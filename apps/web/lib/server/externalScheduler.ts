import { db } from "@/lib/server/db";

const JOB_NAME = "titan-publisher-every-minute";
const JOB_SCHEDULE = "* * * * *";
const DEFAULT_TICK_URL = "https://titanos-dwh6.onrender.com/api/schedule/tick";
const MAX_BOOTSTRAP_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000;

/**
 * Install an idempotent pg_cron + pg_net clock in Titan's existing Supabase
 * database. Named pg_cron jobs are updated in place, so deploy overlap cannot
 * create duplicate clocks.
 */
async function ensureDatabasePublisherClock(): Promise<number | bigint> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET is required");

  const tickUrl = process.env.SCHEDULER_TICK_URL || DEFAULT_TICK_URL;
  const command = `select net.http_post(
    url := '${tickUrl.replaceAll("'", "''")}',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '${cronSecret.replaceAll("'", "''")}'
    ),
    body := '{}'::jsonb
  ) as request_id;`;

  await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_cron");
  await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions");
  const rows = await db.$queryRaw<Array<{ jobid: number | bigint }>>`
    SELECT cron.schedule(${JOB_NAME}, ${JOB_SCHEDULE}, ${command}) AS jobid
  `;
  if (!rows[0]?.jobid) throw new Error("pg_cron returned no job id");
  return rows[0].jobid;
}

const globalForScheduler = globalThis as unknown as { __titanExternalSchedulerStarted?: boolean };

export function startExternalSchedulerBootstrap(): void {
  if (globalForScheduler.__titanExternalSchedulerStarted) return;
  globalForScheduler.__titanExternalSchedulerStarted = true;

  let attempts = 0;
  const bootstrap = async () => {
    attempts += 1;
    try {
      const jobId = await ensureDatabasePublisherClock();
      console.log(`[scheduler] Supabase minute clock active (job ${String(jobId)})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempts < MAX_BOOTSTRAP_ATTEMPTS) {
        console.warn(`[scheduler] clock setup attempt ${attempts} failed; retrying:`, message);
        setTimeout(() => void bootstrap(), RETRY_DELAY_MS);
      } else {
        console.error("[scheduler] could not activate Supabase minute clock:", message);
      }
    }
  };

  void bootstrap();
}

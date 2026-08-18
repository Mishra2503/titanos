export const startJob = async (_i, tool) => ({
  job_id: "job_123", tool, status: "running", note: "Poll get_job_status.",
});
export const getJob = async (_i, id) => ({
  job_id: id, tool: "sync_competitor", status: "done", result: { synced: 12 },
  started_at: "2026-08-18T10:00:00.000Z", finished_at: "2026-08-18T10:01:00.000Z",
});
export const listJobs = async () => [
  { job_id: "job_123", tool: "sync_competitor", status: "done", started_at: null, finished_at: null },
];

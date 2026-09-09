const DEFAULT_TITAN_TICK_URL = "https://titanos-dwh6.onrender.com/api/schedule/tick";

export default {
  async scheduled(_controller, env) {
    const response = await fetch(env.TITAN_TICK_URL || DEFAULT_TITAN_TICK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": env.TITAN_CRON_SECRET,
      },
      body: "{}",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Titan scheduler tick failed (${response.status}): ${body.slice(0, 200)}`);
    }

    console.log("Titan scheduler tick completed", await response.json());
  },
};

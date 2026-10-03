import { postCron } from "./cron-post.mjs";

const started = Date.now();
const budgetMs = 12 * 60 * 1000;
let phase = "full";

for (;;) {
  const result = await postCron("/api/cron/stock-sync", { headers: { "x-stock-sync": phase } });
  if (!result.ok) process.exit(1);
  const stores = Array.isArray(result.body?.stores) ? result.body.stores : [];
  const more = stores.some((store) => store && store.continue === true);
  if (!more) process.exit(0);
  if (Date.now() - started >= budgetMs) {
    console.log(JSON.stringify({
      status: "paused",
      reason: "The daily stock run stopped before the platform limit. Remaining products stay queued.",
    }));
    process.exit(0);
  }
  phase = "push";
  await new Promise((resolve) => setTimeout(resolve, 400));
}

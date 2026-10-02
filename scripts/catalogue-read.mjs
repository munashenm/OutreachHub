import { runCron } from "./cron-post.mjs";

await runCron("/api/cron/catalogue-read");

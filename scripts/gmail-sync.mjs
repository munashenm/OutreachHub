import { runCron } from "./cron-post.mjs";

await runCron("/api/cron/gmail-sync");

import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache needed: every LMS page is dynamic and per-user.
export default defineCloudflareConfig({});

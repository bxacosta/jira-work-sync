// ─── WSync Entry Point ──────────────────────────────────
// Clockify -> Jira Time Sync

import { runCli } from "./cli/index.ts";

// Bun passes args as: [bun, script, ...userArgs]
const args = process.argv.slice(2);

runCli(args).catch((err) => {
    console.error("Fatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
});

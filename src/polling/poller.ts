// ─── Polling Service ────────────────────────────────────
// Periodically fetches recent time entries from Clockify as a fallback.

import type { ClockifyClient } from "../clients/clockify/client.ts";
import { logger } from "../logger/index.ts";
import { getLastSyncedTimestamp } from "../store/sync-repository.ts";
import type { SyncEngine } from "../sync/engine.ts";

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling(
    clockify: ClockifyClient,
    userId: string,
    syncEngine: SyncEngine,
    intervalMinutes: number
): void {
    logger.info("POLL", `Polling every ${intervalMinutes} minutes`);

    // Run first poll after a short delay to let webhooks settle
    const initialDelay = 30_000; // 30 seconds
    setTimeout(() => {
        runPollCycle(clockify, userId, syncEngine);
    }, initialDelay);

    // Schedule recurring polls
    pollTimer = setInterval(() => runPollCycle(clockify, userId, syncEngine), intervalMinutes * 60 * 1000);
}

async function runPollCycle(clockify: ClockifyClient, userId: string, syncEngine: SyncEngine): Promise<void> {
    try {
        // Get the timestamp of the last successfully synced entry
        const lastTs = getLastSyncedTimestamp();
        // Default to 24 hours ago if no previous sync
        const since = lastTs ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        logger.info("POLL", `Checking entries since ${since}...`);

        const entries = await clockify.getTimeEntries(userId, {
            start: since,
            "in-progress": false,
            "page-size": 50,
        });

        // Filter only completed entries (have end time)
        const completed = entries.filter((e) => e.timeInterval.end !== null);

        if (completed.length === 0) {
            logger.info("POLL", "No new completed entries found");
            return;
        }

        let synced = 0;
        let skipped = 0;
        let failed = 0;

        for (const entry of completed) {
            const result = await syncEngine.syncTimeEntry(entry, "polling");
            switch (result.status) {
                case "success":
                    synced++;
                    break;
                case "failed":
                    failed++;
                    break;
                default:
                    skipped++;
                    break;
            }
        }

        logger.info(
            "POLL",
            `Cycle complete: ${completed.length} checked, ${synced} synced, ${skipped} skipped, ${failed} failed`
        );
    } catch (err) {
        logger.error("POLL", `Poll cycle failed: ${(err as Error).message}`, err);
    }
}

export function stopPolling(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        logger.debug("POLL", "Polling stopped");
    }
}

// ─── Polling Service ────────────────────────────────────
// Periodically fetches recent time entries from Clockify as a fallback.

import type { ClockifyClient } from "../clients/clockify/client.ts";
import { logger } from "../logger/index.ts";
import type { SyncEngine } from "../sync/engine.ts";

let pollTimer: ReturnType<typeof setInterval> | null = null;

export interface SyncCycleSummary {
    checked: number;
    failed: number;
    skipped: number;
    synced: number;
}

export function startPolling(
    clockify: ClockifyClient,
    userId: string,
    syncEngine: SyncEngine,
    intervalMinutes: number,
    lookbackMs: number
): void {
    logger.info("POLL", `Polling every ${intervalMinutes} minutes`);

    // Run first poll after a short delay to let webhooks settle
    const initialDelay = 30_000; // 30 seconds
    setTimeout(() => {
        runSyncCycle(clockify, userId, syncEngine, lookbackMs, "POLL");
    }, initialDelay);

    // Schedule recurring polls
    pollTimer = setInterval(
        () => runSyncCycle(clockify, userId, syncEngine, lookbackMs, "POLL"),
        intervalMinutes * 60 * 1000
    );
}

export async function runSyncCycle(
    clockify: ClockifyClient,
    userId: string,
    syncEngine: SyncEngine,
    lookbackMs: number,
    ctx = "POLL"
): Promise<SyncCycleSummary> {
    const summary: SyncCycleSummary = { checked: 0, synced: 0, skipped: 0, failed: 0 };
    try {
        const since = new Date(Date.now() - lookbackMs).toISOString();

        logger.info(ctx, `Checking entries since ${since}...`);

        const entries = await clockify.getTimeEntries(userId, {
            start: since,
            "in-progress": false,
            "page-size": 50,
        });

        // Filter only completed entries (have end time)
        const completed = entries.filter((e) => e.timeInterval.end !== null);
        summary.checked = completed.length;

        if (completed.length === 0) {
            logger.info(ctx, "No new completed entries found");
            return summary;
        }

        for (const entry of completed) {
            const result = await syncEngine.syncTimeEntry(entry, "polling");
            switch (result.status) {
                case "success":
                    summary.synced++;
                    break;
                case "failed":
                    summary.failed++;
                    break;
                default:
                    summary.skipped++;
                    break;
            }
        }

        logger.info(
            ctx,
            `Cycle complete: ${summary.checked} checked, ${summary.synced} synced, ${summary.skipped} skipped, ${summary.failed} failed`
        );
    } catch (err) {
        logger.error(ctx, `Sync cycle failed: ${(err as Error).message}`, err);
    }
    return summary;
}

export function stopPolling(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        logger.debug("POLL", "Polling stopped");
    }
}

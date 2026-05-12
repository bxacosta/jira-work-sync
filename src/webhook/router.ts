// ─── Webhook Router ─────────────────────────────────────
// Handles incoming webhook events and routes them to the sync engine.

import type { ClockifyTimeEntry } from "../clients/clockify/types.ts";
import { logger } from "../logger/index.ts";
import type { SyncEngine } from "../sync/engine.ts";

/**
 * Processes a webhook payload from Clockify.
 * Returns immediately and processes the sync asynchronously.
 */
export function handleWebhookEvent(body: unknown, syncEngine: SyncEngine): void {
    // The webhook payload can come in different shapes depending on configuration.
    // We handle both direct time entry objects and wrapped event objects.
    const payload = body as Record<string, unknown>;

    // Try to detect the event type
    // Some webhooks send { event: "TIMER_STOPPED", payload: { ... } }
    // Others may send the time entry directly
    let eventType: string | undefined;
    let timeEntry: ClockifyTimeEntry;

    if (payload.event && payload.payload) {
        eventType = payload.event as string;
        timeEntry = payload.payload as ClockifyTimeEntry;
    } else if (payload.id && payload.timeInterval) {
        // Direct time entry object
        eventType = "TIMER_STOPPED";
        timeEntry = payload as unknown as ClockifyTimeEntry;
    } else {
        logger.warn("WEBHOOK", `Unrecognized payload structure: ${JSON.stringify(payload).slice(0, 200)}`);
        return;
    }

    logger.info("WEBHOOK", `Received ${eventType} for entry ${timeEntry.id}`);

    // Only process TIMER_STOPPED and NEW_TIME_ENTRY events
    const syncEvents: string[] = ["TIMER_STOPPED", "NEW_TIME_ENTRY", "TIME_ENTRY_UPDATED"];
    if (!syncEvents.includes(eventType)) {
        logger.debug("WEBHOOK", `Ignoring event type: ${eventType}`);
        return;
    }

    // Process async — don't block the webhook response
    syncEngine.syncTimeEntry(timeEntry, "webhook").catch((err) => {
        logger.error("WEBHOOK", `Async sync failed for ${timeEntry.id}: ${(err as Error).message}`, err);
    });
}

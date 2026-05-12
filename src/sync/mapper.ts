// ─── Mapper ─────────────────────────────────────────────
// Maps Clockify time entry data to a Jira worklog creation payload.

import type { ClockifyTimeEntry } from "../clients/clockify/types.ts";
import { JiraClient } from "../clients/jira/client.ts";
import type { CreateWorklogPayload } from "../clients/jira/types.ts";
import { appSignature } from "../constants.ts";

/**
 * Calculates duration in seconds from the time interval.
 * If duration string is available (ISO 8601), parses it.
 * Otherwise, calculates from start/end timestamps.
 */
export function calculateDurationSeconds(entry: ClockifyTimeEntry): number {
    const start = new Date(entry.timeInterval.start);
    const end = entry.timeInterval.end ? new Date(entry.timeInterval.end) : new Date();
    return Math.round((end.getTime() - start.getTime()) / 1000);
}

/**
 * Formats a UTC ISO string to the format Jira expects for the `started` field.
 * Jira v3 expects: "2026-05-11T14:00:00.000+0000"
 */
export function formatJiraStarted(isoString: string): string {
    const date = new Date(isoString);
    // Jira expects the format with timezone offset
    // We send as UTC (+0000)
    const pad = (n: number, digits = 2) => String(n).padStart(digits, "0");

    const y = date.getUTCFullYear();
    const m = pad(date.getUTCMonth() + 1);
    const d = pad(date.getUTCDate());
    const h = pad(date.getUTCHours());
    const min = pad(date.getUTCMinutes());
    const s = pad(date.getUTCSeconds());
    const ms = pad(date.getUTCMilliseconds(), 3);

    return `${y}-${m}-${d}T${h}:${min}:${s}.${ms}+0000`;
}

/**
 * Formats a duration in seconds to a human-readable string.
 */
export function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) {
        return `${h}h ${m}m`;
    }
    if (h > 0) {
        return `${h}h`;
    }
    return `${m}m`;
}

/**
 * Maps a Clockify time entry to a Jira worklog creation payload.
 * Uses Jira's issue summary for the comment (not the full Clockify description).
 */
export function mapToWorklog(
    entry: ClockifyTimeEntry,
    issueKey: string,
    issueSummary: string,
    source: "webhook" | "polling"
): CreateWorklogPayload {
    const durationSeconds = calculateDurationSeconds(entry);
    const started = formatJiraStarted(entry.timeInterval.start);

    // Comment: [ISSUE-KEY]: ISSUE SUMMARY (synced by WSync)
    const commentText = `[${issueKey}]: ${issueSummary} ${appSignature()}`;

    return {
        timeSpentSeconds: durationSeconds,
        started,
        comment: JiraClient.buildAdfComment(commentText),
        properties: JiraClient.buildWorklogProperties(entry.id, source),
    };
}

// ─── Sync Filter ────────────────────────────────────────
// Determines if a time entry should be synced based on metadata and blacklist.

import type { ClockifyTimeEntry } from "../clients/clockify/types.ts";
import type { BlacklistConfig } from "../config/schema.ts";

export interface FilterResult {
    level: "info" | "warn";
    reason: string;
    shouldSync: boolean;
}

const PASS: FilterResult = { shouldSync: true, reason: "", level: "info" };

export function filterTimeEntry(
    entry: ClockifyTimeEntry,
    issueKey: string | null,
    blacklist: BlacklistConfig
): FilterResult {
    // Check: entry has project assigned
    if (!entry.projectId) {
        return { shouldSync: false, reason: "Entry has no project assigned", level: "warn" };
    }

    // Check: entry has task assigned
    if (!entry.taskId) {
        return { shouldSync: false, reason: "Entry has no task assigned", level: "warn" };
    }

    // Check: entry has completed (has end time)
    if (!entry.timeInterval.end) {
        return { shouldSync: false, reason: "Entry is still in progress (no end time)", level: "info" };
    }

    // Check: issue key could be extracted
    if (!issueKey) {
        return { shouldSync: false, reason: "No Jira issue key found in task name or description", level: "warn" };
    }

    // Blacklist checks
    if (blacklist.jiraKeys.includes(issueKey)) {
        return { shouldSync: false, reason: `Issue key ${issueKey} is blacklisted`, level: "info" };
    }

    if (blacklist.clockifyProjectIds.includes(entry.projectId)) {
        return { shouldSync: false, reason: `Project ${entry.projectId} is blacklisted`, level: "info" };
    }

    if (entry.taskId && blacklist.clockifyTaskIds.includes(entry.taskId)) {
        return { shouldSync: false, reason: `Task ${entry.taskId} is blacklisted`, level: "info" };
    }

    return PASS;
}

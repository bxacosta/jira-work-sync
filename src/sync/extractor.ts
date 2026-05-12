// ─── Issue Key Extractor ────────────────────────────────
// Extracts Jira issue key from Clockify time entry metadata.
// Primary: task name. Fallback: description regex.

import type { ClockifyTask } from "../clients/clockify/types.ts";

const ISSUE_KEY_REGEX = /([A-Z][A-Z0-9]+-\d+)/;

export interface ExtractionResult {
    issueKey: string;
    source: "task" | "description";
}

/**
 * Extracts a Jira issue key from a Clockify task name.
 * The Jira plugin typically creates tasks with names like "MPO-4986" or
 * "[MPO-4986]: CAMBIO -- description". The exact format depends on the plugin
 * config, so we use regex to find the pattern.
 */
export function extractFromTask(task: ClockifyTask): string | null {
    const match = task.name.match(ISSUE_KEY_REGEX);
    return match?.[1] ?? null;
}

/**
 * Extracts a Jira issue key from a time entry description.
 * Example: "[MPO-4986]: CAMBIO -- LEVANTAR EL ENTORNO LOCAL"
 */
export function extractFromDescription(description: string): string | null {
    if (!description) {
        return null;
    }
    const match = description.match(ISSUE_KEY_REGEX);
    return match?.[1] ?? null;
}

/**
 * Combined extraction: tries task first, then description.
 */
export function extractIssueKey(task: ClockifyTask | null, description: string): ExtractionResult | null {
    // Primary: task metadata
    if (task) {
        const key = extractFromTask(task);
        if (key) {
            return { issueKey: key, source: "task" };
        }
    }

    // Fallback: description
    const key = extractFromDescription(description);
    if (key) {
        return { issueKey: key, source: "description" };
    }

    return null;
}

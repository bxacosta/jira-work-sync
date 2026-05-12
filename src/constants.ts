// ─── App Constants ──────────────────────────────────────
// Single source of truth for app-wide constants.

export const APP_NAME = "WSync";
export const APP_VERSION = "0.1.0";
export const APP_DESCRIPTION = "Clockify -> Jira Time Sync";
export const JIRA_PROPERTY_KEY = "com.wsync.clockify-entry";
export const PID_FILE = "./data/wsync.pid";
export const DEFAULT_PORT = 3100;

/** Signature line appended to Jira worklog comments */
export function appSignature(): string {
    return `(synced by ${APP_NAME})`;
}

/** Format any value as indented JSON for debug logging */
export function formatJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 4);
    } catch {
        return String(value);
    }
}

// ─── Sync Repository ────────────────────────────────────
// CRUD operations for sync_records table.

import { getDatabase } from "./database.ts";

export type SyncStatus = "success" | "skipped" | "failed" | "blacklisted";

export interface SyncRecord {
    clockify_entry_id: string;
    duration_seconds: number;
    error_message: string | null;
    id?: number;
    jira_issue_key: string;
    jira_worklog_id: string | null;
    source: "webhook" | "polling";
    started_at: string;
    status: SyncStatus;
    synced_at?: string;
}

export function findByClockifyEntryId(entryId: string): SyncRecord | null {
    const db = getDatabase();
    const row = db.query("SELECT * FROM sync_records WHERE clockify_entry_id = ?").get(entryId) as SyncRecord | null;
    return row;
}

export function createSyncRecord(record: Omit<SyncRecord, "id" | "synced_at">): SyncRecord {
    const db = getDatabase();
    const stmt = db.prepare(
        `INSERT INTO sync_records (clockify_entry_id, jira_issue_key, jira_worklog_id, duration_seconds, started_at, status, error_message, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
        record.clockify_entry_id,
        record.jira_issue_key,
        record.jira_worklog_id,
        record.duration_seconds,
        record.started_at,
        record.status,
        record.error_message,
        record.source
    );

    const inserted = findByClockifyEntryId(record.clockify_entry_id);
    if (!inserted) {
        throw new Error(`Failed to retrieve sync record after insert: ${record.clockify_entry_id}`);
    }
    return inserted;
}

export function updateSyncStatus(clockifyEntryId: string, status: SyncStatus, errorMessage?: string): void {
    const db = getDatabase();
    db.prepare("UPDATE sync_records SET status = ?, error_message = ? WHERE clockify_entry_id = ?").run(
        status,
        errorMessage ?? null,
        clockifyEntryId
    );
}

export function getRecentRecords(limit = 20): SyncRecord[] {
    const db = getDatabase();
    return db.query("SELECT * FROM sync_records ORDER BY synced_at DESC LIMIT ?").all(limit) as SyncRecord[];
}

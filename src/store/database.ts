// ─── Database ───────────────────────────────────────────
// SQLite connection with auto-migration on init.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../logger/index.ts";

let db: Database | null = null;

const MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS sync_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clockify_entry_id TEXT UNIQUE NOT NULL,
    jira_issue_key TEXT NOT NULL,
    jira_worklog_id TEXT,
    duration_seconds INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'success',
    error_message TEXT,
    source TEXT NOT NULL DEFAULT 'webhook'
  )`,
    "CREATE INDEX IF NOT EXISTS idx_sync_clockify_id ON sync_records(clockify_entry_id)",
    "CREATE INDEX IF NOT EXISTS idx_sync_jira_key ON sync_records(jira_issue_key)",
    "CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_records(status)",
];

export function initDatabase(dbPath: string): Database {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        logger.debug("DB", `Created data directory: ${dir}`);
    }

    db = new Database(dbPath, { strict: true });

    // Enable WAL mode for better concurrent read/write
    db.run("PRAGMA journal_mode=WAL");

    // Run migrations
    for (const sql of MIGRATIONS) {
        db.run(sql);
    }

    logger.info("DB", `Database initialized: ${dbPath}`);
    return db;
}

export function getDatabase(): Database {
    if (!db) {
        throw new Error("Database not initialized. Call initDatabase() first.");
    }
    return db;
}

export function closeDatabase(): void {
    if (db) {
        db.close();
        db = null;
        logger.debug("DB", "Database connection closed");
    }
}

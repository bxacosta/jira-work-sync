// ─── Sync Engine ────────────────────────────────────────
// Orchestrates the full sync flow for a single time entry.

import type { ClockifyClient } from "../clients/clockify/client.ts";
import type { ClockifyTask, ClockifyTimeEntry } from "../clients/clockify/types.ts";
import type { JiraClient } from "../clients/jira/client.ts";
import type { AppConfig } from "../config/schema.ts";
import { logger } from "../logger/index.ts";
import { createSyncRecord, findByClockifyEntryId, type SyncRecord } from "../store/sync-repository.ts";
import { extractIssueKey } from "./extractor.ts";
import { filterTimeEntry } from "./filter.ts";
import { calculateDurationSeconds, formatDuration, formatEntryInterval, mapToWorklog } from "./mapper.ts";

export type SyncResultStatus = "success" | "skipped" | "failed" | "blacklisted";

export interface SyncResult {
    details: string;
    issueKey: string | null;
    status: SyncResultStatus;
}

// Simple in-memory cache for tasks to avoid repeated API calls
const taskCache = new Map<string, ClockifyTask>();

const LOG_CTX = "SYNC";

export class SyncEngine {
    private readonly clockify: ClockifyClient;
    private readonly jira: JiraClient;
    private readonly config: AppConfig;
    private readonly dryRun: boolean;
    private readonly userTimezone: string;

    constructor(clockify: ClockifyClient, jira: JiraClient, config: AppConfig, dryRun = false, userTimezone = "UTC") {
        this.clockify = clockify;
        this.jira = jira;
        this.config = config;
        this.dryRun = dryRun;
        this.userTimezone = userTimezone;
    }

    /** Tag prefix added to engine logs when dry-run is active. */
    private get tag(): string {
        return this.dryRun ? "[DRY-RUN] " : "";
    }

    /** Persists a sync record unless dry-run is active. */
    private writeRecord(record: Omit<SyncRecord, "id" | "synced_at">): void {
        if (this.dryRun) {
            return;
        }
        createSyncRecord(record);
    }

    /** Fetches a Clockify task, using an in-memory cache to avoid redundant API calls. */
    private async resolveTask(
        projectId: string | null | undefined,
        taskId: string | null | undefined
    ): Promise<ClockifyTask | null> {
        if (!(projectId && taskId)) {
            return null;
        }
        const cacheKey = `${projectId}:${taskId}`;
        const cached = taskCache.get(cacheKey);
        if (cached) {
            return cached;
        }
        try {
            const task = await this.clockify.getTask(projectId, taskId);
            taskCache.set(cacheKey, task);
            return task;
        } catch (err) {
            logger.warn(LOG_CTX, `Could not resolve task ${taskId}: ${(err as Error).message}`);
            return null;
        }
    }

    /** Persists a skipped/blacklisted record and returns the corresponding SyncResult. */
    private recordSkip(
        entry: ClockifyTimeEntry,
        issueKey: string | null,
        source: "webhook" | "polling",
        filterResult: { reason: string; level: string }
    ): SyncResult {
        const entryId = entry.id;
        const label = issueKey ? `[${issueKey}]` : `[${entryId.slice(0, 8)}...]`;
        const dur = entry.timeInterval.end ? ` ${formatDuration(calculateDurationSeconds(entry))}` : "";
        const interval = formatEntryInterval(entry.timeInterval.start, entry.timeInterval.end, this.userTimezone);
        const logMsg = `${this.tag}SKIP ${label}${dur} | ${interval} -> ${filterResult.reason}`;
        if (filterResult.level === "warn") {
            logger.warn(LOG_CTX, logMsg);
        } else {
            logger.info(LOG_CTX, logMsg);
        }
        const status: SyncResultStatus = filterResult.reason.includes("blacklisted") ? "blacklisted" : "skipped";
        this.writeRecord({
            clockify_entry_id: entryId,
            jira_issue_key: issueKey ?? "UNKNOWN",
            jira_worklog_id: null,
            duration_seconds: entry.timeInterval.end ? calculateDurationSeconds(entry) : 0,
            started_at: entry.timeInterval.start,
            status,
            error_message: filterResult.reason,
            source,
        });
        return { status, issueKey, details: filterResult.reason };
    }

    /** Returns the worklog ID if an entry is already logged in Jira, otherwise null. */
    private async findJiraDuplicateWorklog(key: string, entryId: string, startMs: number): Promise<string | null> {
        const worklogs = await this.jira.getWorklogs(key, startMs);
        for (const wl of worklogs) {
            const prop = await this.jira.getWorklogProperty(key, wl.id);
            if (prop && prop.clockifyEntryId === entryId) {
                return wl.id;
            }
        }
        return null;
    }

    async syncTimeEntry(entry: ClockifyTimeEntry, source: "webhook" | "polling"): Promise<SyncResult> {
        const entryId = entry.id;

        try {
            // Step 1: Check if already synced in local DB
            const existing = findByClockifyEntryId(entryId);
            if (existing && existing.status === "success") {
                logger.debug(LOG_CTX, `Entry ${entryId} already synced, skip`);
                return { status: "skipped", issueKey: existing.jira_issue_key, details: "Already synced" };
            }

            // Step 2: Resolve task metadata
            const task = await this.resolveTask(entry.projectId, entry.taskId);

            // Step 3: Extract issue key
            const extraction = extractIssueKey(task, entry.description);
            const issueKey = extraction?.issueKey ?? null;

            // Step 4: Apply filters
            const filterResult = filterTimeEntry(entry, issueKey, this.config.sync.blacklist);
            if (!filterResult.shouldSync) {
                return this.recordSkip(entry, issueKey, source, filterResult);
            }

            // issueKey is guaranteed non-null after filter passes
            if (!issueKey) {
                return { status: "skipped", issueKey: null, details: "No issue key after filter (unexpected)" };
            }
            const key = issueKey;
            const keySource = extraction?.source === "task" ? "task metadata" : "description";
            logger.debug(LOG_CTX, `Issue key ${key} extracted from ${keySource}`);

            // Pre-compute duration and interval — shared across steps 5-8 log lines
            const duration = formatDuration(calculateDurationSeconds(entry));
            const interval = formatEntryInterval(entry.timeInterval.start, entry.timeInterval.end, this.userTimezone);

            // Step 5: Validate issue exists in Jira
            const issue = await this.jira.getIssue(key);
            if (!issue) {
                logger.warn(LOG_CTX, `${this.tag}FAILED [${key}] ${duration} | ${interval} -> issue not found in Jira`);
                this.writeRecord({
                    clockify_entry_id: entryId,
                    jira_issue_key: key,
                    jira_worklog_id: null,
                    duration_seconds: calculateDurationSeconds(entry),
                    started_at: entry.timeInterval.start,
                    status: "failed",
                    error_message: `Issue ${key} not found in Jira`,
                    source,
                });
                return { status: "failed", issueKey: key, details: `Issue ${key} not found in Jira` };
            }

            // Step 6: Check for duplicates in Jira (via worklog properties)
            const startMs = new Date(entry.timeInterval.start).getTime() - 24 * 60 * 60 * 1000;
            const duplicateWorklogId = await this.findJiraDuplicateWorklog(key, entryId, startMs);
            if (duplicateWorklogId) {
                logger.info(LOG_CTX, `${this.tag}SKIP [${key}] ${duration} | ${interval} -> duplicate (worklog #${duplicateWorklogId})`);
                this.writeRecord({
                    clockify_entry_id: entryId,
                    jira_issue_key: key,
                    jira_worklog_id: duplicateWorklogId,
                    duration_seconds: calculateDurationSeconds(entry),
                    started_at: entry.timeInterval.start,
                    status: "skipped",
                    error_message: "Duplicate: already exists in Jira",
                    source,
                });
                return { status: "skipped", issueKey: key, details: "Duplicate in Jira" };
            }

            // Step 7: Create worklog in Jira (skipped in dry-run)
            const payload = mapToWorklog(entry, key, issue.fields.summary, source);

            if (this.dryRun) {
                logger.info(LOG_CTX, `[DRY-RUN] WOULD SYNC [${key}] ${duration} | ${interval}`);
                return { status: "success", issueKey: key, details: `[DRY-RUN] Would sync ${duration}` };
            }

            const worklog = await this.jira.addWorklog(key, payload);

            // Step 8: Record success
            this.writeRecord({
                clockify_entry_id: entryId,
                jira_issue_key: key,
                jira_worklog_id: worklog.id,
                duration_seconds: payload.timeSpentSeconds,
                started_at: entry.timeInterval.start,
                status: "success",
                error_message: null,
                source,
            });

            logger.info(LOG_CTX, `SYNCED [${key}] ${duration} | ${interval} -> worklog #${worklog.id}`);
            return { status: "success", issueKey: key, details: `Synced ${duration}` };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(LOG_CTX, `${this.tag}Entry ${entryId} -- ${message}`, err);

            // Try to record the failure
            try {
                this.writeRecord({
                    clockify_entry_id: entryId,
                    jira_issue_key: "ERROR",
                    jira_worklog_id: null,
                    duration_seconds: 0,
                    started_at: entry.timeInterval.start,
                    status: "failed",
                    error_message: message,
                    source,
                });
            } catch {
                // Best effort — if DB write fails too, just log it
            }

            return { status: "failed", issueKey: null, details: message };
        }
    }
}

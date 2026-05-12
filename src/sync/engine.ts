// ─── Sync Engine ────────────────────────────────────────
// Orchestrates the full sync flow for a single time entry.

import type { ClockifyClient } from "../clients/clockify/client.ts";
import type { ClockifyTask, ClockifyTimeEntry } from "../clients/clockify/types.ts";
import type { JiraClient } from "../clients/jira/client.ts";
import type { AppConfig } from "../config/schema.ts";
import { logger } from "../logger/index.ts";
import { createSyncRecord, findByClockifyEntryId } from "../store/sync-repository.ts";
import { extractIssueKey } from "./extractor.ts";
import { filterTimeEntry } from "./filter.ts";
import { calculateDurationSeconds, formatDuration, mapToWorklog } from "./mapper.ts";

export type SyncResultStatus = "success" | "skipped" | "failed" | "blacklisted";

export interface SyncResult {
    details: string;
    issueKey: string | null;
    status: SyncResultStatus;
}

// Simple in-memory cache for tasks to avoid repeated API calls
const taskCache = new Map<string, ClockifyTask>();

export class SyncEngine {
    private readonly clockify: ClockifyClient;
    private readonly jira: JiraClient;
    private readonly config: AppConfig;

    constructor(clockify: ClockifyClient, jira: JiraClient, config: AppConfig) {
        this.clockify = clockify;
        this.jira = jira;
        this.config = config;
    }

    /** Fetches a Clockify task, using an in-memory cache to avoid redundant API calls. */
    private async resolveTask(
        projectId: string | null | undefined,
        taskId: string | null | undefined,
        ctx: string
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
            logger.warn(ctx, `Could not resolve task ${taskId}: ${(err as Error).message}`);
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
        const ctx = source.toUpperCase();
        if (filterResult.level === "warn") {
            logger.warn(ctx, `SKIP ${entryId} -- ${filterResult.reason}`);
        } else {
            logger.info(ctx, `SKIP ${entryId} -- ${filterResult.reason}`);
        }
        const status: SyncResultStatus = filterResult.reason.includes("blacklisted") ? "blacklisted" : "skipped";
        createSyncRecord({
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
        const ctx = source.toUpperCase();

        try {
            // Step 1: Check if already synced in local DB
            const existing = findByClockifyEntryId(entryId);
            if (existing && existing.status === "success") {
                logger.debug(ctx, `Entry ${entryId} already synced, skip`);
                return { status: "skipped", issueKey: existing.jira_issue_key, details: "Already synced" };
            }

            // Step 2: Resolve task metadata
            const task = await this.resolveTask(entry.projectId, entry.taskId, ctx);

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
            logger.debug(ctx, `Issue key ${key} extracted from ${keySource}`);

            // Step 5: Validate issue exists in Jira
            const issue = await this.jira.getIssue(key);
            if (!issue) {
                logger.warn(ctx, `${key} -- Issue not found in Jira`);
                createSyncRecord({
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
                logger.info(ctx, `SKIP ${key} -- Duplicate detected in Jira (worklog ${duplicateWorklogId})`);
                createSyncRecord({
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

            // Step 7: Create worklog in Jira
            const payload = mapToWorklog(entry, key, issue.fields.summary, source);
            const worklog = await this.jira.addWorklog(key, payload);
            const duration = formatDuration(payload.timeSpentSeconds);

            // Step 8: Record success
            createSyncRecord({
                clockify_entry_id: entryId,
                jira_issue_key: key,
                jira_worklog_id: worklog.id,
                duration_seconds: payload.timeSpentSeconds,
                started_at: entry.timeInterval.start,
                status: "success",
                error_message: null,
                source,
            });

            logger.info(ctx, `SYNCED [${key}] ${duration} -> Jira worklog #${worklog.id}`);
            return { status: "success", issueKey: key, details: `Synced ${duration}` };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(ctx, `Entry ${entryId} -- ${message}`, err);

            // Try to record the failure
            try {
                createSyncRecord({
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

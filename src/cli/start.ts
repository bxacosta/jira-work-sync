// ─── CLI: Start Command ─────────────────────────────────
// Initializes all services and starts the application.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ClockifyClient } from "../clients/clockify/client.ts";
import { JiraClient } from "../clients/jira/client.ts";
import { parseDurationMs } from "../config/duration.ts";
import type { AppConfig } from "../config/schema.ts";
import { APP_DESCRIPTION, APP_VERSION, PID_FILE } from "../constants.ts";
import { logger } from "../logger/index.ts";
import { runSyncCycle, startPolling, stopPolling } from "../polling/poller.ts";
import { closeDatabase, initDatabase } from "../store/database.ts";
import { SyncEngine } from "../sync/engine.ts";
import { startWebhookServer, stopWebhookServer } from "../webhook/server.ts";

export interface StartOptions {
    dryRun: boolean;
}

function printBanner() {
    const d = "\x1b[2m"; // dim
    const r = "\x1b[0m"; // reset

    logger.raw("");
    logger.raw("  ██╗    ██╗███████╗██╗   ██╗███╗   ██╗ ██████╗");
    logger.raw("  ██║    ██║██╔════╝╚██╗ ██╔╝████╗  ██║██╔════╝");
    logger.raw("  ██║ █╗ ██║███████╗ ╚████╔╝ ██╔██╗ ██║██║     ");
    logger.raw("  ██║███╗██║╚════██║  ╚██╔╝  ██║╚██╗██║██║     ");
    logger.raw("  ╚███╔███╔╝███████║   ██║   ██║ ╚████║╚██████╗");
    logger.raw("   ╚══╝╚══╝ ╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝");
    logger.raw(`${d}  v${APP_VERSION}  --  ${APP_DESCRIPTION}${r}`);
    logger.raw("");
}

function writePidFile() {
    const dir = dirname(PID_FILE);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(PID_FILE, String(process.pid));
}

function removePidFile() {
    try {
        if (existsSync(PID_FILE)) {
            unlinkSync(PID_FILE);
        }
    } catch {
        /* best effort */
    }
}

export async function startCommand(config: AppConfig, opts: StartOptions): Promise<void> {
    printBanner();

    if (opts.dryRun) {
        logger.warn("APP", "DRY-RUN mode -- no worklogs will be created and no sync records will be persisted.");
    }

    // Check if already running
    if (existsSync(PID_FILE)) {
        const pid = Number.parseInt(Bun.file(PID_FILE).toString(), 10);
        logger.warn("APP", `PID file exists (pid ${pid}). Another instance may be running.`);
        logger.warn("APP", `If not, delete ${PID_FILE} manually and retry.`);
    }

    // Write PID file
    writePidFile();

    // Initialize database
    initDatabase(config.database.path);

    // Initialize API clients
    const clockify = new ClockifyClient(config.clockify.apiKey, config.clockify.workspaceId);
    const jira = new JiraClient(config.jira.baseUrl, config.jira.email, config.jira.apiToken);

    // Validate credentials
    logger.info("APP", "Validating credentials...");

    let userId: string;
    try {
        const clockifyUser = await clockify.getCurrentUser();
        userId = clockifyUser.id;
        logger.info("APP", `Clockify: ${clockifyUser.name} (${clockifyUser.email})`);
    } catch (err) {
        logger.error("APP", "Failed to authenticate with Clockify. Check your API key.", err);
        removePidFile();
        process.exit(1);
    }

    try {
        const jiraUser = await jira.getMyself();
        logger.info("APP", `Jira: ${jiraUser.displayName} (${jiraUser.emailAddress ?? "no email"})`);
    } catch (err) {
        logger.error("APP", "Failed to authenticate with Jira. Check your credentials.", err);
        removePidFile();
        process.exit(1);
    }

    const lookbackMs = parseDurationMs(config.sync.lookbackWindow);

    // Print config summary
    logger.raw("");
    logger.info("APP", `Webhook:   ${config.webhook.enabled ? `port ${config.webhook.port}` : "disabled"}`);
    logger.info(
        "APP",
        `Polling:   ${config.polling.enabled ? `every ${config.polling.intervalMinutes} min` : "disabled"}`
    );
    logger.info("APP", `Lookback:  ${config.sync.lookbackWindow}`);

    const bl = config.sync.blacklist;
    const blCount = bl.jiraKeys.length + bl.clockifyProjectIds.length + bl.clockifyTaskIds.length;
    logger.info("APP", `Blacklist: ${blCount} rule(s)`);
    logger.raw("");

    // Create sync engine
    const syncEngine = new SyncEngine(clockify, jira, config, opts.dryRun);

    // One-shot mode: when both webhook and polling are disabled, run a single sync cycle and exit.
    if (!(config.webhook.enabled || config.polling.enabled)) {
        logger.info("APP", "Webhook and polling are disabled -- running a single sync cycle.");
        await runSyncCycle(clockify, userId, syncEngine, lookbackMs, "SYNC");
        closeDatabase();
        removePidFile();
        logger.info("APP", "Done.");
        return;
    }

    // Start webhook server (if enabled)
    if (config.webhook.enabled) {
        startWebhookServer(config.webhook.port, config.webhook.secret, syncEngine);
    } else {
        logger.info("WEBHOOK", "Webhook disabled -- running in polling-only mode");
    }

    // Start polling (if enabled)
    if (config.polling.enabled) {
        startPolling(clockify, userId, syncEngine, config.polling.intervalMinutes, lookbackMs);
    } else {
        logger.info("POLL", "Polling disabled by configuration");
    }

    logger.raw("");
    logger.info("APP", "Service is running. Press Ctrl+C to stop.");

    // Graceful shutdown
    const shutdown = () => {
        logger.raw("");
        logger.info("APP", "Shutting down...");
        stopPolling();
        stopWebhookServer();
        closeDatabase();
        removePidFile();
        logger.info("APP", "Goodbye!");
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Handle uncaught errors without crashing
    process.on("uncaughtException", (err) => {
        logger.error("APP", `Uncaught exception: ${err.message}`, err);
    });

    process.on("unhandledRejection", (reason) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        logger.error("APP", `Unhandled rejection: ${message}`, reason);
    });
}

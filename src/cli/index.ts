// ─── CLI Router ─────────────────────────────────────────
// Routes CLI commands to their handlers.

import { loadConfig } from "../config/loader.ts";
import { APP_NAME, PID_FILE } from "../constants.ts";
import { logger } from "../logger/index.ts";
import { startCommand } from "./start.ts";
import { statusCommand } from "./status.ts";

const COMMANDS = ["start", "stop", "status"] as const;
type Command = (typeof COMMANDS)[number];

function printUsage(): void {
    logger.raw("Usage: wsync <command>");
    logger.raw("");
    logger.raw("Commands:");
    logger.raw("  start    Start the sync service");
    logger.raw("  status   Check if the service is running");
    logger.raw("  stop     Stop the running service (sends SIGTERM)");
    logger.raw("");
    logger.raw("Options:");
    logger.raw("  --config <path>  Path to config file (default: ./config.json)");
    logger.raw("  --debug          Enable debug logging");
}

export async function runCli(args: string[]): Promise<void> {
    // Parse args
    const command = args.find((a) => !a.startsWith("--")) as Command | undefined;
    const configPath = args.includes("--config") ? args[args.indexOf("--config") + 1] : undefined;
    const debug = args.includes("--debug");

    if (debug) {
        logger.setDebug(true);
    }

    if (!(command && COMMANDS.includes(command))) {
        printUsage();
        process.exit(command ? 1 : 0);
    }

    switch (command) {
        case "start": {
            const config = await loadConfig(configPath);
            await startCommand(config);
            break;
        }

        case "status": {
            await statusCommand();
            break;
        }

        case "stop": {
            // Read PID and send SIGTERM
            const { existsSync } = await import("node:fs");
            if (!existsSync(PID_FILE)) {
                logger.info("STOP", `${APP_NAME} is not running (no PID file)`);
                process.exit(0);
            }
            const pid = Number.parseInt(await Bun.file(PID_FILE).text(), 10);
            try {
                process.kill(pid, "SIGTERM");
                logger.info("STOP", `Sent SIGTERM to process ${pid}`);
            } catch {
                logger.warn("STOP", `Process ${pid} not found. Removing stale PID file.`);
                const { unlinkSync } = await import("node:fs");
                unlinkSync(PID_FILE);
            }
            break;
        }

        default:
            break;
    }
}

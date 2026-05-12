// ─── CLI: Status Command ────────────────────────────────
// Shows if the service is running and basic health info.

import { existsSync } from "node:fs";
import { APP_NAME, PID_FILE } from "../constants.ts";
import { logger } from "../logger/index.ts";

export async function statusCommand(): Promise<void> {
    if (!existsSync(PID_FILE)) {
        logger.info("STATUS", `${APP_NAME} is not running (no PID file found)`);
        return;
    }

    const pidContent = await Bun.file(PID_FILE).text();
    const pid = Number.parseInt(pidContent.trim(), 10);

    if (Number.isNaN(pid)) {
        logger.warn("STATUS", `Invalid PID file content: ${pidContent}`);
        return;
    }

    logger.info("STATUS", `${APP_NAME} appears to be running (PID: ${pid})`);

    // Try health check
    try {
        // We don't know the port from the PID file alone, try default
        const res = await fetch("http://localhost:3100/health", { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
            const data = (await res.json()) as { status: string; uptime: number };
            const uptimeMin = Math.floor(data.uptime / 60);
            logger.info("STATUS", `Health: ${data.status} | Uptime: ${uptimeMin}m`);
        }
    } catch {
        logger.warn("STATUS", "Could not reach health endpoint (port 3100). Service may be on a different port.");
    }
}

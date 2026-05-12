// ─── Webhook Server ─────────────────────────────────────
// HTTP server using Bun.serve to receive Clockify webhooks.

import type { Server } from "bun";
import { logger } from "../logger/index.ts";
import type { SyncEngine } from "../sync/engine.ts";
import { handleWebhookEvent } from "./router.ts";
import { verifySignature } from "./verify.ts";

let server: Server<undefined> | null = null;
const startedAt = Date.now();

export function startWebhookServer(port: number, secret: string, syncEngine: SyncEngine): Server<undefined> {
    server = Bun.serve({
        port,
        async fetch(req: Request): Promise<Response> {
            const url = new URL(req.url);

            // Health check
            if (req.method === "GET" && url.pathname === "/health") {
                const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
                return Response.json({ status: "ok", uptime: uptimeSeconds });
            }

            // Webhook endpoint
            if (req.method === "POST" && url.pathname === "/webhook/clockify") {
                const rawBody = await req.text();
                const signature = req.headers.get("clockify-signature");

                // Verify signature
                const isValid = await verifySignature(rawBody, signature, secret);
                if (!isValid) {
                    logger.warn("WEBHOOK", "Invalid signature — rejecting request");
                    return new Response("Unauthorized", { status: 401 });
                }

                // Parse body
                let body: unknown;
                try {
                    body = JSON.parse(rawBody);
                } catch {
                    logger.warn("WEBHOOK", "Invalid JSON body");
                    return new Response("Bad Request", { status: 400 });
                }

                // Handle event (async, don't wait)
                handleWebhookEvent(body, syncEngine);

                // Respond immediately to Clockify
                return Response.json({ received: true });
            }

            return new Response("Not Found", { status: 404 });
        },
    });

    logger.info("WEBHOOK", `Server listening on port ${port}`);
    logger.info("WEBHOOK", `Endpoint: POST http://localhost:${port}/webhook/clockify`);
    logger.info("WEBHOOK", `Health:   GET  http://localhost:${port}/health`);

    return server;
}

export function stopWebhookServer(): void {
    if (server) {
        server.stop(true);
        server = null;
        logger.debug("WEBHOOK", "Server stopped");
    }
}

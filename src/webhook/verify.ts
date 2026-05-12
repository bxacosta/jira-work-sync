// ─── Webhook Signature Verification ─────────────────────

import { logger } from "../logger/index.ts";

/**
 * Verifies a Clockify webhook signature using HMAC-SHA256.
 * The signature is computed over the raw request body using the webhook secret.
 */
export async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
    if (!signature) {
        logger.warn("WEBHOOK", "Missing clockify-signature header");
        return false;
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
    ]);

    const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const computed = Array.from(new Uint8Array(signatureBytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    return computed === signature;
}

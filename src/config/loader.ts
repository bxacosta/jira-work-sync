// ─── Config Loader ──────────────────────────────────────
// Loads and validates config.json, merging with defaults.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger/index.ts";
import { CONFIG_DEFAULTS } from "./defaults.ts";
import { parseDurationMs } from "./duration.ts";
import type { AppConfig } from "./schema.ts";

function deepMerge<T extends Record<string, unknown>>(defaults: T, overrides: Record<string, unknown>): T {
    const result = { ...defaults } as Record<string, unknown>;
    for (const key of Object.keys(overrides)) {
        const val = overrides[key];
        if (
            val !== null &&
            typeof val === "object" &&
            !Array.isArray(val) &&
            typeof result[key] === "object" &&
            result[key] !== null
        ) {
            result[key] = deepMerge(result[key] as Record<string, unknown>, val as Record<string, unknown>);
        } else {
            result[key] = val;
        }
    }
    return result as T;
}

function validateRequired(config: Record<string, unknown>, path: string, fields: string[]): string[] {
    const errors: string[] = [];
    for (const field of fields) {
        const value = config[field];
        if (value === undefined || value === null || value === "") {
            errors.push(`Missing required field: ${path}.${field}`);
        }
    }
    return errors;
}

export async function loadConfig(configPath?: string): Promise<AppConfig> {
    const filePath = configPath ?? resolve(process.cwd(), "config.json");

    if (!existsSync(filePath)) {
        throw new Error(
            `Config file not found: ${filePath}\nCopy config.example.json to config.json and fill in your credentials.`
        );
    }

    const file = Bun.file(filePath);
    let raw: Record<string, unknown>;
    try {
        raw = (await file.json()) as Record<string, unknown>;
    } catch {
        throw new Error(`Failed to parse config file: ${filePath}. Ensure it is valid JSON.`);
    }

    // Merge with defaults
    const config = deepMerge(CONFIG_DEFAULTS as Record<string, unknown>, raw) as unknown as AppConfig;

    // Validate required fields
    const errors: string[] = [];
    if (!config.clockify || typeof config.clockify !== "object") {
        errors.push("Missing required section: clockify");
    } else {
        errors.push(
            ...validateRequired(config.clockify as unknown as Record<string, unknown>, "clockify", [
                "apiKey",
                "workspaceId",
            ])
        );
    }

    if (!config.jira || typeof config.jira !== "object") {
        errors.push("Missing required section: jira");
    } else {
        errors.push(
            ...validateRequired(config.jira as unknown as Record<string, unknown>, "jira", [
                "baseUrl",
                "email",
                "apiToken",
            ])
        );
    }

    if (config.webhook?.enabled && (!config.webhook.secret || config.webhook.secret === "YOUR_WEBHOOK_SECRET")) {
        errors.push("webhook.secret is required when webhook is enabled");
    }

    try {
        parseDurationMs(config.sync.lookbackWindow);
    } catch (err) {
        errors.push(`sync.lookbackWindow: ${(err as Error).message}`);
    }

    if (errors.length > 0) {
        throw new Error(`Config validation failed:\n  - ${errors.join("\n  - ")}`);
    }

    logger.debug("CONFIG", `Loaded config from ${filePath}`);
    return config;
}

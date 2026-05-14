// ─── Config Schema ──────────────────────────────────────
// TypeScript types for config.json structure.

export interface ClockifyConfig {
    apiKey: string;
    workspaceId: string;
}

export interface JiraConfig {
    apiToken: string;
    baseUrl: string;
    email: string;
}

export interface WebhookConfig {
    enabled: boolean;
    port: number;
    secret: string;
}

export interface PollingConfig {
    enabled: boolean;
    intervalMinutes: number;
}

export interface BlacklistConfig {
    clockifyProjectIds: string[];
    clockifyTaskIds: string[];
    jiraKeys: string[];
}

export interface SyncConfig {
    blacklist: BlacklistConfig;
    /** Duration string (e.g., "1h", "24h", "7d") — window of time entries each cycle considers, counted back from now. */
    lookbackWindow: string;
}

export interface DatabaseConfig {
    path: string;
}

export interface AppConfig {
    clockify: ClockifyConfig;
    database: DatabaseConfig;
    jira: JiraConfig;
    polling: PollingConfig;
    sync: SyncConfig;
    webhook: WebhookConfig;
}

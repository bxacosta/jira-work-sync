// ─── Config Defaults ────────────────────────────────────

import type { AppConfig } from "./schema.ts";

type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };

export const CONFIG_DEFAULTS: DeepPartial<AppConfig> = {
    webhook: {
        enabled: false,
        port: 3100,
    },
    polling: {
        enabled: true,
        intervalMinutes: 5,
    },
    sync: {
        blacklist: {
            jiraKeys: [],
            clockifyProjectIds: [],
            clockifyTaskIds: [],
        },
        lookbackWindow: "24h",
    },
    database: {
        path: "./data/wsync.db",
    },
};

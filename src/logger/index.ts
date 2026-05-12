// ─── Logger ─────────────────────────────────────────────
// Singleton logger with colored output and context tags.

const COLORS = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
} as const;

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

const LEVEL_COLORS: Record<LogLevel, string> = {
    INFO: COLORS.green,
    WARN: COLORS.yellow,
    ERROR: COLORS.red,
    DEBUG: COLORS.dim,
};

const LEVEL_PAD: Record<LogLevel, string> = {
    INFO: "INFO ",
    WARN: "WARN ",
    ERROR: "ERROR",
    DEBUG: "DEBUG",
};

let debugEnabled = false;

function timestamp(): string {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function formatMessage(level: LogLevel, context: string, message: string): string {
    const color = LEVEL_COLORS[level];
    const label = LEVEL_PAD[level];
    const ts = `${COLORS.dim}${timestamp()}${COLORS.reset}`;
    const tag = context ? `${COLORS.cyan}[${context}]${COLORS.reset} ` : "";
    return `${ts} ${color}${label}${COLORS.reset} ${tag}${message}`;
}

export const logger = {
    setDebug(enabled: boolean) {
        debugEnabled = enabled;
    },

    info(context: string, message: string) {
        console.log(formatMessage("INFO", context, message));
    },

    warn(context: string, message: string) {
        console.warn(formatMessage("WARN", context, message));
    },

    error(context: string, message: string, err?: unknown) {
        console.error(formatMessage("ERROR", context, message));
        if (err instanceof Error && debugEnabled) {
            console.error(`${COLORS.dim}  ${err.stack}${COLORS.reset}`);
        }
    },

    debug(context: string, message: string) {
        if (debugEnabled) {
            console.log(formatMessage("DEBUG", context, message));
        }
    },

    /** Print a raw line without formatting (for banners, etc.) */
    raw(message: string) {
        console.log(message);
    },
};

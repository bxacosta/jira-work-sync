// ─── Duration Parser ────────────────────────────────────
// Parses human-readable duration strings (e.g., "24h", "1w") into milliseconds.

const UNIT_MS: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
};

const DURATION_PATTERN = /^(\d+)\s*(s|m|h|d|w)$/i;

export function parseDurationMs(value: string): number {
    const match = DURATION_PATTERN.exec(value.trim());
    if (!match) {
        throw new Error(
            `Invalid duration "${value}". Expected a positive integer followed by one of: s, m, h, d, w (e.g., "30m", "24h", "7d").`
        );
    }
    const amount = Number.parseInt(match[1] as string, 10);
    const unit = (match[2] as string).toLowerCase();
    if (amount <= 0) {
        throw new Error(`Invalid duration "${value}". Amount must be greater than zero.`);
    }
    return amount * (UNIT_MS[unit] as number);
}

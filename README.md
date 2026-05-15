# WSync — Clockify to Jira Time Sync

Synchronizes completed Clockify time entries as worklogs in Jira.

## Requirements

- [Bun](https://bun.sh) v1.0+
- Clockify API Key ([Profile Settings, Advanced section](https://app.clockify.me/user/settings))
- Jira Cloud API Token ([id.atlassian.com, Security section](https://id.atlassian.com/manage-profile/security/api-tokens))
- A publicly accessible URL — required only when running in webhook mode (see [setup-guide.md](docs/setup-guide.md))

## Setup

```bash
# Install dependencies
bun install

# Copy and fill in credentials
cp config.example.json config.json
```

Full configuration reference: [docs/config-reference.md](docs/config-reference.md).

To enable webhooks, follow the webhook and tunnel setup steps in [docs/setup-guide.md](docs/setup-guide.md).

Start the service:

```bash
bun run start
```

## Commands

| Command                 | Description                                                                 |
|-------------------------|-----------------------------------------------------------------------------|
| `bun run start`         | Start the service                                                           |
| `bun run start:dry-run` | Simulate the sync without creating Jira worklogs or persisting sync records |
| `bun run start:debug`   | Start with debug logging                                                    |
| `bun run dev`           | Start in watch mode (auto-reload)                                           |
| `bun run status`        | Print current service status                                                |
| `bun run stop`          | Stop a running instance                                                     |

Extra CLI flags can also be appended directly, e.g. `bun run start -- --dry-run --debug --config ./other.json`.

## Configuration

Copy `config.example.json` to `config.json` and fill in the required credentials. See [docs/config-reference.md](docs/config-reference.md)
for the full field reference, defaults, and validation rules.

## How It Works

1. **Polling (primary):** Every N minutes, completed entries within `sync.lookbackWindow` (default `24h`) are fetched from Clockify and synced to Jira.
2. **Webhook (optional):** Clockify sends a `TIMER_STOPPED` event in real time; the service processes it immediately.
3. **One-shot:** When both polling and webhook are disabled, the service runs a single sync cycle and exits — ideal for cron or CI invocations.
4. **Dry-run:** Pass `--dry-run` to preview what would be synced without creating Jira worklogs or writing sync records.
5. **Deduplication:** A local SQLite record combined with custom properties on each Jira worklog prevents duplicate worklogs.

## Project Structure

```
src/
├── index.ts           # Entry point
├── constants.ts       # App-wide constants
├── cli/               # CLI command handlers
├── config/            # Config loading, validation, and schema
├── clients/           # HTTP clients (Clockify, Jira)
├── sync/              # Sync engine (orchestration, filtering, mapping)
├── webhook/           # Webhook HTTP server
├── polling/           # Periodic poller
├── store/             # SQLite persistence
└── logger/            # Structured logger
```

## Documentation

- [Config Reference](docs/config-reference.md) — All `config.json` fields, defaults, and validation rules
- [Setup Guide](docs/setup-guide.md) — How to obtain credentials for each platform
- [Architecture](docs/architecture.md) — Module map, dependency graph, and design decisions
- [Sync Flow](docs/sync-flow.md) — Step-by-step breakdown of the sync process

# WSync — Configuration Reference

Reference for all fields in `config.json`. Use `config.example.json` as the starting template.

For instructions on obtaining each credential, see [setup-guide.md](setup-guide.md).

---

## Full Structure

```json
{
  "clockify": {
    "apiKey": "YOUR_CLOCKIFY_API_KEY",
    "workspaceId": "YOUR_WORKSPACE_ID"
  },
  "jira": {
    "baseUrl": "https://your-domain.atlassian.net",
    "email": "your-email@example.com",
    "apiToken": "YOUR_JIRA_API_TOKEN"
  },
  "webhook": {
    "enabled": false,
    "port": 3100,
    "secret": "YOUR_WEBHOOK_SECRET"
  },
  "polling": {
    "enabled": true,
    "intervalMinutes": 5
  },
  "sync": {
    "blacklist": {
      "jiraKeys": [],
      "clockifyProjectIds": [],
      "clockifyTaskIds": []
    }
  },
  "database": {
    "path": "./data/wsync.db"
  }
}
```

---

## `clockify` — Required

| Field | Type | Description |
|---|---|---|
| `apiKey` | string | Clockify REST API key |
| `workspaceId` | string | ID of the Clockify workspace to sync from |

---

## `jira` — Required

| Field | Type | Description |
|---|---|---|
| `baseUrl` | string | Base URL of the Jira Cloud instance (e.g., `https://company.atlassian.net`) |
| `email` | string | Atlassian account email used for authentication |
| `apiToken` | string | Jira Cloud API token |

---

## `webhook` — Optional

Controls the HTTP server that receives `TIMER_STOPPED` events from Clockify.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Whether to start the webhook server |
| `port` | number | `3100` | Local port the server listens on |
| `secret` | string | — | Clockify webhook signing secret. Required when `enabled` is `true` |

When `enabled` is `false`, the service runs in polling-only mode. The `webhook` section is still parsed but the server is not started.

Validation at startup will fail if `enabled` is `true` and `secret` is missing or contains the placeholder value `"YOUR_WEBHOOK_SECRET"`.

Exposed endpoints when enabled:

| Method | Path | Description |
|---|---|---|
| POST | `/webhook/clockify` | Receives Clockify webhook events |
| GET | `/health` | Returns `{ "status": "ok", "uptime": <seconds> }` |

---

## `polling` — Optional

Controls the periodic background poller.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Whether to run the background poller |
| `intervalMinutes` | number | `5` | Polling interval in minutes |

The first poll runs 30 seconds after startup. Each cycle looks back to the `started_at` timestamp of the last successful sync record, or to 24 hours ago if no record exists.

---

## `sync.blacklist` — Optional

Prevents specific entries from being synced regardless of their metadata.

| Field | Type | Default | Description |
|---|---|---|---|
| `jiraKeys` | string[] | `[]` | Jira issue keys to exclude (e.g., `["INTERNAL-001"]`) |
| `clockifyProjectIds` | string[] | `[]` | Clockify project IDs to exclude |
| `clockifyTaskIds` | string[] | `[]` | Clockify task IDs to exclude |

Blacklisted entries are written to the local database with `status = "blacklisted"` and skipped on subsequent cycles.

To find a Clockify project ID, open the project in the Clockify web UI and read the ID from the URL:

```
https://app.clockify.me/projects/64c777ddd3fcab07cfbb210c/edit
                                 ^^^^^^^^^^^^^^^^^^^^^^^^
```

To find a task ID, use the Clockify API:

```bash
curl -H "X-Api-Key: YOUR_API_KEY" \
  "https://api.clockify.me/api/v1/workspaces/WORKSPACE_ID/projects/PROJECT_ID/tasks"
```

---

## `database` — Optional

| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | `./data/wsync.db` | Path to the SQLite database file. Created automatically if absent |

---

## Validation Rules

The config loader (`src/config/loader.ts`) applies the following checks at startup and exits with a descriptive error on failure:

- `clockify.apiKey` and `clockify.workspaceId` must be non-empty strings.
- `jira.baseUrl`, `jira.email`, and `jira.apiToken` must be non-empty strings.
- When `webhook.enabled` is `true`, `webhook.secret` must be set and must not equal the placeholder `"YOUR_WEBHOOK_SECRET"`.

All other fields are optional and fall back to the defaults listed above.

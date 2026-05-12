# WSync — Synchronization Flow

Technical reference for the synchronization process from Clockify time entries to Jira worklogs.

---

## Overview

WSync operates in **polling** mode by default: every N minutes it queries the Clockify API for recently completed time entries and creates corresponding worklogs in Jira. Webhook mode is available as an optional real-time trigger.

---

## Sequence Diagram — Polling Flow

```mermaid
sequenceDiagram
    participant Timer as setInterval
    participant Poller as Polling Service
    participant DB as SQLite DB
    participant CApi as Clockify API
    participant Engine as Sync Engine
    participant JApi as Jira API

    Timer->>Poller: Tick (every N min)
    Poller->>DB: getLastSyncedTimestamp()
    DB-->>Poller: timestamp or null (default: last 24h)

    Poller->>CApi: GET /user/{id}/time-entries?start={ts}
    CApi-->>Poller: TimeEntry[]

    loop For each completed entry
        Poller->>Engine: syncTimeEntry(entry, "polling")

        Note over Engine: Step 1: Local deduplication
        Engine->>DB: findByClockifyEntryId(entry.id)
        DB-->>Engine: null or existing SyncRecord

        alt Already successfully synced
            Engine-->>Poller: SKIP "Already synced"
        end

        Note over Engine: Step 2: Resolve task metadata
        alt entry has projectId + taskId
            Engine->>CApi: GET /projects/{pid}/tasks/{tid}
            CApi-->>Engine: Task (name: "MPO-4986")
        end

        Note over Engine: Step 3: Extract issue key
        Engine->>Engine: extractIssueKey(task, description)
        Note right of Engine: Priority: task.name > description regex

        Note over Engine: Step 4: Filters and blacklist
        Engine->>Engine: filterTimeEntry(entry, issueKey, blacklist)

        alt Does not pass filters
            Engine->>DB: createSyncRecord(status: skipped/blacklisted)
            Engine-->>Poller: SKIP with reason
        end

        Note over Engine: Step 5: Validate issue in Jira
        Engine->>JApi: GET /issue/{issueKey}
        JApi-->>Engine: Issue or 404

        alt Issue does not exist
            Engine->>DB: createSyncRecord(status: failed)
            Engine-->>Poller: FAILED "Issue not found"
        end

        Note over Engine: Step 6: Jira deduplication (Worklog Properties)
        Engine->>JApi: GET /issue/{key}/worklog?startedAfter={ms}
        JApi-->>Engine: Worklog[]

        loop For each worklog
            Engine->>JApi: GET /worklog/{id}/properties/com.wsync.clockify-entry
            JApi-->>Engine: Property or 404
        end

        alt Duplicate found
            Engine->>DB: createSyncRecord(status: skipped)
            Engine-->>Poller: SKIP "Duplicate in Jira"
        end

        Note over Engine: Step 7: Create worklog
        Engine->>JApi: POST /issue/{key}/worklog
        Note right of Engine: Body: timeSpentSeconds, started, comment (ADF), properties
        JApi-->>Engine: Worklog created (id)

        Note over Engine: Step 8: Record result
        Engine->>DB: createSyncRecord(status: success)
        Engine-->>Poller: SUCCESS
    end

    Poller->>Poller: Log cycle summary
```

---

## Step Details

### Step 1: Local Deduplication (SQLite)

The local database is queried before any external API call:

```sql
SELECT * FROM sync_records WHERE clockify_entry_id = ?
```

If a record with `status = 'success'` exists, the entry is skipped immediately. This is the fast-path deduplication check.

For the `sync_records` schema, see [architecture.md](architecture.md).

---

### Step 2: Resolve Task Metadata

If the entry has both `projectId` and `taskId`, the Clockify API is queried for the task:

```
GET /api/v1/workspaces/{wid}/projects/{pid}/tasks/{tid}
```

Response:

```json
{
    "id": "6a021225277e80bfd75bee39",
    "name": "MPO-4986",
    "projectId": "68b72e973a58446e827f86c8"
}
```

The `name` field holds the Jira issue key when the task was created via the Jira plugin for Clockify.

Task results are cached in memory (`Map<string, ClockifyTask>`) for the duration of the polling cycle to avoid repeated API calls.

---

### Step 3: Extract Issue Key

The issue key is extracted from one of two sources, evaluated in order:

1. **Task name (primary):** Regex `[A-Z][A-Z0-9]+-\d+` applied to `task.name`.
2. **Entry description (fallback):** Same regex applied to `entry.description`.

Example description:

```
[MPO-4986]: Set up local environment
```

The regex captures `MPO-4986`.

---

### Step 4: Filters and Blacklist

The following conditions are evaluated in order. A failed check skips the entry and records the reason.

| Condition | Outcome on failure | Log level |
|---|---|---|
| `entry.projectId` is set | SKIP | warn |
| `entry.taskId` is set | SKIP | warn |
| `entry.timeInterval.end` is set | SKIP (timer still running) | info |
| Issue key was extracted | SKIP | warn |
| `issueKey` not in `blacklist.jiraKeys` | SKIP (blacklisted) | info |
| `projectId` not in `blacklist.clockifyProjectIds` | SKIP (blacklisted) | info |
| `taskId` not in `blacklist.clockifyTaskIds` | SKIP (blacklisted) | info |

---

### Step 5: Validate Issue in Jira

The issue is verified to exist before the worklog is created:

```
GET /rest/api/3/issue/{issueKey}?fields=summary,status,project
```

A 404 response records the entry as `failed` with the message `"Issue not found in Jira"`. The `summary` field from a successful response is used as part of the worklog comment.

---

### Step 6: Jira Deduplication (Worklog Properties)

Existing worklogs for the issue are fetched:

```
GET /rest/api/3/issue/{key}/worklog?startedAfter={timestamp}
```

For each worklog, a custom property is checked:

```
GET /rest/api/3/issue/{key}/worklog/{worklogId}/properties/com.wsync.clockify-entry
```

Property structure:

```json
{
    "key": "com.wsync.clockify-entry",
    "value": {
        "clockifyEntryId": "6a0261cff0dbc41f787a2a4d",
        "syncedAt": "2026-05-12T01:46:35.831Z",
        "source": "polling"
    }
}
```

If `clockifyEntryId` matches the current entry, the entry is skipped.

This second deduplication layer ensures correctness even if the local database is lost. The local DB check in Step 1 is a fast path to avoid API calls; Jira properties are the persistent source of truth.

---

### Step 7: Create Worklog in Jira

```
POST /rest/api/3/issue/{issueKey}/worklog
```

Payload:

```json
{
    "timeSpentSeconds": 932,
    "started": "2026-05-11T23:10:07.000+0000",
    "comment": {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "[MPO-4986]: Set up local environment (synced by WSync)"
                    }
                ]
            }
        ]
    },
    "properties": [
        {
            "key": "com.wsync.clockify-entry",
            "value": {
                "clockifyEntryId": "6a0261cff0dbc41f787a2a4d",
                "syncedAt": "2026-05-12T01:46:35.831Z",
                "source": "polling"
            }
        }
    ]
}
```

Field notes:

| Field | Value |
|---|---|
| `timeSpentSeconds` | Computed as `end - start` from the Clockify time interval |
| `started` | UTC timestamp formatted as `YYYY-MM-DDTHH:mm:ss.SSS+0000` |
| `comment` | Atlassian Document Format (ADF), required by Jira API v3. Text: `[ISSUE-KEY]: ISSUE_SUMMARY (synced by WSync)` |
| `properties` | Custom property used for Jira-side deduplication (Step 6) |

---

### Step 8: Record Result

A `sync_records` row is written for every processed entry regardless of outcome (`success`, `skipped`, `failed`, `blacklisted`). This record serves as the fast-path deduplication check in Step 1 on subsequent cycles.

---

## Flow Diagram — Entry Decision

```mermaid
flowchart TD
    A[Time Entry received] --> B{Synced in local DB?}
    B -->|Yes| Z1[SKIP: Already synced]
    B -->|No| C[Resolve task metadata]
    C --> D[Extract issue key]
    D --> E{Has projectId?}
    E -->|No| Z2[SKIP: No project]
    E -->|Yes| F{Has taskId?}
    F -->|No| Z3[SKIP: No task]
    F -->|Yes| G{Has end time?}
    G -->|No| Z4[SKIP: In progress]
    G -->|Yes| H{Issue key found?}
    H -->|No| Z5[SKIP: No issue key]
    H -->|Yes| I{On blacklist?}
    I -->|Yes| Z6[SKIP: Blacklisted]
    I -->|No| J[Validate issue in Jira]
    J --> K{Issue exists?}
    K -->|No| Z7[FAILED: Not found]
    K -->|Yes| L[Check Jira for duplicate worklog]
    L --> M{Duplicate found?}
    M -->|Yes| Z8[SKIP: Duplicate]
    M -->|No| N[Create worklog in Jira]
    N --> O[Write sync_record]
    O --> Z9[SUCCESS]
```

---

## Polling Cycle

The poller runs every `polling.intervalMinutes` minutes (default: 5).

1. Reads `getLastSyncedTimestamp()` from the database.
2. If no timestamp exists, defaults to 24 hours ago.
3. Calls `GET /time-entries?start={ts}&in-progress=false&page-size=50`.
4. Processes only entries where `end !== null`.
5. Calls `syncTimeEntry()` for each entry.
6. Logs a cycle summary: `N checked, X synced, Y skipped, Z failed`.

The first cycle is delayed 30 seconds after startup.

---

## API Reference

### Clockify Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/user` | Credential validation, retrieve user ID |
| GET | `/api/v1/workspaces/{wid}/user/{uid}/time-entries` | Fetch recent time entries |
| GET | `/api/v1/workspaces/{wid}/projects/{pid}/tasks/{tid}` | Resolve task name |

### Jira Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/rest/api/3/myself` | Credential validation |
| GET | `/rest/api/3/issue/{key}` | Verify issue exists, retrieve summary |
| GET | `/rest/api/3/issue/{key}/worklog` | List worklogs for deduplication |
| GET | `/rest/api/3/issue/{key}/worklog/{id}/properties/{propKey}` | Read deduplication property |
| POST | `/rest/api/3/issue/{key}/worklog` | Create worklog |

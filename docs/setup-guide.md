# WSync — Setup Guide

Procedure for obtaining credentials and configuring each platform.

---

## 1. Clockify — API Key

### API Key

1. Log in to [Clockify](https://app.clockify.me).
2. Open the account menu (avatar, top-right corner) and go to **Profile Settings**.
3. Scroll to the **API** or **Advanced** section.
4. Copy the displayed **API Key**. If none exists, click **Generate** to create one.

The API Key does not expire. Regenerating it invalidates the previous key.

### Workspace ID

The workspace ID appears in the Clockify URL when navigating any page:

```
https://app.clockify.me/tracker/64a687e29ae1f428e7ebe303
                                ^^^^^^^^^^^^^^^^^^^^^^^^
```

Alternatively, retrieve it via the API:

```bash
curl -H "X-Api-Key: YOUR_API_KEY" https://api.clockify.me/api/v1/workspaces
```

The response is a JSON array. The `id` field of the target workspace is the required value.

### `config.json` fields

```json
{
  "clockify": {
    "apiKey": "your-api-key",
    "workspaceId": "your-workspace-id"
  }
}
```

---

## 2. Clockify — Webhook

### Creating the webhook

1. In Clockify, go to **Settings** or **Profile Settings**.
2. Navigate to **Preferences > Advanced > Webhooks**.
3. Click **Add Webhook**.
4. Fill in the required fields:

| Field   | Value                                                                                                          |
|---------|----------------------------------------------------------------------------------------------------------------|
| Name    | Any descriptive label (e.g., `WSync`)                                                                          |
| URL     | The public endpoint where WSync will receive events. Example: `https://wsync.your-domain.com/webhook/clockify` |
| Trigger | `Timer Stopped` (`TIMER_STOPPED`)                                                                              |

5. After saving, Clockify displays a **Signing Secret**. Copy it immediately — it is shown only once.

### `config.json` fields

```json
{
  "webhook": {
    "enabled": true,
    "port": 3100,
    "secret": "the-signing-secret"
  }
}
```

`port` is the local port WSync listens on. If Cloudflare Tunnel is used, configure the tunnel to forward to this port.

---

## 3. Jira Cloud — API Token

### API Token

1. Go to [id.atlassian.com > Security > API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Click **Create API token** and assign a label (e.g., `WSync`).
3. Copy the generated token. It is shown only once.

The token inherits the permissions of the associated Atlassian account. The account must have **Browse Projects** and **Log Work**
permissions on all projects to be synced.

### Base URL

The Jira Cloud base URL follows the format `https://company.atlassian.net` and is visible in the browser address bar when logged into Jira.

### Email

The email address used to authenticate with Atlassian (the login email, not a notification address).

### Enabling Time Tracking

WSync creates Jira worklogs, which requires Time Tracking to be enabled.

Per project: **Project Settings > Features > Time Tracking** (or **Estimation**) must be active.

Instance-wide (requires admin): **Jira Settings > Issues > Time Tracking**.

### `config.json` fields

```json
{
  "jira": {
    "baseUrl": "https://your-company.atlassian.net",
    "email": "your-email@company.com",
    "apiToken": "the-api-token"
  }
}
```

---

## 4. Cloudflare Tunnel

Cloudflare Tunnel exposes a local port over a public HTTPS URL without opening firewall ports. This is required for Clockify to deliver
webhook events to a local machine.

### Prerequisites

- A Cloudflare account.
- A domain with DNS managed by Cloudflare.
- `cloudflared` installed — [download](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

### Option A: Temporary tunnel

```bash
cloudflared tunnel --url http://localhost:3100
```

Generates a temporary URL such as `https://random-words.trycloudflare.com`. The URL changes on every restart, requiring the Clockify webhook
URL to be updated each time.

### Option B: Named tunnel (permanent URL)

1. Authenticate:
   ```bash
   cloudflared tunnel login
   ```

2. Create the tunnel:
   ```bash
   cloudflared tunnel create wsync
   ```
   A credentials file is created under `~/.cloudflared/`.

3. Add a DNS record:
   ```bash
   cloudflared tunnel route dns wsync wsync.your-domain.com
   ```

4. Create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <TUNNEL-ID>
   credentials-file: ~/.cloudflared/<TUNNEL-ID>.json

   ingress:
     - hostname: wsync.your-domain.com
       service: http://localhost:3100
     - service: http_status:404
   ```

5. Start the tunnel:
   ```bash
   cloudflared tunnel run wsync
   ```

6. Set the Clockify webhook URL to:
   ```
   https://wsync.your-domain.com/webhook/clockify
   ```

With a named tunnel the URL is stable and the Clockify webhook only needs to be configured once.

---

## 5. Blacklist

To exclude specific entries from synchronization, populate the `sync.blacklist` section of `config.json`. For field descriptions and
instructions on finding Clockify IDs, see [config-reference.md](config-reference.md).

---

## 6. Verification

Start the service:

```bash
bun run start
```

Confirm the following in the startup output:

- Both Clockify and Jira credentials were validated successfully (the account name or email appears for each).
- The configuration summary shows the expected webhook status, polling interval, and blacklist rule count.
- A final line confirms the service is running.

If authentication errors appear, verify the credentials in `config.json`.

When the webhook is shown as disabled, the service runs in polling-only mode. This is expected when `webhook.enabled` is `false` or the
secret is not configured.

---

## Credentials Summary

For a complete field reference including types and defaults, see [config-reference.md](config-reference.md).

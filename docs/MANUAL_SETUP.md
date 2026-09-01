# Manual Setup Guide — Paper English Social Engine

This guide walks you step-by-step through configuring publishing credentials for the Paper English social marketing engine.

> [!IMPORTANT]
> **Meta for Developers is not required for this architecture.**
> You do not need Facebook Developer Apps, Instagram App IDs/Secrets, Threads App Secrets, Page Access Tokens, or Long-Lived User Tokens.
> All publishing to Facebook, Instagram, and Threads is handled through Buffer's official GraphQL API.

---

## Step A: Create or Log in to your Buffer Account

1. Go to [https://buffer.com](https://buffer.com) and sign in to your Buffer account.
2. Ensure you have an active Organization workspace for 紙屬英文 (Paper English).

---

## Step B: Connect your Facebook Page to Buffer

1. In Buffer dashboard, navigate to **Manage Channels** (or click **Connect a Channel**).
2. Choose **Facebook** → **Facebook Page**.
3. Log in with your Facebook account and select the **紙屬英文** Facebook Page.
4. Grant the requested permissions so Buffer can post on behalf of your Page.

---

## Step C: Connect your Instagram Account to Buffer

1. In Buffer dashboard, click **Connect a Channel**.
2. Choose **Instagram** → **Instagram Business Profile** (or Creator profile).
3. Authenticate and connect the **紙屬英文** Instagram account.
4. Ensure direct publishing is enabled in Buffer for this Instagram channel.

---

## Step D: Connect your Threads Profile to Buffer

1. In Buffer dashboard, click **Connect a Channel**.
2. Choose **Threads**.
3. Authenticate and connect your **紙屬英文** Threads profile.
4. Verify that Threads appears in your active connected channels list.

---

## Step E: Create a Buffer Personal API Key

1. In your Buffer account, navigate to:
   [https://publish.buffer.com/settings/api](https://publish.buffer.com/settings/api)
2. Scroll to the **Personal API Keys** section.
3. Click **Create Key** (or use your existing key).
4. Give it a descriptive name (e.g. `Paper English Social Engine`).
5. Copy the generated API key immediately.

---

## Step F: Add BUFFER_API_KEY to GitHub Actions Secrets

1. Open your GitHub repository in your browser:
   `https://github.com/<your-org-or-user>/eng-poster/settings/secrets/actions`
2. Under **Repository secrets**, click **New repository secret**.
3. Name: `BUFFER_API_KEY`
4. Value: Paste your Buffer Personal API key from Step E.
5. Click **Add secret**.
6. Also ensure your Supabase secrets are present in Repository secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

For local development, copy `.env.example` to `.env` and add:
```env
BUFFER_API_KEY=your_buffer_api_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

---

## Step G: Discover Connected Channels (`buffer-channels`)

Run the channel discovery command in your terminal:

```bash
pnpm social buffer-channels
```

This command connects to Buffer GraphQL API using your `BUFFER_API_KEY`, queries your organizations, and prints all connected channels:

```json
[
  {
    "channelId": "67401a...",
    "name": "紙屬英文 Paper English",
    "service": "facebook",
    "organizationName": "Paper English"
  },
  {
    "channelId": "67401b...",
    "name": "paperenglish",
    "service": "instagram",
    "organizationName": "Paper English"
  },
  {
    "channelId": "67401c...",
    "name": "paperenglish",
    "service": "threads",
    "organizationName": "Paper English"
  }
]
```

> [!NOTE]
> The engine automatically redacts the API key from all logs and output.

---

## Step H: (Optional) Configure Explicit Channel IDs

If you have **exactly one** Facebook channel, **one** Instagram channel, and **one** Threads channel connected in Buffer, the engine **safely auto-resolves** their IDs with zero manual configuration.

If you have multiple channels for the same service (e.g. two Facebook pages), save the intended channel IDs in your `.env` and in GitHub Actions Repository Variables:

- `BUFFER_FACEBOOK_CHANNEL_ID`
- `BUFFER_INSTAGRAM_CHANNEL_ID`
- `BUFFER_THREADS_CHANNEL_ID`

---

## Step I: Verify Credential Health (`token-health`)

Run the non-destructive credential health inspection:

```bash
pnpm social token-health
```

This command:
- Validates that `BUFFER_API_KEY` is authentic and active.
- Confirms that channels for all enabled platforms (`facebook`, `instagram`, `threads`) are properly connected and resolvable.
- Never creates any test posts.
- Records health telemetry into the `marketing_token_health` table in Supabase.

A successful response looks like:
```json
[
  {
    "platform": "facebook",
    "valid": true,
    "accountId": "67401a...",
    "grantedScopes": ["buffer:api"],
    "diagnostic": "Buffer channel resolved: 紙屬英文 Paper English (67401a...) on service facebook in org \"Paper English\""
  },
  {
    "platform": "instagram",
    "valid": true,
    "accountId": "67401b...",
    "grantedScopes": ["buffer:api"],
    "diagnostic": "Buffer channel resolved: paperenglish (67401b...) on service instagram in org \"Paper English\""
  },
  {
    "platform": "threads",
    "valid": true,
    "accountId": "67401c...",
    "grantedScopes": ["buffer:api"],
    "diagnostic": "Buffer channel resolved: paperenglish (67401c...) on service threads in org \"Paper English\""
  }
]
```

---

## Step J: Live Smoke Test One Platform at a Time

Before enabling full automated scheduling, perform an explicit live smoke test for each platform.

### Safety Gates Checklist
To publish live, you must explicitly provide:
- `DRY_RUN=false` in environment
- `PAUSE_ALL_POSTING=false` in environment
- `--confirm-live` CLI flag

### 1. Test Facebook
```bash
DRY_RUN=false PAUSE_ALL_POSTING=false pnpm social publish-test --platform facebook --confirm-live
```

### 2. Test Threads
```bash
DRY_RUN=false PAUSE_ALL_POSTING=false pnpm social publish-test --platform threads --confirm-live
```

### 3. Test Instagram
Instagram requires a publicly accessible image URL:
```bash
DRY_RUN=false PAUSE_ALL_POSTING=false pnpm social publish-test --platform instagram --confirm-live --media-url "https://your-domain.com/path/to/test-image.jpg"
```
*(Or omit `--media-url` if you already ingested valid assets into Supabase Storage via `pnpm social ingest-assets`).*

### Verify
Open your Facebook Page, Threads profile, and Instagram feed to confirm each test post published successfully with correct branding, text formatting, and image attachments.

---

## Summary of Environment Variables

| Variable | Type | Required | Description |
|---|---|---|---|
| `BUFFER_API_KEY` | Secret | **Yes** | Buffer Personal API key from publish.buffer.com/settings/api |
| `SUPABASE_URL` | Secret | **Yes** | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | **Yes** | Supabase service role key (bypasses RLS for engine workers) |
| `BUFFER_FACEBOOK_CHANNEL_ID` | Variable | No | Optional explicit Facebook channel ID (auto-resolved if single) |
| `BUFFER_INSTAGRAM_CHANNEL_ID` | Variable | No | Optional explicit Instagram channel ID (auto-resolved if single) |
| `BUFFER_THREADS_CHANNEL_ID` | Variable | No | Optional explicit Threads channel ID (auto-resolved if single) |
| `DRY_RUN` | Variable | No | Default `true`. Set `false` for live posting |
| `PAUSE_ALL_POSTING` | Variable | No | Default `true`. Set `false` to enable dispatcher |
| `FACEBOOK_ENABLED` | Variable | No | Default `false`. Enable when ready |
| `INSTAGRAM_ENABLED` | Variable | No | Default `false`. Enable when ready |
| `THREADS_ENABLED` | Variable | No | Default `false`. Enable when ready |

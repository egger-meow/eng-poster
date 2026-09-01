# Paper English Social Engine

Organic-social infrastructure, scheduling validation, asset management, and publishing for 紙屬英文 on Facebook, Instagram, and Threads.

The engine uses **ChatGPT Scheduled Tasks** as its autonomous research, topic discovery, and writing brain, while this repository provides hardened scheduling, claim verification, asset tracking, safety switches, and Buffer GraphQL publishing infrastructure (Facebook, Instagram, Threads).

The engine is safe by default: `.env.example` starts in dry-run/global-pause mode, every Paper English URL gets platform-specific UTM attribution, researched claims require stored sources, and live smoke publishing needs both `DRY_RUN=false` and `--confirm-live`.

## Requirements

- Node.js 22+
- pnpm 10.15.1
- Supabase project / CLI
- ChatGPT with Scheduled Tasks or direct Supabase connection (see [docs/SCHEDULER_SETUP.md](docs/SCHEDULER_SETUP.md))
- Buffer account with connected Facebook, Instagram, and Threads channels (see [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md))

## Local setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
cp config/production.example.yaml config/production.yaml
pnpm verify
supabase db reset
pnpm social buffer-channels
pnpm social token-health
pnpm social ingest-assets
pnpm social dry-run --platform threads
pnpm social queue-health
```

## Commands

```bash
# Ingest and validate a content plan from ChatGPT Scheduler
pnpm social enqueue-plan --input payload.json

# Discover connected Buffer channels
pnpm social buffer-channels

# Check upcoming scheduled queue health
pnpm social queue-health --hours 48

# Dispatch due posts (runs every 30 mins in GitHub Actions)
pnpm social dispatch-due

# Validate Buffer credentials and channel health
pnpm social token-health

# Ingest local assets into Supabase storage and library
pnpm social ingest-assets

# Dry-run platform payload formatting
pnpm social dry-run --platform <facebook|instagram|threads>

# Explicit live smoke test
pnpm social publish-test --platform <facebook|instagram|threads> --confirm-live
```

The final command refuses to publish while `DRY_RUN=true` or `PAUSE_ALL_POSTING=true`.

## Production rollout

1. Verify the knowledge files and add licensed public assets under `assets/manual/**`.
2. Apply `supabase/migrations/20260831000000_marketing_engine.sql` to the intended project and run `pnpm verify:migration`.
3. Configure secrets and repository variables from `.env.example`.
4. Set up the ChatGPT Scheduled Task using [docs/CHATGPT_SCHEDULER_PROMPT.md](docs/CHATGPT_SCHEDULER_PROMPT.md) and [docs/SCHEDULER_SETUP.md](docs/SCHEDULER_SETUP.md).
5. Run `pnpm verify`, token health, and asset ingestion.
6. Follow the explicit one-post-per-platform smoke procedure in [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md).
7. Enable the dispatcher in GitHub Actions.

GitHub Actions provide CI, a 30-minute dispatcher (`dispatch.yml`), daily token health (`token-health.yml`), and daily queue health monitoring (`queue-health.yml`).

## Decoupled Look-Ahead Buffer Scheduling

To prevent GitHub Actions cron scheduling jitter from delaying social posts, Buffer acts as the native execution scheduler:
1. **Durable Queue**: The scheduler writes posts with exact `scheduled_for` timestamps to Supabase.
2. **Look-Ahead Dispatch**: Whenever the GitHub Actions dispatcher runs, it claims posts within the lookahead window (`dispatcher.lookaheadHours: 24`, default 24h).
3. **Native Scheduling**: Future posts are submitted to Buffer via GraphQL with `mode: customScheduled`, `dueAt: ISO8601`, and `schedulingType: automatic`. Overdue posts are submitted with `mode: shareNow`.
4. **Lifecycle State Machine**:
   `scheduled` → `claimed` → `provider_scheduled` (Buffer accepted future schedule) → `published` (Buffer confirmed sent during reconciliation).
5. **Reconciliation**: On every dispatcher run, `provider_scheduled` posts near or past due time are inspected via Buffer's GraphQL API (`post(input: { id })`). When Buffer marks a post `sent`, the engine transitions the post to `published` and records the live permalink.
6. **Zero Duplicate Guarantee**: Row locks (`SKIP LOCKED`), checking pre-existing Buffer post IDs before re-dispatch, and channel searches for ambiguous network timeouts prevent duplicate posts.


## Post Asset Strategy & Attribution

Each post explicitly specifies its `asset_mode` (`text_only`, `image_post`, `link_preview`):
- **Facebook**: Either `link_preview` (traffic) or `image_post` (branding/visuals), not mixed.
  - `image_post`: Main post copy is clean with no raw URLs; the canonical destination URL is dispatched as the first comment (`metadata.facebook.firstComment`).
  - `link_preview`: Main post copy contains the canonical destination URL; attached media is disallowed, and no duplicate first comment is created.
  - `text_only`: Text post without media or destination URLs.
- **Threads**: Selects `text_only`, `image_post`, or `link_preview` based on intent.
  - `image_post`: Main post copy is clean with no raw URLs; when a destination URL exists, it is dispatched as a 2-item self-reply thread via Buffer's official `metadata.threads.thread`.
  - `link_preview`: Main post copy contains the canonical destination URL; attached media is disallowed, and no duplicate thread reply is created.
  - `text_only`: Sharp pedagogical opinions and insights without media or URLs.
- **Instagram**: Strictly `image_post` only.
  - Media asset is mandatory; caption has no raw URL; the destination URL is dispatched as the first comment (`metadata.instagram.firstComment`).

## Safety and failure behavior

- `PAUSE_ALL_POSTING=true` stops all dispatch; per-platform switches are evaluated again at dispatch time.
- Database claiming uses `FOR UPDATE SKIP LOCKED`, stable idempotency keys, unique constraints, and leases.
- HTTP 429/5xx/transient failures retry up to the configured cap. Permission, identity, policy, and validation failures do not loop.
- Ambiguous network outcomes are marked `AMBIGUOUS` for inspection rather than blindly reposted.
- Logs and attempt summaries redact credentials and Authorization fields.
- Instagram requires publicly fetchable media; Facebook and Threads may remain text-only when valid.

## What automated verification cannot prove

The codebase can verify lint, types, unit/integration contracts, build output, and migration structure without secrets. Production readiness additionally requires a real Supabase migration application, valid credential-health responses, at least one usable Instagram/fallback asset, a credentialed researched plan, and explicit live smoke posts on all three platforms. Do not report those conditions as complete until a human supplies credentials and runs them.

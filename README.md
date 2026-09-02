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
pnpm social queue-health
pnpm social next-queue-gap
```

## Commands

```bash
# Calculate earliest future queue gap within 14-day stockpile horizon
pnpm social next-queue-gap

# Ingest and validate a content plan from ChatGPT Scheduler
pnpm social enqueue-plan --input payload.json

# Discover connected Buffer channels
pnpm social buffer-channels

# Check upcoming scheduled queue health across 14-day stockpile horizon
pnpm social queue-health --hours 336

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


## Post Asset Strategy & Mandatory Main-Body Link Contract

**EVERY Facebook and Threads post must lead back to Paper English in the main body.**
Canonical base: `https://paperbond.jjmowlab.com`

Each post explicitly specifies its `asset_mode` (`text_only`, `image_post`, `link_preview`):
- **Facebook**:
  - `text_only`: Text post with canonical destination URL visibly in main body; no media.
  - `link_preview`: Main post copy contains the canonical destination URL; attached media is disallowed.
  - `image_post`: Attached media + copy + canonical destination URL visibly in main body; optional secondary first comment (`metadata.facebook.firstComment`).
- **Threads**:
  - `text_only`: Sharp pedagogical opinions and punchy hooks with canonical destination URL visibly in main body; no media.
  - `link_preview`: Main post copy contains the canonical destination URL; attached media is disallowed.
  - `image_post`: Attached media + copy + canonical destination URL visibly in main body; optional secondary 2-item self-reply thread.
- **Instagram**: Strictly `image_post` only.
  - Media asset is mandatory; caption has no clickable URL; destination URL is dispatched as first comment (`metadata.instagram.firstComment`) when CTA is soft or direct.

## Authoritative Copy-Length Contract & 1:1 Rolling Mix

The engine enforces an approximately **1:1 LONG : SHORT** content mix across rolling production history:
- **Short mode** (`copyLengthMode: 'short'`): Genuinely short, punchy, stop-scroll, 1–4 lines, 1 provocative thought or punchline only, 1–4 emojis for emotional punctuation. No filler, no generic AI intros.
  - Threads: 5–100 characters (max 140)
  - Facebook: 10–150 characters (max 200)
  - Instagram: 30–180 characters (max 220)
- **Long mode** (`copyLengthMode: 'long'`): High-density, explanatory, concrete examples, tight structure: `hook → concrete evidence → useful insight → stop`. No generic setup or conclusion filler.
  - Threads: 150–350 characters (max 500)
  - Facebook: 250–800 characters (max 63,206)
  - Instagram: 180–400 characters (max 2,200)

The planner deterministically selects whichever mode is currently underrepresented via `selectCopyLengthMode` and `pnpm social next-queue-gap`.

## Safety and failure behavior

- `PAUSE_ALL_POSTING=true` stops all dispatch; per-platform switches are evaluated again at dispatch time.
- Database claiming uses `FOR UPDATE SKIP LOCKED`, stable idempotency keys, unique constraints, and leases.
- HTTP 429/5xx/transient failures retry up to the configured cap. Permission, identity, policy, and validation failures do not loop.
- Ambiguous network outcomes are marked `AMBIGUOUS` for inspection rather than blindly reposted.
- Logs and attempt summaries redact credentials and Authorization fields.
- Instagram requires publicly fetchable media; Facebook and Threads may remain text-only when valid.

## What automated verification cannot prove

The codebase can verify lint, types, unit/integration contracts, build output, and migration structure without secrets. Production readiness additionally requires a real Supabase migration application, valid credential-health responses, at least one usable Instagram/fallback asset, a credentialed researched plan, and explicit live smoke posts on all three platforms. Do not report those conditions as complete until a human supplies credentials and runs them.

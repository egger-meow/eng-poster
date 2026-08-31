# Paper English Social Engine

Organic-social infrastructure, scheduling validation, asset management, and publishing for 紙屬英文 on Facebook, Instagram, and Threads.

The engine uses **ChatGPT Scheduled Tasks** as its autonomous research, topic discovery, and writing brain, while this repository provides hardened scheduling, claim verification, asset tracking, safety switches, and Meta publishing infrastructure.

The engine is safe by default: `.env.example` starts in dry-run/global-pause mode, every Paper English URL gets platform-specific UTM attribution, researched claims require stored sources, and live smoke publishing needs both `DRY_RUN=false` and `--confirm-live`.

## Requirements

- Node.js 22+
- pnpm 10.15.1
- Supabase project / CLI
- ChatGPT with Scheduled Tasks or direct Supabase connection (see [docs/SCHEDULER_SETUP.md](docs/SCHEDULER_SETUP.md))
- Independent Meta credentials described in [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md)

## Local setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
cp config/production.example.yaml config/production.yaml
pnpm verify
supabase db reset
pnpm social token-health
pnpm social ingest-assets
pnpm social dry-run --platform threads
pnpm social queue-health
```

## Commands

```bash
# Ingest and validate a content plan from ChatGPT Scheduler
pnpm social enqueue-plan --input payload.json

# Check upcoming scheduled queue health
pnpm social queue-health --hours 48

# Dispatch due posts (runs every 30 mins in GitHub Actions)
pnpm social dispatch-due

# Validate Meta credentials and token expiry
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


## Safety and failure behavior

- `PAUSE_ALL_POSTING=true` stops all dispatch; per-platform switches are evaluated again at dispatch time.
- Database claiming uses `FOR UPDATE SKIP LOCKED`, stable idempotency keys, unique constraints, and leases.
- HTTP 429/5xx/transient failures retry up to the configured cap. Permission, identity, policy, and validation failures do not loop.
- Ambiguous network outcomes are marked `AMBIGUOUS` for inspection rather than blindly reposted.
- Logs and attempt summaries redact credentials and Authorization fields.
- Instagram requires publicly fetchable media; Facebook and Threads may remain text-only when valid.

## What automated verification cannot prove

The codebase can verify lint, types, unit/integration contracts, build output, and migration structure without secrets. Production readiness additionally requires a real Supabase migration application, valid credential-health responses, at least one usable Instagram/fallback asset, a credentialed researched plan, and explicit live smoke posts on all three platforms. Do not report those conditions as complete until a human supplies credentials and runs them.

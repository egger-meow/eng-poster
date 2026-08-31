# Paper English Social Engine

Automated organic-social research, writing, media selection, scheduling, and publishing for 紙屬英文 on an independent Facebook Page, Instagram Professional account, and Threads profile.

The engine is safe by default: `.env.example` starts in dry-run/global-pause mode, every Paper English URL gets platform-specific UTM attribution, current claims require stored sources, and live smoke publishing needs both `DRY_RUN=false` and `--confirm-live`.

## Requirements

- Node.js 22+
- pnpm 10.15.1
- Supabase project/CLI
- OpenAI API key
- independent Meta credentials described in [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md)

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
pnpm social plan-day --date 2026-08-31
```

`plan-day` performs hosted web research, creates independent platform copy, runs semantic and deterministic gates, selects media, and saves immutable scheduled records. `dispatch-due` only publishes due records; it never regenerates copy.

## Commands

```bash
pnpm social plan-day --date YYYY-MM-DD
pnpm social dispatch-due
pnpm social token-health
pnpm social ingest-assets
pnpm social dry-run --platform <facebook|instagram|threads>
pnpm social publish-test --platform <facebook|instagram|threads> --confirm-live
```

The final command still refuses to publish while `DRY_RUN=true` or `PAUSE_ALL_POSTING=true`.

## Production rollout

1. Verify the knowledge files and add licensed public assets under `assets/manual/**`.
2. Apply `supabase/migrations/20260831000000_marketing_engine.sql` to the intended project and run `pnpm verify:migration`.
3. Configure every secret and repository variable from `.env.example`; set the currently supported Meta Graph API version explicitly in `META_GRAPH_VERSION` after checking Meta's current docs.
4. Run `pnpm verify`, token health, asset ingestion, and a complete `plan-day` with the dispatcher paused.
5. Inspect database plans, claims, copy, public media URLs, and UTM parameters.
6. Follow the explicit one-post-per-platform smoke procedure in [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md).
7. Only after the smoke records contain platform IDs/URLs, enable the dispatcher variables.

GitHub Actions provide CI, a daily planner at 00:15 Asia/Taipei, a 30-minute dispatcher, and daily token health. Scheduled workflows intentionally use Supabase rather than Git commits for runtime state.

## Safety and failure behavior

- `PAUSE_ALL_POSTING=true` stops all dispatch; per-platform switches are evaluated again at dispatch time.
- Database claiming uses `FOR UPDATE SKIP LOCKED`, stable idempotency keys, unique constraints, and leases.
- HTTP 429/5xx/transient failures retry up to the configured cap. Permission, identity, policy, and validation failures do not loop.
- Ambiguous network outcomes are marked `AMBIGUOUS` for inspection rather than blindly reposted.
- Logs and attempt summaries redact credentials and Authorization fields.
- Instagram requires publicly fetchable media; Facebook and Threads may remain text-only when valid.

## What automated verification cannot prove

The codebase can verify lint, types, unit/integration contracts, build output, and migration structure without secrets. Production readiness additionally requires a real Supabase migration application, valid credential-health responses, at least one usable Instagram/fallback asset, a credentialed researched plan, and explicit live smoke posts on all three platforms. Do not report those conditions as complete until a human supplies credentials and runs them.

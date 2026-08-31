# Paper English Social Engine v0 Implementation Plan

> **For agentic workers:** Execute inline in this repository. Verify each deliverable after implementation; this repository explicitly does not use TDD unless requested.

**Goal:** Build the complete v0 automated research, content, media, scheduling, and publishing engine described by the approved design.

**Architecture:** A Node 22 ESM CLI coordinates OpenAI-backed research/generation, deterministic content gates, a hybrid media selector, Supabase persistence, and independent Meta platform adapters. GitHub Actions invoke the same CLI commands used locally; atomic Postgres RPC claims and stable idempotency keys protect dispatch.

**Tech Stack:** TypeScript, Node.js 22+, pnpm, OpenAI SDK, Supabase JS, Zod, YAML, Sharp, Vitest, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-31-paper-english-social-engine-design.md`

## Global Constraints

- Build v0 only; exclude every non-goal in design section 25.
- Treat Facebook, Instagram, and Threads credentials as independent.
- Require hosted web search for changing claims and reject unsupported facts.
- Preserve secrets only in local/GitHub environment variables.
- Never publish live without credentials and the explicit confirmation gate.
- Keep planner, dispatcher, token health, and verification available as GitHub Actions.

---

### Task 1: Runtime, configuration, and domain contracts

**Files:** `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `config/production.yaml`, `src/config.ts`, `src/types.ts`, `src/env.ts`

**Interfaces:** Produces validated `AppConfig`, secret-safe environment loading, platform/post/media types, and CLI scripts consumed by all later tasks.

- [ ] Create the Node 22/pnpm ESM project and pinned dependency lockfile.
- [ ] Implement Zod validation for behavior config and environment switches.
- [ ] Define platform-neutral publisher and durable-record types.
- [ ] Verify configuration loading and typecheck.

### Task 2: Supabase persistence and atomic leasing

**Files:** `supabase/migrations/20260831000000_marketing_engine.sql`, `src/db/client.ts`, `src/db/repository.ts`, `scripts/verify-migration.ts`

**Interfaces:** Produces `MarketingRepository` methods for plans, assets, posts, attempts, health, duplicate/cap queries, and `claim_marketing_posts` RPC leasing.

- [ ] Create marketing tables, indexes, RLS, public marketing-media bucket, and tightly granted claim RPC.
- [ ] Implement service-role repository operations with no credential persistence.
- [ ] Add static migration verification for required schema objects.

### Task 3: Deterministic content and schedule gates

**Files:** `src/content/utm.ts`, `src/content/gates.ts`, `src/content/schedule.ts`, `src/shared/hash.ts`, `src/shared/redact.ts`

**Interfaces:** Produces UTM construction, stable hashes/idempotency, platform validation, kill-switch/cap enforcement, and secret-redacted audit summaries.

- [ ] Implement deterministic link, copy, media, duplicate, and unsupported-claim gates.
- [ ] Implement timezone-aware scheduling with collision prevention and caps.
- [ ] Implement redaction and transient/permanent error classification.

### Task 4: OpenAI research, writing, and semantic critic

**Files:** `src/ai/openai.ts`, `src/research/researcher.ts`, `src/content/generator.ts`, `src/content/critic.ts`, `prompts/*.md`, `knowledge/*.md`

**Interfaces:** Produces persisted research snapshots with sources, independent platform variants, claim manifests, one bounded repair, and evergreen fallback content.

- [ ] Use Responses API `web_search` with required tool choice for current research.
- [ ] Use strict structured outputs for plans, copy, claims, and critic decisions.
- [ ] Bound authoring to two initial attempts plus one targeted repair.
- [ ] Hash prompt/config/knowledge provenance into every plan.

### Task 5: Hybrid media pipeline

**Files:** `src/media/ingest.ts`, `src/media/select.ts`, `src/media/generate.ts`, `src/media/validate.ts`, `assets/**`

**Interfaces:** Produces asset ingestion/upload/registry, selection priority and cooldown, validated public media, configurable GPT Image generation, and fallback behavior.

- [ ] Accept PNG/JPEG/WebP manual drops and optional YAML sidecars.
- [ ] Validate actual image type/dimensions/size and upload to the public bucket.
- [ ] Select manual, screenshot, template, generated, then fallback assets in order.
- [ ] Make generation failure non-blocking for valid text platforms and require media on Instagram.

### Task 6: Independent Meta publishers and token health

**Files:** `src/platforms/base.ts`, `src/platforms/facebook.ts`, `src/platforms/instagram.ts`, `src/platforms/threads.ts`, `src/platforms/index.ts`

**Interfaces:** Implements `SocialPublisher` for current Graph endpoints, payload builders, non-destructive credential checks, Threads refresh, and publish results.

- [ ] Implement Facebook text/link/photo Page publishing.
- [ ] Implement Instagram Login image container, status wait, and publish flow.
- [ ] Implement Threads text/image container and publish flow.
- [ ] Add credential identity validation and token-health metadata without raw tokens.

### Task 7: Orchestration and CLI

**Files:** `src/orchestration/*.ts`, `src/cli.ts`

**Interfaces:** Produces `plan-day`, `dispatch-due`, `token-health`, `ingest-assets`, `dry-run`, and gated `publish-test` commands.

- [ ] Implement daily planning and immutable scheduled records.
- [ ] Implement atomic dispatch, leases, retries, reconciliation-safe ambiguous failures, and append-only attempts.
- [ ] Enforce switches again at dispatch time.
- [ ] Require `--confirm-live` and `DRY_RUN=false` for smoke publishing.

### Task 8: Automated verification and operations

**Files:** `tests/**/*.test.ts`, `.github/workflows/*.yml`, `README.md`, `docs/MANUAL_SETUP.md`

**Interfaces:** Produces deterministic unit/integration coverage, CI/schedules, and exact local/production/smoke procedures.

- [ ] Cover all tests listed in design section 19 using mocked APIs.
- [ ] Add daily planner, 30-minute dispatcher, daily token health, and CI workflows with minimum permissions.
- [ ] Document migration, credential, dry-run, and explicit live smoke procedures.
- [ ] Run install, lint, typecheck, tests, build, and migration verification.
- [ ] Initialize Git, inspect for secrets, commit, and push when a suitable upstream exists.


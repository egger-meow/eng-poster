# Online Authoring Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ChatGPT online stage exactly one queue-fill candidate safely, then have a GitHub worker process it through the existing `enqueuePlanSchema` and `enqueuePlan()` path before anything reaches `marketing_posts`.

**Architecture:** Add a service-role-only Supabase staging queue and RPCs, a Node worker that claims submissions and reuses the current enqueue path, and a scheduled GitHub Action that runs only the ingestion worker. Add a paste-ready online prompt that performs read-only planning and exactly one staging mutation.

**Tech Stack:** TypeScript, Supabase/Postgres, GitHub Actions, Vitest, existing eng-poster CLI.

**Spec:** Approved in chat on 2026-09-04.

## Global Constraints

- Do not duplicate TypeScript enqueue validation in SQL.
- Online submission must never call Buffer or `dispatch-due`.
- The only online mutation is `public.chatgpt_submit_marketing_plan(jsonb,text)`.
- Current main Git SHA must be carried into the submission and checked by the worker.
- Existing queue cadence, offer gates, winner learning, failed-slot replacement, URL invariants, and dispatcher behavior must remain unchanged.
- Service-role only. No anon/authenticated access.

---

### Task 1: Add staging migration and contract tests

**Files:**
- Create: `supabase/migrations/20260904070000_online_authoring_bridge.sql`
- Create: `tests/online-authoring-migration.test.ts`
- Modify: `scripts/verify-migration.ts`

**Interfaces:**
- Produces `public.marketing_authoring_submissions`
- Produces `public.chatgpt_submit_marketing_plan(jsonb,text)`
- Produces `public.chatgpt_get_marketing_submission(uuid)`
- Produces `private_generation.claim_marketing_authoring_submissions(text,integer,integer)`

- [ ] Write migration contract tests first.
- [ ] Verify tests fail before migration exists.
- [ ] Add minimal forward-only migration.
- [ ] Verify migration tests pass.

### Task 2: Add online submission repository and worker

**Files:**
- Create: `src/online/submissions.ts`
- Create: `src/orchestration/process-online-submissions.ts`
- Create: `tests/online-submissions.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- `OnlineSubmissionRepository.claim(workerId, limit, leaseMinutes)`
- `OnlineSubmissionRepository.accept(id, result)`
- `OnlineSubmissionRepository.reject(id, code, message, result?)`
- `OnlineSubmissionRepository.fail(id, code, message, retryable)`
- `processOnlineSubmissions(options?)`

- [ ] Write worker tests first for stale SHA, accepted enqueue, deterministic rejection, technical retry, and read-after-write verification.
- [ ] Verify tests fail because worker does not exist.
- [ ] Implement minimal repository/worker using existing `enqueuePlanSchema` and `enqueuePlan()` imports.
- [ ] Add CLI commands `process-online-submissions`, `online-submissions`, and `online-submission-status`.
- [ ] Verify worker tests pass.

### Task 3: Add isolated GitHub worker workflow

**Files:**
- Create: `.github/workflows/process-online-authoring.yml`
- Create: `tests/online-authoring-workflow.test.ts`

- [ ] Write workflow contract test first.
- [ ] Verify it fails before workflow exists.
- [ ] Add scheduled/workflow_dispatch ingestion-only workflow.
- [ ] Verify it never invokes Buffer/dispatcher and tests pass.

### Task 4: Add online ChatGPT prompt and docs

**Files:**
- Create: `docs/CHATGPT_ONLINE_QUEUE_FILL_PROMPT.md`
- Modify: `README.md`
- Modify: `docs/SCHEDULER_SETUP.md`
- Create: `tests/online-authoring-prompt.test.ts`

- [ ] Write prompt contract tests first.
- [ ] Add exactly-once submission prompt and status semantics.
- [ ] Document staging/worker flow.
- [ ] Verify prompt tests pass.

### Task 5: Full verification and rollout

- [ ] Run `pnpm verify` in CI.
- [ ] Confirm branch Verify workflow is green.
- [ ] Fast-forward `main` only after verification.
- [ ] Apply `20260904070000_online_authoring_bridge` to production.
- [ ] Read-after-write inspect schema/RPCs without staging a real candidate.
- [ ] Confirm main Verify is green and report SHA.

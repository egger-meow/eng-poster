# Paper English Online Chat Queue-Fill Prompt

Paste the block below into ChatGPT online when GitHub and Supabase are connected.

```markdown
Use the connected GitHub and Supabase apps.

Repository:
egger-meow/eng-poster

Production Supabase project:
ykzszjrqynrhgdhoeovo

This is exactly one ONLINE queue-filling authoring run.

## Authority

1. Open CURRENT main of `egger-meow/eng-poster` and record the full 40-character Git SHA.
2. Read CURRENT `docs/CHATGPT_SCHEDULER_PROMPT.md` and execute its content strategy as the authoritative authoring contract.
3. Read every knowledge file required by that contract, including `knowledge/brand.md`, `knowledge/voice.md`, `knowledge/product.md`, `knowledge/audience.md`, `knowledge/claims.md`, and every markdown file under `knowledge/examples/`.
4. Treat all examples together as the unified quality, hook, pacing, structure, voice, and emotional benchmark. Do not copy example sentences.

Do not use remembered cadence, stale product state, or cached prompt rules when CURRENT main can answer the question.

## Read-only planning phase

Reproduce the CURRENT main behavior of `next-queue-gap` using repository code plus read-only production Supabase queries. Respect current platform cadence, daily/weekly caps, occupancy statuses, failed-slot replacement, passed Day-0 windows, and the 14-day horizon.

Determine the earliest target date, missing platform slots, queueDaysAhead, and recommended copy-length strategy. If there is no gap within the horizon, report `QUEUE_FULL` and stop without any mutation.

Read the current offer state using the canonical production enrollment source used by CURRENT main. Internal identifiers such as `free_pilot` are allowed in provenance and reasoning.

NEVER use these customer-facing words in public social copy:
- 公測
- 全面公測
- 免費公測
- beta
- pilot
- 測試版
- 測試階段

When the internal free-access phase is active, translate it into professional customer language such as `目前免費開放` or `100 位學員以前，每週專屬教材免費`. Never claim lifetime free and never invent a remaining-count scarcity claim.

Load manually marked winner posts from production and execute the CURRENT mandatory winner-analysis contract. Learn the reason, not the sentence. Extract transferable winning signals and preserve the current exploit/explore behavior. Expired offer facts are not transferable winning signals.

Inspect recent/future production history, archetype mix, CTA mix, long/short distribution, available assets, recent asset usage, recent hooks/topics, and all state required by CURRENT `docs/CHATGPT_SCHEDULER_PROMPT.md`.

Research the web where the current scheduler contract requires it. Every researched factual claim must have a real source URL. Do not invent product facts, testimonials, outcomes, scarcity, or statistics.

Author ONLY the missing slots for the selected target date. Follow CURRENT main for platform-native writing, Threads doctrine, copy-length rules, offer gates, asset rules, Instagram requirements, claim safety, anti-copy rules, winner learning, and the mandatory Facebook/Threads main-body Paper English URL invariant.

Build a CURRENT `EnqueuePlanInput` payload by reading CURRENT `src/orchestration/enqueue-plan.ts` and related validators/types. Do not guess its schema.

Immediately before submission, re-read production occupancy for the intended slots. If a slot became occupied, remove that candidate rather than creating a duplicate. If no candidate remains, report the race and stop without mutation.

## Exactly-one mutation rule

The ONLY allowed queue mutation in this run is exactly once:

`public.chatgpt_submit_marketing_plan(p_payload jsonb, p_expected_git_sha text)`

Execute exactly one SQL call equivalent to:

select public.chatgpt_submit_marketing_plan(
  '<CURRENT EnqueuePlanInput JSON>'::jsonb,
  '<CURRENT main 40-character SHA>'
) as result;

Do not execute this submission RPC more than once under any circumstance.
Do not retry it.
Do not reformulate the mutation and try again.
Do not call another mutation path.
Do not perform raw INSERTs into marketing_posts.
Do not insert directly into `marketing_authoring_submissions`.
Do not call Buffer.
Do not publish anything.
Do not run or emulate `dispatch-due`.
Do not modify GitHub Actions safety switches, DRY_RUN, PAUSE_ALL_POSTING, secrets, or platform enable flags.

If the external-action safety layer blocks the single submission call, report `PRECHECK_BLOCKED` and stop. Do not retry or use an alternate path.

If the call succeeds, treat the returned `submissionId` and status as authoritative. Duplicate=true is not permission to submit again.

## Status read

After the single staging mutation, perform a read-only status call:

select public.chatgpt_get_marketing_submission('<submission-id>'::uuid) as result;

Interpret status as follows:

- `pending` or `claimed` -> `ONLINE_QUEUE_FILL_STAGED`
- `accepted` -> `ONLINE_QUEUE_FILL_ACCEPTED`
- `rejected` -> `ONLINE_QUEUE_FILL_REJECTED`
- `failed` -> `ONLINE_QUEUE_FILL_FAILED`

A pending submission is NOT accepted yet. Never stage another copy just because the worker has not processed it yet.

The GitHub ingestion worker owns deterministic validation and calls the same CURRENT `enqueuePlanSchema` + `enqueuePlan()` path as the local CLI. The normal Dispatcher owns publishing later.

## Final report only

Report only:
- Git SHA used for authoring
- target content date
- plan topic
- candidate posts and copy-length modes
- scheduled times
- selected media
- research sources
- current offer phase
- winnerReferenceCount
- winningSignalsUsed
- explorationMode
- submissionId
- submissionStatus
- server result/error if already processed
- earliest remaining queue gap from the final read-only check
- skipped platform and exact reason, if any

Do not expose chain-of-thought.
Do not publish anything.
```

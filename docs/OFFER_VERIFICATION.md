# Offer-aware engine verification — 2026-09-03

This is an implementation verification record, not live offer authority. Every future authoring run must call `pnpm social offer-state` again. The delivery commit SHA is provided in the implementation handoff.

## Result

`pnpm verify` completed with exit code 0: lint, typecheck, 27 test files / **264 passing tests**, build and both base/offer migration contract checks. **71 new tests** cover RPC state mapping, malformed/optional counts, public terminology, lifetime claims, queued scarcity, enqueue freshness and provenance, durable gates/comments, cancelled cadence replacement, provider deletion and idempotent recovery, ambiguous submissions, pre-submit outage recovery, definite rate-limit retries, winner transfer and scheduler order. Existing 193 tests remain passing; scheduler step assertions were updated to the mandated sequence.

No live Buffer call, publication, production queue rewrite, enrollment modification, GitHub Variable/Secret change, or posting-switch change was performed. All Buffer verification used mocks. Enqueue test fixtures explicitly inject offer state; final verification also runs with production Supabase credentials unavailable to confirm CI independence. Independent code review findings about pre-submit retries, ambiguous recovery and duplicate text matches were addressed and regression-tested.

## Exact offer-state JSON observed at 07:02:26 UTC

```json
{
  "offerPhase": "free_pilot",
  "freePilotActive": true,
  "freePilotAdmissions": 4,
  "freePilotLimit": 100,
  "capacityRemaining": 96,
  "status": "open",
  "checkedAt": "2026-09-03T07:02:26.324Z",
  "validOfferClaims": [
    "100 位學員以前，每週專屬教材免費。",
    "目前免費開放中",
    "目前免費使用，免信用卡"
  ],
  "strategy": {
    "acquisitionAngle": "current_free_access",
    "conversionCapableFreeMentionShare": { "min": 0.6, "max": 0.7 },
    "suggestedCtaMix": { "none": 0.3, "soft": 0.35, "direct": 0.35 },
    "directionalOnly": true
  }
}
```

## Read-only queue checks

- `pnpm social next-queue-gap`: exit 0; target 2026-09-04, Threads slots 1 and 2, Instagram slot 1; recommended short mode.
- `pnpm social queue-health --hours 336`: exit 0, but **healthy: false** because of an existing permanently failed post. Two upcoming provider-scheduled posts (Facebook 1, Threads 1), no stale local/provider schedules, no retryable failures. This existing operational issue was not mutated.
- `pnpm social offer-sensitive-queue`: exit 0; zero detected offer-sensitive unresolved rows at inspection time. Existing queued copy was not rewritten.

## Delivered behavior

- Exact phase model: `OfferPhase = "free_pilot" | "standard_paid"`; durable post gate `null | "free_pilot_active"`.
- Canonical production RPC supplies state; invalid/unavailable responses never authorize free-access claims. Operational remaining capacity is distinct from historical admissions.
- Enqueue persists live phase/snapshot provenance and gate; supplied snapshots cannot override production. Free-access copy requires an explicit gate, current active phase and open capacity; it is checked again before scheduling.
- Dispatch checks live state before submission; invalid posts are cancelled without rewriting. Claim-only RPC failures can retry safely. Confirmed no-create provider rejections retain normal retry behavior; uncertain submissions remain durably held for reconciliation.
- Provider-scheduled offer posts, including far-future ones and unresolved submissions without IDs, are revalidated. Recovery requires a unique match. Official `deletePost(input: DeletePostInput!)` returns `DeletePostSuccess { id }` or `VoidMutationError`; only confirmed deletion/absence permits local cancellation. Failed/ambiguous cancellation remains unresolved. Already-sent expired offers become explicit incidents, not newly published local rows.
- Cancellation retains history and atomically releases the unique cadence key. Repeated cancellation is a no-op and the missing slot can be refilled.
- Public canonical copy is 「100 位學員以前，每週專屬教材免費。」 Public testing terminology, lifetime-free promises and queued exact remaining-count scarcity are rejected.
- Free access is a directional 60–70% acquisition angle with 30–40% pure value content, flexible CTA mix 30/35/35, varied openings/reveals. Existing 14-day horizon, 72h topic rule, 1:1 long/short and mandatory FB/Threads main-body URLs remain.
- Winner context includes historical source phase and current claim validity. Expired facts cannot transfer; psychological mechanisms can. Zero/evergreen winners and the local dashboard remain supported.

## Migration and remaining operator steps

New migration: `supabase/migrations/20260903064118_marketing_offer_gate.sql`. Adds `offer_gate`, `first_comment_text`, `cta_mode`, and service-role-only `cancel_marketing_offer_post` RPC. The migration was applied to production project `ykzszjrqynrhgdhoeovo` on 2026-09-04. Refresh any externally saved scheduler prompt before the next authoring run. Existing Supabase credentials suffice; no new secret is needed.

Official API sources and full architecture are in [OFFER_CONTRACT.md](OFFER_CONTRACT.md). A 30-minute polling interval, cron delays, outages and the delete/publish race leave a residual timing window: separate product and Buffer systems cannot provide an atomic offer check at publication. Manual provider review is required for unresolved incidents. No claim of a zero-race cancellation guarantee is made.

## Files changed

- `AGENT_START_PROMPT.md`
- `README.md`
- `docs/CHATGPT_SCHEDULER_PROMPT.md`
- `docs/OFFER_CONTRACT.md`
- `docs/OFFER_VERIFICATION.md`
- `docs/SCHEDULER_SETUP.md`
- `knowledge/claims.md`
- `knowledge/product.md`
- `knowledge/voice.md`
- `scripts/verify-migration.ts`
- `src/cli.ts`
- `src/content/gates.ts`
- `src/db/repository.ts`
- `src/offer/claims.ts`
- `src/offer/queue.ts`
- `src/offer/reconcile.ts`
- `src/offer/state.ts`
- `src/offer/winners.ts`
- `src/orchestration/dispatch-due.ts`
- `src/orchestration/enqueue-plan.ts`
- `src/platforms/buffer.ts`
- `src/types.ts`
- `supabase/migrations/20260903064118_marketing_offer_gate.sql`
- `tests/enqueue-plan.test.ts`
- `tests/mandatory-link-invariant.test.ts`
- `tests/knowledge-structure.test.ts`
- `tests/offer-contracts.test.ts`
- `tests/offer-dispatch.test.ts`
- `tests/offer-enqueue-winners.test.ts`
- `tests/offer-state-claims.test.ts`
- `tests/winner-contracts.test.ts`
- `tests/winner-repository.test.ts`

Pre-existing untracked `supabase/.temp/` was preserved and excluded from the commit.

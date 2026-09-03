# Dynamic offer contract

**FREE PILOT IS A DYNAMIC OFFER, NOT A PERMANENT PRODUCT FACT.** Current product truth must always come from `pnpm social offer-state`. Public language is governed by [claims.md](../knowledge/claims.md); canonical wording is 「100 位學員以前，每週專屬教材免費。」

## Authority and model

`OfferPhase = "free_pilot" | "standard_paid"`; `OfferGate = null | "free_pilot_active"`. `src/offer/state.ts` calls production `public.get_enrollment_state()` via the existing Supabase client, with a 15-second request timeout and an explicit production-project check. Existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are used; no new secrets or product mutations. Website text is wording evidence only.

The active boolean is authoritative. Counts must be nonnegative integers when supplied, the threshold positive, and exactly one valid RPC row must exist. Missing optional counts become null. An active flag at/above the reported historical threshold is inconsistent and fails closed. `capacityRemaining` maps operational `remaining` (it may differ from threshold minus admissions). Acquisition claims also require `status: open` and known positive capacity; the 100-person claim additionally requires limit 100. No free claims are authorized by `standard_paid` alone, even if an older page advertises a different trial.

## Planning and enqueue

Mandatory scheduler order is in [CHATGPT_SCHEDULER_PROMPT.md](CHATGPT_SCHEDULER_PROMPT.md). `offer-state` precedes authoring on every run; failed verification blocks authoring. The rolling free-access acquisition share is 60–70% of conversion-capable posts, with 30–40% pure educational/provocative/winner content. Suggested active-phase CTA none/soft/direct is 30/35/35; evidence may adjust both. The independent winner exploit/explore split, 14-day horizon, 72h topical rule, 1:1 long/short and main-body URL invariants remain unchanged.

The author explicitly sets `offerGate` on every offer-sensitive post, including image/first-comment claims. Enqueue checks the whole batch for offer violations before writes, fetches state itself, persists a live `provenance.offerPhase` + `offerSnapshot`, then rechecks gated posts before each schedule write. Caller snapshots cannot override production. Plans are reused only within the same phase; an older plan's phase is never overwritten. Unknown historical phases remain null. Claims and winner signals are rejected if they depend on expired offers. Normal per-post validation can still fail after earlier posts in a batch have enqueued; this is not an atomic batch API.

## Durable gate and cancellation

Migration `20260903064118_marketing_offer_gate.sql` adds nullable `marketing_posts.offer_gate` with the single supported gate. It also persists `first_comment_text` and `cta_mode` so offer-bearing comments survive dispatch and inspection. Schema fallback never drops the offer gate. `cancel_marketing_offer_post` is a service-role-only, security-invoker RPC that atomically marks an unresolved post cancelled, clears its lease, records a reason and appends `:cancelled:<id>` to its cadence key. Repeated cancellation is a no-op. The historical row/Buffer ID remain, but the original unique cadence key is available for replacement. Enqueue chooses the first unoccupied slot, so cancellation of slot 1 while slot 2 exists can refill correctly.

No existing queued copy is rewritten or gates backfilled by the migration. The read-only `pnpm social offer-sensitive-queue` reports explicit gates, detected legacy copy and review reasons; it also includes overdue unresolved rows. Dispatch infers an effective gate for obvious legacy offer text. Novel paraphrases/image claims need manual author review.

## Dispatch and Buffer reconciliation

Before handing sensitive copy to Buffer, re-read the current offer. Invalid copy is cancelled locally; copy is never silently rewritten. Unknown state releases the claim with an error and sends nothing. Evergreen scheduling retains the 24-hour lookahead.

Every normal reconciliation run reads all provider-scheduled rows (including far-future offer posts), then checks live state for sensitive rows. Evergreen reconciliation retains its near-due window. An invalid offer calls official `deletePost(input: { id })` and recognizes only `DeletePostSuccess` with the matching ID. An explicit null `post` lookup acknowledges already-absent content. Malformed responses, network failures and mutation errors do not establish cancellation: the row remains unresolved, `last_error` identifies retry/manual review, and the next pass retries. A remote deletion followed by a failed local write recovers by confirming absence on the next pass. Invalid gated rows are never newly marked published; already-sent detection records an OFFER INCIDENT for manual review and does not delete a live social post.

Ambiguous sensitive submissions remain durably held as `provider_scheduled` with `provider_status: offer_submission_unconfirmed` (possibly without an ID) and are searched on every reconciliation before resubmission/cancellation. They never disappear on retry exhaustion. Provider recovery requires exactly one text match; zero/multiple matches require manual review. Pre-submit offer deferrals undo the claim-only attempt increment so an RPC outage does not manufacture submission ambiguity. Even when every platform is disabled for new submissions, offer reconciliation still runs unless globally paused or in DRY_RUN. An unconfirmed lookup must not authorize a duplicate or free a cadence whose provider state is unknown. Existing evergreen idempotency behavior remains.

**Residual timing risk:** Buffer scheduling and the product RPC are separate systems, with no atomic publish-time offer check. The dispatcher normally runs every 30 minutes and GitHub scheduling can be delayed. An offer can end after a successful check and before the next reconciliation or during a delete/publish race. Official deletion reduces this risk but cannot guarantee withdrawal before publication. Pausing dispatch, DRY_RUN, outages or authorization failures also prevent automatic cancellation; manually inspect Buffer in those cases. Do not claim provider schedules are automatically safe. Keep normal evergreen lookahead; cancellation is officially supported, so shortening it globally is unnecessary.

## Official capability and product evidence

Verified 2026-09-03 against current official documentation (no live Buffer call):

- [DeletePostInput](https://developers.buffer.com/types/DeletePostInput.html): required post ID.
- [DeletePostPayload](https://developers.buffer.com/types/DeletePostPayload.html): `DeletePostSuccess | VoidMutationError`.
- [DeletePostSuccess](https://developers.buffer.com/types/DeletePostSuccess.html): deleted post ID.
- [VoidMutationError](https://developers.buffer.com/types/VoidMutationError.html): error message; not a cancellation acknowledgement.

The implementation uses this official delete path; it does not invent an unschedule endpoint. Account-specific permissions and deletion/publication races remain operational limitations.

Authoritative product repository: `egger-meow/eng-tutor-saas`, verified local and remote HEAD `c26a46ac5b1a9cdf245c1f40f0a2db9094db0dc6`; `supabase/migrations/20260903140000_free_pilot_phase.sql`, `apps/web/src/lib/enrollment.ts`, `apps/web/src/routes/LandingPage.tsx`, `docs/SPEC.md` section 197. Historical admissions end the phase permanently at 100. Product landing wording is translated into the stricter public copy contract in this repository.

## Winner learning

`winners-list` joins historical plan provenance and emits source/current phase, offer dependency, current allowed claims and `offerClaimsReusable`. Missing legacy phase is unknown and does not authorize claims. Optional structured `winningSignals` records `signal`, `evidencePostIds`, `confidence`, `sourceOfferPhase`, `offerDependent` and `notes`. Describe transferable mechanisms separately from offer facts. Enqueue rejects obvious expired offer text in both structured signals and `winningSignalsUsed`; public copy gates independently enforce current claims. Zero winners and evergreen winners continue normally. Local Winner dashboard behavior is unchanged.

## Rollout and verification

1. Apply the forward-only marketing migration to the marketing database before relying on durable gates/cancellation. Do not modify enrollment state or apply product migrations from this repository.
2. Refresh any externally saved scheduler prompt from the authoritative prompt here. Repository edits do not update external task instructions automatically.
3. Run `pnpm verify`, `pnpm social offer-state`, `pnpm social next-queue-gap`, `pnpm social queue-health --hours 336`, `pnpm social offer-sensitive-queue`.
4. Review flagged legacy queue rows. Inspection is read-only; implementation verification must not call Buffer, publish, rewrite production posts or alter posting switches/secrets.

Mock tests verify the cancellation contract and failure recovery. They do not prove account-specific live deletion rights. Production migration application is an operator step and was not performed by the implementation.

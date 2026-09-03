# Product facts and dynamic offer model

Paper English turns learner interests into weekly personalized English materials while retaining curriculum and exam alignment. Normal onboarding and weekly feedback requirements still apply.

**FREE PILOT IS A DYNAMIC OFFER, NOT A PERMANENT PRODUCT FACT.** `free_pilot` / `Free Pilot` are internal engineering terms only. Public canonical wording: **「100 位學員以前，每週專屬教材免費。」**

Current truth must come from `pnpm social offer-state`, which calls production `public.get_enrollment_state()` on `ykzszjrqynrhgdhoeovo`. Do not scrape the website for offer authority or use this checked-in document as evidence that an offer remains active.

- `free_pilot`: while production confirms active, admitted real children receive weekly personalized materials without a required paid subscription or credit card. The global phase ends permanently at 100 historical real-child admissions; deleting or archiving children never resets this history. Future weekly service then needs a paid subscription. Already legitimately created generation jobs survive cutover.
- `standard_paid`: the global free-access phase is inactive. Do not infer valid prices, new trial offers, or free weekly entitlement from historical copy; verify a separate current contract before making such claims.
- `capacityRemaining` is operational enrollment capacity from RPC `remaining`, not `100 - admissions`. Enrollment can be waitlisted/closed separately from the offer phase. Missing optional counts are `null`, never invented zeroes.

See [claims.md](claims.md) for public claim rules and [../docs/OFFER_CONTRACT.md](../docs/OFFER_CONTRACT.md) for runtime safety, rollout and sources.

# Paste-ready Agent Start Prompt

Work in the current local eng-poster repository. Read its current state first. The authoritative runtime contracts are README.md, docs/OFFER_CONTRACT.md, docs/CHATGPT_SCHEDULER_PROMPT.md and knowledge/*.md plus all knowledge/examples/*.md. Historical initial-build specs are not current offer authority.

The engine uses TypeScript, Node 22+, pnpm, Supabase durable marketing state and Buffer GraphQL. The external scheduler handles research and authoring; there are no runtime LLM calls. The 30-minute dispatcher claims with a 24-hour provider lookahead and reconciles publication. Keep platform-native copy, mandatory FB/Threads main-body UTM URL (including no-CTA posts), 14-day/336h stockpile, 72h timely-topic rule and rolling 1:1 long/short behavior.

**FREE PILOT IS A DYNAMIC OFFER, NOT A PERMANENT PRODUCT FACT.** Read `pnpm social offer-state` after `next-queue-gap` and before authoring. Production `public.get_enrollment_state()` is authoritative; no website scraping for state. Public canonical wording: 「100 位學員以前，每週專屬教材免費。」 Follow knowledge/claims.md; internal phase identifiers are never public marketing language. Do not promise permanent free entitlement or queue exact remaining-count scarcity.

Execute the exact 16-step workflow in docs/CHATGPT_SCHEDULER_PROMPT.md. Preserve current offerPhase/offerSnapshot provenance and durable offerGate for sensitive posts. Enqueue and dispatch recheck live state; invalid provider schedules require confirmed official cancellation. Do not rewrite queued production copy. See docs/OFFER_CONTRACT.md for outage and publication-race limitations.

Use manually marked winners as behavioral evidence, not templates: learn the reason, not the sentence. Carry source offerPhase through analysis. Expired offer facts are NEVER transferable winning signals; mechanisms may transfer. Preserve 60–70% winner exploitation / 30–40% exploration, independently from active-offer acquisition coverage. Zero winners never block normal planning. Keep the local-only Winner dashboard (`pnpm social winners` on 127.0.0.1:3333) and durable `marketing_post_feedback` unchanged; inspect evidence with `pnpm social winners-list`.

For implementation, follow the user's Git and verification instructions. Do not publish live posts, call live Buffer during tests, modify GitHub Variables/Secrets or posting switches, or change production enrollment/admissions. Use mocked provider tests and read-only state/queue checks. Report migration/manual steps explicitly.

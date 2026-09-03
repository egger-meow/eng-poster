# Paste-ready Agent Start Prompt

Create a new private repository named `paper-english-social-engine` for Paper English organic social automation.

Treat `docs/superpowers/specs/2026-08-31-paper-english-social-engine-design.md` as the authoritative product and architecture contract. Read it fully before implementation. Also read `docs/MANUAL_SETUP.md`, `docs/CONTENT_PLAYBOOK.md`, `docs/ASSET_GUIDE.md`, `.env.example`, and `config/production.example.yaml`.

Before freezing any Meta endpoint, permission, token flow, or platform publishing constraint, verify it against current official Meta developer documentation or Meta's official Postman workspaces. External APIs change; update the setup docs in the same change whenever implementation-time reality differs from the design assumptions. For OpenAI integration, verify current official OpenAI API docs before selecting model IDs or tool parameters.

Build v0 only. Do not add X/Twitter, Facebook Groups automation, comments/DM automation, a custom admin UI, paid ads, reels/video generation, or social analytics dashboards.

Core contract:

- TypeScript + Node 22+ + pnpm.
- GitHub Actions: daily planner, 30-minute dispatcher, daily token health, CI verification.
- Supabase durable marketing state + public marketing media storage.
- OpenAI Responses API hosted web search for current research.
- Platform-native independent copy for Facebook, Instagram, Threads.
- Queue-aware conveyor belt architecture: 14-day stockpile horizon, deterministic earliest future queue gap (`pnpm social next-queue-gap`), 72h timely-topic freshness rule (no timely topics > 72h out; enforce evergreen archetypes), and 336h queue health monitoring.
- Fully automatic publishing, no approval queue.
- Hybrid media pipeline: manual assets > real product screenshot > branded template > AI-generated image > fallback.
- Manual asset drop folders must work exactly as documented.
- Independent platform credentials; do not require FB/IG/Threads to be the same Meta identity.
- Instagram auth should prefer Instagram API with Instagram Login unless current official docs reveal a blocker.
- Idempotent publishing and atomic DB job claiming are mandatory.
- Every Paper English link must carry platform-specific UTM attribution.
- Winner feedback & learning loop: local-only Winner Posts dashboard (`pnpm social winners` on 127.0.0.1) allows the operator to mark winners and observed metrics into durable `marketing_post_feedback`; future scheduler runs must analyze winners, extract transferable hypotheses, enforce anti-copy safeguards ("Learn the reason, not the sentence"), and balance ~60–70% winner exploitation with ~30–40% creative exploration.
- Unsupported factual claims must be rejected rather than made more persuasive.
- Aggressive/stop-scroll hooks are desired, but factual claims must remain evidence-backed.
- Keep all secrets out of Git/logs/DB state.
- Include all documented manual setup instructions and update `.env.example` when a new secret is genuinely required.

Start with implementation planning, then implement until every v0 Done Condition in the design spec is satisfied. Do not claim production readiness until lint, typecheck, tests, build, migration verification, credential-health checks, dry-run, and explicit live smoke procedures are complete. Live publishing must require explicit human-provided credentials and the spec's confirmation gate; never invent credentials or bypass missing setup.

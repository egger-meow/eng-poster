# Paper English Social Engine — Production Design Spec

Date: 2026-08-31
Status: Approved architecture, implementation-ready after final user review
Proposed repository: `egger-meow/paper-english-social-engine`
Primary brand: 紙屬英文 / Paper English
Platforms: Facebook Page, Instagram Professional Account, Threads
Out of scope: X/Twitter, paid ads, Facebook Groups automation, DMs/comments automation, ad campaign management

## 1. Product Goal

Build a standalone, fully automated organic-social publishing engine for 紙屬英文.

The system must continuously:

1. research timely and relevant web information;
2. combine research with the brand knowledge base and approved writing examples;
3. plan a diversified daily/weekly content mix;
4. write platform-native copy for Facebook, Instagram, and Threads;
5. choose or create an appropriate visual when needed;
6. publish automatically without human approval;
7. persist every plan, claim source, media asset, publish attempt, and platform result;
8. retry transient failures safely without duplicate posts;
9. expose simple kill switches and per-platform controls;
10. attach UTM attribution to every Paper English website link.

The goal is not "post every day". The goal is a durable organic distribution machine that can increase Paper English impressions and qualified visits while remaining factual, brand-consistent, and operationally safe.

## 2. Core Design Decisions

### 2.1 Runtime and repository

- TypeScript
- Node.js 22+
- pnpm
- ESM
- GitHub Actions for cron dispatching (every 30m), token health (daily), and queue monitoring
- Supabase for durable job state and public marketing-media storage
- External ChatGPT Scheduled Tasks as the autonomous research, writing, and planning brain
- Ingestion contract (`enqueue-plan` and direct Supabase MCP writes) with deterministic validation gates
- No production runtime LLM dependencies inside the repository


### 2.2 Platform accounts are independent

The Facebook Page, Instagram account, and Threads account do not need to share the same Meta login identity or Accounts Center relationship.

Each platform adapter owns its own credentials and resource IDs.

No code may assume:

- Facebook Page == Instagram owner identity;
- Instagram == Threads identity;
- one access token works for all three platforms.

### 2.3 Fully automatic publishing

There is no approval queue in v0.

A valid post moves from planning to scheduled to publishing automatically after deterministic and model-based gates pass.

Emergency controls must exist:

- `PAUSE_ALL_POSTING=true`
- `FACEBOOK_ENABLED=false`
- `INSTAGRAM_ENABLED=false`
- `THREADS_ENABLED=false`
- per-platform daily/weekly maximums
- `DRY_RUN=true`

### 2.4 Research before generation

The engine must not rely only on model memory for timely claims.

For every research-backed content item, the planner must use OpenAI Responses API with the hosted `web_search` tool and persist:

- research query;
- source URL;
- source title;
- retrieved timestamp;
- short factual notes;
- which generated claims depend on each source.

When research is required, configure web search as required rather than optional.

Evergreen product/brand posts may skip live web research only when every factual claim comes from checked-in brand knowledge or approved product facts.

### 2.5 Visual strategy is hybrid

Visual selection priority:

1. high-fit human-curated manual asset;
2. real product/material screenshot;
3. deterministic branded template render;
4. AI-generated image;
5. evergreen fallback asset.

A visual failure must not block Facebook/Threads when the selected post type can validly publish as text-only. Instagram must always have a valid media asset.

AI image generation is a normal automated pipeline stage, not a human handoff.

Human-created images can be added at any time to `assets/manual/**`; ingestion must make them available to the asset selector.

## 3. Suggested Repository Layout

```text
paper-english-social-engine/
├─ AGENTS.md
├─ README.md
├─ package.json
├─ pnpm-lock.yaml
├─ tsconfig.json
├─ .env.example
├─ .gitignore
├─ assets/
│  ├─ manual/
│  │  ├─ evergreen/
│  │  ├─ product/
│  │  ├─ lifestyle/
│  │  └─ campaigns/
│  ├─ templates/
│  └─ fallback/
├─ config/
│  ├─ production.yaml
│  └─ schema.ts
├─ knowledge/
│  ├─ brand.md
│  ├─ product.md
│  ├─ audience.md
│  ├─ claims.md
│  ├─ voice.md
│  └─ examples/
│     ├─ facebook/
│     ├─ instagram/
│     └─ threads/
├─ prompts/
│  ├─ research.md
│  ├─ planner.md
│  ├─ writer.md
│  ├─ critic.md
│  ├─ visual-planner.md
│  └─ image-prompt.md
├─ src/
│  ├─ cli.ts
│  ├─ orchestration/
│  │  ├─ plan-day.ts
│  │  ├─ dispatch-due.ts
│  │  ├─ refresh-tokens.ts
│  │  └─ ingest-assets.ts
│  ├─ research/
│  ├─ content/
│  ├─ media/
│  ├─ platforms/
│  │  ├─ facebook.ts
│  │  ├─ instagram.ts
│  │  └─ threads.ts
│  ├─ storage/
│  ├─ db/
│  ├─ telemetry/
│  └─ shared/
├─ supabase/
│  └─ migrations/
├─ tests/
└─ .github/
   └─ workflows/
      ├─ plan-daily.yml
      ├─ dispatch.yml
      ├─ token-health.yml
      └─ verify.yml
```

Large generated media files must not be committed to Git history.

## 4. Scheduling Model

Use a two-stage scheduler instead of one workflow per social platform.

### 4.1 Daily planner

Runs once daily shortly after midnight Asia/Taipei.

Suggested initial execution window: 00:15 Asia/Taipei.

Responsibilities:

- load current production config;
- load recent post history;
- load brand knowledge and approved examples;
- research candidate topics;
- create that day's content plan;
- generate copy;
- prepare visuals/media;
- run all quality gates;
- insert scheduled jobs with explicit `scheduled_for` timestamps.

### 4.2 Dispatcher

Runs every 30 minutes.

Responsibilities:

- atomically claim jobs whose `scheduled_for <= now()`;
- publish each job at most once;
- persist platform response IDs/URLs;
- retry transient failures with capped exponential backoff;
- mark permanent errors for inspection;
- never regenerate copy while dispatching.

GitHub scheduled workflows are not guaranteed to run at the exact minute. Organic social publishing must tolerate normal scheduler delay.

### 4.3 Initial production cadence

All cadence values live in `config/production.yaml`, not source code.

Default:

- Threads: 2 posts/day
- Facebook: 4 posts/week
- Instagram: 3 feed posts/week

Recommended local posting windows:

- Threads #1: 11:30–13:30 Asia/Taipei
- Threads #2: 19:00–22:00 Asia/Taipei
- Facebook: 19:00–21:30 Asia/Taipei
- Instagram: 19:00–21:30 Asia/Taipei

The daily planner chooses a concrete time within each window. It must not schedule two Paper English platforms at exactly the same minute unless explicitly configured.

Per-platform caps are hard gates.

## 5. Content Strategy

### 5.1 Content mix

Target rolling 14-day mix:

- 35% parent/student pain-point or opinion hook
- 25% educational value / English-learning insight
- 20% Paper English product or real-material demonstration
- 10% timely/trending topic translated into an English-learning angle
- 10% direct conversion / offer / free sample CTA

No exact percentage needs to hold within one day. The planner optimizes diversity over a rolling window.

### 5.2 Content archetypes

Required initial archetypes:

- `pain_point`
- `contrarian_education_take`
- `interest_to_english`
- `material_showcase`
- `grammar_micro_lesson`
- `vocabulary_micro_lesson`
- `exam_alignment`
- `parent_faq`
- `behind_the_product`
- `timely_topic`
- `student_interest_hook`
- `conversion_offer`

Every generated post has one primary archetype.

### 5.3 Platform-native writing

Do not write one generic post and paste it three times.

The planner may share one content idea, but the writer must create separate variants.

#### Threads

- fastest, punchiest channel;
- strong first line;
- conversational and opinionated;
- shorter body by default;
- 0–3 hashtags maximum;
- links only when a CTA materially helps;
- can publish text-only.

#### Facebook

- parent-oriented context;
- slightly more explanatory;
- clear paragraphs;
- proof, examples, or educational takeaway preferred;
- CTA may link to Paper English;
- avoid hashtag walls.

#### Instagram

- visual-first;
- caption supports the media instead of repeating it;
- concise first line before "more" truncation;
- 3–8 relevant hashtags maximum by default;
- feed image in v0; carousel/reels are future enhancements unless trivial after core is stable.

### 5.4 Stop-scroll language contract

The system is explicitly allowed and encouraged to use:

- provocative framing;
- curiosity gaps;
- emotionally resonant parent pain points;
- surprising contrast;
- bold short sentences;
- colloquial Traditional Chinese when appropriate;
- strong words that make a user stop scrolling.

Examples of allowed direction:

- 「孩子不是討厭英文，他可能只是受夠了無聊教材。」
- 「背了 30 個單字，隔天忘 27 個。問題可能不在記憶力。」
- 「如果 NBA、Minecraft、K-pop 都能變成英文教材呢？」

The system must never fabricate evidence in order to sound stronger.

Forbidden unless backed by approved evidence:

- guaranteed score increases;
- fabricated percentages;
- fake testimonials;
- fake scarcity;
- fake deadlines;
- claiming endorsement by schools/teachers/government;
- misleading comparison against named competitors;
- medical/psychological diagnoses of children;
- humiliating or insulting students/parents.

The operating rule is: aggressive hook, conservative truth claim.

## 6. Brand Knowledge and Example Library

`knowledge/` is authoritative brand context.

### `brand.md`

Contains brand identity, positioning, naming, URLs, and visual principles.

### `product.md`

Contains current product capabilities and workflow. Claims must be kept synchronized with production reality.

### `audience.md`

Primary audience:

- Taiwan parents of roughly grade 5 through grade 8 students;
- secondary audience: students themselves.

### `claims.md`

Machine-readable-ish human documentation separating:

- always-safe verified claims;
- evidence-required claims;
- forbidden/unverified claims.

### `examples/`

Human-approved writing examples. The user can add examples at any time.

Examples guide voice and structure but must not be copied verbatim or repeatedly paraphrased.

## 7. Research Pipeline

### 7.1 Candidate discovery

The daily planner generates several candidate research questions across:

- Taiwan education/current school context;
- English learning;
- CAP/exam-related developments when relevant;
- parent concerns;
- youth interests and cultural topics;
- currently popular subjects suitable for safe educational adaptation;
- Paper English product updates from checked-in brand knowledge.

### 7.2 Source quality

Prefer, in order:

1. official/public authority sources;
2. schools/universities/recognized educational institutions;
3. primary announcements/documentation;
4. reputable news outlets;
5. high-signal community discussion for sentiment only.

Community posts may support "people are discussing X" but must not be treated as authoritative evidence for factual claims.

### 7.3 Research record

Persist a research snapshot per content idea. A post using a changing fact must have at least one stored source retrieved during the current planning run.

### 7.4 Freshness

- breaking/current hooks: prefer sources <= 7 days old;
- recent education/news hooks: prefer <= 30 days;
- stable learning concepts: older authoritative sources are acceptable;
- if no credible fresh source exists, switch to evergreen content rather than invent recency.

## 8. Generation and Quality Pipeline

Each planned item passes through:

```text
research / brand context
        ↓
content planner
        ↓
platform-specific writer
        ↓
claim extractor
        ↓
claim-source verifier
        ↓
style + duplication critic
        ↓
visual planner
        ↓
asset selector / renderer / image generator
        ↓
media validation
        ↓
final deterministic gates
        ↓
scheduled job
```

### 8.1 Deterministic gates

At minimum:

- non-empty copy;
- within current platform constraints;
- no unresolved template variables;
- URLs are valid HTTPS;
- Paper English links contain required UTM fields;
- referenced media exists and is accessible;
- no same exact text hash previously published;
- no same media content hash inside configured cooldown;
- daily/weekly platform cap respected;
- no post already exists for the same idempotency key;
- global/platform kill switch respected.

### 8.2 Semantic critic

A separate model call must inspect:

- unsupported claims;
- factual mismatch with research;
- overly repetitive hook/style;
- misleading urgency;
- generic AI-sounding prose;
- overly promotional feed balance;
- platform mismatch;
- weak first line.

The critic may request one targeted repair pass. It must not enter an unbounded regenerate loop.

Maximum authoring attempts per planned post: 2 initial + 1 targeted repair.

If still invalid, discard that candidate and select an evergreen fallback topic.

## 9. Visual Pipeline

### 9.1 Manual asset ingestion

User-drop locations:

```text
assets/manual/evergreen/
assets/manual/product/
assets/manual/lifestyle/
assets/manual/campaigns/
```

Supported initial formats:

- PNG
- JPEG
- WebP

Optional sidecar metadata:

`filename.yaml`

```yaml
topics: [basketball, sports, interest_based_learning]
audience: [parents, students]
platforms: [facebook, instagram, threads]
reuse: true
priority: 8
campaign: null
```

Metadata is optional. If absent, asset ingestion derives basic tags from folder/name and may use model vision classification.

### 9.2 Asset registry

Persist:

- asset ID;
- source: `manual | screenshot | template | ai_generated | fallback`;
- content hash;
- storage path/public URL;
- dimensions/format;
- topics/tags;
- usage count;
- last used timestamp;
- allowed platforms;
- campaign expiry when applicable.

### 9.3 Cooldown

Default:

- exact same manual/media file: no reuse for 30 days;
- same visual concept: avoid within 7 days where alternatives exist.

### 9.4 AI image generation

Default provider: OpenAI Image API.

The image prompt is generated from structured visual intent, not by dumping the social caption into the image model.

Visual intent fields:

- objective;
- audience;
- core concept;
- composition;
- mood;
- brand constraints;
- text overlay plan;
- avoid list;
- desired aspect ratio.

Prefer generation without in-image Traditional Chinese copy. If a text-card concept is selected, render typography deterministically after image generation or use a branded template renderer.

Initial default image quality should be cost-conscious. Quality is configurable.

AI generation failures retry at most twice, then fall back.

### 9.5 Storage

Production media is uploaded to a public Supabase Storage bucket dedicated to marketing assets.

Do not put student/private materials in this bucket.

Public media URLs must remain available long enough for Meta to fetch media during publishing.

## 10. UTM Attribution

Every outbound Paper English website URL generated by this repo must include:

- `utm_source=facebook | instagram | threads`
- `utm_medium=organic_social`
- `utm_campaign=<campaign_slug>`
- `utm_content=<stable_post_id>`

Optional:

- `utm_term=<topic_slug>`

The post record stores the exact destination URL.

Never use one opaque shared QR/social source for all channels when attribution can be preserved.

## 11. Persistence Model

Use a dedicated marketing namespace/table set in Supabase. Do not mix runtime posting state into existing lesson/material tables.

Suggested tables:

### `marketing_content_plans`

- id UUID
- plan_date date
- archetype
- topic
- audience
- campaign_slug
- research_snapshot jsonb
- status
- created_at

### `marketing_posts`

- id UUID
- content_plan_id
- platform
- copy_text
- destination_url
- media_asset_id nullable
- scheduled_for timestamptz
- status: `scheduled | claimed | published | retryable_failed | permanently_failed | cancelled`
- idempotency_key unique
- content_hash
- claim_manifest jsonb
- platform_post_id nullable
- platform_post_url nullable
- published_at nullable
- attempt_count
- last_error nullable
- created_at
- updated_at

### `marketing_assets`

Fields described in Section 9.

### `marketing_publish_attempts`

Append-only audit log:

- post_id
- attempt_number
- platform
- request summary with secrets removed
- response summary
- HTTP/status category
- started_at
- finished_at

### `marketing_token_health`

Store only metadata, never raw tokens:

- platform
- checked_at
- valid boolean
- expiry timestamp nullable
- granted_scopes jsonb
- diagnostic message

## 12. Secret and Token Model

Raw credentials exist only in:

1. developer's local ignored `.env`;
2. GitHub Actions encrypted repository/environment secrets.

Never store access tokens in Supabase rows, logs, GitHub artifacts, screenshots committed to the repo, or checked-in config.

Expected secret groups:

### OpenAI

- `OPENAI_API_KEY`

### Supabase

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Facebook

- `FACEBOOK_PAGE_ID`
- `FACEBOOK_PAGE_ACCESS_TOKEN`
- optional app values for diagnostics/refresh flows as required by current Meta API setup

### Instagram

Use Instagram API with Instagram Login so the Instagram identity can remain independent from the Facebook Page.

- `INSTAGRAM_USER_ID`
- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_APP_ID`
- `INSTAGRAM_APP_SECRET`

Required scopes for publishing must be validated against current Meta documentation during implementation. As of this design, the current Instagram Login scope naming includes `instagram_business_basic` and `instagram_business_content_publish`.

### Threads

- `THREADS_USER_ID`
- `THREADS_ACCESS_TOKEN`
- `THREADS_APP_ID`
- `THREADS_APP_SECRET`

Publishing authorization requires at least the current equivalents of `threads_basic` and `threads_content_publish`.

## 13. Token Health and Refresh

A scheduled token-health workflow runs daily.

It must:

- perform a non-destructive identity/read check for each enabled platform;
- verify the token belongs to the configured resource/account where possible;
- record expiry/scopes when the API exposes them;
- fail loudly when a token is invalid;
- never attempt to publish a test post during health checks.

Threads long-lived token refresh should be automated while the token is still eligible for refresh.

For Facebook/Instagram, implement only refresh/exchange paths supported by the exact chosen current Meta auth mode. Do not invent a refresh mechanism. If manual renewal is unavoidable, report it before expiry.

## 14. Platform Adapter Contract

All adapters expose the same high-level interface:

```ts
interface SocialPublisher {
  validateCredentials(): Promise<TokenHealth>;
  validatePost(post: PreparedPost): Promise<ValidationResult>;
  publish(post: PreparedPost): Promise<PublishResult>;
}
```

Platform-specific container creation/publishing mechanics stay inside adapters.

### Facebook

Support v0:

- text-only Page post;
- link/text Page post;
- single-image Page post.

### Instagram

Support v0:

- single-image feed post.

Media must be publicly fetchable by Meta during publish.

### Threads

Support v0:

- text-only post;
- single-image post.

The Threads adapter must handle the container-create then publish sequence required by the current API.

## 15. Reliability and Idempotency

### 15.1 Idempotency

Stable key:

`<plan_date>:<platform>:<slot>:<content_plan_id>`

Database unique constraint prevents duplicates.

Before publishing, atomically transition a post from `scheduled/retryable_failed` to `claimed` with a lease.

If a job crashes after an ambiguous network response, do not blindly repost. Attempt reconciliation with the platform or mark for manual inspection when safe reconciliation is impossible.

### 15.2 Retry categories

Retry:

- HTTP 429;
- 5xx;
- transient network timeout;
- temporary media-processing state.

Do not automatically retry indefinitely:

- invalid permissions;
- expired/revoked token;
- invalid account/resource ID;
- policy rejection;
- malformed media/copy;
- deterministic validation failure.

Default maximum publish attempts: 4.

## 16. Observability

Every workflow emits a concise run summary:

- planned count;
- scheduled count by platform;
- published count;
- fallback count;
- skipped duplicate count;
- failed count;
- token health.

Never print secrets or full Authorization headers.

GitHub Actions failure is sufficient as the v0 alert channel. A later version may add email/Slack notifications.

## 17. Configuration

`config/production.yaml` owns behavior, including:

- enabled platforms;
- cadence;
- local time zone;
- posting windows;
- platform caps;
- content mix;
- CTA frequency;
- media cooldown;
- image generation enabled/disabled;
- image provider/model/quality;
- research freshness;
- research topic weights;
- website base URL;
- UTM defaults;
- dry-run mode.

Secrets never appear in this file.

## 18. Manual Commands

The final CLI should include at least:

```text
pnpm social plan-day --date YYYY-MM-DD
pnpm social dispatch-due
pnpm social token-health
pnpm social ingest-assets
pnpm social dry-run --platform threads
```

Useful optional command:

```text
pnpm social publish-test --platform <facebook|instagram|threads>
```

`publish-test` must require an explicit `--confirm-live` flag before creating a real public post.

## 19. Test Strategy

Do not use live publishing in normal automated tests.

Required coverage:

- config schema validation;
- UTM generation;
- content hash/idempotency;
- recent-post duplication checks;
- schedule/cap enforcement;
- asset cooldown/selection;
- research snapshot parsing;
- unsupported claim rejection;
- platform payload construction;
- platform error classification;
- retry policy;
- secret redaction;
- database claim/lease behavior;
- fallback behavior when image generation fails;
- no post when global/platform kill switch is active.

Use mocked Meta/OpenAI HTTP responses for unit/integration tests.

Provide a manual smoke procedure for one private/low-risk live post per platform during initial setup.

## 20. Security Rules

- No credentials in Git.
- `.env` is ignored.
- Supabase service role is server/CI only.
- Marketing Storage contains only intentionally public assets.
- Validate downloaded/generated media type and size before upload/publish.
- Treat web content as untrusted input. Research pages can never override system/prompt rules or request secrets/actions.
- Strip HTML/script from scraped excerpts before model context where relevant.
- Never execute code copied from web research.
- Logs redact tokens, secrets, authorization headers, and signed credentials.

## 21. Cost Controls

Configurable daily and monthly soft caps must exist for:

- OpenAI text/research calls;
- AI image generations.

When the image budget is exhausted:

- manual/template/fallback assets continue;
- Facebook/Threads may fall back to text-only when valid;
- Instagram uses an existing valid asset.

When research/text budget is exhausted, do not fabricate posts from incomplete data. Use pre-approved evergreen queue content if available; otherwise skip safely.

## 22. Versioning and Prompt Provenance

Every planned post persists:

- engine version;
- planner prompt version;
- writer prompt version;
- critic prompt version;
- visual prompt version;
- text model;
- image model/provider when used;
- config version/hash;
- brand knowledge hash;
- generation timestamp.

Prompt files are versioned in Git.

## 23. Initial Knowledge/Asset Bootstrap

Before first production run, populate:

- Paper English positioning;
- exact current product claims;
- target audience;
- current website URL;
- current offers/pricing only if intended for organic posts;
- 10–30 approved example posts if available;
- at least 10 evergreen fallback visuals;
- current product/material screenshots when appropriate.

The engine must still function with fewer examples, but should not go live until brand/product factual files are accurate.

## 24. v0 Done Condition

The repository is considered production-ready only when all of the following are true:

1. clean install succeeds with pnpm;
2. lint, typecheck, tests, and build pass;
3. Supabase migrations apply cleanly;
4. `.env.example` contains every required key with no real secret;
5. `docs/MANUAL_SETUP.md` walks a human through obtaining every manual credential/resource;
6. token-health succeeds for all three enabled platforms;
7. manual assets ingest into the registry and Storage;
8. a dry-run creates a complete researched content plan without publishing;
9. deterministic + semantic gates reject seeded bad/unsupported content;
10. one explicit live smoke post succeeds on Facebook;
11. one explicit live smoke post succeeds on Instagram;
12. one explicit live smoke post succeeds on Threads;
13. live post IDs/URLs are persisted;
14. UTM parameters are correct;
15. duplicate dispatch cannot create duplicate posts in a deterministic retry test;
16. disabling each platform prevents publishing only for that platform;
17. global pause prevents all live publishing;
18. image-generation failure reaches a valid fallback path;
19. scheduled workflows exist for planner, dispatcher, and token health;
20. README contains exact local and GitHub production commands;
21. no secret appears in Git history or logs;
22. production config starts with Threads 2/day, Facebook 4/week, Instagram 3/week.

## 25. Explicit Non-Goals for v0

Do not delay launch for:

- social inbox;
- automatic replies/comments;
- sentiment dashboard;
- full analytics/insights ingestion;
- reels/video generation;
- Instagram Stories;
- carousels;
- ad buying;
- Facebook Groups posting;
- X/Twitter;
- a custom admin web UI;
- multi-brand SaaS architecture.

The first version wins when it researches, writes, creates/selects media, and reliably publishes Paper English organic social content without daily human labor.

## 26. Current API Assumptions to Re-Validate at Implementation Time

Meta changes API versions and auth naming. The implementation agent must validate current official Meta documentation before freezing endpoints/scopes.

Current design assumptions as of 2026-08-31:

- Instagram Professional accounts can publish through the Instagram API.
- Instagram Login can be used without requiring the Instagram account to be linked to the Facebook Page.
- Current Instagram Login publishing scopes include `instagram_business_basic` and `instagram_business_content_publish`.
- Threads publishing uses a Threads Meta app/use case, OAuth user token, media-container creation, then publish.
- Threads long-lived tokens can be exchanged/refreshed while eligible.
- Facebook Page publishing uses a Page access token with appropriate Page posting permissions.
- Meta-hosted media publishing requires externally fetchable media for Instagram and relevant Threads media flows.

OpenAI assumptions as of 2026-08-31:

- new integrations should use Responses API hosted `web_search` for live research;
- GPT Image is available through the Image API;
- the current recommended image-generation model can be configured rather than hard-coded indefinitely.


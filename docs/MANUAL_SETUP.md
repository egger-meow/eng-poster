# Manual Setup Guide — Paper English Social Engine

This file is the human checklist for everything automation cannot safely create for you.

Do not paste real secrets into Git. Put them in a local ignored `.env` and in GitHub repository/environment secrets.

## 0. Accounts you need

Already expected:

- one Facebook Page for 紙屬英文;
- one Instagram Professional account for 紙屬英文;
- one usable Threads profile for 紙屬英文 branding;
- one OpenAI API account/project;
- one GitHub repository;
- access to the Paper English Supabase project (or a dedicated Supabase project if you intentionally choose one later).

The three Meta identities may be separate.

## 1. Create the repository

Suggested name:

`paper-english-social-engine`

Recommended visibility: private initially.

Do not add real `.env` values during repo creation.

## 2. OpenAI API

Official console:

https://platform.openai.com/

Create a project/API key dedicated to this social engine when practical.

Store:

```env
OPENAI_API_KEY=...
```

The engine uses:

- Responses API + hosted `web_search` for research;
- text generation/structured outputs for planning/writing/critique;
- Image API for AI-generated visuals.

As of 2026-08-31, OpenAI documents `gpt-image-2` as the latest GPT Image generation model. Keep the model configurable because models change.

OpenAI may require API Organization Verification for GPT Image model access. Complete it in the developer console if the API reports that requirement.

## 3. Meta Developer setup — important distinction

Access tokens are developer credentials. They are not normally "retrieved from Accounts Center".

Use Meta for Developers / the relevant Meta developer tooling:

https://developers.facebook.com/apps/

Meta developer documentation can change. When a permission name or auth screen differs from this guide, use the current official Meta/official Meta Postman collection as source of truth and update this repo's guide in the same PR.

Set `META_GRAPH_VERSION` to the version currently supported by the chosen Meta apps. The engine intentionally has no baked-in default because freezing a stale version is unsafe:

```env
META_GRAPH_VERSION=vXX.X
```

## 4. Facebook Page credentials

Create or reuse an appropriate Meta app that can manage the Facebook Page.

You need a Page access token authorized to publish on the target Page.

Expected minimum publishing permission family includes Page-management/posting permissions such as the current equivalent of:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`

Use the Graph API Explorer or current supported login flow to obtain a user token with the required scopes, then request the Page(s) you manage and retrieve the target Page access token.

Official Meta Postman currently demonstrates querying:

`GET /me/accounts?fields=name,access_token,tasks`

and using the selected Page's `id` + `access_token` as the Page ID/Page access token.

Record locally:

```env
FACEBOOK_PAGE_ID=...
FACEBOOK_PAGE_ACCESS_TOKEN=...
```

Before proceeding, manually verify with a non-destructive read call that the Page ID and token correspond to the correct Paper English Page.

Do not publish a live test until the repo's explicit smoke command exists.

## 5. Instagram credentials

### 5.1 Account requirement

The target Instagram account must be Professional (Business or Creator) for the publishing API.

### 5.2 Preferred auth architecture for this repo

Use **Instagram API with Instagram Login** unless implementation-time validation finds a concrete blocker.

Why:

- this project deliberately permits Instagram to be independent of the Facebook Page;
- Meta's current Instagram Login API does not require a Facebook Page link;
- it exposes publishing permissions directly for Instagram professional accounts.

Current scope names to request/verify:

```text
instagram_business_basic
instagram_business_content_publish
```

Add manage-comment/message scopes only if a future feature actually needs them. v0 does not.

Obtain the Instagram access token and user/account ID through the current Meta authorization flow.

Record:

```env
INSTAGRAM_USER_ID=...
INSTAGRAM_ACCESS_TOKEN=...
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
```

The implementation must include a credential-validation command before any live publish.

Instagram content publishing requires the media to be available from a public server while Meta fetches it, so the production media bucket must be reachable via HTTPS.

## 6. Threads credentials

Create a Meta app with the Threads use case (or add the current Threads use case to the chosen compatible app if supported by the current dashboard).

Request at least:

```text
threads_basic
threads_content_publish
```

Follow the current Threads OAuth authorization flow.

Current official Meta Postman flow is:

1. authorization code;
2. exchange code for a short-lived Threads user access token;
3. exchange for a long-lived token;
4. refresh the long-lived token while still eligible.

Current token exchange/refresh endpoints and parameters must be copied from current Meta docs/official Postman rather than retyped from memory during implementation.

Record:

```env
THREADS_USER_ID=...
THREADS_ACCESS_TOKEN=...
THREADS_APP_ID=...
THREADS_APP_SECRET=...
```

The long-lived Threads token currently reports an expiry duration in Meta's official examples. The repo must automate refresh while the token remains refreshable and run daily token health.

## 7. Supabase

Preferred v0: reuse the Paper English Supabase project but isolate all social-engine tables with the `marketing_` prefix and use a dedicated marketing media bucket.

Record:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

The service role key is CI/server only. Never expose it to a browser/client bundle.

Create via migration, not manual dashboard drift:

- marketing tables from the design spec;
- indexes/unique idempotency constraints;
- `marketing-media` public bucket or equivalent controlled through migration/setup code where feasible.

Only intentionally public marketing assets belong in this public bucket.

## 8. Website / UTM configuration

Set the canonical Paper English landing URL in non-secret production config.

Suggested environment/config values:

```env
PAPER_ENGLISH_BASE_URL=https://paperbond.jjmowlab.com
```

Every generated organic-social link must add:

```text
utm_source=<facebook|instagram|threads>
utm_medium=organic_social
utm_campaign=<campaign_slug>
utm_content=<post_id>
```

## 9. Local `.env`

Copy:

```bash
cp .env.example .env
```

Fill every required value.

Never commit `.env`.

Run credential health before a live smoke test:

```bash
pnpm social token-health
```

## 10. GitHub Actions secrets

GitHub repo → Settings → Secrets and variables → Actions.

Add the same production secrets used locally:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
META_GRAPH_VERSION
FACEBOOK_PAGE_ID
FACEBOOK_PAGE_ACCESS_TOKEN
INSTAGRAM_USER_ID
INSTAGRAM_ACCESS_TOKEN
INSTAGRAM_APP_ID
INSTAGRAM_APP_SECRET
THREADS_USER_ID
THREADS_ACCESS_TOKEN
THREADS_APP_ID
THREADS_APP_SECRET
```

If implementation introduces a genuinely required additional secret, add it to `.env.example` + this file in the same change. Never silently depend on an undocumented secret.

## 11. GitHub Actions permissions

Workflows should default to minimum permissions.

Normal planner/dispatcher jobs do not need write access to repository contents.

Do not solve runtime persistence by committing generated state back to the repo.

Use Supabase for durable state.

## 12. Manual image library

Whenever you create/find approved Paper English marketing images, drop them into one of:

```text
assets/manual/evergreen/
assets/manual/product/
assets/manual/lifestyle/
assets/manual/campaigns/
```

Then run:

```bash
pnpm social ingest-assets
```

or let the designated ingestion workflow process them after merge.

Optional metadata uses a same-name YAML sidecar.

Example:

```text
assets/manual/lifestyle/basketball-01.png
assets/manual/lifestyle/basketball-01.yaml
```

No YAML is required for casual drops.

## 13. Approved writing examples

Put human-approved examples in:

```text
knowledge/examples/facebook/
knowledge/examples/instagram/
knowledge/examples/threads/
```

Plain Markdown is preferred.

Examples are style references only. The model must not repeatedly clone wording.

## 14. Brand facts before going live

Review these files carefully:

```text
knowledge/brand.md
knowledge/product.md
knowledge/audience.md
knowledge/claims.md
knowledge/voice.md
```

This matters more than prompt cleverness. If product facts or price claims are stale, automation can scale the mistake very efficiently.

## 15. First-live procedure

Do not enable the recurring dispatcher immediately after adding secrets.

Order:

1. `pnpm install`
2. migrations
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm build`
7. `pnpm social token-health`
8. `pnpm social ingest-assets`
9. run full daily plan with `DRY_RUN=true`
10. inspect generated records/copy/media URLs
11. explicit one-post live smoke on Facebook
12. explicit one-post live smoke on Instagram
13. explicit one-post live smoke on Threads
14. verify DB platform IDs/URLs
15. delete smoke posts manually if desired
16. enable production schedules

Live smoke commands must require an explicit confirmation flag.

## 16. Emergency stop

Fastest stop:

Set GitHub Actions variable/secret-backed config so:

```env
PAUSE_ALL_POSTING=true
```

Then disable the dispatcher workflow if necessary.

Per-platform stop:

```env
FACEBOOK_ENABLED=false
INSTAGRAM_ENABLED=false
THREADS_ENABLED=false
```

The dispatcher must check these at execution time, not only when the post was originally planned.

## 17. Token failure response

If GitHub reports token-health failure:

1. leave the affected platform disabled;
2. use Meta token debugger/current developer dashboard to confirm validity and granted scopes;
3. renew/re-authorize only the affected platform;
4. update the GitHub secret;
5. run token-health;
6. re-enable that platform.

Do not regenerate the other platforms' tokens merely because one failed.

## 18. Sources to re-check during implementation

Meta:

- https://developers.facebook.com/
- https://www.postman.com/meta/facebook/overview
- https://www.postman.com/meta/instagram/overview
- https://www.postman.com/meta/threads/overview

OpenAI:

- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/image-generation

GitHub Actions:

- https://docs.github.com/actions

Supabase:

- https://supabase.com/docs

The implementation agent must prefer current official documentation over this file when an external API has changed, and must update this file to match the implementation.

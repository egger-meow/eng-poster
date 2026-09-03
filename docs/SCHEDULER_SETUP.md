# Paper English Social Engine — Queue-Aware Scheduler Setup Guide

This document explains how to operate the queue-aware content conveyor belt using ChatGPT Scheduled Tasks (or on-demand executor agents like Antigravity) as the autonomous research and planning brain, backed by deterministic queue-gap discovery and Buffer GraphQL publishing infrastructure.

---

## 1. Architectural Overview: The 14-Day Stockpile Conveyor Belt

```mermaid
flowchart TD
  subgraph Discovery ["Deterministic Queue Analysis & Evidence"]
    QG[pnpm social next-queue-gap] -->|Finds Earliest Gap| GapInfo["targetDate, missing slots,\nqueueDaysAhead (0-14d)"]
    WL[pnpm social winners-list] -->|Winner Evidence & Metrics| WinnerData["Manually Marked Winners\nviews, likes, comments, notes"]
  end

  subgraph Brain ["Content Brain (ChatGPT / Antigravity)"]
    GapInfo --> R{72h Freshness Gate}
    R -->|queueDaysAhead <= 3| T[Timely Topic or Evergreen]
    R -->|queueDaysAhead > 3| E[Strict Evergreen Archetypes]
    WinnerData --> WA[Mandatory Winner Analysis\nHook, Angle, Density, Signals]
    T --> W[Web Research & Knowledge Base]
    E --> W
    WA -->|winningSignals| P[Author Native Copy\nExploit 60-70% / Explore 30-40%]
    W --> P
    P --> JSON[EnqueuePlanInput JSON\nprovenance: winnerReferenceCount, explorationMode]
  end

  subgraph Engine ["Engine & Publishing Pipeline (GitHub Actions)"]
    JSON -->|CLI Ingestion| EP[pnpm social enqueue-plan]
    EP --> DB[(Supabase 14-Day Stockpile\nmarketing_content_plans\nmarketing_posts\nmarketing_post_feedback)]
    QH[Daily Queue Health\npnpm social queue-health --hours 336] --> DB
    Cron[30-min Dispatcher] -->|Lookahead Claim| DB
    Cron --> Buffer[Buffer GraphQL API\nFB / IG / Threads]
    Buffer --> Reconcile[Record Permalinks & Asset Usage]
    Reconcile --> DB
    DB -->|Published Posts| WD[Local Winner Dashboard\npnpm social winners :3333]
    WD -->|Operator marks winner + metrics| DB
  end
```

The repository contains **zero runtime LLM calls**. The AI brain handles planning and research; the repository provides deterministic queue discovery, database management, asset tracking, safety switches, and Buffer publishing infrastructure.

---

## 2. Queue Discovery: `pnpm social next-queue-gap`

To prevent AI hallucination of dates or mental-math scheduling errors, the engine provides a deterministic queue-gap calculator:

```bash
pnpm social next-queue-gap
```

Output:
```json
{
  "targetDate": "2026-09-05",
  "missing": [
    { "platform": "threads", "slot": 1 },
    { "platform": "threads", "slot": 2 },
    { "platform": "instagram", "slot": 1 }
  ],
  "queueDaysAhead": 3,
  "recommendedCopyLengthMode": "short"
}
```

### How `next-queue-gap` Works:
1. **Zone-Aware Iteration**: Checks calendar days from `today` (Day 0) up to 14 days out (`queueDaysAhead = 0..13`) in `Asia/Taipei`.
2. **Platform Constraints**: Evaluates platform weekly targets, preferred days, and daily caps:
   - **Threads**: 2 posts/day every day (slots 1 and 2).
   - **Facebook**: 4 posts/week (Tue, Thu, Sat, Sun; slot 1).
   - **Instagram**: 3 posts/week (Mon, Wed, Fri; slot 1).
3. **Day-0 Expiration Protection**: For `today`, slots whose publishing windows have already passed are considered expired, preventing scheduling posts into the past.
4. **Immediate Stop on Earliest Gap**: Returns the very first date that has any missing slots.
5. **Full Queue Notification**: When the entire 14-day horizon is fully booked, returns:
   ```json
   {
     "targetDate": null,
     "missing": [],
     "queueDaysAhead": 14,
     "message": "Queue fully stocked across 14-day horizon"
   }
   ```

Operators or automated scripts can run this command repeatedly. Each run fills one date, feeding the conveyor belt up to two weeks ahead.

---

## 3. Winner Feedback Loop & Local Dashboard

To transform the engine from a linear pipeline (`generate → publish`) into an evidence-driven learning system:

`generate → publish → operator marks winners → analyze why winners worked → author novel posts using winning signals`

The engine provides a local-only operator interface and CLI inspection tools:

### Local Winner Dashboard
```bash
pnpm social winners
```
- Binds strictly to `http://127.0.0.1:3333` (never exposed publicly).
- Allows the human operator to review published posts and mark winners with a single checkbox.
- Metrics (`views`, `likes`, `comments`, `shares`) and strategic notes are completely optional.

### Winner Inspection CLI
```bash
pnpm social winners-list
```
Outputs JSON list of all manually marked winners with observed metrics and full copy context.

### Authoring Rules:
1. **Behavioral Evidence, Not Templates**: The scheduler is strictly bound to *"Learn the reason, not the sentence."* Mechanical paraphrasing or cloning winner opening sentences is strictly forbidden.
2. **Exploit vs. Explore (~60–70% / ~30–40%)**: ~60–70% of new posts exploit identified `winningSignals`, while ~30–40% remain exploratory.
3. **Zero-Winner Fallback**: If zero winners exist in the database, authoring continues normally in exploratory mode (`winnerReferenceCount: 0`).

---

## 4. Core Policy: 72h Timely-Topic Freshness Rule

When writing content for `targetDate`:
- **`queueDaysAhead <= 3` (within 72 hours)**: Eligible for the `timely_topic` archetype (breaking Taiwan education news, 108 課綱 announcements, exam trends, seasonal parent discussions) or evergreen archetypes.
- **`queueDaysAhead > 3` (beyond 72 hours)**: **Strictly forbidden** to choose `timely_topic`. Must use evergreen archetypes (`pain_point`, `educational_value`, `product_proof`, `conversion_offer`) so that content scheduled up to 14 days in advance does not rot or become obsolete before publication.

---

## 5. Deterministic Ingestion via `enqueue-plan`

The safest, production-hardened pattern is:
1. **AI Brain generates the JSON plan**: Following [docs/CHATGPT_SCHEDULER_PROMPT.md](file:///c:/IDEA/eng-poster/docs/CHATGPT_SCHEDULER_PROMPT.md), the AI outputs a structured JSON payload conforming to `EnqueuePlanInput` for `targetDate`.
2. **Deterministic Validation Gate**: The engine's CLI (`pnpm social enqueue-plan`) sits in front of the database to enforce:
   - Platform character limits and mode bounds (Threads: short 5–100, long 150–350; FB: short 10–150, long 250–800; IG: short 30–180, long 180–400)
   - Asset mode validation (`text_only`, `image_post`, `link_preview`)
   - Copy length strategy (`copyLengthMode: 'short' | 'long'`) and quality gates (forbidding AI boilerplate intros/conclusions)
   - Mandatory source URLs on all factual/researched claims
   - Media selection with cooldowns (`visualConceptCooldownDays = 7`)
   - Platform weekly and daily caps
   - Deterministic slot timing and collision avoidance
   - UTM parameter generation and clean first-comment attribution
   - SHA-256 content hashing and idempotent deduplication
3. **Safe Queue Insertion**: Offer validation occurs before plan writes and again before sensitive post writes. Other validation is per post; a later failure can leave earlier valid posts enqueued.

### CLI Usage:
```bash
pnpm social enqueue-plan --input payload.json
```

Or inline:
```bash
pnpm social enqueue-plan --input '{"planDate":"2026-09-05","archetype":"pain_point","topic":"背單字挫折","posts":[{"platform":"threads","copyLengthMode":"short","assetMode":"text_only","copyText":"孩子背了就忘...","claimManifest":[]}]}'
```

---

## 6. ChatGPT Scheduled Task Setup

1. Open **ChatGPT** (with custom GPT or ChatGPT Scheduled Tasks enabled).
2. Create a new Scheduled Task named `Paper English Social Conveyor Planner`.
3. Set schedule recurrence: **Every day at 06:00 AM (Asia/Taipei)** (or trigger on-demand).
4. Attach or provide access to the repository's `knowledge/` directory:
   - Core guides: `audience.md`, `brand.md`, `claims.md`, `product.md`, `voice.md`.
   - All example files: `knowledge/examples/**` (`knowledge/examples/*.md`, used together as reference benchmarks across all platforms).
5. Copy the entire contents of [docs/CHATGPT_SCHEDULER_PROMPT.md](file:///c:/IDEA/eng-poster/docs/CHATGPT_SCHEDULER_PROMPT.md) into the task instructions.
6. Execution: The task reads repository state and knowledge, runs `next-queue-gap` then mandatory `offer-state`, inspects the queue, loads winners via `winners-list`, targets the missing slots, and outputs the validated plan JSON.

---

## 7. Supabase Table Specifications

### Table: `public.marketing_post_feedback`
| Column | Type | Description |
|---|---|---|
| `post_id` | `uuid` | Primary key referencing `marketing_posts(id) on delete cascade` |
| `is_winner` | `boolean` | Operator manual winner flag |
| `observed_views` | `bigint` | Optional observed views count (check >= 0) |
| `observed_likes` | `bigint` | Optional observed likes count (check >= 0) |
| `observed_comments` | `bigint` | Optional observed comments count (check >= 0) |
| `observed_shares` | `bigint` | Optional observed shares count (check >= 0) |
| `operator_note` | `text` | Operator qualitative notes on why the post performed well |
| `marked_at` | `timestamptz` | Timestamp when first marked as winner |
| `updated_at` | `timestamptz` | Timestamp of latest feedback edit |


### Table: `public.marketing_content_plans`
| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key (`gen_random_uuid()`) |
| `plan_date` | `date` | Target execution date (e.g. `2026-09-05`) |
| `archetype` | `text` | One of `pain_point`, `educational_value`, `product_proof`, `timely_topic`, `conversion_offer` |
| `topic` | `text` | Editorial topic title |
| `audience` | `text` | Target audience (e.g. `Taiwan parents grade 5-8`) |
| `campaign_slug` | `text` | Campaign slug (e.g. `always-on`) |
| `research_snapshot` | `jsonb` | `{ "query": "...", "sources": [...], "factualNotes": [...] }` |
| `provenance` | `jsonb` | Metadata including source, prompt version, `queueDaysAhead`, timestamp |

### Table: `public.marketing_posts`
| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key (`gen_random_uuid()`) |
| `content_plan_id` | `uuid` | Foreign key referencing `marketing_content_plans(id)` |
| `platform` | `text` | `'facebook' \| 'instagram' \| 'threads'` |
| `asset_mode` | `text` | `'text_only' \| 'image_post' \| 'link_preview'` |
| `copy_length_mode` | `text` | `'short' \| 'long'` |
| `copy_text` | `text` | Authored post text |
| `destination_url` | `text` | Attributed canonical Paper English UTM URL (mandatory for Facebook & Threads) |
| `media_asset_id` | `uuid` | Foreign key referencing `marketing_assets(id)` (optional) |
| `scheduled_for` | `timestamptz`| Scheduled publish timestamp (ISO8601 with timezone) |
| `status` | `text` | Lifecycle: `'scheduled'` &rarr; `'claimed'` &rarr; `'provider_scheduled'` &rarr; `'published'` |
| `provider_scheduled_at` | `timestamptz` | Timestamp when Buffer accepted the future schedule |
| `provider_status` | `text` | Status reported by Buffer (`'scheduled'`, `'sent'`, `'failed'`) |
| `idempotency_key` | `text` | `${plan_date}:${platform}:${slot_number}` (unique constraint) |
| `content_hash` | `text` | `sha256(copy_text)` |
| `claim_manifest` | `jsonb` | Array of `{ "text": "...", "kind": "...", "sourceUrls": [...] }` |

### Mandatory Main-Body Link Invariant & Asset Strategy:
**EVERY FACEBOOK AND THREADS POST MUST LEAD BACK TO PAPER ENGLISH IN THE MAIN BODY.**
Canonical base: `https://paperbond.jjmowlab.com`

- **Facebook**:
  - `text_only`: Pure text + canonical destination URL visibly in main body. No attached media.
  - `link_preview`: Text + canonical destination URL in main body. No attached media.
  - `image_post`: Media attached. Canonical destination URL is visibly in the main post body. Optional secondary first comment (`firstComment`) may provide additional context.
- **Threads**:
  - `text_only`: Pure copy + canonical destination URL visibly in main body. No attached media.
  - `link_preview`: Text + canonical destination URL in main body. No attached media.
  - `image_post`: Media attached. Canonical destination URL is visibly in the main post body. Optional secondary self-reply thread may provide additional context.
- **Instagram**: Strictly `image_post` only.
  - Media asset is mandatory. Caption has no clickable URL. When `destination_url` exists, it is sent to Buffer as the first comment (`metadata.instagram.firstComment`).

---

## 7. 336h Queue Health Monitoring

To verify the full 14-day stockpile horizon (336 hours) without authoring anything:

```bash
pnpm social queue-health --hours 336
```

The GitHub Actions workflow [.github/workflows/queue-health.yml](file:///c:/IDEA/eng-poster/.github/workflows/queue-health.yml) automatically runs daily to report on 336 hours of upcoming posts.

## Dynamic offer state

**FREE PILOT IS A DYNAMIC OFFER, NOT A PERMANENT PRODUCT FACT.** Current truth must always come from `pnpm social offer-state` before authoring. Public canonical wording: 「100 位學員以前，每週專屬教材免費。」 See [OFFER_CONTRACT.md](OFFER_CONTRACT.md) for the authoritative phase model, claim rules, Buffer cancellation capability and residual timing risk.

```bash
pnpm social offer-state
pnpm social offer-sensitive-queue
```

`offerPhase` is `free_pilot | standard_paid`. Persist live plan provenance and per-post `offerGate: null | free_pilot_active`; enqueue and dispatch revalidate, and provider reconciliation checks future offer posts for official deletion when invalid. The inspection command is read-only and does not rewrite existing posts. Historical winner offers do not authorize current claims.

Apply `supabase/migrations/20260903064118_marketing_offer_gate.sql` before using the new durable gate/cancellation path. Update any saved external scheduler prompt. No new secret is required; existing Supabase settings must target production `ykzszjrqynrhgdhoeovo`.

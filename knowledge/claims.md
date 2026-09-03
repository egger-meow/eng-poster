# Claims contract

Safe stable positioning: interest-first English materials, curriculum alignment, real examples, and the canonical website URL. Score/retention improvements, testimonials, endorsements and other factual claims require verified source URLs in `claimManifest`. Opinions and rhetorical hooks cannot disguise unsupported promises.

## Dynamic offer claims

**Current offer truth must always come from `pnpm social offer-state`.** Checked-in text, website wording, old winner posts, and supplied provenance are not current pricing/offer/capacity authority. Do not rely on stale text alone.

While live state confirms `free_pilot`, open enrollment and known positive capacity, use professional consumer language:

- Canonical: 「100 位學員以前，每週專屬教材免費。」 (only with confirmed limit 100)
- 「目前免費開放中」
- 「現在加入，每週專屬教材免費」
- 「目前免費使用，免信用卡」
- 「100 位學員以前免費使用」
- 「名額開放期間免費」

Every offer-dependent post must explicitly carry `offerGate: "free_pilot_active"`. This includes body, first comment/reply, and any visible image text; authors must review visuals because the engine does not OCR images. Obvious text synonyms are detected deterministically; word detection cannot cover every creative paraphrase. Evergreen posts use `offerGate: null`.

Public-facing forbidden terminology: 「公測」、「全面公測」、「免費公測」、`beta`, `pilot`, 「測試階段」、「測試版」. These are forbidden even when technically true. Internal code, schema, provenance, tests and CLI diagnostics may use `free_pilot`, `freePilotActive`, `Free Pilot`.

Lifetime/permanent free entitlement is false and always forbidden: no 「前 100 名永久免費」, 「搶到就終身免費」 or permanently reserved free seats. The phase ends for everyone at the historical threshold; admission does not create permanent entitlement.

Never queue exact remaining-count scarcity, even from a fresh snapshot: it will age during the 14-day stockpile. No invented deadlines, countdowns or urgency. Stable threshold wording is preferred. No false guarantees, fabricated testimonials, diagnoses or competitor disparagement.

Enqueue rechecks production and rejects stale/ungated claims; dispatch revalidates and cancels invalid copy without rewriting it. Inactive or unavailable state never authorizes free claims. [Runtime contract](../docs/OFFER_CONTRACT.md).

Expired offer facts are NEVER transferable winning signals. Psychological mechanisms (low friction, direct challenge, value contrast, zero-risk CTA) may transfer; expired free/no-credit-card/threshold claims may not.

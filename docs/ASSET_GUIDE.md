# Manual Asset Guide

You can continuously feed the engine images without touching code.

## Where to put images

```text
assets/manual/evergreen/
assets/manual/product/
assets/manual/lifestyle/
assets/manual/campaigns/
```

### evergreen

Reusable brand-safe visuals with no short expiration.

### product

Real Paper English website/material/product screenshots.

### lifestyle

General education, interest, sports, reading, study, culture visuals approved for brand use.

### campaigns

Images tied to a temporary offer/event. Add expiry metadata when practical.

## File naming

Prefer descriptive names:

```text
basketball-interest-reading-01.png
parent-material-preview-02.webp
cap-reading-example-01.jpg
```

Avoid:

```text
IMG_8271.png
newnewfinal2.png
```

but ingestion must still accept them.

## Optional YAML metadata

Same basename:

```text
basketball-interest-reading-01.png
basketball-interest-reading-01.yaml
```

Example:

```yaml
topics:
  - basketball
  - sports
  - interest_based_learning
audience:
  - parents
  - students
platforms:
  - facebook
  - instagram
  - threads
reuse: true
priority: 8
campaign: null
expires_at: null
```

## Rules

- Do not commit huge batches of raw/generated images forever if the repo becomes bloated. The implementation may move originals to Storage and keep only curated/source assets in Git.
- Never put private student photos/material containing personal data in public marketing assets.
- Do not use copyrighted third-party logos/characters/artwork unless usage rights are clear.
- AI-generated images should avoid fake UI/screenshots presented as real product proof.
- Real Paper English product screenshots must be labeled/treated as real, not AI-generated.

## Selection priority

1. manual high-fit asset;
2. real product screenshot;
3. brand template;
4. AI generation;
5. evergreen fallback.

## Cooldown

Default exact-media cooldown: 30 days.

The registry tracks hashes, use count, and last-used timestamp so renaming a file does not defeat cooldown.

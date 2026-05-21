# Circuit

A low-cost AI lead sourcing and opportunity intelligence system for a small AI development /
automation agency.

- **Phase 1** built the explainable scoring foundation on mocked data.
- **Phase 2** adds the first real automatic source connector (Google Maps / Google Places),
  per-source run tracking, and dashboard review actions.

## Setup

```bash
npm install
cp .env.example .env   # then fill in GOOGLE_PLACES_API_KEY if you want live data
```

Requires Node 18+. `better-sqlite3` ships a native binding and may need build tools on first
install (`xcode-select --install` on macOS).

## Quick start

```bash
# 1. Reset + seed from the mock connector (Phase 1 fixtures).
npm run seed

# 2. Re-run the pipeline against the mock source and export JSON/CSV.
npm run pipeline

# 3. Run the Google Maps source (live API call if key is set; falls back to mock otherwise).
npm run pipeline:google-maps

# 4. Per-lead score breakdowns.
npm run debug:score
npm run debug:score -- "Lumen & Co Marketing"

# 5. All tests.
npm test

# 6. Internal monitoring dashboard.
npm run dev   # → http://localhost:3000
```

## What's implemented

### Phase 1 — foundation (`tests/scoring.test.ts`, 13 cases)

| Area | File(s) | Notes |
|---|---|---|
| Types | `src/types/index.ts` | Zod schemas for every persisted entity |
| Database | `src/db/{schema,client,repository}.ts` | Local SQLite at `./data/circuit.db`, auto-created |
| Mock source | `src/sources/mockSourceConnector.ts` | 10 realistic fixtures covering ICP + edge cases |
| Rule filter | `src/filters/ruleBasedFilter.ts` | Explainable, weighted, reasons + rejection reasons |
| Dedupe | `src/filters/dedupe.ts` | Domain → normalised name |
| Intent scoring | `src/scoring/intentScoring.ts` | 6 weighted components + trust-barrier penalty |
| Pipeline | `src/pipeline/runLeadSourcingPipeline.ts` | fetch → validate → dedupe → persist → score → enqueue |
| Review export | `src/review/{reviewQueue,exportReviewQueue}.ts` | `data/outputs/review-queue.{json,csv}` |
| Debug tools | `src/debug/*`, `scripts/debugScore.ts` | Explainable per-lead breakdown |
| Dashboard | `app/page.tsx` | Minimal operator view |

### Phase 2 — Google Maps source (`tests/googleMapsSource.test.ts`, 9 cases)

| Area | File(s) | Notes |
|---|---|---|
| Provider abstraction | `src/sources/providers/types.ts` | Lets us swap providers without touching connector logic |
| Google Places (live) | `src/sources/providers/googlePlacesProvider.ts` | Places API (New) Text Search with strict `FieldMask` |
| Mock provider | `src/sources/providers/mockPlacesProvider.ts` | Deterministic fixtures for tests / no-key local dev |
| Google Maps source | `src/sources/googleMapsSource.ts` | Quota-controlled `category × location` sweep |
| Source runs | `src/db/schema.ts`, `src/db/repository.ts` | New `source_runs` table + repository helpers |
| Pipeline | `src/pipeline/runLeadSourcingPipeline.ts` | One `source_runs` row per source per run |
| CLI | `scripts/runGoogleMaps.ts`, `npm run pipeline:google-maps` | One-shot runner with config + summary print |
| Dashboard — source runs | `app/page.tsx` | Recent runs with status / found / accepted / errors / API calls |
| Dashboard — review actions | `app/_components/ReviewActions.tsx`, `app/api/review/route.ts` | Accept / Reject / Contacted / Re-queue buttons |

## Configuring the Google Maps source

1. Enable **Places API (New)** in your Google Cloud project.
2. Create an API key restricted to `places.googleapis.com`.
3. Add it to `.env`:

   ```ini
   GOOGLE_PLACES_API_KEY=your-key-here
   GOOGLE_MAPS_MAX_SEARCHES_PER_RUN=20
   GOOGLE_MAPS_MAX_RESULTS_PER_SEARCH=20
   GOOGLE_MAPS_MAX_LEADS_PER_RUN=200
   GOOGLE_MAPS_REQUEST_TIMEOUT_MS=15000
   GOOGLE_MAPS_FORCE_MOCK=0
   ```

4. Run:

   ```bash
   npm run pipeline:google-maps
   ```

If the key is missing the connector **does not crash** — it falls back to the in-memory mock
provider and records that as a note on the source run, so you can verify the pipeline wiring
without spending any quota.

### Cost controls

- **One Places Text Search request per (category, location) pair.** No follow-up Place Details
  fetches — every field we need is requested via the field mask in one request, keeping the
  call on the cheaper SKU.
- `GOOGLE_MAPS_MAX_SEARCHES_PER_RUN` caps the number of requests in a single run.
- `GOOGLE_MAPS_MAX_RESULTS_PER_SEARCH` caps the per-request result count (Google's hard max
  is 20 for Text Search).
- `GOOGLE_MAPS_MAX_LEADS_PER_RUN` halts the run early once enough leads are collected.
- **In-run dedupe by `place_id` then by domain** — the connector skips duplicate calls before
  ever touching the rule filter or score persistence.
- **Website filter** — places without a website are dropped before deeper processing.
- **Failed queries are isolated** — a 429/500 on one search records an error on the source
  run but lets the rest of the sweep continue.

### Default targets

- **Categories:** recruitment agency, marketing agency, real estate agency, accounting firm,
  bookkeeping firm, legal firm, business consultant, ecommerce agency, web design agency.
- **Locations:** London, Manchester, Birmingham, Leeds, Bristol, Liverpool, Glasgow,
  Edinburgh, Cardiff, Newcastle.

Override per-run by passing `{ categories, locations }` to `googleMapsSource.fetchLeads`.

## Data model

```
companies ──< contacts
          ├──< signals
          ├──< lead_scores
          └──── review_queue (1-to-1)

source_runs (independent — one row per source per pipeline run)
```

## Scoring overview

1. **Rule filter** — base 50, weighted positive/negative deltas for ICP signals.
   Outputs `ruleScore`, `pass`, `reasons[]`, `rejectionReasons[]`.
2. **Intent scoring** — 6 components (urgency, manual workload, decision-maker access,
   budget, automation fit, implementation simplicity) minus a `trustBarrierRisk` penalty.
3. **Combine** — `finalScore = 0.55 * rule + 0.45 * intent`, mapped to A (≥85) / B (≥70) /
   C (≥60) / Reject (<60).

Everything is tunable in `src/scoring/scoringConfig.ts`.

## What is intentionally NOT built yet

- Outreach (email / LinkedIn / DMs), email sending, inbox management.
- LLM enrichment / AI scoring of leads.
- LinkedIn scraping.
- Other live source connectors (job boards, Product Hunt) — placeholders return empty results
  with a note.
- Paid enrichment (Apollo, Clay, Clearbit).
- Multi-tenant or authenticated dashboard — intended for `localhost`.
- Background scheduler / cron — runs are operator-triggered.

## Suggested Part 3 prompt

> Phase 3 — additional sources + verified website signals.
>
> 1. Add `jobBoardSource` (Workable public feeds or similar) using ops/automation keywords
>    as the query layer.
> 2. Add a lightweight website-presence check (status code + simple tech fingerprint) so the
>    rule filter can verify `HAS_WEBSITE` instead of assuming it.
> 3. Persist per-source `review_decisions` (accept / reject) to a new table; surface
>    suggested scoring-weight tweaks on the dashboard (display only, no auto-apply).
> 4. Add a `scheduler` module that runs the pipeline nightly, appends new leads, and emits a
>    daily diff to `data/outputs/daily-diff.json`. No email sending.
>
> Keep all hard cost ceilings explicit and configurable. Still no outreach.

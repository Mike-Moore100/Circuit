# Circuit

A low-cost AI lead sourcing and opportunity intelligence system for a small AI development /
automation agency.

- **Phase 1** — explainable scoring foundation on mocked data.
- **Phase 2** — Google Maps / Places source, per-source run tracking, review actions.
- **Phase 3** — Verified website signals: lightweight site inspection between dedupe and
  scoring, with explainable score deltas and dashboard visibility.
- **Phase 5** — Selective AI opportunity analysis: cache-first, budget-capped, evidence-
  grounded operational analysis on top-priority leads only.

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

# 4. Inspect (or re-inspect) every known company's website. Respects the cache.
npm run inspect:websites
npm run inspect:websites -- --force         # ignore the cache
npm run inspect:websites -- --limit 25      # only the first N

# 5. Per-lead score breakdowns.
npm run debug:score
npm run debug:score -- "Lumen & Co Marketing"

# 6. Per-lead signal breakdown (raw source + verified inspection).
npm run debug:signals -- "Lumen & Co Marketing"

# 7. Selective AI enrichment on top-priority leads. Mock provider used if no API key.
npm run analyze:top-leads
npm run analyze:top-leads -- --limit 3 --force

# 8. Per-company AI breakdown.
npm run debug:ai -- "Lumen & Co Marketing"

# 9. All tests.
npm test

# 10. Internal monitoring dashboard.
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

### Phase 5 — Selective AI opportunity analysis (`tests/aiPrompt.test.ts` + `tests/aiAnalysis.test.ts`, 27 cases)

| Area | File(s) | Notes |
|---|---|---|
| Types | `src/ai/aiTypes.ts` | Zod schema for `AiAnalysisResult` + prompt input shape, prompt version constant |
| Prompt | `src/ai/buildAnalysisPrompt.ts` | Long, stable, anti-hype system prompt (marked cacheable); compact structured user prompt under `AI_ANALYSIS_MAX_INPUT_CHARS` |
| Parser | `src/ai/parseAnalysisResponse.ts` | JSON extraction (bare / fenced / wrapped) + Zod validation; fails closed |
| Cache | `src/ai/aiCache.ts`, `src/db/schema.ts` | `ai_analyses` table, UNIQUE`(company_id, input_hash)`, SHA-256 hash of stable serialised input |
| Budget | `src/ai/aiBudget.ts` | Daily spend = SUM(estimated_cost) where created_at is today; conservative pre-call check refuses if remaining < estimated cost |
| Provider | `src/ai/providers/*.ts` | `AiProvider` interface; Anthropic (with prompt-cached system block); deterministic Mock; per-model pricing table |
| Engine | `src/ai/aiAnalysisEngine.ts` | budget → cache → provider → parse → persist; fail-safe on any step |
| Pipeline | `src/pipeline/runLeadSourcingPipeline.ts` | After scoring, builds candidates from priority A/B/C rows, calls engine selectively |
| CLI | `scripts/{analyzeTopLeads,debugAi}.ts` | One-shot batch runner + per-company breakdown showing tokens, cost, cache hit, confidence, evidence |
| Dashboard | `app/page.tsx`, `app/_components/AiFeedback.tsx`, `app/_lib/dashboardData.ts` | AI overview cards (cost today, feedback split) + per-lead AI panel with pain points, opportunities, proof angles, evidence, feedback buttons |
| Feedback API | `app/api/ai-feedback/route.ts` | Zod-validated POST; sets `feedback_status` to `useful` / `not_useful` / `hallucination` / `approved` / `rejected` |

### Phase 3 — Verified website signals (`tests/websiteSignals.test.ts` + `tests/inspectionScoring.test.ts`, 14 cases)

| Area | File(s) | Notes |
|---|---|---|
| Inspector | `src/inspection/websiteInspector.ts` | Native `fetch` + `AbortController` timeout + follow-redirect; parses with `node-html-parser`; optionally follows 1–2 internal pages (contact / services / careers) |
| Signal extraction | `src/inspection/extractWebsiteSignals.ts` | Pure function over `PageFingerprint[]` — easy to unit-test |
| Cache + persistence | `src/inspection/inspect.ts`, `src/db/schema.ts`, `src/db/repository.ts` | New `website_inspections` table keyed by domain, TTL-driven freshness, signals fanned out into the `signals` table with `source='website_inspection'` |
| Scoring | `src/scoring/scoringConfig.ts`, `src/filters/ruleBasedFilter.ts`, `src/scoring/intentScoring.ts` | Each verified signal type has an explicit weight; intent components consume contact-form / booking / manual-workflow / AI-provider verifies directly |
| Pipeline | `src/pipeline/runLeadSourcingPipeline.ts` | Inspection runs in parallel between dedupe and scoring with `mapWithConcurrency`; falls through on errors |
| CLI | `scripts/inspectWebsites.ts`, `scripts/debugSignals.ts` | `npm run inspect:websites` (re-inspect known sites), `npm run debug:signals` (per-lead signal dump) |
| Dashboard | `app/page.tsx`, `app/_lib/dashboardData.ts` | Inspection counts cards + verified-signals expander per lead |

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

## Configuring AI analysis (Phase 5)

```ini
AI_ANALYSIS_ENABLED=1
AI_ANALYSIS_PROVIDER=anthropic
AI_ANALYSIS_MODEL=claude-haiku-4-5-20251001     # cheapest tier; sufficient for grounded analysis
AI_ANALYSIS_MAX_LEADS_PER_RUN=10                # hard cap per pipeline / CLI invocation
AI_ANALYSIS_ALLOWED_PRIORITIES=A                # or A,B
AI_ANALYSIS_DAILY_COST_LIMIT_USD=5              # refuses new calls past this
AI_ANALYSIS_MAX_INPUT_CHARS=12000               # prompt input cap
AI_ANALYSIS_MAX_OUTPUT_TOKENS=1500
AI_ANALYSIS_REQUEST_TIMEOUT_MS=30000
ANTHROPIC_API_KEY=sk-ant-...                    # leave blank to fall back to mock
AI_ANALYSIS_FORCE_MOCK=0                        # set 1 to force mock with a key present
```

### How AI budget enforcement works
- Before every call: `SUM(estimated_cost) WHERE date(created_at) = today` is compared against `AI_ANALYSIS_DAILY_COST_LIMIT_USD`. If `spent + conservative_estimate > limit`, the engine returns `skipped_budget` for that lead and the batch stops early.
- The conservative estimate uses the configured model's *fresh* per-token price (not cached) plus the full `max_output_tokens`, so we never start a call we cannot afford in the worst case.
- Per-lead cap (`AI_ANALYSIS_MAX_LEADS_PER_RUN`) and priority allow-list (`AI_ANALYSIS_ALLOWED_PRIORITIES`) act before cost — rejected and below-priority leads are never sent to the provider at all.

### How caching works
- Every input is hashed (`SHA-256` of `{promptVersion, company, sortedReasons, sortedSignals, snippet, contact}`).
- The `ai_analyses` table has `UNIQUE(company_id, input_hash)` — re-running the same lead with no new evidence returns `cache_hit` with the prior analysis and **zero** new cost.
- Bumping `PROMPT_VERSION` in `src/ai/aiTypes.ts` invalidates the entire cache.
- The Anthropic provider marks the (long, stable) system prompt as `cache_control: {type: 'ephemeral'}` — once the prefix is warm, subsequent live calls pay ~0.1× input price for the system bytes (verified via `usage.cache_read_input_tokens`).

### Cost profile
On `claude-haiku-4-5` ($1/$5 per Mtok in/out, ~0.1× cached):
- One full live call: ~3K input + ~1K output ≈ **$0.008–$0.010**.
- After the system prompt caches: ~$0.003–$0.005.
- A full pipeline at default caps (10 priority-A leads, mostly cached system prompt): **≤ $0.05 / run**.
- Daily ceiling at $5 = ~500 fresh analyses worst case, or thousands in steady state with cache + dedup.

### What changed in scoring
Nothing. Phase 5 sits *after* scoring — it does not alter scores, weights, or priority bucketing. It reads the same `reasons`/`rejectionReasons`/`verifiedSignals` that informed the score and produces a parallel layer of operational interpretation that the operator reads (or ignores) on the dashboard.

## Configuring website inspection (Phase 3)

```ini
WEBSITE_INSPECTION_ENABLED=1
WEBSITE_INSPECTION_TIMEOUT_MS=10000
WEBSITE_INSPECTION_MAX_PAGES_PER_SITE=3
WEBSITE_INSPECTION_USE_PLAYWRIGHT=0          # not implemented yet
WEBSITE_INSPECTION_CACHE_TTL_DAYS=7
WEBSITE_INSPECTION_CONCURRENCY=4
# WEBSITE_INSPECTION_USER_AGENT="CircuitInspector/0.1"
```

The inspector:

- uses native `fetch` (Node 18+) with an `AbortController` timeout — no Playwright
  unless `WEBSITE_INSPECTION_USE_PLAYWRIGHT=1` (stub).
- follows redirects, parses HTML with `node-html-parser`, extracts title / meta /
  visible text / `<a>` links / `<form>` inputs.
- optionally follows the top internal links (`/contact`, `/services`, `/pricing`,
  `/careers`) up to `MAX_PAGES_PER_SITE - 1` follow-ups per site.
- caches the result by domain in `website_inspections`; subsequent runs reuse it
  until the TTL elapses or `--force` is passed.
- emits one or more typed signals (e.g. `verified.has_contact_form`,
  `verified.has_ai_automation_language`) into the `signals` table with
  `source='website_inspection'`.
- **fails safely** — a network error becomes a `verified.website_failed` signal
  and the pipeline continues.

### What changed in scoring

| New verified signal | Rule weight | Component impact |
|---|---:|---|
| `verified.website_loads` | +4 | — |
| `verified.has_contact_page` | +4 | — |
| `verified.has_contact_form` | +8 | decisionMakerAccess +15 |
| `verified.has_booking_link` | +10 | decisionMakerAccess +15 |
| `verified.has_services_page` | +5 | — |
| `verified.has_multiple_service_pages` | +4 | — |
| `verified.has_careers_page` | +5 | — |
| `verified.has_support_or_help` | +5 | — |
| `verified.has_ecommerce_signals` | +6 | — |
| `verified.has_manual_workflow_language` | +8 | manualWorkload +25 |
| `verified.high_automation_fit` | +8 | manualWorkload +15 |
| `verified.likely_service_business` | +4 | automationFit +10 |
| `verified.likely_saas` | +4 | — |
| `verified.likely_local_smb` | +3 | — |
| `verified.website_failed` | **−30** | — |
| `verified.has_ai_automation_language` | **−45** | automationFit −40 (competitor) |
| `verified.low_digital_maturity` | **−12** | — |

Every contribution shows up explicitly in the score `reasons[]` / `rejectionReasons[]` so
the dashboard and `npm run debug:score` keep their full explanation.

## Data model

```
companies ──< contacts
          ├──< signals          (raw source signals + verified.* signals)
          ├──< lead_scores
          ├──< ai_analyses      (latest + history, UNIQUE by company + input hash)
          ├──── review_queue (1-to-1)
          └──── website_inspections (1-to-1, cached by domain)

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
- AI-generated outreach copy. Phase 5 produces operational analysis only — never
  copy intended to be sent to a buyer.
- Autonomous AI agents / agent frameworks. The AI layer is one-shot, single-prompt,
  single-response. No tool use, no recursive loops, no agentic crawling.
- AI scoring on every lead. Only priority A (optionally B) leads are sent to the model.
- LinkedIn scraping.
- Other live source connectors (job boards, Product Hunt) — placeholders return empty results
  with a note.
- Paid enrichment (Apollo, Clay, Clearbit).
- Playwright-based inspection — env switch exists (`WEBSITE_INSPECTION_USE_PLAYWRIGHT=1`)
  but the path is a deliberate stub; only wire it up if a real site requires JS-rendered
  content to surface its signals.
- Multi-tenant or authenticated dashboard — intended for `localhost`.
- Background scheduler / cron — runs are operator-triggered.

## Suggested next phase

> Phase 6 — Feedback-driven scoring tuning + nightly run.
>
> 1. Surface a "suggested scoring tweaks" widget on the dashboard derived from
>    AI feedback patterns (high-confidence + approved → reasons / signals that
>    correlate; flagged hallucinations → reasons we should de-weight). Display
>    only — no auto-apply.
> 2. Add a `scheduler` module: nightly cron-equivalent that runs the source
>    pipeline, refreshes stale inspections, and re-analyses leads whose input
>    hash changed. Emits a daily diff to `data/outputs/daily-diff.json`.
> 3. Add an evaluation harness for AI analyses: replay a fixed set of seeded
>    leads, compare new outputs against a frozen baseline, flag drift.
> 4. Optional: implement `jobBoardSource` (Workable feeds) — hiring is a
>    strong intent signal for ops/automation work.
>
> Still no outreach. Still no email. Still no autonomous agents.

## Previous suggested phase (Phase 4)

> Phase 4 — additional sources + feedback loop + nightly run.
>
> 1. Add `jobBoardSource` (Workable public feeds or similar) using ops/automation keywords
>    as the query layer. Reuse the inspection pipeline so verified signals get attached.
> 2. Persist per-lead `review_decisions` (accept / reject / contacted) to a new table; on
>    the dashboard surface *suggested* scoring-weight tweaks based on decision patterns
>    (display only, no auto-apply).
> 3. Add a `scheduler` module that runs the pipeline nightly, appends new leads, refreshes
>    stale inspections, and emits a daily diff to `data/outputs/daily-diff.json`. No email
>    sending.
> 4. Optional: wire up `WEBSITE_INSPECTION_USE_PLAYWRIGHT=1` to a Playwright provider for
>    JS-rendered sites, gated behind a strict per-day budget.
>
> Keep all hard cost ceilings explicit and configurable. Still no outreach. Still no LLMs.

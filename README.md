# Circuit

A low-cost AI lead sourcing and opportunity intelligence system for a small AI development /
automation agency. Phase 1 focuses on building a **trustworthy, explainable scoring foundation**
on top of mocked data — no live scraping, no outreach, no AI calls yet.

## Phase 1 — what's implemented

| Area | File(s) | Notes |
|---|---|---|
| Project scaffold | `package.json`, `tsconfig.json`, `next.config.mjs` | TypeScript + Next.js 14 + tsx + better-sqlite3 + Zod + Vitest |
| Config | `src/config/index.ts` | DB path, output dir, review threshold — all env-overridable |
| Types | `src/types/index.ts` | Zod schemas for `RawLead`, `Company`, `Contact`, `Signal`, `LeadScore`, `ReviewItem` |
| Database | `src/db/{schema,client,repository}.ts` | Local SQLite at `./data/circuit.db`, auto-created |
| Source connectors | `src/sources/*` | `SourceConnector` interface, working `mockSourceConnector`, stub files for Google Maps / Product Hunt / job boards / LinkedIn-assisted |
| Rule filter | `src/filters/ruleBasedFilter.ts` | First-pass filter with weighted reasons + rejection reasons |
| Dedupe | `src/filters/dedupe.ts` | Batch-level dedupe by domain → normalised name |
| Intent scoring | `src/scoring/intentScoring.ts` | 7-component opportunity score, weighted combine, priority bucket A/B/C/Reject |
| Scoring config | `src/scoring/scoringConfig.ts` | Single tunable knob-set for thresholds + weights |
| Pipeline | `src/pipeline/runLeadSourcingPipeline.ts` | fetch → validate → dedupe → persist → score → enqueue |
| Review export | `src/review/{reviewQueue,exportReviewQueue}.ts` | Writes `data/outputs/review-queue.{json,csv}` |
| Debug tools | `src/debug/{explainScore,testLeadFixtures}.ts` | Per-lead score breakdowns |
| CLI scripts | `scripts/{seed,pipeline,debugScore,resetDb}.ts` | npm-runnable entry points |
| Dashboard | `app/page.tsx`, `app/_lib/dashboardData.ts`, `app/api/dashboard/route.ts` | Minimal internal monitoring UI |
| Tests | `tests/scoring.test.ts` | Proves good-fit fixtures rank above bad-fit fixtures |

## Setup

```bash
npm install
cp .env.example .env   # optional — defaults are fine for local dev
```

Requires Node 18+. `better-sqlite3` ships a native binding and may need build tools on first
install (`xcode-select --install` on macOS).

## Running Phase 1

```bash
# 1. Reset + seed the local SQLite database from the mock connector.
npm run seed

# 2. Re-run the pipeline against active sources and write JSON/CSV exports.
npm run pipeline

# 3. Print a full score breakdown for every fixture (or one company).
npm run debug:score
npm run debug:score -- "Lumen & Co Marketing"

# 4. Run the scoring test suite.
npm test

# 5. Boot the internal monitoring dashboard.
npm run dev
# → http://localhost:3000
```

Outputs land in:

- `data/circuit.db` — SQLite database
- `data/outputs/review-queue.json`
- `data/outputs/review-queue.csv`

## Data model

```
companies ──< contacts
          ├──< signals
          ├──< lead_scores
          └──── review_queue (1-to-1)
```

Every source connector returns the normalised `RawLead` shape defined in
`src/types/index.ts`; the pipeline takes it from there.

## Scoring overview

1. **Rule filter** (`evaluateRules`) — cheap, explainable. Starts at 50, applies positive deltas
   for ICP signals (ideal headcount, target industry, founder reachable, ops complexity,
   commercial intent, automatable workload) and negative deltas for disqualifiers
   (enterprise, restaurant, no website, hobby project, internal automation team, heavy
   compliance). Outputs `ruleScore`, `pass`, `reasons[]`, `rejectionReasons[]`.
2. **Intent scoring** (`evaluateIntent`) — 6 weighted positive components (urgency,
   manual workload, decision-maker access, budget likelihood, automation fit, implementation
   simplicity) minus a `trustBarrierRisk` penalty. Outputs `intentScore` and a per-component
   breakdown.
3. **Combine** — `finalScore = 0.55 * rule + 0.45 * intent`, mapped to A (≥85) / B (≥70) /
   C (≥60) / Reject (<60).

Every threshold and weight is in `src/scoring/scoringConfig.ts` — tweak there, re-run
`npm run debug:score`, observe the deltas.

## What is intentionally NOT in Phase 1

- No live source scraping. Stubs throw — wire them up in Phase 2.
- No outreach (email/LinkedIn), no email sending, no inbox management.
- No LLM enrichment / AI analysis of leads. Rules and weighted heuristics only.
- No paid enrichment (Apollo, Clay, Clearbit etc.).
- No multi-tenant or auth on the dashboard — it's intended for the operator on `localhost`.
- No background scheduler / cron — runs are operator-triggered via npm scripts.

## Suggested Part 2 prompt

> Phase 2 — Live source ingestion + nightly run.
>
> 1. Implement `googleMapsSource` against the Google Places API with a strict daily quota and
>    cached responses. Persist quota usage to a new `source_runs` table.
> 2. Implement `jobBoardSource` against a single SMB-friendly board (e.g. Workable public
>    feeds) — use ops/automation keywords as the query layer.
> 3. Add lightweight website-presence checks (status code + tech-stack fingerprint) so
>    `HAS_WEBSITE` is verified, not assumed.
> 4. Add a `scheduler` module that runs the pipeline nightly, appends new leads, and emits
>    a daily diff to `data/outputs/daily-diff.json` (no email sending yet).
> 5. Add a feedback loop: dashboard accept/reject buttons that write to a
>    `review_decisions` table; use those decisions to suggest scoring-weight tweaks (display
>    only, no auto-apply).
>
> Keep all hard cost ceilings explicit and configurable. Still no outreach.

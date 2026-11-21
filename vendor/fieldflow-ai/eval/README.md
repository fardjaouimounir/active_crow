# Offline business-accuracy benchmark

Measures whether FieldFlow reports are **correct**, not just well-formed. The
earlier 8/8 Qwen acceptance test only showed that the output format and the
numeric allow-list hold on one clean dataset.

```bash
npm run eval:recorded                 # replay eval/recorded/baseline.json (deterministic, no network)
npm run eval:live -- --record         # call the real model through the production pipeline (needs .env)
npm run eval:live -- --runs 3 --cap sales_performance --locale ar --verbose
```

Filters: `--cap`, `--locale`, `--id`, `--runs N`, `--concurrency N`, `--file`.

**Held-out and rule switches:** `--set heldout` runs the 10 scenarios of `scenarios-heldout.mjs` (written without
looking at model output, never used to tune anything); `--no-claim-rules` runs the claims pipeline without the P4
claim rules (evaluation only, never available in the service).

**Safety:** `--record` requires an explicit `--file` that does not exist yet (the runner exits with code 2
otherwise; `--force` overrides). Progress is saved every 10 cases to `<file>.partial.json` and removed on success, so an
interrupted run keeps its results. Recordings carry `meta` (set, claimRules, outputMode, promptVersion, model,
git HEAD). Cases that fell back because of provider errors (`AI_UNAVAILABLE`, `AI_MODEL_TIMEOUT`, `AI_RATE_LIMITED`)
measure nothing: the runner warns, and they must be re-run into a new file.
Reports are written to `eval/reports/` (git-ignored); `eval/BASELINE.md` is the
reviewed baseline. Live runs stub the callback: nothing is sent to FieldFlow.

## What is in the box

| File | Role |
|---|---|
| `scenarios.mjs` | 45 hand-written scenarios (11 supervisor, 13 sales, 10 campaign, 11 animateur), each run in `en` and `ar` = 90 cases |
| `reference.mjs` | Independent calculator: KPIs, per-entity figures, data-quality findings. Never imports `src/` (a test enforces it) |
| `judge.mjs` | Scores one report against a scenario. No model is called |
| `lexicon.mjs` | English/Arabic word lists used by the judge |
| `run.mjs` | Recorded and live runner, aggregation, report |
| `recorded/baseline.json` | Raw replies from the live baseline run, for deterministic replay |

## Ground truth is independent of the model and of the service

- Scenario data, the data-quality codes and the "what a good report must address"
  (`focus`, `priority`) are written by hand.
- Expected KPIs come from `reference.mjs`, which is written from the metric
  definitions below, not from `src/pipeline/kpis.js`. About 90 KPI values are
  also worked out by hand in the scenarios (`hand`) and checked against the
  reference in `tests/eval.test.js`.
- No model produces or grades any answer.

## Metric semantics used by the reference (proposals, to confirm with the business)

1. A metric is **undefined** (`null`) when an input is missing or its
   denominator is 0. The service currently reports `0`.
2. An aggregate over several entities is undefined when **any** entity lacks
   the field (no silent partial sums).
3. Rates are ratios in 0..1 (`attendanceRate`); percentages are x100.
4. Ranking is by units; ties are allowed in any order.

These are not found in the service or its docs, so they are labelled as
proposals. If the business defines them differently, only `reference.mjs`
changes.

## Critical gates (any one fails the case, whatever the score)

`SCHEMA_INVALID`, `PII_LEAK`, `UNKNOWN_LABEL`, `UNSUPPORTED_NUMBER`,
`WRONG_ATTRIBUTION`, `WRONG_DIRECTION`, `WRONG_SUPERLATIVE`, `WRONG_RANKING`,
`CAUSAL_AS_FACT`, `DATA_CONFLICT_IGNORED`, `KPI_WRONG_VALUE`,
`KPI_UNDEFINED_AS_VALUE`.

## Scored dimensions (0..1, non-critical)

coverage (focus items addressed) · prioritisation (top item mentioned first) ·
evidence (items carry refs) · relevance (recommendations name a focus
entity/topic) · locale (script, Latin trade terms). Weighted 0.30 / 0.20 /
0.15 / 0.20 / 0.15, renormalised over the dimensions that apply. A case passes
with no critical failure and a score of at least 0.7.

## Known limits of the judge (read before trusting a number)

- Attribution, direction, superlative and causal checks are **lexical
  heuristics**. They look at one clause at a time, skip clauses with negation,
  and skip "respectively" sentences (a swapped "respectively" is missed).
- "Data conflict acknowledged" means an acknowledgement keyword is present. It
  does not prove the explanation is right (SAL-09 invents "one period / another
  period" yet is accepted because it says "inconsistent").
- Relevance and prioritisation are crude proxies. Sample-review them with a
  human rubric before using them to compare versions.
- The 0.7 pass threshold and the weights are arbitrary starting values.
- Scenarios are small and synthetic, and the baseline uses one run per case.
  Use `--runs 3` to see variance before drawing conclusions from small gaps.
- The judge was tuned after reading the first baseline: five false positives
  were found by reading the real outputs and fixed (see the regression tests in
  `tests/eval.test.js`). That is tuning on the test set, so re-validate with new
  scenarios when they are added.

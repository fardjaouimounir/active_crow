# Baseline: current system (prompt-v2, label whitelist, number allow-list)

Live run on 2026-11-20 against Qwen/Qwen3.8-27B through the production pipeline:
45 scenarios x 2 locales = 90 cases, **one run per case**. Raw replies are in
`recorded/baseline.json`; `npm run eval:recorded` reproduces every figure below.
Read `README.md` first for the judge's limits.

| Metric | Value |
|---|---|
| Cases judged | 90 (no fallback, no repair, no provider error) |
| **Critical-failure rate** | **28.9% (26 of 90)** |
| Critical-failure rate excluding "undefined reported as 0" | 15.6% (14 of 90) |
| AI-accepted outputs that still contain a critical error | 28.9% (26 of 26 failures passed every current validator) |
| Pass rate (no critical, score >= 0.7) | 70% |
| Mean score | 0.91 |
| Dimension means | coverage 0.994, prioritisation 0.75, evidence 1.0, relevance 0.688, locale 0.967 |

## Where the failures are (cases)

| Critical code | Cases | What it is |
|---|---|---|
| `KPI_UNDEFINED_AS_VALUE` | 14 | A missing or undefined input is reported as a number: no target becomes `target 0, attainment 0%`; `previousUnits 0` becomes "0% change"; a missing seller target gives `totalTarget 200` and 135% attainment |
| `DATA_CONFLICT_IGNORED` | 12 | Impossible or contradictory data is narrated as normal (see below) |
| `UNSUPPORTED_NUMBER` | 2 | A knock-on of the zero-filled gifts KPIs (SUP-06) |
| every other gate | 0 | No wrong seller, wrong direction, wrong ranking, wrong superlative, unknown label, PII or cause-as-fact was found |

Examples read from the real replies:

- SUP-07 (60 present, 50 expected): "Attendance exceeded expectations with 60 present against 50 expected."
- CAM-07 (120 gifts distributed, 100 planned): presented as a "surplus" to exploit.
- ANI-05 (rate sent as 90 instead of 0.9): "Improve the 45.4 avgAttendanceRate".
- ANI-07 (duplicate label A1): invents "attendance dropped to 60% in one period".
- SAL-09 (duplicate S1): invents "100% attainment in one period but 60% in another"
  (counted as acknowledged because it says "inconsistent").

By capability and locale:

| Group | n | Critical | Critical (non-KPI) | Mean score |
|---|---|---|---|---|
| supervisor_daily_summary / en | 11 | 36.4% | 18.2% | 0.848 |
| supervisor_daily_summary / ar | 11 | 45.5% | 27.3% | 0.847 |
| sales_performance / en | 13 | 7.7% | 0% | 0.955 |
| sales_performance / ar | 13 | 15.4% | 7.7% | 0.953 |
| campaign_insights / en | 10 | 30% | 10% | 0.936 |
| campaign_insights / ar | 10 | 30% | 10% | 0.897 |
| animateur_coaching / en | 11 | 36.4% | 27.3% | 0.93 |
| animateur_coaching / ar | 11 | 36.4% | 27.3% | 0.9 |

## What this says

1. On **clean data**, the current guardrails hold up on this sample: no
   attribution, direction, ranking or label errors in 90 cases. The P0 label
   whitelist and the number allow-list are doing their job there.
2. The failures are almost all about **data quality**: the code zero-fills
   undefined values (14 cases) and the model narrates impossible data as normal
   (12 cases). Nothing in the pipeline detects either. This confirms risks R5
   and R6 from the audit and makes the P2 "data understanding" layer the next
   priority.
3. The validators cannot be credited with these results: every failing case
   was accepted as valid AI output.

## What this does not say

- The sample is small and uniform, with one run per case. A clean 0 on a gate
  is not proof of 0%: re-run with `--runs 3` and add scenarios before relying
  on it.
- Prioritisation (0.75) and relevance (0.688) use crude proxies and need a
  human rubric review on a sample.
- The first judging pass flagged 37 cases. Reading the replies showed several
  were judge false positives (an Arabic word containing "جراء", "best
  practices", ranges such as "from 120 to 150"), and the acknowledgement word
  list was too narrow for two cases. After fixing both, 26 remain. The figures
  above are after that tuning, so they are somewhat optimistic about the judge.

---

# After P2 (data understanding, prompt-v3)

Same 45 scenarios x 2 locales, **two runs per case** (180 cases), same judge, live Qwen.
Raw replies: `recorded/p2.json` (`npm run eval:recorded -- --file recorded/p2.json`).
The P1 baseline above is unchanged and re-judged with the final judge below (28.9% either way).

| Metric | P1 baseline (90 cases) | After P2 (180 cases) |
|---|---|---|
| Critical-failure rate | **28.9%** | **0%** (0 of 180) |
| ...excluding "undefined reported as 0" | 15.6% | 0% |
| `KPI_UNDEFINED_AS_VALUE` cases | 14 | 0 |
| `DATA_CONFLICT_IGNORED` cases | 12 | 0 |
| Pass rate (no critical, score >= 0.7) | 70% | 98.9% |
| Fallback rate / repair rate | 0% / 0% | 0% / 1.1% |
| Mean score | 0.91 | 0.90 |
| Dimension means | coverage 0.994, prioritisation 0.75, evidence 1, relevance 0.688, locale 0.967 | coverage 0.994, prioritisation 1, evidence 1, relevance 0.664, locale 0.939 |

What changed in the service: undefined metrics are omitted instead of 0; code-detected
data-quality findings are given to the model, returned as `output.dataQuality`, and
rendered by the fallback; completeness counts missing per-row fields; typed data
schemas (warn-only); prompt rules for data problems.

## Read this before trusting the numbers

- **The scenarios guided the fix.** The failure categories found on these 45
  scenarios are exactly what P2 targets, so the improvement on the same scenarios
  overstates how it will generalise. Validate on new, held-out scenarios.
- **The judge was adjusted after seeing the P2 results.** The first P2 pass (one
  run, judge as of P1) gave 5.6% critical (5 of 90): all `CAUSAL_AS_FACT`, on
  sentences such as "unavailable due to a zero denominator". Those explain a data
  limit, not a business cause. I then limited the causal gate to observations,
  exempted sentences that describe a data limitation (English and Arabic lists),
  and let evidence fields cite finding codes. A later 2 of 180 cases ("لا يمكن ...
  بسبب غياب بيانات الهدف") led to adding Arabic "absence" words. These changes do
  not alter the P1 baseline, but the gate is now more lenient; regression tests
  in `tests/eval.test.js` pin each case.
- **A real defect was found in the service by the benchmark itself:** in missing-data
  scenarios Qwen cited the finding code (`TARGET_MISSING`) or an unavailable metric
  name in `evidence`, which the label whitelist rejected (2 fallbacks, 5 repairs in
  the first P2 pass). The whitelist now accepts finding codes and the capability's
  metric and field names; entity labels are still strict.
- "Conflict acknowledged" remains a keyword check: it does not prove the explanation
  is right. Relevance (0.664) and the 0.90 mean score fell slightly; they are crude
  proxies that penalise "verify the data" actions, which carry no entity label.
- 0% on 180 synthetic cases is not 0% in production.

---

# After P3 (findings engine, typed claims, prompt-v4)

Same 45 scenarios x 2 locales, two runs per case (180 cases), same judge, live Qwen, default
`OUTPUT_MODE=claims`. Raw replies: `recorded/p3.json`. Compared with P2 under the same final judge
(P1 baseline 28.9% and P2 0% are unchanged by the judge fixes below).

| Metric | P2 (180) | P3 (180) |
|---|---|---|
| Critical-failure rate | **0%** (0) | **1.1%** (2: one scenario, CAM-09 in Arabic, both runs) |
| Pass rate | 98.9% | 90.6% |
| Fallback / repair rate | 0% / 1.1% | 1.1% / 1.1% (the 2 fallbacks are provider timeouts) |
| Mean score | 0.90 | 0.889 |
| coverage / prioritisation / evidence | 0.994 / 1 / 1 | 1 / 1 / 1 |
| relevance / locale | 0.664 / 0.939 | 0.666 / 0.928 |
| animateur_coaching mean score | 0.925 en, 0.901 ar | 0.964 en, 0.935 ar |
| sales_performance mean score (ar) | 0.942 | 0.887 |
| campaign_insights mean score | 0.929 en, 0.865 ar | 0.878 en, 0.862 ar |

What P3 added: a deterministic finding engine (ranked, no invented threshold, nothing built on
contradictory data), typed claims (observation / interpretation / hypothesis / recommendation)
each tied to finding ids, code rendering into the existing fields, code statements for any top
finding the model skips (coverage is now 1.0 by construction), and a fallback built from the
findings. The finding engine's priority agrees with all 14 hand-written scenario priorities.

## Read this before trusting the numbers

- **P3 is not a clear win on this benchmark.** It improves coverage by construction, gives
  provenance (which claim rests on which finding, hypotheses marked as such) and a more
  informative fallback, and animateur coaching scores higher. It does not reduce the critical
  rate (0% -> 1.1%) and lowers the mean score on sales / campaign / supervisor. The value is
  structural (traceability, enforceable gates in P4), not a measured accuracy gain.
- **The one remaining critical error is real:** CAM-09 (Arabic) states "campaign performance
  declined because of the shortage of gift distribution ..." as fact, an unsupported cause and an
  unsupported "declined" on a mid-campaign snapshot. Claims typing makes this enforceable (a cause
  belongs in a `hypothesis` claim); that is P4.
- **Judge fixes after seeing P3 results**, each verified by reading the text, and none changes the
  P1 or P2 figures: Arabic diacritics are stripped before matching; "possible / possibly" count as
  hedges; percent relations between sibling fields of the data are accepted as correct
  arithmetic (16.667 = 10 / 60); the previous period's units belong to the sentence about the
  period; "دون" alone no longer means "below" (it also means "without"); the new `insights`
  structure is not scanned as prose. First pass of this run scored 4.4% critical before these fixes.
- **A real service defect found by reading outputs:** "lowest units" statements were rendered as
  strengths in coaching. Fixed (`lean: weak` lists them under gaps; they stay non-adverse).
- **Provider outages:** the first full run had 43 provider errors (`AI_UNAVAILABLE`, timeouts),
  mostly on animateur_coaching; those 44 cases were re-run and replaced. Two timeouts on CAM-10 remain.
- **Quality issues the judge does not see:** the model repeats itself (an observation and an
  interpretation about the same finding become two near-identical risks) and sometimes invents
  vocabulary ("30 Animateurs present", "10% of points of sale did not participate") because the
  business definition of attendance is not in the data. Relevance (0.666) is unchanged.
- The scenarios guided the design and the judge was tuned on these outputs; validate on
  held-out scenarios before relying on any of these figures.

---

# After P4 (claim validation, prompt-v5) — final code, 2026-11-21

Code: git `68857c3` (branch `feat/claims-validation`). Judge, lexicon, reference and scenarios are **unchanged since commit
`a090837`**: nothing was tuned during or after this measurement. Recordings carry `meta` (set, claimRules, promptVersion, HEAD):
`recorded/p4b-design-rules-on.json`, `p4b-design-rules-off.json`, `p4b-heldout-rules-on.json`, `p4b-heldout-rules-off.json`.
Same model, `OUTPUT_MODE=claims`, 2 runs per case. "Rules off" = `--no-claim-rules` (evaluation switch, same prompt-v5).
The earlier `recorded/p4.json` is a first P4 run made before the final fixes and is not used here.

| | P3 design (180) | P4 design, rules **on** (180) | P4 design, rules **off** (180) | Held-out, rules **on** (40) | Held-out, rules **off** (40) |
|---|---|---|---|---|---|
| Critical-failure rate | 1.1% (2) | **0%** | **0%** | 0% | 0% |
| Pass rate | 90.6% | 96.1% | 94.4% | 100% | 100% |
| Fallback / repair rate | 1.1% / 1.1% | 0% / 8.9% | 0% / 0% | 2.5% / 15% | 0% / 0% |
| Mean score | 0.889 | 0.909 | 0.907 | 0.879 | 0.867 |
| relevance / locale | 0.666 / 0.928 | 0.70 / 0.983 | 0.699 / 0.983 | 0.689 / 0.925 | 0.686 / 0.913 |

## What this does and does not show

1. **The drop from 1.1% to 0% critical is not evidence for the rules.** With the same prompt-v5, the run with the rules
   **off** also has 0%. The improvement over P3 comes from the prompt (and the headline/finding fixes), not from the enforcement.
2. **The rules are a guarantee, not a measured gain.** Applying them to the *rules-off* outputs shows what they would have
   intervened on: **14 of 180 reports (7.8%)** on the design set and **4 of 40 (10%)** on the held-out set contain at least
   one violation (design set: 10 of 1,328 model claims; 4 of 44 supervisor headlines state a cause), mostly unsupported causes,
   labels or figures not in the cited findings, and unacknowledged data conflicts. The offline judge does not classify these
   as critical, so a 0% judge score is compatible with them.
3. **Cost:** 8.9% (design) and 15% (held-out) of reports need the one repair retry; 1 of 40 held-out reports fell back
   (HLD-02, Arabic: the repair introduced an invented number). Six re-runs of that case did not reproduce it, and the
   offending number was not recorded, so the cause is unknown.
4. **Held-out generalisation:** no critical error on 10 scenarios the rules were not designed with, and the finding engine
   ranks the hand-written priority first in all 6 priority scenarios (`tests/heldout.test.js`). The prioritisation score
   (0.25 vs 0) rests on a single scenario (4 cases): the model-written *headline* lists topics in a different order than the
   code-ranked facts (HLD-02), which is a headline issue, not a ranking one. Not fixed.
5. **Previous defects verified fixed:** the "20 percent" invented-number fallback seen twice in the interrupted run did not
   recur (0 fallbacks in 180); French elision and the KNOWN_CAUSE/hedge gaps are covered by regression tests.

## Limits of this measurement

- **The provider returned cached completions.** In the rules-off recordings run 1 and run 2 are identical in 81 of 90
  design cases and 14 of 20 held-out cases (rules-on: 6 of 90). The effective sample of the rules-off runs is about half,
  the two arms are not a paired experiment (identical outputs in 90 of 180 design cases), and variance is understated.
- The judge is lexical and the scenarios are synthetic. 0% is not 0% in production.
- Not measured: recommendations lost after claims are removed (the code only restores observations), Arabic and English only
  (French is defensive, not a contract locale), and any real backend.

---

# After D9 and D11 (headline priority, recommendation restore) — 2026-11-21

Code: git `798c406`. Recordings: `recorded/p4c-design-rules-on.json` (180) and `recorded/p4c-heldout-rules-on.json` (40), rules on,
prompt-v5, 2 runs per case. **These are fresh samples**: 0 of 220 model reply sets are identical to the `p4b` run (no provider cache
this time), so they are independent of the previous measurement.

| | p4b design (180) | **p4c design (180)** | p4b held-out (40) | **p4c held-out (40)** |
|---|---|---|---|---|
| Critical-failure rate | 0% | **0%** | 0% | **0%** |
| Pass rate | 96.1% | 96.1% | 100% | 100% |
| Fallback / repair rate | 0% / 8.9% | 0% / 6.7% | 2.5% / 15% | **0% / 12.5%** |
| Mean score | 0.909 | 0.905 | 0.879 | **0.898** |
| prioritisation | 1 | 1 | **0.25** | **1** |
| relevance / locale | 0.70 / 0.983 | 0.696 / 0.975 | 0.689 / 0.925 | 0.691 / 0.938 |

## What happened

- **D11 works where it was measured to fail.** Held-out prioritisation goes from 0.25 to 1: the headline now leads with the
  top-priority topic. The rule replaced 13 headlines on the design set and 5 on the held-out set by the code's statement of finding 1,
  with no repair retry (`insights.rejected`: `HEADLINE_ORDER / headline`). Four design-set headlines still stated a cause and were
  rejected by the earlier rule. Offline replay on the *recorded* headlines showed that a strict full ordering rejected natural
  sentences, so the rule only requires the top-priority topic to be named and to come first.
- **D9 was not exercised live.** No recommendation had to be removed in these 220 reports (0 code-written recommendations), so the
  restoration is verified only by tests (unit and end to end with a stub model, en and ar). Do not read this run as evidence that it
  works on real model output.
- The held-out fallback of the previous run did not recur (0 of 40). It was not reproducible before either (0 of 6), so this is not
  evidence it is fixed.
- **Judge fix, disclosed.** The first judging of `p4c-design-rules-on` reported one critical error (ANI-02, Arabic). It was a false positive:
  the text says high attendance "was not enough to exceed the target" and the judge's Arabic negation used `\b`, which never matches Arabic
  letters (the same ASCII-boundary defect already fixed in the service lexicon). Fixed in `eval/lexicon.mjs` with a regression test.
  Re-judging every recording changes nothing else: baseline 28.9%, P2 0%, P3 1.1%, p4b 0%.

## Limits

- 0% is on a lexical judge and synthetic scenarios, with 180 + 40 cases. Differences of a few points between rows are within noise.
- Repair rate 6.7% / 12.5%: the rules still cost one extra model call in roughly one report in ten.

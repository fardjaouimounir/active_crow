# Claim validation (P4): causal reasoning and grounding

Principle: **code calculates what happened, the model explains what it means, and code checks the
explanation.** P3 made the model write typed claims about code-detected findings. P4 makes the
code enforce what the prompt only asked for.

## Where text is produced and validated

| Step | File | What it checks |
|---|---|---|
| Findings (what happened) | `src/pipeline/findings.js` | deterministic, ranked; nothing built on contradictory data |
| Claims reply shape | `src/pipeline/claims.js` (`ClaimsReplySchema`, `validateClaims`) | JSON shape, valid finding ids, every claim cites a finding |
| **Claim rules (new)** | `src/pipeline/claim-rules.js` + `lexicon.js` | causality, grounding, undefined terms, direction, data conflicts |
| Rendering | `src/pipeline/claims.js` (`renderReport`) | claims -> existing report fields; code statements for any top finding skipped |
| Global checks (unchanged) | `label-check.js`, `number-check.js` | labels and numbers of the rendered report |
| Fallback | `claims.js` (`buildClaimsFallback`) | report built only from findings |

The **headline** is free text, not a claim. Before P4 it bypassed every check (the CAM-09 Arabic
"campaign performance declined because of ..." sentence was the headline). It is now validated by
the same rules and replaced by the code's own statement of finding 1 when rejected.

## Rules (all in code; identical for Arabic, English and French)

| Code | Rule | Outcome |
|---|---|---|
| `CAUSAL_NOT_HYPOTHESIS` | A cause or a diagnosis ("reflects a defect/weakness", "because of", "led to") is stated as fact | reject; if the wording is already hedged and the claim is not a recommendation, **downgrade to `hypothesis`** (`downgradedFrom` recorded) |
| `HYPOTHESIS_NOT_HEDGED` | A `hypothesis` claim has no hedge (may, might, could, possibly, worth verifying, peut-être, قد...) | reject |
| `UNDEFINED_METRIC` | An observation / interpretation / headline mentions a metric the data does not contain (revenue, profit, price, conversion, customer satisfaction, stock levels...) | reject |
| `UNDEFINED_TERM` | In supervisor / campaign reports, attendance counts are given a population (staff, promoters, employees, Animateurs...). Their definition is not in the API | reject |
| `UNGROUNDED_LABEL` | A claim names a label that does not belong to the findings it cites | reject |
| `UNGROUNDED_NUMBER` | An observation states a figure that is not in the findings it cites | reject |
| `CONTRADICTS_FINDING` | Direction words (below/above, up/down) contradict any finding about the same entity or topic | reject |
| `DATA_CONFLICT_UNACKNOWLEDGED` | An observation/interpretation about a data conflict does not say the data is inconsistent or must be verified | reject |
| `HEADLINE_ORDER` | Supervisor / campaign headline that names adverse topics (attendance, gifts, sales) without naming the **top-priority** one, or names another one first | **drop**: the headline is replaced by the code's statement of finding 1, **without a repair retry** |

**When a cause may be stated as fact (all must be explicit in the data, never inferred):**

1. The claim cites a `KNOWN_CAUSE` finding that belongs to the same entity (or is group-level) **and the sentence names
   that cause's own code** (e.g. `STK-01`). Citing a cause while writing a different explanation is still rejected.
   `KNOWN_CAUSE` comes from the optional request field `data.causes = [{ "label": "S2", "code": "STK-01" }]`.
   The code is **opaque**: the service does not know what it means and never interprets it.
   Without `data.causes` no report can state a cause as fact. Causes for unknown labels are ignored.
2. The claim cites only data-issue findings (the mechanism of a data limitation is known to the
   code), or the sentence explains why a figure cannot be determined because an input is missing,
   zero or undefined ("attainment is unavailable because the target is missing").
3. Arithmetic consequences are not causes: "sold 98 against 100, which led to a gap of 2".

## Handling (pipeline)

- First attempt with any rejection -> **one repair retry** whose hint lists each rule code and where
  (`claim 3 -> CAUSAL_NOT_HYPOTHESIS`). This reuses the existing single retry (never more).
- Final attempt -> the offending claims (or headline) are **removed**, never shown. The AI report is
  still delivered from the remaining claims plus code statements for any top finding left uncovered.
  The report is **not** replaced by the fallback for a claim-rule violation.
- **Recommendations are never lost to a rejection (D9).** If the model's recommendation(s) were removed and none remains, the
  code adds, for the finding each removed recommendation was about (at most 3, one per finding), a neutral "review it" action
  (`Review the performance of S2 against its target.`, `Review the distribution of the remaining gifts.`, `Verify the source data.`).
  It states no cause, figure or new fact and is marked `source: "code"`. If the model wrote no recommendation, none is added.
- `output.insights.rejected` lists `{ reason, kind }` for each removed claim (and the dropped headline, `kind: "headline"`) (the removed text is
  never exposed). `output.insights.claims[].downgradedFrom` marks a downgrade.
- Global label and number checks still run on the rendered report (defence in depth). They still
  send the whole report to the fallback when they fail.
- `OUTPUT_MODE=legacy` is untouched: no claim rules, no `insights`.

## Optional input added (additive, no obligation for the backend)

`data.causes`: array of `{ label?: string, code: string }`. Strings must satisfy the existing PII
firewall (short codes such as `S2`, `STK-01`). Free-text causes are not accepted by design.

## Prompt

`prompt-v5` adds: causes only as hedged hypotheses (also in the headline), only `KNOWN_CAUSE` allows a
fact; no invented metrics or roles for attendees; labels and figures only from cited findings; data
conflicts must be called inconsistent. The prompt is a request, the rules above are the guarantee.

## Known limits

- **Hedge scope:** a hedge only counts in the same clause as the causal wording ("because of weak promotion, which may be
  fixed" is still an asserted cause). A bare "if" / "si" / "إذا" is not a hedge.
- **Attendance role policy** (same in EN, AR, FR): explicit population nouns (staff, employees, promoters, team members,
  Animateurs, موظفين, employés...) are rejected; a bare "team" is allowed. This is a default pending the business
  definition of who attends.
- **Missing share:** attendance findings carry `missingPct`, so "a 20 percent shortfall" is a supported figure.
- The rules are **lexical**. A cause worded with vocabulary not in `lexicon.js` is missed (for
  example the bare verb "causes"; this is a documented false negative, see the tests). A new
  language or phrasing needs new entries.
- `UNDEFINED_TERM` encodes a proposal ("attendance is of unspecified attendees"). If the business
  defines who attends, remove `animateurs?` from `ROLE_TERMS` for that case.
- The direction rule judges one entity per clause; comparisons across entities in one clause are not
  judged. "Respectively" constructions are not paired.
- A claim that is accurate but cites the wrong finding is rejected (`UNGROUNDED_*`); the repair and
  code statements recover the content, at the cost of some repairs.
- Hedge detection is word-based; a hedge word elsewhere in the sentence turns a cause into a
  downgraded hypothesis even if it does not modify the cause.
- Interpretations that restate arithmetic with new framing are not detected unless they use the
  listed vocabulary.

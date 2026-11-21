// confidence = data completeness x generation factor. Numeric, 3 decimals, [0, 1].
//   'first_pass' -> 1     Qwen output accepted on the first attempt
//   'repaired'   -> 0.85  Qwen output accepted only after the repair retry
//   'fallback'   -> 0     deterministic template: NOT AI output, so it gets no
//                         AI confidence at all (false/anything else = fallback)
export function computeConfidence(completeness, state) {
  const c = Math.min(1, Math.max(0, Number(completeness) || 0));
  let factor = 0;
  if (state === true || state === 'first_pass') factor = 1;
  else if (state === 'repaired') factor = 0.85;
  return Math.round(c * factor * 1000) / 1000;
}

// English / Arabic / French word lists used by the deterministic claim rules.
//
// These are HEURISTICS. They are deliberately conservative: a rule fires only
// on explicit vocabulary, so a miss is possible (a cause worded in a way not
// listed) but a false rejection of plain arithmetic ("20 below target") is
// avoided. They are intentionally separate from the offline judge's lexicon
// (eval/lexicon.mjs) so the validator and the evaluator stay independent.
// Arabic diacritics are stripped (stripMarks) and digits normalised before
// matching. Arabic has no \b, so boundaries use explicit Arabic-letter lookarounds.

const AR_L = '\\u0600-\\u06FF';
// Arabic attaches prefixes (ال، ب، و، ل...) and suffixes (ا، ة، ات، ين...) to words, so a plain
// boundary misses inflected forms such as "خللاً". `affixes` tolerates them for noun lists
// (diagnostics, metrics, roles). Causal connectors stay strict: "النتيجة" ("the result") is not "نتيجة" as a connector.
const arWord = (s, affixes = false) => affixes
  ? `(?<![${AR_L}])(?:وال|بال|لل|ال|و|ف|ب|ل|ك){0,2}(?:${s})(?:ات|ين|ون|ان|ها|هم|ا|ة|ه){0,1}(?![${AR_L}])`
  : `(?<![${AR_L}])(?:${s})(?![${AR_L}])`;

export const stripMarks = (text) => String(text).replace(/[ً-ْـ]/g, '');

export const normDigits = (text) =>
  stripMarks(text)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/٪/g, '%');

// Explicit causal connectors and verbs: "X happened because of Y".
export const CAUSAL = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:because|due to|caused|causing|owing to|as a result of|led to|leading to|leads to|resulted in|results in|attributable to|attributed to|driven by|stems? from|explained by|explains why|responsible for|thanks to|on account of)(?![\\p{L}\\p{N}_])',
  arWord('بسبب|نتيجة|ناجم|ناتج|جراء|يعود إلى|يعزى|يرجع إلى|أدى إلى|يؤدي إلى|تسبب|بفضل'),
  '(?<![\\p{L}\\p{N}_])(?:parce que|car|en raison (?:de|du|des)|à cause (?:de|du|des)|dû à|due à|dus à|grâce à|causé par|causée par|a entraîné|entraîne|résulte|provoque|a provoqué|imputable à|explique pourquoi)(?![\\p{L}\\p{N}_])',
  // elided forms: "à cause d'une", "en raison d'un" (the next character is a letter, so no end boundary)
  '(?<![\\p{L}\\p{N}_])(?:en raison|à cause) d[\'’]',
].join('|'), 'iu');

// "Sold 98 against a target of 100, which led to a gap of 2" restates arithmetic: the effect is the
// gap/shortfall computed from the very figures in the sentence, not a business cause.
const CAUSAL_ALL = new RegExp(CAUSAL.source, 'giu');
const VERBAL_EFFECT = /^(?:led to|leading to|leads to|resulted in|results in|أدى إلى|يؤدي إلى|a entraîné|entraîne)$/iu;
const ARITH_EFFECT = /(?:gap|shortfall|difference|deficit|attainment|absence|absent|missing|فجوة|عجز|فارق|نسبة تحقق|نسبة التحقق|غياب|écart|déficit|absence)/iu;
// "Due to the missing target, attainment cannot be determined": the cause is a data limitation
// (the connector is followed by a missing / zero / undefined input AND the sentence says something
// cannot be determined). "Because of missing stock" is a business cause and is NOT exempt.
const LIMIT_CAUSE = /(?:missing|absent|undefined|zero|unavailable|not (?:available|provided|supplied)|مفقود|غير متاح|غير معرف|صفر|manquant|indisponible|zéro)/iu;
const LIMIT_EFFECT = /(?:cannot|can't|unavailable|not (?:be )?(?:determined|computed|calculated|assessed|available)|undefined|لا يمكن|غير متاح|impossible|indisponible)/iu;
// `whole` is the full text: the "cannot be determined" part of a data-limitation sentence may sit in
// another clause than the connector.
export function hasCausal(text, whole = text) {
  for (const m of text.matchAll(CAUSAL_ALL)) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (VERBAL_EFFECT.test(m[0]) && ARITH_EFFECT.test(rest)) continue;
    if (LIMIT_CAUSE.test(text.slice(m.index + m[0].length, m.index + m[0].length + 30)) && LIMIT_EFFECT.test(whole)) continue;
    return true;
  }
  return false;
}

// Diagnosis stated as fact without a causal connector: "reflects a defect in execution".
export const DIAGNOSTIC = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:weakness(?:es)?|defects?|flaws?|inefficienc(?:y|ies)|deficienc(?:y|ies)|mismanagement|poor (?:execution|performance|management|coordination|planning|training)|operational (?:issues?|problems?|failures?|constraints?)|execution (?:problems?|issues?|failures?)|lack of (?:training|motivation|coordination|resources|supervision|stock))(?![\\p{L}\\p{N}_])',
  `${arWord('خلل|قصور|ضعف في|ضعف الأداء|ضعف|سوء الإدارة|سوء التنفيذ|سوء التخطيط|عدم كفاءة|نقص في التدريب|نقص في الكفاءة|مشكلة في التنفيذ|مشكلة في التوزيع', true)}`,
  '(?<![\\p{L}\\p{N}_])(?:faiblesses?|défaillances?|dysfonctionnements?|défauts?|inefficacité|mauvaise (?:exécution|gestion|coordination)|manque de (?:formation|motivation|coordination|ressources))(?![\\p{L}\\p{N}_])',
].join('|'), 'iu');

// A hedge turns a cause into a hypothesis ("may", "possibly", "worth verifying").
export const HEDGE = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:may|might|could|possibly|perhaps|likely|probably|possible|potentially|appears?|seems?|suggests?|hypothes\\p{L}+|worth (?:verifying|investigating|checking)|to (?:verify|investigate|confirm)|verify whether|check whether)(?![\\p{L}\\p{N}_])',
  `${arWord('قد|ربما|محتمل|يحتمل|يبدو|يرجح|الأرجح|من الممكن|ممكن|للتحقق|يستحق التحقق|فرضية')}|يستحق`,
  '(?<![\\p{L}\\p{N}_])(?:peut-être|pourrait|pourraient|peut|probablement|semble|il se peut|possible|éventuellement|hypothèses?|à vérifier|à confirmer)(?![\\p{L}\\p{N}_])',
].join('|'), 'iu');

// Metrics the service has no data for. Stating one as a fact invents a metric.
export const UNDEFINED_METRIC = new RegExp([
  "(?<![\\p{L}\\p{N}_])(?:revenues?|income|profits?|margins?|pric(?:e|es|ing)|costs?|conversion|conversion rates?|market share|roi|return on investment|customer satisfaction|satisfaction|churn|retention|stock-?outs?|out of stock|inventory levels?|stock levels?)(?![\\p{L}\\p{N}_])",
  `${arWord('إيرادات|إيراد|ربح|أرباح|هامش|سعر|أسعار|تكلفة|تكاليف|تحويل|معدل التحويل|حصة سوقية|رضا العملاء|نفاد المخزون', true)}`,
  "(?<![\\p{L}\\p{N}_])(?:chiffre d'affaires|revenus?|bénéfices?|marges?|prix|coûts?|coût|taux de conversion|conversion|part de marché|satisfaction client|rupture de stock|niveaux? de stock)(?![\\p{L}\\p{N}_])",
].join('|'), 'iu');

// Attendance counts have no stated population. Naming one invents a definition.
export const ROLE_TERMS = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:promoters?|staff|employees?|workers?|personnel|workforce|team members?|salespeople|agents?|animateurs?|work team|members of the team)(?![\\p{L}\\p{N}_])',
  `${arWord('مروجين|مروج|موظفين|موظف|عاملين|طاقم|فريق العمل|فريق عمل|أعضاء الفريق', true)}`,
  '(?<![\\p{L}\\p{N}_])(?:promoteurs?|employés?|effectifs|agents?|animateurs?|membres de l[\'’]équipe|équipe de travail)(?![\\p{L}\\p{N}_])',
].join('|'), 'iu');

// Direction vocabulary (claim vs finding contradiction).
export const TARGET_WORD = new RegExp(`(?<![\\p{L}\\p{N}_])(?:target|quota|objectif)(?![\\p{L}\\p{N}_])|${arWord('هدف|الهدف|هدفه|الأهداف')}`, 'iu');
export const SALES_WORD = new RegExp(`(?<![\\p{L}\\p{N}_])(?:sales|units|sold|ventes|unités)(?![\\p{L}\\p{N}_])|${arWord('مبيعات|المبيعات|وحدة|وحدات')}`, 'iu');
export const BELOW = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:below|short of|shortfall|missed|misses|under|behind|lagging|underperform\\p{L}*|falls? short|fell short)(?![\\p{L}\\p{N}_])',
  `${arWord('أقل|دون الهدف|دون هدف|متأخر|يقل|عجز|تأخر', true)}`,
  "(?<![\\p{L}\\p{N}_])(?:en dessous|sous l'objectif|inférieur\\p{L}*|en retard|déficit|manque)(?![\\p{L}\\p{N}_])",
].join('|'), 'iu');
export const ABOVE = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:exceed\\p{L}*|above|surpass\\p{L}*|ahead of|beat|beats|outperform\\p{L}*|over-?achiev\\p{L}*)(?![\\p{L}\\p{N}_])',
  `${arWord('تجاوز|فاق|تخطى|يفوق|فوق', true)}`,
  '(?<![\\p{L}\\p{N}_])(?:dépassé\\p{L}*|dépasse\\p{L}*|au-dessus|supérieur\\p{L}*)(?![\\p{L}\\p{N}_])',
].join('|'), 'iu');
export const UP = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:up|increase\\p{L}*|rise|rose|risen|grew|growth|higher|improv\\p{L}*)(?![\\p{L}\\p{N}_])',
  `${arWord('ارتفع|ارتفاع|زاد|زيادة|نمو|تحسن', true)}`,
  '(?<![\\p{L}\\p{N}_])(?:augment\\p{L}*|hausse|progression|croissance)(?![\\p{L}\\p{N}_])',
].join('|'), 'iu');
export const DOWN = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:down|decreas\\p{L}*|declin\\p{L}*|drop\\p{L}*|fell|fall|lower)(?![\\p{L}\\p{N}_])',
  `${arWord('انخفض|انخفاض|تراجع|هبط', true)}`,
  '(?<![\\p{L}\\p{N}_])(?:baisse|diminu\\p{L}*|recul|chute)(?![\\p{L}\\p{N}_])',
].join('|'), 'iu');
export const NEGATION = new RegExp([
  "(?<![\\p{L}\\p{N}_])(?:not|never|no|without)(?![\\p{L}\\p{N}_])|n't",
  arWord('لم|لا|ليس|دون أي'),
  "(?<![\\p{L}\\p{N}_])(?:ne|pas|jamais|sans)(?![\\p{L}\\p{N}_])|n'",
].join('|'), 'iu');

// A claim about a data conflict must say so.
export const DQ_ACK = new RegExp([
  '(?<![\\p{L}\\p{N}_])(?:inconsisten\\p{L}*|invalid|impossible|missing|unavailable|not available|undefined|cannot be|can\'t be|conflict\\p{L}*|error|suspicious|unreliable|unusual|implausible|duplicate\\p{L}*|verif\\p{L}*|incorrect|anomal\\p{L}*|negative|mis-?scaled|out of range|exceeds? (?:the )?(?:expected|planned|plan))(?![\\p{L}\\p{N}_])',
  `${arWord('غير متسق|غير متسقة|تعارض|تناقض|ناقص|مفقود|غير متاح|غير متاحة|مشكوك|غير منطقي|غير صالح|خطأ|أخطاء|مكرر|تكرار|تحقق|تأكد|سالب|سلبية|غير موثوق|غير موثوقة|مستحيل|يتجاوز|خارج النطاق', true)}|غير متسق|غير موثوق`,
  '(?<![\\p{L}\\p{N}_])(?:incohérent\\p{L}*|invalide|impossible|manquant\\p{L}*|indisponible|conflit|erreur|suspect\\p{L}*|doublon\\p{L}*|vérifi\\p{L}*|négatif\\p{L}*|hors plage|dépasse)(?![\\p{L}\\p{N}_])',
].join('|'), 'iu');

// Business topics a supervisor / campaign headline may name. Used only to read the ORDER in which a headline
// mentions them (D11); Unicode-aware boundaries, Arabic with affixes.
export const TOPIC_WORDS = {
  attendance: new RegExp([
    '(?<![\\p{L}\\p{N}_])(?:attendance|attendees?|present|absent|absence|turnout)(?![\\p{L}\\p{N}_])',
    arWord('حضور|غياب', true),
    '(?<![\\p{L}\\p{N}_])(?:présence|présences|présents?|absents?|absence)(?![\\p{L}\\p{N}_])',
  ].join('|'), 'iu'),
  gifts: new RegExp([
    '(?<![\\p{L}\\p{N}_])(?:gifts?|giveaways?)(?![\\p{L}\\p{N}_])',
    arWord('هدية|هدايا', true),
    '(?<![\\p{L}\\p{N}_])(?:cadeaux?)(?![\\p{L}\\p{N}_])',
  ].join('|'), 'iu'),
  sales: new RegExp([
    '(?<![\\p{L}\\p{N}_])(?:sales|units|sold)(?![\\p{L}\\p{N}_])',
    arWord('مبيعات|وحدات|وحدة', true),
    '(?<![\\p{L}\\p{N}_])(?:ventes?|unités?)(?![\\p{L}\\p{N}_])',
  ].join('|'), 'iu'),
};

export const LABEL_TOKEN = /(?<![A-Za-z0-9])[A-Z]{1,4}[-_]?\d+(?:[-_][A-Za-z0-9]+)*(?![A-Za-z0-9])/g;
export const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

// Sentence / clause splitters. Do not split decimals (84.5) or thousands (1,250).
export const SENTENCE_SPLIT = /(?<!\d)\.(?=\s|$)|[;؛!?؟]/;
export const CLAUSE_SPLIT = /\.(?=\s|$)|,(?!\d)|[;،؛]|\b(?:while|whereas|but|versus|and|mais|tandis que)\b|بينما|لكن/i;

// A hedge only turns a cause into a hypothesis when it is in the SAME clause as the causal wording.
// "because of weak promotion, which may be fixed next month" keeps the cause asserted.
// Returns { causal, hedged }: causal = some clause asserts a cause or diagnosis;
// hedged = every such clause also contains a hedge word.
export function causalStatus(text, { diagnostics = true } = {}) {
  const clauses = text.split(CLAUSE_SPLIT).map((c) => c?.trim()).filter(Boolean);
  const flagged = clauses.filter((c) => hasCausal(c, text) || (diagnostics && DIAGNOSTIC.test(c)));
  return { causal: flagged.length > 0, hedged: flagged.length > 0 && flagged.every((c) => HEDGE.test(c)) };
}

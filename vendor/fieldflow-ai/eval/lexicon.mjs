// English / Arabic lexicons used by the judge. These are HEURISTICS: they are
// deliberately narrow (few false positives) and are validated by the crafted
// good/bad outputs in tests/eval.test.js. They are not a language model.

export const normDigits = (text) =>
  String(text)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/٪/g, '%');

// Arabic diacritics (tashkeel) and tatweel are removed before any lexicon test.
export const stripMarks = (text) => String(text).replace(/[ً-ْـ]/g, '');

export const LABEL_TOKEN = /(?<![A-Za-z0-9])[A-Z]{1,4}[-_]?\d+(?:[-_][A-Za-z0-9]+)*(?![A-Za-z0-9])/g;
export const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

export const TOPICS = {
  attendance: /attendance|present|absent|turnout|حضور|الحضور|حضر|غياب|غاب/i,
  gifts: /gift|هدايا|هدية|الهدايا/i,
  sales: /sales|units|sold|مبيعات|المبيعات|وحدة|وحدات/i,
  target: /target|quota|هدف|الهدف|أهداف/i,
  visits: /visit|زيارة|زيارات|الزيارات/i,
  trend: /period|trend|declin|increas|growth|فترة|الفترة|اتجاه|انخفاض|ارتفاع|تراجع/i,
};

export const TARGET_WORD = /target|quota|هدف|الهدف/i;
export const BELOW = /\b(?:below|short of|shortfall|missed|misses|under|behind|lagging|underperform\w*|falls? short|fell short)\b|أقل|دون الهدف|دون هدف|متأخر|يقل|نقص|عجز|تأخر/i;
export const ABOVE = /\b(?:exceed\w*|above|surpass\w*|ahead of|beat|beats|outperform\w*|over-?achiev\w*)\b|تجاوز|فاق|تخطى|يفوق|فوق/i;
// JavaScript \b only knows ASCII word characters, so Arabic negations need explicit Arabic-letter lookarounds.
export const NEGATION = /\b(?:not|never|no|without)\b|n't|(?<![؀-ۿ])(?:لم|لا)(?![؀-ۿ])|(?<![؀-ۿ])ليس/i;
export const UP = /\b(?:up|increase\w*|rise|rose|risen|grew|growth|higher|improv\w*)\b|ارتفع|ارتفاع|زاد|زيادة|نمو|تحسن/i;
export const DOWN = /\b(?:down|decreas\w*|declin\w*|drop\w*|fell|fall|lower|decrease)\b|انخفض|انخفاض|تراجع|هبط|نقص/i;
export const SALES_WORD = /sales|units|مبيعات|المبيعات|وحدة|وحدات/i;
export const TOP_WORD = /\b(?:top|best|highest|leading|leader|strongest)\b|تصدر|الأعلى|الأفضل|الأقوى/i;
export const BOTTOM_WORD = /\b(?:lowest|worst|weakest|bottom)\b|الأدنى|الأضعف|الأقل/i;

export const CAUSAL = /\b(?:because|due to|caused by|owing to|as a result of|the reason|thanks to|on account of)\b|بسبب|نتيجة|ناجم|ناتج|يعود|السبب|(?<![؀-ۿ])جراء/i; // not "إجراءات" (actions)
export const HEDGE = /\b(?:may|might|could|possibly|perhaps|likely|possible|possibly|potential|potentially|appears?|seems?|suggests?|hypothes\w+|verify|investigate|check whether|worth|to confirm|if)\b|قد |ربما|محتمل|يحتمل|يبدو|ممكن|الممكن|يرجح|تحقق|للتحقق|فرضية|استقصاء|إذا/i;

export const DQ_ACK = /\b(?:data (?:quality|issue|problem|conflict|error|looks?)|inconsistent|inconsistency|invalid|impossible|missing|unavailable|not available|not provided|undefined|cannot be|can't be|conflict\w*|error|suspicious|unreliable|unusual|implausible|duplicate\w*|verify|check the data|incorrect|anomal\w*|exceeds? (?:the )?expected|negative|no target|target setting|zero target|target of 0)\b|سلبية|سلبي|هدف صفر|بدون هدف|بيانات غير|غير متسق|تعارض|ناقص|مفقود|غير متاح|غير متوفر|غير معرّف|غير محدد|مشكوك|غير منطقي|غير صالح|خطأ|أخطاء|مكرر|تكرار|تحقق|التحقق|سالب|غير موثوق|مستحيل|غير معقول/i;

// Sentences that explain a data limitation (why a figure is unavailable or unreliable).
export const DATA_MECHANICS = /\b(?:unavailable|not available|zero|missing|invalid|negative|denominator|cannot be (?:computed|calculated)|can't be (?:computed|calculated)|requires? verification|needs? verification|unreliable|inconsistent|inconsistency|data conflict|conflicting data|absence of|lack of|no data)\b|غير متاح|غير متسق|غير متسقة|غياب بيانات|عدم توفر|عدم وجود|صفر|مفقود|سالب|سلبي|المقام|لا يمكن حساب|يحتاج إلى تحقق|غير موثوق/i;

export const PREMATURE_VERDICT = /\b(?:failed|will not|won't|will miss|cannot reach|has missed|missed the target)\b|لن يحقق|فشل|أخفق|لن تحقق/i;

export const PII = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
  /https?:\/\//,
];

// Trade terms must stay in Latin script, so their Arabic renderings are errors.
export const ARABIC_TRADE_TERMS = /أنيماتور|الأنيماتور|أنيماتير|مشرف|المشرف|نقطة بيع|نقاط البيع|نقطة البيع/;

export const ARABIC_LETTER = /[؀-ۿ]/g;
export const LATIN_LETTER = /[A-Za-z]/g;

// Sentence/clause splitter. Does not split decimals (84.5) or thousands (1,250).
export const CLAUSE_SPLIT = /\.(?=\s|$)|,(?!\d)|[;،؛]|\b(?:while|whereas|but|versus|and)\b|بينما|لكن/i;

// [English, Arabic] pairs for the command palette. Kept beside the palette (a lazy chunk) instead of in
// common.json so the shared bundle every surface loads - including /field - stays small.
export const messages = {
  title: ['Jump to', 'انتقال سريع'],
  placeholder: [
    'Search campaigns, stores, people, pages…',
    'ابحث في الحملات ونقاط البيع والأشخاص والصفحات…',
  ],
  pages: ['Pages', 'الصفحات'],
  campaigns: ['Campaigns', 'الحملات'],
  stores: ['Points de vente', 'نقاط البيع'],
  users: ['People', 'الأشخاص'],
  empty: [
    'Nothing matches. Try a campaign name, a store code or a colleague.',
    'لا توجد نتائج. جرّب اسم حملة أو رمز نقطة بيع أو اسم زميل.',
  ],
  loading: ['Searching…', 'جارٍ البحث…'],
  hint: ['↑ ↓ to move · Enter to open · Esc to close', '↑ ↓ للتنقل · Enter للفتح · Esc للإغلاق'],
  results: ['{{count}} results', '{{count}} نتيجة'],
};

# FieldFlow — حزمة البدء

ضع محتوى هذا المجلد في جذر مستودع Git فارغ، ثم افتح Claude Code من هذا الجذر.

```
CLAUDE.md                         ← ذاكرة المشروع: يقرؤها Claude تلقائياً في كل جلسة
docs/01-business-analysis.md      ← المرحلة 1 (القواعد BR و FR والحالات الاستثنائية)
docs/04-database-design.md        ← المرحلة 4 (تصميم قاعدة البيانات المعتمد)
prompts/prompt-01-project-setup.md
prompts/prompt-02-database.md
prompts/prompt-review.md          ← مراجعة الكود بعد كل وحدة، في جلسة جديدة
```

## طريقة العمل

1. انسخ محتوى `prompt-01` (ما تحت الخط) والصقه في Claude Code.
2. عندما يسلّم التقرير، شغّل أوامر التحقق في قسم Acceptance Criteria بنفسك.
3. افتح **جلسة جديدة** والصق `prompt-review.md` مع اسم الـ Prompt المنفَّذ.
4. أصلح الملاحظات الحرجة والكبيرة، ثم اعمل commit.
5. انتقل إلى `prompt-02` بنفس الطريقة.

ملاحظة: `prompt-02` يبدأ بخطوة تحقق (Step 0) لأن Prisma 7 يولّد كود TypeScript افتراضياً. إذا توقف
Claude هناك وطلب قراراً، أرسل لي تقريره قبل المتابعة.

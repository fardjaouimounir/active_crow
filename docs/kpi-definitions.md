# KPI definitions

All counts exclude voided sales and voided absences. Dates are Algiers work dates.

1. **Expected slots** = `expectedCheckpoints` over the period (approved assignments × work days × checkpoints of the rule effective that day, campaign `active` that day) **minus** slots covered by a justified absence.
2. **Attendance rate** = slots with a record in `verified` ÷ expected slots. Also return **submitted rate** (`pending` + `verified`) and counts per `slotStatus`, and **late share** = late records ÷ records.
3. **Sales volume** = sum of units of `recorded` sales; **sales count** = number of `recorded` sales.
4. **Buyers** = distinct identified customers + anonymous sales (BR-34). **Customer reach** = buyers + sum of `field_interactions.count`. **Conversion rate** = buyers ÷ reach (null when reach = 0).
5. **Gift distribution** = distributed units ÷ entitled units (entitlements not `cancelled`); plus undelivered units and the "to review" count (delivered gifts of voided sales).
6. **Supervisor visits** = visits count; **store coverage** = distinct stores visited ÷ distinct stores with an approved assignment in the period.
7. **Campaign completion** = elapsed working days ÷ planned working days of the campaign; **target achievement** = sales volume ÷ `sales_target` (and interactions ÷ `sampling_target`) when the rule defines one, using the target unit/period of the rule — read the schema and document how per-day / per-Animateur targets are aggregated.
8. **Stock** (from the existing reconciliation, never recomputed differently): stock-in, distributed to customers, losses, returned to client, physical remaining, failing checks count.

A zero denominator produces a blank ratio. Targets add the effective daily units or samples once per visible Animateur assignment work day while the campaign is active, up to and including today. Product breakdowns use each product's own daily target. Buyers are deduplicated independently in each group. Planned days count distinct scheduled campaign work dates across the eligible campaigns, and elapsed days count those through the earlier of today or the report end. Attendance status counts retain saved checkpoints from earlier rule versions. The rate numerators use expected slots. Stock is a current reconciliation snapshot for eligible campaigns. Geographic and staff filters suppress unattributable stock balances. For regional managers and supervisors, the current snapshot is limited to holders visible in both the inventory view and the reporting tree today.

## تعريف المؤشرات

تُحسب تواريخ العمل بتوقيت الجزائر. تُستبعد المبيعات والغيابات الملغاة، وتظهر الهدايا المسلّمة عن المبيعات الملغاة في عداد المراجعة.

1. **فترات الحضور المتوقعة** هي نقاط الحضور في أيام التكليف المعتمد وفق القاعدة السارية والحملة النشطة، بعد طرح الفترات التي يغطيها غياب مبرر.
2. **معدل الحضور** هو المؤكد ÷ المتوقع. **معدل الإرسال** هو قيد المراجعة والمؤكد ÷ المتوقع. تُعرض الأعداد حسب حالة الفترة و**نسبة التأخير** هي السجلات المتأخرة ÷ جميع السجلات.
3. **حجم المبيعات** هو مجموع وحدات المبيعات المسجلة، و**عدد المبيعات** هو عدد عمليات البيع المسجلة.
4. **المشترون** هم الزبائن المعرّفون دون تكرار مضافًا إليهم عدد المبيعات المجهولة. **الوصول** هو المشترون مضافًا إليهم مجموع التفاعلات. **معدل التحويل** هو المشترون ÷ الوصول.
5. **توزيع الهدايا** هو الوحدات الموزّعة ÷ الوحدات المستحقة غير الملغاة. يُعرض أيضًا عدد الوحدات غير المسلّمة وعدد هدايا المبيعات الملغاة التي تتطلب مراجعة.
6. **زيارات المشرف** هي عدد الزيارات. **تغطية نقاط البيع** هي النقاط التي تلقت زيارة ÷ النقاط ذات تكليف معتمد في الفترة، مع احتساب كل نقطة مرة واحدة.
7. **تقدّم الحملة** هو أيام العمل المنقضية ÷ أيام العمل المجدولة. **تحقيق الهدف** هو حجم المبيعات ÷ هدف المبيعات، والتفاعلات ÷ هدف العينات. يُحتسب الهدف اليومي الساري لكل منشط عن كل يوم عمل في تكليف مشمول والحملة نشطة حتى اليوم. يُستخدم الهدف الخاص بالمنتج عند التجميع حسب المنتج.
8. **المخزون** يأتي من لقطة التسوية الحالية ويشمل الوارد، والموزّع للزبائن، والفاقد، والمُعاد للعميل، والمتبقي الفعلي، وعدد حالات فشل التحقق.

تُعرض النسبة فارغة عندما يساوي المقام صفرًا. يُزال تكرار المشترين داخل كل مجموعة على حدة. تُحتسب أيام العمل المجدولة على امتداد الحملات المشمولة، والمنقضية حتى نهاية التقرير أو اليوم، أيهما أسبق. تحتفظ عدادات حالات الحضور بالنقاط المسجّلة بإصدارات سابقة من القاعدة، وتستخدم النسب الفترات المتوقعة. يقتصر المخزون على الأرصدة التي يمكن نسبتها إلى نطاق التقرير.

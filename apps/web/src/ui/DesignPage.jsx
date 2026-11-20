import { Gift, Info } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Breadcrumbs,
  EmptyState,
  KpiStrip,
  KpiTile,
  Pagination,
  SortHeader,
  Stepper,
  TabStrip,
  TableFrame,
  Timeline,
  TimelineStep,
  tableClass,
} from './data.jsx';
import { IconButton, ThemeToggle } from './controls.jsx';
import { chartAxis, chartGrid, chartSeries } from './chartTheme.js';
import {
  ConfirmDialog,
  Dialog,
  Drawer,
  Popover,
  ToastProvider,
  Tooltip,
  useToast,
} from './overlays.jsx';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  DateRange,
  Delta,
  ForwardArrow,
  Input,
  LogoMark,
  Radio,
  SelectControl,
  Skeleton,
  Switch,
  Textarea,
  Wordmark,
} from './primitives.jsx';

/*
 * Dev-only kit review page (route /app/_design, not registered in production builds).
 * Every component is rendered in four specimens: dark/light × LTR/RTL, so a reviewer can check
 * contrast, mirroring and density in one scroll. Copy is inline EN/AR because this page never ships.
 */
const COPY = {
  en: {
    buttons: 'Buttons',
    fields: 'Form controls',
    status: 'Status pills',
    table: 'Table',
    nav: 'Navigation',
    overlays: 'Overlays',
    kpi: 'KPI strip',
    empty: 'Empty state',
    charts: 'Charts',
    chain: 'Sale chain',
    primary: 'Save campaign',
    secondary: 'Export Excel',
    ghost: 'Cancel',
    danger: 'Cancel campaign',
    loading: 'Loading…',
    name: 'Campaign name',
    note: 'Notes for the supervisor',
    wilaya: 'Wilaya',
    algiers: 'Algiers',
    oran: 'Oran',
    checkbox: 'Gifts are shared by the client',
    switch: 'Send daily summary',
    from: 'From',
    to: 'To',
    good: 'Verified',
    warn: 'Pending',
    bad: 'Rejected',
    info: 'Justified absence',
    neutral: 'Not sent',
    accent: 'AI-generated',
    store: 'Point de Vente',
    units: 'Units',
    sales: 'Sales',
    rows: [
      ['Ardis Hydra', 'Hydra, Algiers', 128],
      ['Uno Bab Ezzouar', 'Bab Ezzouar, Algiers', 94],
      ['Carrefour Oran', 'Oran', 61],
    ],
    tabs: ['Overview', 'Coverage', 'Sales'],
    crumbs: ['Campaigns', 'Ramadan 2027', 'Sales'],
    steps: ['Planning', 'Assigned', 'Active', 'Completed', 'Closed'],
    openDialog: 'Open dialog',
    openDrawer: 'Open drawer',
    openPopover: 'Open popover',
    toast: 'Show toast',
    tip: 'Shown on hover and focus',
    dialogBody: 'Close the campaign? Stock must be reconciled first.',
    toastText: 'Campaign saved.',
    emptyTitle: 'No campaign yet',
    emptyBody: 'Create the first campaign for this client to start assigning crews.',
    sale: 'Sale',
    gifts: 'Gift entitlements',
    delivery: 'Delivery movement',
    tombola: 'Tombola',
    previous: 'vs last week',
    chartSales: 'Sales per day',
  },
  ar: {
    buttons: 'الأزرار',
    fields: 'عناصر النماذج',
    status: 'شارات الحالة',
    table: 'الجدول',
    nav: 'التنقل',
    overlays: 'النوافذ المنبثقة',
    kpi: 'مؤشرات الأداء',
    empty: 'حالة فارغة',
    charts: 'المخططات',
    chain: 'سلسلة البيع',
    primary: 'حفظ الحملة',
    secondary: 'تصدير إكسل',
    ghost: 'إلغاء',
    danger: 'إلغاء الحملة',
    loading: 'جارٍ التحميل…',
    name: 'اسم الحملة',
    note: 'ملاحظات للمشرف',
    wilaya: 'الولاية',
    algiers: 'الجزائر',
    oran: 'وهران',
    checkbox: 'الهدايا يوفّرها العميل',
    switch: 'إرسال الملخص اليومي',
    from: 'من',
    to: 'إلى',
    good: 'تم التحقق',
    warn: 'قيد المراجعة',
    bad: 'مرفوض',
    info: 'غياب مبرَّر',
    neutral: 'لم يُرسل',
    accent: 'مُولَّد بالذكاء الاصطناعي',
    store: 'نقطة البيع',
    units: 'الوحدات',
    sales: 'المبيعات',
    rows: [
      ['أردیس حيدرة', 'حيدرة، الجزائر', 128],
      ['أونو باب الزوار', 'باب الزوار، الجزائر', 94],
      ['كارفور وهران', 'وهران', 61],
    ],
    tabs: ['نظرة عامة', 'التغطية', 'المبيعات'],
    crumbs: ['الحملات', 'رمضان 2027', 'المبيعات'],
    steps: ['تخطيط', 'مُسنَدة', 'نشطة', 'مكتملة', 'مغلقة'],
    openDialog: 'فتح نافذة',
    openDrawer: 'فتح لوحة جانبية',
    openPopover: 'فتح قائمة',
    toast: 'عرض إشعار',
    tip: 'يظهر عند التمرير والتركيز',
    dialogBody: 'إغلاق الحملة؟ يجب مطابقة المخزون أولاً.',
    toastText: 'تم حفظ الحملة.',
    emptyTitle: 'لا توجد حملة بعد',
    emptyBody: 'أنشئ أول حملة لهذا العميل لبدء إسناد الفرق.',
    sale: 'عملية بيع',
    gifts: 'استحقاقات الهدايا',
    delivery: 'حركة التسليم',
    tombola: 'السحب (تومبولا)',
    previous: 'مقارنة بالأسبوع الماضي',
    chartSales: 'المبيعات اليومية',
  },
};

const days = ['01', '02', '03', '04', '05', '06', '07'];
const series = days.map((day, index) => ({
  day,
  sales: [12, 18, 15, 26, 31, 28, 40][index],
  absent: [2, 1, 3, 1, 0, 2, 1][index],
}));

function Specimen({ theme, dir }) {
  const copy = COPY[dir === 'rtl' ? 'ar' : 'en'];
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState(null);
  const [sort, setSort] = useState('asc');
  const [range, setRange] = useState({ from: '2027-02-10', to: '2027-03-12' });
  const [on, setOn] = useState(true);
  const tabs = ['overview', 'coverage', 'sales'].map((value, index) => ({
    value,
    label: copy.tabs[index],
  }));
  const steps = ['planning', 'assigned', 'active', 'completed', 'closed'].map((key, index) => ({
    key,
    label: copy.steps[index],
  }));
  const section = (title, children) => (
    <section className="space-y-3 border-t border-line pt-5">
      <h3 className="text-xs font-medium tracking-wider text-fg-3 uppercase">{title}</h3>
      {children}
    </section>
  );
  return (
    <div
      data-theme={theme}
      dir={dir}
      lang={dir === 'rtl' ? 'ar' : 'en'}
      className="min-w-0 space-y-5 rounded-lg border border-line bg-canvas p-5 text-fg"
    >
      <div className="flex items-center gap-2.5">
        <LogoMark size={28} />
        <Wordmark className="text-lg" />
        <span className="ms-auto text-xs text-fg-3">
          {theme} · {dir}
        </span>
      </div>

      {section(
        copy.buttons,
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">{copy.primary}</Button>
          <Button variant="secondary">{copy.secondary}</Button>
          <Button variant="ghost">{copy.ghost}</Button>
          <Button variant="danger">{copy.danger}</Button>
          <Button variant="primary" size="sm">
            {copy.primary}
          </Button>
          <Button variant="primary" size="lg">
            <ForwardArrow />
            {copy.primary}
          </Button>
          <Button variant="primary" disabled>
            {copy.loading}
          </Button>
          <IconButton label={copy.tip}>
            <Info size={16} />
          </IconButton>
          <ThemeToggle />
        </div>,
      )}

      {section(
        copy.fields,
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            {copy.name}
            <Input defaultValue="Ramadan 2027" />
          </label>
          <label className="grid gap-1 text-sm">
            {copy.wilaya}
            <SelectControl defaultValue="16">
              <option value="16">{copy.algiers}</option>
              <option value="31">{copy.oran}</option>
            </SelectControl>
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            {copy.note}
            <Textarea />
          </label>
          <DateRange
            from={range.from}
            to={range.to}
            onChange={setRange}
            fromLabel={copy.from}
            toLabel={copy.to}
          />
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox defaultChecked /> {copy.checkbox}
            </label>
            <label className="flex items-center gap-2">
              <Radio name={'r-' + theme + dir} defaultChecked /> A
            </label>
            <label className="flex items-center gap-2">
              <Radio name={'r-' + theme + dir} /> B
            </label>
            <Switch
              label={copy.switch}
              checked={on}
              onChange={(event) => setOn(event.target.checked)}
            />
          </div>
          <label className="grid gap-1 text-sm">
            {copy.name}
            <Input aria-invalid="true" defaultValue="" />
          </label>
        </div>,
      )}

      {section(
        copy.status,
        <div className="flex flex-wrap gap-2">
          {['good', 'warn', 'bad', 'info', 'neutral', 'accent'].map((tone) => (
            <Badge key={tone} tone={tone}>
              {copy[tone]}
            </Badge>
          ))}
          <Avatar name="Amine Bensalem" />
          <Avatar name="سارة" size="lg" />
        </div>,
      )}

      {section(
        copy.table,
        <TableFrame>
          <table className={tableClass.table}>
            <thead className={tableClass.head}>
              <tr>
                <th
                  className={tableClass.th()}
                  aria-sort={sort === 'asc' ? 'ascending' : 'descending'}
                >
                  <SortHeader
                    direction={sort}
                    onClick={() => setSort(sort === 'asc' ? 'desc' : 'asc')}
                  >
                    {copy.store}
                  </SortHeader>
                </th>
                <th className={tableClass.th(true, true)}>{copy.units}</th>
              </tr>
            </thead>
            <tbody>
              {copy.rows.map(([name, place, units], index) => (
                <tr key={name} className={tableClass.row(true, index === 1)}>
                  <td className={tableClass.td()}>
                    {name}
                    <span className="block text-xs text-fg-3">{place}</span>
                  </td>
                  <td className={tableClass.td(true, true)}>{units}</td>
                </tr>
              ))}
              <tr className={tableClass.row()}>
                <td className={tableClass.td()}>
                  <Skeleton className="h-4 w-32" />
                </td>
                <td className={tableClass.td(true, true)}>
                  <Skeleton className="ms-auto h-4 w-8" />
                </td>
              </tr>
            </tbody>
          </table>
          <Pagination page={2} pages={5} onPage={() => {}} />
        </TableFrame>,
      )}

      {section(
        copy.nav,
        <div className="space-y-3">
          <Breadcrumbs
            items={copy.crumbs.map((label, index) => ({
              label,
              to: index < 2 ? '/app' : undefined,
            }))}
            label="breadcrumb"
          />
          <TabStrip
            label="demo"
            tabs={tabs}
            value={tab}
            onChange={setTab}
            idPrefix={'demo-' + theme + dir}
          />
          <Stepper label="lifecycle" steps={steps} current="active" />
          <Stepper label="lifecycle-compact" steps={steps} current="assigned" compact />
        </div>,
      )}

      {section(
        copy.overlays,
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setDialog('dialog')}>{copy.openDialog}</Button>
          <Button onClick={() => setDialog('drawer')}>{copy.openDrawer}</Button>
          <Popover trigger={<Button>{copy.openPopover}</Button>} align="start">
            <p className="p-2 text-sm text-fg-2">{copy.tip}</p>
          </Popover>
          <Tooltip label={copy.tip}>
            <Button variant="ghost">?</Button>
          </Tooltip>
          <Button onClick={() => toast(copy.toastText)}>{copy.toast}</Button>
          {dialog === 'dialog' && (
            <ConfirmDialog
              title={copy.danger}
              message={copy.dialogBody}
              onClose={() => setDialog(null)}
              onConfirm={() => setDialog(null)}
            />
          )}
          {dialog === 'drawer' && (
            <Drawer title={copy.sale} onClose={() => setDialog(null)}>
              <p className="text-sm text-fg-2">{copy.dialogBody}</p>
            </Drawer>
          )}
          {dialog === 'plain' && <Dialog title={copy.sale} onClose={() => setDialog(null)} />}
        </div>,
      )}

      {section(
        copy.kpi,
        <KpiStrip>
          <KpiTile label={copy.sales} value={1248} delta={86} period={copy.previous} />
          <KpiTile
            label={copy.units}
            value={0.912}
            format={(value) => (value * 100).toFixed(1) + '%'}
            delta={-0.021}
            deltaFormat={(value) => (value * 100).toFixed(1)}
            period={copy.previous}
          />
          <KpiTile label={copy.bad} value={14} delta={3} deltaGood={false} period={copy.previous} />
          <KpiTile label={copy.warn} value={null} />
        </KpiStrip>,
      )}
      <div className="flex gap-4 text-sm">
        <Delta value={12} good />
        <Delta value={-4} good />
        <Delta value={0} />
        <Delta value={5} good={false} />
      </div>

      {section(
        copy.empty,
        <EmptyState title={copy.emptyTitle} message={copy.emptyBody}>
          <Button variant="primary" size="sm">
            {copy.primary}
          </Button>
        </EmptyState>,
      )}

      {section(
        copy.charts,
        <div className="grid gap-3 sm:grid-cols-2" dir="ltr">
          <div className="h-44" role="img" aria-label={copy.chartSales}>
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 320, height: 176 }}
            >
              <LineChart data={series}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="day" {...chartAxis} />
                <YAxis {...chartAxis} />
                <Line
                  dataKey="sales"
                  stroke={chartSeries[0]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-44" role="img" aria-label={copy.sales}>
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 320, height: 176 }}
            >
              <BarChart data={series}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="day" {...chartAxis} />
                <YAxis {...chartAxis} />
                <Bar dataKey="sales" stackId="a" fill={chartSeries[0]} isAnimationActive={false} />
                <Bar dataKey="absent" stackId="a" fill={chartSeries[1]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>,
      )}

      {section(
        copy.chain,
        <Timeline label={copy.chain}>
          <TimelineStep icon={Gift} title={copy.sale} tone="accent">
            Juice × 3
          </TimelineStep>
          <TimelineStep icon={Gift} title={copy.gifts} tone="good">
            Mug × 1
          </TimelineStep>
          <TimelineStep icon={Gift} title={copy.delivery}>
            movement-1
          </TimelineStep>
          <TimelineStep icon={Gift} title={copy.tombola} last>
            1042
          </TimelineStep>
        </Timeline>,
      )}
    </div>
  );
}

export function DesignPage() {
  return (
    <ToastProvider>
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">ActiCrew design kit</h1>
        <p className="max-w-prose text-sm text-fg-2">
          Dev-only review page. Four specimens: dark and light, left-to-right and right-to-left.
          Tokens live in ui/tokens.css.
        </p>
        <div className="grid gap-4 2xl:grid-cols-2">
          {[
            ['dark', 'ltr'],
            ['dark', 'rtl'],
            ['light', 'ltr'],
            ['light', 'rtl'],
          ].map(([theme, dir]) => (
            <Specimen key={theme + dir} theme={theme} dir={dir} />
          ))}
        </div>
      </section>
    </ToastProvider>
  );
}

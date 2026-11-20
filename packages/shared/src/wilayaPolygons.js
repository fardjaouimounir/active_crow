// Wilaya -> map polygon. The open boundary data (geoBoundaries gbOpen, OpenStreetMap) predates the
// 2019-2021 creation of wilayas 49-69, so it has 48 polygons (codes 01-48). A wilaya without its own
// polygon is drawn inside the polygon of the wilaya it was carved out of; nothing is invented.
// Polygon codes are the two-digit official codes of the first 48 wilayas (= wilayas.id 1-48).
// docs/geo-data.md explains the source and this table.

/** wilaya id -> polygon code ("01"-"48"). */
export const WILAYA_POLYGON = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.fromEntries([
    // Wilayas 1-48 own their polygon.
    ...Array.from({ length: 48 }, (_, index) => [index + 1, String(index + 1).padStart(2, '0')]),
    // 2019 wilayas.
    [49, '01'], // Timimoun -> Adrar
    [50, '01'], // Bordj Badji Mokhtar -> Adrar
    [51, '07'], // Ouled Djellal -> Biskra
    [52, '08'], // Béni Abbès -> Béchar
    [53, '11'], // In Salah -> Tamanrasset
    [54, '11'], // In Guezzam -> Tamanrasset
    [55, '30'], // Touggourt -> Ouargla
    [56, '33'], // Djanet -> Illizi
    [57, '39'], // El M'Ghair -> El Oued
    [58, '47'], // El Meniaa -> Ghardaïa
    // 2021 wilayas.
    [59, '03'], // Aflou -> Laghouat
    [60, '05'], // Barika -> Batna
    [61, '07'], // El Kantara -> Biskra
    [62, '12'], // Bir El Ater -> Tébessa
    [63, '13'], // El Aricha -> Tlemcen
    [64, '14'], // Ksar Chellala -> Tiaret
    [65, '17'], // Aïn Ouessara -> Djelfa
    [66, '17'], // Messaad -> Djelfa
    [67, '26'], // Ksar El Boukhari -> Médéa
    [68, '28'], // Bou Saâda -> M'Sila
    [69, '32'], // El Abiodh Sidi Cheikh -> El Bayadh
  ]),
);

/** polygon code -> wilaya ids drawn in it (own wilaya first). */
export const POLYGON_WILAYAS = /* @__PURE__ */ (() => {
  const groups = {};
  for (const [id, code] of Object.entries(WILAYA_POLYGON)) (groups[code] ??= []).push(Number(id));
  return Object.freeze(groups);
})();

export const polygonOf = (wilayaId) => WILAYA_POLYGON[wilayaId] ?? null;

/** Metrics the geography views can colour a wilaya by. */
export const GEO_METRICS = /* @__PURE__ */ Object.freeze([
  'sales_units',
  'buyers',
  'conversion_rate',
  'attendance_rate',
  'gift_distribution_rate',
  'store_coverage',
  'undelivered_units',
]);

/** Metrics a client may see (no attendance, coverage or stock handling). */
export const CLIENT_GEO_METRICS = /* @__PURE__ */ Object.freeze([
  'sales_units',
  'buyers',
  'conversion_rate',
  'gift_distribution_rate',
]);

/** Metrics that are shares (0-1) rather than counts. */
export const RATIO_GEO_METRICS = /* @__PURE__ */ Object.freeze([
  'conversion_rate',
  'attendance_rate',
  'gift_distribution_rate',
  'store_coverage',
]);

const PICK = {
  sales_units: (kpis) => kpis.sales.units,
  buyers: (kpis) => kpis.customers.buyers,
  conversion_rate: (kpis) => kpis.customers.conversionRate,
  attendance_rate: (kpis) => kpis.attendance.rate,
  gift_distribution_rate: (kpis) => kpis.gifts.distributionRate,
  store_coverage: (kpis) => kpis.visits.storeCoverage,
  undelivered_units: (kpis) => kpis.gifts.undeliveredUnits,
};

/** The value of `metric` in a KPI bundle (the object calculateKpis returns). */
export const geoMetricValue = (kpis, metric) => PICK[metric](kpis);

export const HEATMAP_KINDS = /* @__PURE__ */ Object.freeze(['sales', 'attendance_late']);

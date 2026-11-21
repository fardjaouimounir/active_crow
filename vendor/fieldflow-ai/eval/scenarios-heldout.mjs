// Held-out scenarios, written for P4 WITHOUT looking at any model output, and never used to
// design or tune the claim rules. They exist to check that behaviour measured on the 45
// design scenarios carries over to data the rules were not shaped by. Same fields as
// eval/scenarios.mjs (hand-written dq / focus / priority).
import { buildRequest } from './scenarios.mjs';

const SUP = 'supervisor_daily_summary';
const SALES = 'sales_performance';
const CAMP = 'campaign_insights';
const ANIM = 'animateur_coaching';

const sup = (present, expected, units, previousUnits, distributed, planned) => ({
  attendance: { present, expected }, sales: { units, previousUnits }, gifts: { distributed, planned },
});
const camp = (present, expected, units, target, distributed, planned) => ({
  attendance: { present, expected }, sales: { units, target }, gifts: { distributed, planned },
});
const sellers = (...rows) => rows.map(([label, units, target]) => ({ label, units, target }));
const periods = (...units) => units.map((u, i) => ({ label: `P${i + 1}`, units: u }));
const anim = (...rows) => rows.map(([label, attendanceRate, units, target, visits]) => ({ label, attendanceRate, units, target, visits }));

export const HELDOUT = [
  { id: 'HLD-01', cap: SUP, title: 'mostly fine day, gifts slightly behind', tags: ['normal'],
    data: sup(36, 40, 210, 200, 70, 80), dq: [], focus: ['gifts'], priority: 'gifts' },
  { id: 'HLD-02', cap: SUP, title: 'three problems at once', tags: ['supervisor-decision'],
    data: sup(25, 60, 90, 150, 30, 90), dq: [], focus: ['gifts', 'attendance', 'sales'], priority: 'gifts' },
  { id: 'HLD-03', cap: SUP, title: 'two conflicts at once (present > expected, gifts > plan)', tags: ['conflict'],
    data: sup(70, 60, 120, 110, 120, 100), dq: ['DISTRIBUTED_GT_PLANNED', 'PRESENT_GT_EXPECTED'], focus: [] },
  { id: 'HLD-04', cap: SALES, title: 'six sellers, one far behind', tags: ['underperformer'],
    data: { sellers: sellers(['S1', 140, 120], ['S2', 60, 120], ['S3', 118, 120], ['S4', 95, 120], ['S5', 121, 120], ['S6', 120, 120]), periods: periods(200, 210, 244) },
    dq: [], focus: ['S2'], priority: 'S2' },
  { id: 'HLD-05', cap: SALES, title: 'all sellers tied, sharp decline', tags: ['trend', 'trap-ranking'],
    data: { sellers: sellers(['S1', 90, 100], ['S2', 90, 100], ['S3', 90, 100]), periods: periods(130, 80, 60) },
    dq: [], focus: ['trend'] },
  { id: 'HLD-06', cap: CAMP, title: 'sales well behind, attendance and gifts close', tags: ['campaign-inefficiency'],
    data: camp(38, 40, 140, 200, 55, 60), dq: [], focus: ['sales'], priority: 'sales' },
  { id: 'HLD-07', cap: CAMP, title: 'half the expected attendance, sales above target, gifts complete', tags: ['campaign-inefficiency'],
    data: camp(15, 30, 210, 200, 100, 100), dq: [], focus: ['attendance'], priority: 'attendance' },
  { id: 'HLD-08', cap: CAMP, title: 'sales target is zero', tags: ['conflict', 'suspicious'],
    data: camp(45, 50, 120, 0, 80, 100), dq: ['TARGET_ZERO'], focus: [] },
  { id: 'HLD-09', cap: ANIM, title: 'five animateurs, one with no attendance and no visits', tags: ['coaching', 'scale'],
    data: { animateurs: anim(['A1', 0.9, 100, 80, 5], ['A2', 0.95, 82, 80, 4], ['A3', 0.85, 70, 80, 3], ['A4', 0, 10, 80, 0], ['A5', 0.92, 96, 80, 5]) },
    dq: [], focus: ['A4'], priority: 'A4' },
  { id: 'HLD-10', cap: ANIM, title: 'negative visits for one animateur', tags: ['conflict', 'suspicious'],
    data: { animateurs: anim(['A1', 0.9, 100, 100, -2], ['A2', 0.8, 90, 100, 3], ['A3', 0.85, 95, 100, 4]) },
    dq: ['NEGATIVE_VALUE'], focus: [] },
];

export { buildRequest };

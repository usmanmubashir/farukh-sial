// Catalogue entries for the Practice reports and the sales-against-practice summary. They are merged into REPORTS and
// GROUPS in _report-defs.js. Each loader returns rows, and optionally:
//   kpis:   [{ label, value, type }] shown as tiles above the table (type: money | int | pct | text)
//   totals: { key: value } to show in the totals rows instead of summing the rows (for example, voided excluded)
//   trend:  { kind: 'line' | 'stacked' | 'hbars', ... } drawn above the table
import * as store from '../core/store.js';
import { t } from '../core/i18n.js';
import { formatDate } from '../core/dates.js';
import {
  practiceByMedicine,
  practiceKpis,
  practiceReportRows,
  practiceTrend,
  rankValue,
  salesVsPracticeRows,
  slowMovers,
  topProducts,
} from '../services/practice-reports.js';
import { format } from '../core/money.js';

const weekdayFormat = () => new Intl.DateTimeFormat(store.get('lang') === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'long' });
const shortDay = (iso) => formatDate(iso).slice(0, 5);

export const PRACTICE_GROUP = { key: 'practice', reports: ['practice', 'practice-medicine', 'top-products', 'slow-movers', 'sales-vs-practice'] };

export const PRACTICE_REPORTS = {
  practice: {
    group: 'practice', period: true, periods: 'full', search: true, extras: ['voided'], rowDetail: 'practice', bottomTotals: true,
    columns: [
      { key: 'date', label: 'rpt.col.date', type: 'date' },
      { key: 'day', label: 'rpt.col.day', type: 'text' },
      { key: 'number', label: 'rpt.col.practiceNo', type: 'text' },
      { key: 'cost', label: 'rpt.col.medicineCost', type: 'money', sum: true },
      { key: 'charged', label: 'rpt.col.chargedPractice', type: 'money', sum: true },
      { key: 'profit', label: 'rpt.col.profit', type: 'money', sum: true },
    ],
    async load(ctx) {
      const rows = await practiceReportRows({ from: ctx.from, to: ctx.to, showVoided: ctx.showVoided });
      const day = weekdayFormat();
      const list = rows.map((row) => ({ ...row, day: day.format(new Date(`${row.date}T12:00:00`)) }));
      const kpi = practiceKpis(list);
      const trend = practiceTrend(list);
      return {
        rows: list,
        text: ['number', 'patientName'],
        totals: { cost: kpi.cost, charged: kpi.charged, profit: kpi.profit },
        kpis: [
          { label: t('rpt.kpi.count'), value: kpi.count, type: 'int' },
          { label: t('rpt.kpi.cost'), value: kpi.cost, type: 'money' },
          { label: t('rpt.kpi.charged'), value: kpi.charged, type: 'money' },
          { label: t('rpt.kpi.profit'), value: kpi.profit, type: 'money', tone: kpi.profit < 0 ? 'loss' : 'profit' },
          { label: t('rpt.kpi.averageCharge'), value: kpi.averageCharge, type: 'money' },
          { label: t('rpt.kpi.averageProfit'), value: kpi.averageProfit, type: 'money' },
          { label: t('rpt.kpi.margin'), value: kpi.margin === null ? null : kpi.margin, type: 'pct' },
          { label: t('rpt.kpi.best'), value: kpi.best ? `${kpi.best.number} · ${format(kpi.best.profit, { symbol: false })}` : '—', type: 'text' },
          { label: t('rpt.kpi.worst'), value: kpi.worst ? `${kpi.worst.number} · ${format(kpi.worst.profit, { symbol: false })}` : '—', type: 'text' },
        ],
        trend: {
          kind: 'line',
          format: 'money',
          labels: trend.map((d) => shortDay(d.date)),
          series: [
            { key: 'charged', label: t('rpt.col.chargedPractice'), values: trend.map((d) => d.charged) },
            { key: 'cost', label: t('rpt.col.medicineCost'), values: trend.map((d) => d.cost) },
            { key: 'profit', label: t('rpt.col.profit'), values: trend.map((d) => d.profit) },
          ],
        },
      };
    },
  },
  'practice-medicine': {
    group: 'practice', period: true, periods: 'full', search: true, extras: ['voided'], bottomTotals: true,
    columns: [
      { key: 'label', label: 'rpt.col.medicine', type: 'text' },
      { key: 'units', label: 'rpt.col.units', type: 'int', sum: true },
      { key: 'cost', label: 'rpt.col.medicineCost', type: 'money', sum: true },
      { key: 'charged', label: 'rpt.col.chargedShare', type: 'money', sum: true },
      { key: 'profit', label: 'rpt.col.profitShare', type: 'money', sum: true },
      { key: 'practices', label: 'rpt.col.practices', type: 'int', sum: true },
    ],
    async load(ctx) {
      const rows = await practiceByMedicine({ from: ctx.from, to: ctx.to, showVoided: ctx.showVoided });
      return { rows, text: ['label'] };
    },
  },
  'top-products': {
    group: 'practice', period: true, periods: 'full', search: true, extras: ['source', 'rank', 'topn', 'tabs:top-products|slow-movers'],
    bottomTotals: true,
    columns: [
      { key: 'rank', label: 'rpt.col.rank', type: 'rank' },
      { key: 'name', label: 'rpt.col.medicine', type: 'text' },
      { key: 'company', label: 'rpt.col.company', type: 'text' },
      { key: 'qtyText', label: 'rpt.col.qty', type: 'text' },
      { key: 'revenue', label: 'rpt.col.revenue', type: 'money', sum: true },
      { key: 'cost', label: 'rpt.col.cost', type: 'money', sum: true },
      { key: 'profit', label: 'rpt.col.profit', type: 'money', sum: true },
      { key: 'margin', label: 'rpt.col.margin', type: 'pct' },
      { key: 'share', label: 'rpt.col.share', type: 'pct' },
    ],
    async load(ctx) {
      const result = await topProducts({ from: ctx.from, to: ctx.to, source: ctx.source, rank: ctx.rank, limit: ctx.topN });
      const top = result.rows.slice(0, 10);
      const money = ctx.rank !== 'qty';
      const best = result.rows[0];
      return {
        rows: result.rows.map((row) => ({ ...row, margin: row.margin ?? null })),
        text: ['name', 'company'],
        totals: { revenue: result.bottom.revenue, cost: result.bottom.cost, profit: result.bottom.profit },
        kpis: [
          { label: t('rpt.kpi.medicinesSold'), value: result.bottom.count, type: 'int' },
          { label: t('rpt.kpi.revenue'), value: result.bottom.revenue, type: 'money' },
          { label: t('rpt.kpi.profit'), value: result.bottom.profit, type: 'money', tone: result.bottom.profit < 0 ? 'loss' : 'profit' },
          { label: t('rpt.kpi.topSeller'), value: best ? best.name : '—', type: 'text' },
        ],
        trend: {
          kind: 'hbars',
          format: money ? 'money' : 'int',
          ariaLabel: t('rpt.top.chart'),
          rows: top.map((row) => ({ rank: row.rank, label: row.name, value: rankValue(row, ctx.rank) })),
        },
      };
    },
  },
  'slow-movers': {
    group: 'practice', period: true, periods: 'full', search: true, extras: ['tabs:top-products|slow-movers'],
    columns: [
      { key: 'name', label: 'rpt.col.medicine', type: 'text' },
      { key: 'company', label: 'rpt.col.company', type: 'text' },
      { key: 'sold', label: 'rpt.col.sold', type: 'int' },
      { key: 'stockText', label: 'rpt.col.stock', type: 'text' },
      { key: 'lastSold', label: 'rpt.col.lastSold', type: 'date' },
      { key: 'daysSince', label: 'rpt.col.daysSince', type: 'int' },
    ],
    async load(ctx) {
      const today = ctx.today;
      const rows = await slowMovers({ from: ctx.from, to: ctx.to, today, limit: 0 });
      return { rows, text: ['name', 'company'] };
    },
  },
  'sales-vs-practice': {
    group: 'practice', period: true, periods: 'full', search: false, extras: ['by'], bottomTotals: true,
    columns: [
      { key: 'period', label: 'rpt.col.period', type: 'text' },
      { key: 'salesRevenue', label: 'rpt.col.salesRevenue', type: 'money', sum: true },
      { key: 'practiceCharged', label: 'rpt.col.practiceCharged', type: 'money', sum: true },
      { key: 'total', label: 'rpt.col.total', type: 'money', sum: true },
      { key: 'salesProfit', label: 'rpt.col.salesProfit', type: 'money', sum: true },
      { key: 'practiceProfit', label: 'rpt.col.practiceProfit', type: 'money', sum: true },
    ],
    async load(ctx) {
      const rows = await salesVsPracticeRows({ from: ctx.from, to: ctx.to, by: ctx.by });
      return {
        rows,
        text: ['period'],
        trend: {
          kind: 'stacked',
          format: 'money',
          ariaLabel: t('rpt.svp.chart'),
          periods: rows.map((row) => ({
            label: row.period,
            parts: [
              { key: 'sales', label: t('mix.sales'), value: row.salesRevenue },
              { key: 'practice', label: t('mix.practice'), value: row.practiceCharged },
            ],
          })),
        },
      };
    },
  },
};

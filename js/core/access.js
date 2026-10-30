// Screen access. Every sidebar item and every sub-item (the New purchase and New return pages, and each report on the
// Reports screen) has its own key. The owner can use all of them. Other users can use only what the owner grants.
// A route names its key (see ROUTES in app.js). The sidebar, the command palette, the dashboard and the Reports
// screen hide what the user cannot open, and the router sends them away from any page they cannot open by URL.
// Pure functions only: no storage here, so the rules are easy to test.

/** Sidebar items and their sub-pages, in sidebar order. `group` is the sidebar group, `label` the text shown. */
export const SCREENS = [
  { key: 'dashboard', group: 'daily', label: 'nav.home' },
  { key: 'pos', group: 'daily', label: 'nav.newSale' },
  { key: 'practice', group: 'daily', label: 'nav.practice' },
  { key: 'practice-list', group: 'daily', label: 'nav.practiceList' },
  { key: 'sales', group: 'daily', label: 'nav.sales' },
  { key: 'purchases', group: 'daily', label: 'nav.purchases' },
  { key: 'purchases-new', group: 'daily', label: 'access.newPurchase', sub: true },
  { key: 'returns', group: 'daily', label: 'nav.returns' },
  { key: 'returns-new', group: 'daily', label: 'access.newReturn', sub: true },
  { key: 'products', group: 'medicines', label: 'nav.products' },
  { key: 'stock', group: 'medicines', label: 'nav.stock' },
  { key: 'expiry', group: 'medicines', label: 'nav.expiry' },
  { key: 'demand', group: 'medicines', label: 'nav.demand' },
  { key: 'trace', group: 'medicines', label: 'nav.batchTrace' },
  { key: 'rx', group: 'medicines', label: 'nav.rxRegister' },
  { key: 'customers', group: 'parties', label: 'nav.customers' },
  { key: 'suppliers', group: 'parties', label: 'nav.suppliers' },
  { key: 'vouchers', group: 'accounts', label: 'nav.cashBook' },
  { key: 'accounts', group: 'accounts', label: 'nav.ledger' },
  { key: 'reports', group: 'accounts', label: 'nav.reports' },
  { key: 'backup', group: 'admin', label: 'nav.backup' },
  { key: 'settings', group: 'admin', label: 'nav.settings' },
];

/** Every report on the Reports screen. Each is opened from there, so each one is configurable. */
export const REPORT_KEYS = [
  'stock', 'batches', 'expiry', 'lowstock', 'dead', 'daily', 'range', 'returns', 'medicine', 'company', 'salt',
  'purchases', 'purchaseReturns', 'purchaseMedicine', 'supplier', 'customerLedger', 'supplierLedger', 'receivables',
  'payables', 'cashBook', 'accountLedger', 'dailyClosing', 'profit',
  'practice', 'practice-medicine', 'top-products', 'slow-movers', 'sales-vs-practice',
];

/** One entry per report: its key is `report:<key>`, its label is the report's title. */
export const REPORT_SCREENS = REPORT_KEYS.map((key) => ({ key: `report:${key}`, group: 'accounts', label: `rpt.${key}.title`, report: key }));

/** The owner-only screen. Shown in the permissions list, but it is never granted to anyone else. */
export const OWNER_SCREEN = { key: 'users', group: 'admin', label: 'nav.users' };

/** Keys a user can be granted. */
export const GRANTABLE_SECTIONS = [...SCREENS, ...REPORT_SCREENS].map((screen) => screen.key);

/** Keys only the owner can use. */
export const OWNER_SECTIONS = [OWNER_SCREEN.key];

/** The access key a route needs. A report page needs its own report key; every other route uses its own key. */
export function sectionOf(route, params = {}) {
  if (route?.section === 'reports' && params.key) return `report:${params.key}`;
  return route?.section;
}

/**
 * Access saved before these keys existed used broad section names. Each one stands for the keys it covered.
 * Records saved since then carry accessVersion 2 and are read as they are, so unticking a report sticks.
 */
const LEGACY = {
  dashboard: ['dashboard'],
  sales: ['pos', 'sales', 'returns', 'returns-new'],
  purchases: ['purchases', 'purchases-new'],
  practice: ['practice', 'practice-list'],
  medicines: ['products', 'stock', 'expiry', 'demand', 'trace', 'rx'],
  parties: ['customers', 'suppliers'],
  accounts: ['vouchers', 'accounts'],
  reports: ['reports', ...REPORT_KEYS.map((key) => `report:${key}`)],
  backup: ['backup'],
  settings: ['settings'],
};

/** Keeps only known keys, once each, in sidebar order. Unknown keys and the owner-only screen are dropped. */
export function sanitizeSections(list) {
  const wanted = new Set(Array.isArray(list) ? list : []);
  return GRANTABLE_SECTIONS.filter((key) => wanted.has(key));
}

/** The screen keys a stored user has. Records from before accessVersion 2 are expanded from the broad names. */
export function screensOf(record) {
  const list = Array.isArray(record?.sections) ? record.sections : [];
  if (record?.accessVersion === 2) return sanitizeSections(list);
  return sanitizeSections(list.flatMap((key) => LEGACY[key] ?? [key]));
}

/**
 * The access a user has, from a stored user record (or the session user): { role, sections }.
 * role: 'owner' | 'staff'. The owner has every key.
 */
export function accessOf(user) {
  if (!user) return null;
  if (user.role === 'owner') return { role: 'owner', sections: [...GRANTABLE_SECTIONS, ...OWNER_SECTIONS] };
  return { role: 'staff', sections: sanitizeSections(user.sections) };
}

/** True when the access may open the key. A route without a key (login, setup) is open to any signed-in user. */
export function canOpen(access, section) {
  if (!section) return true;
  return Boolean(access?.sections?.includes(section));
}

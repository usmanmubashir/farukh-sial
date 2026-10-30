// Screen access. Every entry in the sidebar is a screen with its own key. The owner can use every screen. Other
// users can use only the screens the owner grants them. A route names its screen (see ROUTES in app.js); the
// sidebar, the command palette and the dashboard hide what the user cannot open, and the router sends them away
// from any screen they cannot open by URL.
// Pure functions only: no storage here, so the rules are easy to test.

/** Screens a user can be granted, in sidebar order. `group` is the sidebar group, `label` the sidebar text. */
export const SCREENS = [
  { key: 'dashboard', group: 'daily', label: 'nav.home' },
  { key: 'pos', group: 'daily', label: 'nav.newSale' },
  { key: 'practice', group: 'daily', label: 'nav.practice' },
  { key: 'practice-list', group: 'daily', label: 'nav.practiceList' },
  { key: 'sales', group: 'daily', label: 'nav.sales' },
  { key: 'purchases', group: 'daily', label: 'nav.purchases' },
  { key: 'returns', group: 'daily', label: 'nav.returns' },
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

/** The owner-only screen. Shown in the permissions list, but it is never granted to anyone else. */
export const OWNER_SCREEN = { key: 'users', group: 'admin', label: 'nav.users' };

/** Keys a user can be granted. */
export const GRANTABLE_SECTIONS = SCREENS.map((screen) => screen.key);

/** Keys only the owner can use. */
export const OWNER_SECTIONS = [OWNER_SCREEN.key];

/**
 * Access saved before screens existed used four-level section keys. Each one stands for the screens it covered,
 * so an existing staff account keeps everything it could open.
 */
const LEGACY = {
  dashboard: ['dashboard'],
  sales: ['pos', 'sales', 'returns'],
  purchases: ['purchases'],
  practice: ['practice', 'practice-list'],
  medicines: ['products', 'stock', 'expiry', 'demand', 'trace', 'rx'],
  parties: ['customers', 'suppliers'],
  accounts: ['vouchers', 'accounts'],
  reports: ['reports'],
  backup: ['backup'],
  settings: ['settings'],
};

/**
 * Keeps only known, granted screen keys, once each, in sidebar order. Old section keys are expanded to their screens.
 * Unknown keys and users are dropped.
 */
export function sanitizeSections(list) {
  const wanted = new Set();
  for (const key of Array.isArray(list) ? list : []) {
    for (const screen of LEGACY[key] ?? [key]) wanted.add(screen);
  }
  return GRANTABLE_SECTIONS.filter((key) => wanted.has(key));
}

/**
 * The access a user has, from a stored user record (or the session user): { role, sections }.
 * role: 'owner' | 'staff'. The owner has every screen.
 */
export function accessOf(user) {
  if (!user) return null;
  if (user.role === 'owner') return { role: 'owner', sections: [...GRANTABLE_SECTIONS, ...OWNER_SECTIONS] };
  return { role: 'staff', sections: sanitizeSections(user.sections) };
}

/** True when the access may open the screen. A route without a screen (login, setup) is open to any signed-in user. */
export function canOpen(access, section) {
  if (!section) return true;
  return Boolean(access?.sections?.includes(section));
}

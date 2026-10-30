// Section access. The owner can use every section. Other users can use only the sections the owner grants them.
// A route names its section (see ROUTES in app.js); the sidebar, the command palette and the dashboard tiles hide
// what the user cannot open, and the router sends them away from any section they cannot open by URL.
// Pure functions only: no storage here, so the rules are easy to test.

/** Sections the owner can grant to a user, in the order they appear in the Users screen. */
export const GRANTABLE_SECTIONS = ['dashboard', 'sales', 'purchases', 'practice', 'medicines', 'parties', 'accounts', 'reports', 'backup', 'settings'];

/** Sections only the owner can use. They are never granted to anyone else, so a user cannot raise their own access. */
export const OWNER_SECTIONS = ['users'];

/** Keeps only known, granted section keys, without duplicates. Unknown keys are dropped. */
export function sanitizeSections(list) {
  const wanted = new Set(Array.isArray(list) ? list : []);
  return GRANTABLE_SECTIONS.filter((key) => wanted.has(key));
}

/**
 * The access a user has, from a stored user record (or the session user): { role, sections }.
 * role: 'owner' | 'staff'. The owner has every section.
 */
export function accessOf(user) {
  if (!user) return null;
  if (user.role === 'owner') return { role: 'owner', sections: [...GRANTABLE_SECTIONS, ...OWNER_SECTIONS] };
  return { role: 'staff', sections: sanitizeSections(user.sections) };
}

/** True when the access may open the section. A route without a section (login, setup) is open to any signed-in user. */
export function canOpen(access, section) {
  if (!section) return true;
  return Boolean(access?.sections?.includes(section));
}

// Service errors carry a stable `code` so the UI can translate them and tests can assert them.
export class ServiceError extends Error {
  constructor(code, vars = {}) {
    super(code);
    this.name = 'ServiceError';
    this.code = code;
    this.vars = vars;
  }
}

export const missing = (entity, id) => new ServiceError('notFound', { entity, id });

const asNumber = (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value);

/** A safe integer >= min. Numeric strings from form fields are accepted. */
export function requireInt(value, field, min = 0) {
  const n = asNumber(value);
  if (!Number.isSafeInteger(n) || n < min) throw new ServiceError('invalidField', { field });
  return n;
}

/** Like requireInt, but empty input becomes `fallback`. */
export function optionalInt(value, field, min = 0, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return requireInt(value, field, min);
}

export function requireText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new ServiceError('required', { field });
  return text;
}

export function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new ServiceError('invalidField', { field });
  return value;
}

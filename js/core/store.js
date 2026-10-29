// Observable UI state: language, connectivity, session, pharmacy name, sync backlog.
// Business data is never cached here. Pages read it through services, and
// 'data:changed' tells them when to re-read.
import { emit, on } from './events.js';

const state = {
  lang: 'en',
  online: navigator.onLine,
  session: null, // { username, expiresAt } while signed in
  pharmacyName: '',
  syncPending: 0,
};

export function get(key) {
  return state[key];
}

export function set(key, value) {
  if (Object.is(state[key], value)) return;
  state[key] = value;
  emit(`state:${key}`, value);
}

/** Calls fn(value) on every change of `key`. Returns an unsubscribe function. */
export function subscribe(key, fn) {
  return on(`state:${key}`, fn);
}

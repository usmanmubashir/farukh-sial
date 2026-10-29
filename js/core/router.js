// Hash router. Routes look like "#/sales/42?tab=items".
// Pages export { route, title, render($root, params, query), destroy() }.
// Guards (beforeEach) may return false (stay put) or a path to redirect to.
import { emit } from './events.js';
import { t } from './i18n.js';
import * as anim from './anim.js';

/** "#/a/b?x=1" → { path: "/a/b", query: { x: "1" } }. Empty hash is "/". */
export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  let path = pathPart.replace(/\/+$/, '');
  if (!path.startsWith('/')) path = `/${path}`;
  return { path, query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

/** "/products/:id" → { re: /^\/products\/([^/]+)\/?$/, names: ["id"] }. */
export function compilePattern(pattern) {
  const names = [];
  const body = pattern.replace(/\/+$/, '').replace(/:(\w+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  return { names, re: new RegExp(`^${body}/?$`) };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** First route whose pattern matches path, with decoded params. Returns null when nothing matches. */
export function matchRoute(routes, path) {
  for (const route of routes) {
    const { names, re } = compilePattern(route.path);
    const found = re.exec(path);
    if (found) {
      const params = {};
      names.forEach((name, i) => {
        params[name] = safeDecode(found[i + 1]);
      });
      return { route, params };
    }
  }
  return null;
}

/** Navigates to a route, e.g. navigate('/login?next=%2Fsales'). */
export function navigate(target) {
  location.hash = target;
}

function queryString(query) {
  const text = new URLSearchParams(query ?? {}).toString();
  return text ? `?${text}` : '';
}

const failedPage = {
  title: 'errors.generic',
  render($root) {
    $root.html(`<section class="card empty-state" role="alert"><p>${t('errors.pageFailed')}</p></section>`);
  },
  destroy() {},
};

/**
 * Creates a router bound to `view` (a jQuery element).
 * Events: 'route:loading' (boolean), 'route:after' ({ to, from, module }).
 */
export function createRouter({ routes, notFound, view }) {
  const beforeHooks = [];
  const afterHooks = [];
  let current = null; // { to, module } for the page on screen
  let token = 0; // every navigation gets a number. Stale ones stop quietly.

  async function resolve() {
    const mine = ++token;
    const { path, query } = parseHash();
    const match = matchRoute(routes, path);
    const to = { path, query, params: match?.params ?? {}, route: match?.route ?? null };
    const from = current?.to ?? null;

    for (const guard of beforeHooks) {
      const verdict = await guard(to, from);
      if (mine !== token) return;
      if (verdict === false) {
        if (current) history.replaceState(null, '', `#${current.to.path}${queryString(current.to.query)}`);
        return;
      }
      if (typeof verdict === 'string' && parseHash(`#${verdict}`).path !== path) {
        navigate(verdict);
        return;
      }
    }

    const load = to.route ? to.route.load : notFound;
    emit('route:loading', true);
    let module;
    try {
      module = await load();
    } catch (err) {
      console.error(`[router] could not load ${path}`, err);
      module = failedPage;
    }
    emit('route:loading', false);
    if (mine !== token) return;

    await anim.leave(view);
    if (mine !== token) return;

    if (current?.module?.destroy) {
      try {
        current.module.destroy();
      } catch (err) {
        console.error('[router] destroy failed', err);
      }
    }
    current = null;
    view.empty();

    try {
      await module.render(view, to.params, to.query);
    } catch (err) {
      console.error(`[router] render failed for ${path}`, err);
      failedPage.render(view);
    }
    if (mine !== token) {
      module.destroy?.();
      return;
    }

    current = { to, module };
    if (module.title) document.title = `${t(module.title)} · ${t('app.name')}`;
    for (const hook of afterHooks) hook(to, from);
    emit('route:after', { to, from, module });

    await anim.enter(view);
    view[0]?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }

  const remove = (list, fn) => () => {
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  };

  return {
    start() {
      window.addEventListener('hashchange', resolve);
      return resolve();
    },
    stop() {
      window.removeEventListener('hashchange', resolve);
    },
    /** Re-renders the current route without changing the hash (e.g. after a language switch). */
    refresh: resolve,
    beforeEach(fn) {
      beforeHooks.push(fn);
      return remove(beforeHooks, fn);
    },
    afterEach(fn) {
      afterHooks.push(fn);
      return remove(afterHooks, fn);
    },
    get current() {
      return current?.to ?? null;
    },
  };
}

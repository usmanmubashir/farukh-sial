// Shown for any hash that matches no route.
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';

export const route = '*';
export const title = 'errors.notFoundTitle';

export function render($root) {
  $root.html(`
    <section class="card empty-state" aria-labelledby="nf-title">
      <h2 id="nf-title">${esc(t(title))}</h2>
      <p class="muted">${esc(t('errors.notFoundText'))}</p>
      <p><a class="btn btn-primary" href="#/dashboard">${esc(t('nav.dashboard'))}</a></p>
    </section>`);
}

export function destroy() {}

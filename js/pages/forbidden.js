// Shown to a signed-in user whose account has no sections they may open.
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';

export const route = '/forbidden';
export const title = 'access.title';

export function render($root) {
  // The home link goes through '/', so the router sends the user to the first section they may open.
  $root.html(`
    <section class="card empty-state" aria-labelledby="fb-title">
      <h2 id="fb-title">${esc(t(title))}</h2>
      <p class="muted">${esc(t('access.noneText'))}</p>
      <p><a class="btn btn-primary" href="#/">${esc(t('access.goHome'))}</a></p>
    </section>`);
}

export function destroy() {}

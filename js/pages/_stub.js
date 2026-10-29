// Placeholder page for modules that arrive in later milestones. Shows the title and a short note.
import { t } from '../core/i18n.js';
import { esc } from '../core/ui.js';

export function stubPage(route, title) {
  return {
    route,
    title,
    render($root) {
      $root.html(`
        <section class="card empty-state" aria-labelledby="stub-title">
          <h2 id="stub-title">${esc(t(title))}</h2>
          <p class="muted">${esc(t('stub.body'))}</p>
        </section>`);
    },
    destroy() {},
  };
}

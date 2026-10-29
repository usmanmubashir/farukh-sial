// Small dialogs for the Medicines screen: product groups and barcode entry.
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc } from '../core/ui.js';
import { listGroups, saveGroups, searchProducts, generateBarcode } from '../services/products.js';

const t = i18n.t;

/** Groups manager. Adds and removes group names; each change is saved at once. */
export async function openGroupsDialog({ onChange } = {}) {
  let groups = await listGroups();
  const $body = $(`
    <div class="stack">
      <p class="muted small">${esc(t('groups.help'))}</p>
      <form class="inline-form" novalidate>
        <input type="text" name="group" placeholder="${esc(t('groups.placeholder'))}" aria-label="${esc(t('groups.placeholder'))}">
        <button type="submit" class="btn btn-primary btn-sm">${esc(t('groups.add'))}</button>
      </form>
      <ul class="plain-list group-list"></ul>
    </div>`);
  const $list = $body.find('.group-list');

  const paint = () => {
    $list.empty();
    if (!groups.length) $list.append(`<li class="muted small">${esc(t('groups.none'))}</li>`);
    for (const name of groups) {
      $('<li></li>')
        .append($('<span></span>').text(name))
        .append(
          $('<button type="button" class="btn btn-ghost btn-sm"></button>')
            .text(t('groups.remove'))
            .on('click', async () => {
              groups = await saveGroups(groups.filter((g) => g !== name));
              paint();
              onChange?.();
            }),
        )
        .appendTo($list);
    }
  };

  $body.find('form').on('submit', async (event) => {
    event.preventDefault();
    const value = $body.find('input[name="group"]').val();
    if (!String(value).trim()) return;
    groups = await saveGroups([...groups, value]);
    $body.find('input[name="group"]').val('');
    paint();
    onChange?.();
  });

  paint();
  ui.openModal({ title: t('groups.title'), body: $body, actions: [{ label: t('btn.close'), variant: 'primary' }] });
}

/**
 * Barcode entry. A USB or Bluetooth scanner types the code and presses Enter, which is how most pharmacies scan.
 * onCode(code) gets any code typed. onProduct(product) runs when the code belongs to an existing medicine.
 */
export function openScanDialog({ onCode, onProduct } = {}) {
  const $body = $(`
    <div class="stack">
      <p class="muted small">${esc(t('scan.hint'))}</p>
      <form class="inline-form" novalidate>
        <input type="text" inputmode="numeric" name="code" autocomplete="off" aria-label="${esc(t('form.barcode'))}">
        <button type="submit" class="btn btn-primary btn-sm">OK</button>
      </form>
      <button type="button" class="btn btn-soft btn-sm" data-generate>${esc(t('scan.generate'))}</button>
      <p class="form-error" role="alert" hidden></p>
    </div>`);
  const $input = $body.find('input[name="code"]');
  const $error = $body.find('.form-error');
  let dialog = null;

  const finish = (code, product) => {
    dialog?.close();
    if (product) onProduct?.(product);
    else onCode?.(code);
  };

  $body.find('[data-generate]').on('click', () => $input.val(generateBarcode()).trigger('focus'));
  $body.find('form').on('submit', async (event) => {
    event.preventDefault();
    const code = String($input.val() ?? '').trim();
    if (!code) return;
    const [match] = await searchProducts(code, { includeInactive: true, limit: 1 });
    if (match && match.barcode === code) {
      finish(code, match);
      return;
    }
    // Not a known medicine: hand the code to the caller (the medicine form uses it as a new barcode).
    if (onProduct && !onCode) {
      $error.text(t('scan.notFound')).prop('hidden', false);
      return;
    }
    finish(code, null);
  });

  dialog = ui.openModal({ title: t('scan.title'), body: $body, actions: [{ label: t('btn.cancel'), variant: 'ghost' }] });
  $input[0].focus();
}

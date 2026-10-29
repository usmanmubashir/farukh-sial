// New and edit medicine form, in a modal (a bottom sheet on phones). Every field from the brief is here.
// Prices are typed in rupees and stored in paisa. Every price is per ONE PACK, except the loose price.
import * as anim from '../core/anim.js';
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc } from '../core/ui.js';
import { parseRupees } from '../core/money.js';
import { expiryFromInput, todayISO } from '../core/dates.js';
import { CLASSES, FORMS, SOLD_AS, STORAGE, createProduct, generateBarcode, listGroups, updateProduct } from '../services/products.js';
import { addBatch } from '../services/stock.js';
import { ServiceError } from '../services/errors.js';
import { openScanDialog } from './_medicine-dialogs.js';

const t = i18n.t;
const PHOTO_SOFT_LIMIT = 100 * 1024; // base64 adds about a third, so this stays under the 150 KB store limit
const rupees = (paisa) => (paisa ? (paisa / 100).toFixed(2) : '');
const DEFAULT_UNIT = { tablet: 'tablet', capsule: 'capsule', sachet: 'sachet', powder: 'sachet' };

function option(value, label, selected) {
  return `<option value="${value}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

/** A floating-label text or number field. */
function text({ id, label, value = '', type = 'text', required = false, inputmode = '', help = '' }) {
  return `
    <div class="float-field" data-field="${id}">
      <input id="mf-${id}" name="${id}" type="${type}" value="${esc(value)}" placeholder=" " autocomplete="off"${inputmode ? ` inputmode="${inputmode}"` : ''}${required ? ' data-required="true"' : ''}>
      <label for="mf-${id}">${esc(label)}${required ? ' *' : ''}</label>
      <svg class="tick" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9.5 7.2 13.5 15 5"/></svg>
      ${help ? `<span class="hint">${esc(help)}</span>` : ''}
      <span class="field-error" role="alert" hidden></span>
    </div>`;
}

function select({ id, label, options, required = false }) {
  return `
    <div class="field" data-field="${id}">
      <label for="mf-${id}">${esc(label)}${required ? ' *' : ''}</label>
      <select id="mf-${id}" name="${id}">${options}</select>
      <span class="field-error" role="alert" hidden></span>
    </div>`;
}

function toggle({ id, label, checked }) {
  return `
    <label class="switch" data-field="${id}">
      <input type="checkbox" name="${id}"${checked ? ' checked' : ''}>
      <span class="switch-track"><span class="switch-thumb"></span></span>
      <span>${esc(label)}</span>
    </label>`;
}

function markup(product, groups, isNew) {
  const p = product ?? {};
  const soldOptions = SOLD_AS.map((v) => option(v, t(`sold.${v}`), (p.soldAs ?? 'strip') === v)).join('');
  const formOptions = FORMS.map((v) => option(v, t(`type.${v}`), (p.form ?? 'tablet') === v)).join('');
  const classOptions = CLASSES.map((v) => option(v, t(`class.${v}`), (p.class ?? 'otc') === v)).join('');
  const storageOptions = STORAGE.map((v) => option(v, t(`storage.${v}`), (p.storage ?? 'room') === v)).join('');
  const groupOptions = [option('', t('common.none'), !p.group), ...groups.map((g) => option(g, g, p.group === g))].join('');
  const unit = p.unitName ?? DEFAULT_UNIT[p.form ?? 'tablet'] ?? 'unit';

  return `
    <form class="med-form" novalidate>
      <p class="form-help">${esc(t('form.priceHelp'))}</p>
      <div class="form-error" id="mf-error" role="alert" hidden></div>

      <fieldset class="form-section">
        <legend>${esc(t('form.section.basic'))}</legend>
        ${text({ id: 'name', label: t('form.name'), value: p.name, required: true })}
        <div class="form-grid">
          ${text({ id: 'strength', label: t('form.strength'), value: p.strength })}
          ${select({ id: 'form', label: t('form.type'), options: formOptions })}
        </div>
        ${text({ id: 'generic', label: t('form.salt'), value: p.generic })}
        ${text({ id: 'company', label: t('form.company'), value: p.company })}
      </fieldset>

      <fieldset class="form-section">
        <legend>${esc(t('form.section.pack'))}</legend>
        <div class="form-grid">
          ${text({ id: 'mrp', label: t('form.mrp'), value: rupees(p.mrpPerPack), required: true, inputmode: 'decimal' })}
          ${text({ id: 'salePrice', label: t('form.salePrice'), value: rupees(p.salePricePerPack), inputmode: 'decimal' })}
        </div>
        <p class="hint small">${esc(t('form.salePriceHelp'))}</p>
        ${text({ id: 'costPrice', label: t('form.costPrice'), value: rupees(p.costPerPack), inputmode: 'decimal' })}
        <div class="form-grid">
          ${select({ id: 'soldAs', label: t('form.soldAs'), options: soldOptions, required: true })}
          ${text({ id: 'unitsPerPack', label: t('form.unitsPerPack'), value: p.unitsPerPack ?? 1, type: 'number', inputmode: 'numeric', required: true })}
          ${text({ id: 'unitName', label: t('form.unitName'), value: unit })}
          ${text({ id: 'packsPerBox', label: t('form.packsPerBox'), value: p.packsPerBox ?? '', type: 'number', inputmode: 'numeric' })}
        </div>
        ${toggle({ id: 'looseSelling', label: t('form.looseSelling'), checked: Boolean(p.looseSelling) })}
        <div data-loose ${p.looseSelling ? '' : 'hidden'}>
          ${text({ id: 'loosePrice', label: t('form.loosePrice'), value: rupees(p.looseUnitPrice), inputmode: 'decimal' })}
        </div>
      </fieldset>

      <fieldset class="form-section">
        <legend>${esc(t('form.section.class'))}</legend>
        <div class="form-grid">
          ${select({ id: 'class', label: t('form.class'), options: classOptions, required: true })}
          ${select({ id: 'storage', label: t('form.storage'), options: storageOptions })}
          ${text({ id: 'reorderLevel', label: t('form.reorderLevel'), value: p.reorderLevel ?? 0, type: 'number', inputmode: 'numeric' })}
          ${text({ id: 'rack', label: t('form.rack'), value: p.rack })}
          ${select({ id: 'group', label: t('form.group'), options: groupOptions })}
        </div>
      </fieldset>

      ${
        isNew
          ? `<fieldset class="form-section" data-batch>
        <legend>${esc(t('form.section.batch'))}</legend>
        <div class="form-grid">
          ${text({ id: 'batchNo', label: t('form.batchNo') })}
          ${text({ id: 'expiry', label: t('form.expiry'), help: 'MM/YY' })}
          ${text({ id: 'packs', label: t('form.packs'), type: 'number', inputmode: 'numeric' })}
        </div>
      </fieldset>`
          : ''
      }

      <details class="form-section more">
        <summary>${esc(t('form.moreDetails'))}</summary>
        ${text({ id: 'nameUr', label: t('form.urduName'), value: p.nameUr })}
        <label class="field" data-field="directions"><span>${esc(t('form.directions'))}</span>
          <textarea name="directions" rows="2">${esc(p.directions ?? '')}</textarea></label>
        <div class="form-grid">
          ${text({ id: 'code', label: t('form.code'), value: p.code })}
          ${text({ id: 'wholesale', label: t('form.wholesale'), value: rupees(p.wholesalePerPack), inputmode: 'decimal' })}
        </div>
        <div class="barcode-row" data-field="barcode">
          ${text({ id: 'barcode', label: t('form.barcode'), value: p.barcode, inputmode: 'numeric' })}
          <div class="barcode-actions">
            <button type="button" class="btn btn-soft btn-sm" data-scan>${esc(t('med.scan'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-generate>${esc(t('scan.generate'))}</button>
          </div>
        </div>
        ${toggle({ id: 'trackStock', label: t('form.trackStock'), checked: p.trackStock !== false })}
        <p class="hint small">${esc(t('form.trackHelp'))}</p>
        <div class="photo-row" data-field="photo">
          <label class="btn btn-ghost btn-sm">${esc(t('form.photo'))}<input type="file" accept="image/*" hidden data-photo-input></label>
          <span class="hint small">${esc(t('form.photoHelp'))}</span>
          <img class="photo-preview" alt="" ${p.photo ? `src="${esc(p.photo)}"` : 'hidden'}>
          <span class="field-error" role="alert" hidden></span>
        </div>
      </details>

      <div class="form-footer">
        <button type="button" class="btn btn-ghost" data-cancel>${esc(t('btn.cancel'))}</button>
        <button type="submit" class="btn btn-primary" data-save><span data-label-hide>${esc(t('form.save'))}</span></button>
      </div>
    </form>`;
}

/* ---------- Validation ---------- */

const money = (value) => parseRupees(String(value ?? '').trim());
const whole = (value, min) => {
  const n = Number(String(value ?? '').trim());
  return String(value ?? '').trim() !== '' && Number.isSafeInteger(n) && n >= min ? n : null;
};

/** Returns an error key for one field, or '' when it is fine. */
function check($form, id) {
  const val = (name) => $form.find(`[name="${name}"]`).val() ?? '';
  const checked = (name) => $form.find(`[name="${name}"]`).prop('checked');
  switch (id) {
    case 'name':
      return val('name').trim() ? '' : 'form.err.required';
    case 'mrp': {
      const value = money(val('mrp'));
      return value === null || value <= 0 ? 'form.err.money' : '';
    }
    case 'salePrice':
    case 'costPrice':
    case 'wholesale':
      return val(id).trim() === '' || money(val(id)) !== null ? '' : 'form.err.money';
    case 'unitsPerPack':
      return whole(val('unitsPerPack'), 1) === null ? 'form.err.int' : '';
    case 'packsPerBox':
      return val('packsPerBox').trim() === '' || whole(val('packsPerBox'), 1) !== null ? '' : 'form.err.int';
    case 'reorderLevel':
      return whole(val('reorderLevel'), 0) === null ? 'form.err.int' : '';
    case 'loosePrice':
      if (!checked('looseSelling')) return '';
      return (money(val('loosePrice')) ?? 0) > 0 ? '' : 'form.err.loosePrice';
    case 'batchNo':
    case 'expiry':
    case 'packs': {
      const filled = ['batchNo', 'expiry', 'packs'].some((name) => val(name).trim() !== '');
      if (!filled) return '';
      if (id === 'batchNo') return val('batchNo').trim() ? '' : 'form.err.batchTogether';
      if (id === 'packs') return whole(val('packs'), 1) === null ? 'form.err.batchTogether' : '';
      const iso = expiryFromInput(val('expiry'));
      if (!iso) return 'form.err.expiry';
      return iso < todayISO() ? 'form.err.expiryPast' : '';
    }
    default:
      return '';
  }
}

const VALIDATED = ['name', 'mrp', 'salePrice', 'costPrice', 'wholesale', 'unitsPerPack', 'packsPerBox', 'reorderLevel', 'loosePrice', 'batchNo', 'expiry', 'packs'];

function showError($form, id, key) {
  const $wrap = $form.find(`[data-field="${id}"]`).first();
  const $err = $wrap.find('.field-error').first();
  if (key) {
    $err.text(t(key)).prop('hidden', false);
    anim.markField($wrap[0], 'invalid');
  } else {
    $err.text('').prop('hidden', true);
    anim.markField($wrap[0], $wrap.find('input[required], input[data-required]').length && val($form, id) ? 'valid' : 'clear');
  }
}

function val($form, id) {
  return $form.find(`[name="${id}"]`).val() ?? '';
}

/** Validates every field. Returns the first invalid field id, or null. */
function validateAll($form) {
  let first = null;
  for (const id of VALIDATED) {
    const key = check($form, id);
    showError($form, id, key);
    if (key && !first) first = id;
  }
  return first;
}

/* ---------- Save ---------- */

function buildInput($form) {
  const get = (name) => $form.find(`[name="${name}"]`).val() ?? '';
  const flag = (name) => $form.find(`[name="${name}"]`).prop('checked') === true;
  const price = (name) => (get(name).trim() === '' ? 0 : money(get(name)));
  const mrp = price('mrp');
  const sale = get('salePrice').trim() === '' ? mrp : price('salePrice');
  const perBox = get('packsPerBox').trim() === '' ? null : whole(get('packsPerBox'), 1);
  return {
    name: get('name').trim(),
    nameUr: get('nameUr').trim(),
    strength: get('strength').trim(),
    form: get('form'),
    generic: get('generic').trim(),
    company: get('company').trim(),
    mrpPerPack: mrp,
    salePricePerPack: sale,
    costPerPack: price('costPrice'),
    wholesalePerPack: price('wholesale'),
    soldAs: get('soldAs'),
    unitsPerPack: whole(get('unitsPerPack'), 1),
    unitName: get('unitName').trim() || 'unit',
    looseSelling: flag('looseSelling'),
    looseUnitPrice: flag('looseSelling') ? price('loosePrice') : 0,
    packsPerBox: perBox,
    class: get('class'),
    storage: get('storage'),
    reorderLevel: whole(get('reorderLevel'), 0) ?? 0,
    rack: get('rack').trim(),
    group: get('group'),
    code: get('code').trim(),
    barcode: get('barcode').trim(),
    directions: get('directions').trim(),
    trackStock: flag('trackStock'),
    photo: $form.find('img.photo-preview').attr('src') || null,
  };
}

/**
 * Opens the form. product: an existing row to edit, or null for a new medicine.
 * onSaved(product) runs after a successful save.
 */
export async function openMedicineForm({ product = null, onSaved } = {}) {
  const groups = await listGroups();
  const isNew = !product;
  const $body = $(markup(product, groups, isNew));
  const $form = $body.is('form') ? $body : $body.find('form');
  let dialog = null;

  // Looser selling and the photo are the only fields that change what else is shown.
  $form.find('[name="looseSelling"]').on('change', function toggleLoose() {
    $form.find('[data-loose]').prop('hidden', !this.checked);
  });
  $form.find('[data-photo-input]').on('change', function readPhoto() {
    const file = this.files?.[0];
    if (!file) return;
    if (file.size > PHOTO_SOFT_LIMIT) {
      showError($form, 'photo', 'form.err.photo');
      this.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      $form.find('img.photo-preview').attr('src', reader.result).prop('hidden', false);
      showError($form, 'photo', '');
    };
    reader.readAsDataURL(file);
  });
  $form.find('[name="barcode"]').on('blur', () => showError($form, 'barcode', ''));
  $form.find('[data-generate]').on('click', () => $form.find('[name="barcode"]').val(generateBarcode()));
  $form.find('[data-scan]').on('click', () =>
    openScanDialog({ onCode: (code) => $form.find('[name="barcode"]').val(code) }),
  );
  for (const id of VALIDATED) {
    $form.find(`[name="${id}"]`).on('blur change', () => showError($form, id, check($form, id)));
  }

  const submit = async () => {
    const $error = $form.find('#mf-error');
    $error.prop('hidden', true);
    const firstInvalid = validateAll($form);
    if (firstInvalid) {
      $form.find(`[name="${firstInvalid}"]`).trigger('focus');
      return;
    }
    const input = buildInput($form);
    const $save = $form.find('[data-save]');
    anim.buttonState($save, 'loading');
    try {
      const saved = product ? await updateProduct(product.id, input) : await createProduct(input);
      if (isNew && val($form, 'batchNo').trim()) {
        await addBatch({
          productId: saved.id,
          batchNo: val($form, 'batchNo').trim(),
          expiry: val($form, 'expiry').trim(),
          packs: whole(val($form, 'packs'), 1),
          costPerPack: input.costPerPack,
          mrp: input.mrpPerPack,
        });
      }
      anim.buttonState($save, 'success');
      ui.toast(t('form.saved'), { type: 'success' });
      setTimeout(() => {
        dialog?.close();
        onSaved?.(saved);
      }, 650);
    } catch (err) {
      anim.buttonState($save, 'idle');
      if (err instanceof ServiceError && (err.code === 'codeTaken' || err.code === 'barcodeTaken')) {
        $error.text(t('form.err.duplicate')).prop('hidden', false);
        showError($form, 'barcode', 'form.err.duplicate');
      } else if (err instanceof ServiceError && err.code === 'unitsLocked') {
        $error.text(t('form.err.unitsLocked')).prop('hidden', false);
      } else {
        console.error('[medicine form] save failed', err);
        $error.text(t('form.err.generic')).prop('hidden', false);
      }
      anim.shake($error[0]);
    }
  };

  $form.on('submit', (event) => {
    event.preventDefault();
    submit();
  });
  $form.find('[data-cancel]').on('click', () => dialog?.close());

  dialog = ui.openModal({
    title: product ? t('form.edit') : t('form.new'),
    body: $form,
    actions: [],
  });
  $form.find('[name="name"]').trigger('focus');
  return dialog;
}

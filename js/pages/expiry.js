// Expiry: batches grouped by how long they have left, a searchable list, and a return list that sends
// expired batches back to their suppliers.
import * as anim from '../core/anim.js';
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc, money } from '../core/ui.js';
import { formatDate, todayISO } from '../core/dates.js';
import * as events from '../core/events.js';
import { batchRows } from '../services/stock.js';
import { returnExpiredBatches } from '../services/returns.js';

const t = i18n.t;

export const route = '/expiry';
export const title = 'nav.expiry';

const BUCKETS = ['expired', 'd30', 'd60', 'd90', 'm6', 'all'];
const BUCKET_TONE = { expired: 'danger', d30: 'warn', d60: 'warn', d90: 'info', m6: 'ok', all: 'brand' };

let $host = null;
let batches = [];
let bucket = 'expired';
let query = '';
let selected = new Set();
let unsubscribe = null;

const inBucket = (row, key) => key === 'all' || row.bucket === key;

function daysText(days) {
  return days < 0 ? t('daysAgo', { days: Math.abs(days) }) : t('daysLeft', { days });
}

function tilesHtml() {
  return BUCKETS.map((key) => {
    const list = batches.filter((b) => inBucket(b, key));
    const value = list.reduce((n, b) => n + b.costValue, 0);
    return `
      <button type="button" class="bucket-tile" data-accent-tone="${BUCKET_TONE[key]}" data-bucket="${key}" aria-pressed="${key === bucket}">
        <span class="bucket-label">${esc(t(`expiry.bucket.${key}`))}</span>
        <span class="bucket-count"><span data-count="${list.length}">0</span></span>
        <span class="muted small">${esc(t('expiry.batches', { count: list.length }))} · ${money(value)}</span>
      </button>`;
  }).join('');
}

function visible() {
  const q = query.trim().toLowerCase();
  return batches.filter((b) => inBucket(b, bucket) && (!q || `${b.productName} ${b.batchNo}`.toLowerCase().includes(q)));
}

function rowsHtml(list) {
  return list
    .map((b) => {
      const expired = b.bucket === 'expired';
      const tone = expired ? 'badge--danger' : b.bucket === 'd30' ? 'badge--warn' : 'badge--ok';
      return `
        <li class="exp-row" data-key="${esc(b.batchId)}">
          <label class="check exp-check">
            <input type="checkbox" data-select="${esc(b.batchId)}" ${selected.has(b.batchId) ? 'checked' : ''} ${expired ? '' : 'disabled'}>
            <span class="check-box"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 9.5 7.5 13.5 14.5 5"/></svg></span>
          </label>
          <div class="exp-main">
            <span class="med-name">${esc(b.productName)}</span>
            <span class="muted small">${esc(t('stock.colBatch'))} ${esc(b.batchNo)} · ${esc(formatDate(b.expiry))}</span>
          </div>
          <div class="exp-side">
            <span class="badge ${tone}">${esc(daysText(b.days))}</span>
            <span class="small">${esc(b.packs)}${b.looseUnits ? ` + ${esc(b.looseUnits)}` : ''}</span>
            <span class="small">${money(b.costValue)}</span>
          </div>
        </li>`;
    })
    .join('');
}

function paintList() {
  const list = visible();
  $host.find('.exp-list').html(rowsHtml(list));
  $host.find('.exp-none').prop('hidden', list.length > 0);
  $host.find('.exp-selected').text(selected.size ? t('expiry.batches', { count: selected.size }) : '');
}

function paintTiles() {
  $host.find('.bucket-row').html(tilesHtml());
  $host.find('[data-count]').each(function count() {
    anim.countUp(this, Number(this.dataset.count), { format: 'int' });
  });
}

async function load() {
  batches = await batchRows({ today: todayISO() });
  // Drop selections that no longer exist.
  selected = new Set([...selected].filter((id) => batches.some((b) => b.batchId === id && b.bucket === 'expired')));
  if (!$host) return;
  paintTiles();
  paintList();
}

/** Lists the selected expired batches (or all expired ones when nothing is ticked) and creates the returns. */
function openReturnList() {
  const expired = batches.filter((b) => b.bucket === 'expired');
  const picked = selected.size ? expired.filter((b) => selected.has(b.batchId)) : expired;
  const returnable = picked.filter((b) => b.purchaseItemId && b.packs > 0);
  const noPurchase = picked.filter((b) => !b.purchaseItemId).length;
  const $body = $(`
    <div class="stack">
      <p class="muted small">${esc(t('expiry.returnHelp'))}</p>
      ${
        noPurchase
          ? `<p class="form-error">${esc(t('expiry.noPurchase', { count: noPurchase }))}</p>`
          : ''
      }
      <ul class="plain-list">${
        returnable.length
          ? returnable
              .map((b) => `<li><span>${esc(b.productName)} <span class="muted small">${esc(b.batchNo)} · ${b.packs}</span></span>${money(b.costValue)}</li>`)
              .join('')
          : `<li class="muted small">${esc(t('expiry.returnNone'))}</li>`
      }</ul>
      <div class="form-footer">
        <button type="button" class="btn btn-danger" data-create ${returnable.length ? '' : 'disabled'}><span data-label-hide>${esc(t('expiry.returnCreate'))}</span></button>
      </div>
    </div>`);
  const $create = $body.find('[data-create]');
  $create.on('click', async () => {
    anim.buttonState($create, 'loading');
    try {
      const result = await returnExpiredBatches(returnable.map((b) => b.batchId), { today: todayISO() });
      anim.buttonState($create, 'success');
      ui.toast(t('expiry.returnDone', { count: result.created }), { type: 'success' });
      selected = new Set();
      setTimeout(() => {
        dialog.close();
        load();
      }, 500);
    } catch (err) {
      console.error('[expiry] return failed', err);
      anim.buttonState($create, 'idle');
      ui.toast(t('errors.generic'), { type: 'error' });
    }
  });
  const dialog = ui.openModal({ title: t('expiry.returnTitle'), body: $body, actions: [] });
}

function bind() {
  $host.on('click', '[data-bucket]', (event) => {
    bucket = event.currentTarget.getAttribute('data-bucket');
    $host.find('[data-bucket]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    anim.flip($host.find('.exp-list')[0], paintList);
  });
  $host.on('input', '.exp-search', (event) => {
    query = event.currentTarget.value;
    paintList();
  });
  $host.on('change', '[data-select]', (event) => {
    const id = event.currentTarget.getAttribute('data-select');
    if (event.currentTarget.checked) selected.add(id);
    else selected.delete(id);
    paintList();
  });
  $host.on('click', '[data-action="return"]', openReturnList);
}

export async function render($root) {
  $root.html('<div class="exp-root"></div>');
  $host = $root.children('.exp-root');
  $host.html(`
    <div class="page-head">
      <div><h2>${esc(t('expiry.title'))}</h2></div>
      <div class="row">
        <span class="muted small exp-selected"></span>
        <button type="button" class="btn btn-danger" data-action="return">${esc(t('expiry.returnList'))}</button>
      </div>
    </div>
    <div class="bucket-row"></div>
    <label class="search-box"><span class="sr-only">${esc(t('expiry.search'))}</span>
      <input type="search" class="exp-search" placeholder="${esc(t('expiry.search'))}" autocomplete="off"></label>
    <ul class="exp-list"></ul>
    <p class="muted exp-none" hidden>${esc(t('expiry.empty'))}</p>`);
  bind();
  await load();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['batches', 'stockMovements', 'purchaseItems'].includes(s))) load();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
  batches = [];
  selected = new Set();
}

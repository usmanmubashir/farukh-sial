// Receipt content. One model feeds the screen preview, browser print (HTML), WhatsApp (text) and the
// thermal printer (ESC/POS, rendered by printing.js). No DOM here, except the labels from t().
import * as db from '../core/db.js';
import { t } from '../core/i18n.js';
import { formatDate } from '../core/dates.js';
import { format } from '../core/money.js';
import { getSettings, getProfile } from './settings.js';
import { getSaleWithItems } from './sales.js';

/**
 * Builds the receipt for a sale. options: { showBatch, showDirections } from the settings unless given.
 * Directions come from each medicine's "usual directions" field. The header and footer come from the profile.
 */
export async function buildReceipt(saleId, options = {}) {
  const settings = await getSettings();
  const profile = await getProfile();
  const sale = await getSaleWithItems(saleId);
  const customer = sale.customerId ? await db.get('customers', sale.customerId) : null;
  const pharmacyName = profile.name || (await db.getSetting('pharmacyName', ''));
  const showBatch = options.showBatch ?? settings.receiptShowBatch ?? false;
  const showDirections = options.showDirections ?? settings.receiptShowDirections ?? true;

  const items = [];
  for (const item of sale.items) {
    const product = await db.get('products', item.productId);
    const batches = (item.allocations ?? []).map((a) => `${a.batchNo} ${formatDate(a.expiry)}`).join(', ');
    const qty = [item.packs ? `${item.packs} ${product?.soldAs ?? 'pack'}` : '', item.looseUnits ? `${item.looseUnits} ${product?.unitName ?? 'unit'}` : '']
      .filter(Boolean)
      .join(' + ');
    items.push({
      name: item.productName,
      strength: item.strength ?? product?.strength ?? '',
      qty,
      amount: format(item.amount, { symbol: false }),
      batches: showBatch ? batches : '',
      directions: showDirections ? product?.directions ?? '' : '',
      rx: ['rx', 'controlled'].includes(item.class),
    });
  }

  return {
    pharmacyName,
    pharmacyNameUr: profile.nameUr,
    address: profile.address,
    phone: profile.phone,
    ntn: profile.ntn,
    licence: profile.licence,
    footer: profile.receiptFooter,
    number: sale.number,
    date: formatDate(sale.date),
    customer: customer?.name ?? '',
    patient: sale.patient ?? '',
    doctor: sale.doctor ?? '',
    items,
    subtotal: format(sale.subtotal, { symbol: false }),
    discount: sale.discount ? format(sale.discount, { symbol: false }) : '',
    tax: sale.tax ? format(sale.tax, { symbol: false }) : '',
    total: format(sale.total, { symbol: false }),
    paid: format(sale.paid, { symbol: false }),
    balance: sale.balance ? format(sale.balance, { symbol: false }) : '',
    change: sale.change ? format(sale.change, { symbol: false }) : '',
    note: sale.note ?? '',
    width: Number(settings.receiptWidth) === 58 ? 58 : 80,
    raw: sale,
  };
}

/** The header lines of a receipt (name, Urdu name, address, phone, NTN, licence), empty ones left out. */
export function headerLines(model) {
  return [
    model.pharmacyName,
    model.pharmacyNameUr,
    model.address,
    model.phone ? `${t('rcpt.phone')}: ${model.phone}` : '',
    model.ntn ? `${t('rcpt.ntn')}: ${model.ntn}` : '',
    model.licence ? `${t('rcpt.licence')}: ${model.licence}` : '',
  ].filter(Boolean);
}

/** Plain text, for WhatsApp. */
export function receiptText(model) {
  const lines = [...headerLines(model), `${model.number}  ${model.date}`];
  if (model.customer) lines.push(`${t('rcpt.customer')}: ${model.customer}`);
  if (model.patient) lines.push(`${t('rcpt.patient')}: ${model.patient}`);
  if (model.doctor) lines.push(`${t('rcpt.doctor')}: ${model.doctor}`);
  lines.push('-----------------------');
  for (const item of model.items) {
    lines.push(`${item.name} ${item.strength}`.trim());
    lines.push(`  ${item.qty}  ${item.amount}`);
    if (item.batches) lines.push(`  ${t('rcpt.batch')}: ${item.batches}`);
    if (item.directions) lines.push(`  ${item.directions}`);
  }
  lines.push('-----------------------');
  if (model.discount) lines.push(`${t('rcpt.discount')}: ${model.discount}`);
  if (model.tax) lines.push(`${t('rcpt.tax')}: ${model.tax}`);
  lines.push(`${t('rcpt.total')}: ${model.total}`);
  lines.push(`${t('rcpt.paid')}: ${model.paid}`);
  if (model.balance) lines.push(`${t('rcpt.balance')}: ${model.balance}`);
  if (model.change) lines.push(`${t('rcpt.change')}: ${model.change}`);
  if (model.footer) lines.push(model.footer);
  lines.push(t('rcpt.thanks'));
  return lines.join('\n');
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** HTML for the print area. Width follows the printer: 58 mm or 80 mm. */
export function receiptHtml(model) {
  const rows = model.items
    .map(
      (item) => `
      <div class="r-item">
        <div class="r-row"><span>${esc(item.name)} ${esc(item.strength)}</span><span>${esc(item.amount)}</span></div>
        <div class="r-sub">${esc(item.qty)}${item.rx ? ` · ${esc(t('rcpt.rx'))}` : ''}</div>
        ${item.batches ? `<div class="r-sub">${esc(t('rcpt.batch'))}: ${esc(item.batches)}</div>` : ''}
        ${item.directions ? `<div class="r-sub">${esc(item.directions)}</div>` : ''}
      </div>`,
    )
    .join('');
  const line = (label, value) => (value ? `<div class="r-row"><span>${esc(label)}</span><span>${esc(value)}</span></div>` : '');
  const header = headerLines(model)
    .map((text, i) => `<div class="${i === 0 ? '' : 'r-sub '}r-center">${i === 0 ? `<strong>${esc(text)}</strong>` : esc(text)}</div>`)
    .join('');
  return `
    <div class="receipt receipt-${model.width}">
      ${header}
      <div class="r-row"><span>${esc(model.number)}</span><span>${esc(model.date)}</span></div>
      ${model.customer ? `<div class="r-sub">${esc(t('rcpt.customer'))}: ${esc(model.customer)}</div>` : ''}
      ${model.patient ? `<div class="r-sub">${esc(t('rcpt.patient'))}: ${esc(model.patient)}</div>` : ''}
      ${model.doctor ? `<div class="r-sub">${esc(t('rcpt.doctor'))}: ${esc(model.doctor)}</div>` : ''}
      <hr>
      ${rows}
      <hr>
      ${line(t('rcpt.discount'), model.discount)}
      ${line(t('rcpt.tax'), model.tax)}
      ${line(t('rcpt.total'), model.total)}
      ${line(t('rcpt.paid'), model.paid)}
      ${line(t('rcpt.balance'), model.balance)}
      ${line(t('rcpt.change'), model.change)}
      ${model.note ? `<div class="r-sub">${esc(model.note)}</div>` : ''}
      ${model.footer ? `<div class="r-sub r-center">${esc(model.footer)}</div>` : ''}
      <div class="r-center r-sub">${esc(t('rcpt.thanks'))}</div>
    </div>`;
}

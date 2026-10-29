// Receipt content. One model feeds the screen preview, browser print (HTML), WhatsApp (text) and the
// thermal printer (ESC/POS, rendered by printing.js). No DOM here.
import * as db from '../core/db.js';
import { formatDate } from '../core/dates.js';
import { format } from '../core/money.js';
import { getSettings } from './settings.js';
import { getSaleWithItems } from './sales.js';

/**
 * Builds the receipt for a sale. options: { showBatch, showDirections } from the settings unless given.
 * Directions come from each medicine's "usual directions" field.
 */
export async function buildReceipt(saleId, options = {}) {
  const settings = await getSettings();
  const sale = await getSaleWithItems(saleId);
  const customer = sale.customerId ? await db.get('customers', sale.customerId) : null;
  const pharmacyName = await db.getSetting('pharmacyName', '');
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

/** Plain text, for WhatsApp. */
export function receiptText(model) {
  const lines = [model.pharmacyName, `${model.number}  ${model.date}`];
  if (model.customer) lines.push(`Customer: ${model.customer}`);
  if (model.patient) lines.push(`Patient: ${model.patient}`);
  if (model.doctor) lines.push(`Doctor: ${model.doctor}`);
  lines.push('-----------------------');
  for (const item of model.items) {
    lines.push(`${item.name} ${item.strength}`.trim());
    lines.push(`  ${item.qty}  ${item.amount}`);
    if (item.batches) lines.push(`  Batch: ${item.batches}`);
    if (item.directions) lines.push(`  ${item.directions}`);
  }
  lines.push('-----------------------');
  if (model.discount) lines.push(`Discount: ${model.discount}`);
  if (model.tax) lines.push(`Tax: ${model.tax}`);
  lines.push(`Total: ${model.total}`);
  lines.push(`Paid: ${model.paid}`);
  if (model.balance) lines.push(`Balance on account: ${model.balance}`);
  if (model.change) lines.push(`Change: ${model.change}`);
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
        <div class="r-sub">${esc(item.qty)}${item.rx ? ' · Rx' : ''}</div>
        ${item.batches ? `<div class="r-sub">Batch: ${esc(item.batches)}</div>` : ''}
        ${item.directions ? `<div class="r-sub">${esc(item.directions)}</div>` : ''}
      </div>`,
    )
    .join('');
  const line = (label, value) => (value ? `<div class="r-row"><span>${esc(label)}</span><span>${esc(value)}</span></div>` : '');
  return `
    <div class="receipt receipt-${model.width}">
      <div class="r-center"><strong>${esc(model.pharmacyName)}</strong></div>
      <div class="r-row"><span>${esc(model.number)}</span><span>${esc(model.date)}</span></div>
      ${model.customer ? `<div class="r-sub">Customer: ${esc(model.customer)}</div>` : ''}
      ${model.patient ? `<div class="r-sub">Patient: ${esc(model.patient)}</div>` : ''}
      ${model.doctor ? `<div class="r-sub">Doctor: ${esc(model.doctor)}</div>` : ''}
      <hr>
      ${rows}
      <hr>
      ${line('Discount', model.discount)}
      ${line('Tax', model.tax)}
      ${line('Total', model.total)}
      ${line('Paid', model.paid)}
      ${line('Balance on account', model.balance)}
      ${line('Change', model.change)}
      ${model.note ? `<div class="r-sub">${esc(model.note)}</div>` : ''}
      <div class="r-center r-sub">Thank you</div>
    </div>`;
}

// The shift figures as one printable report: the X-report during the shift and the Z-report after the close.
// Printed on the receipt printer (80 mm) or shown in a dialog, from the same figures.
import { esc } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { format } from '../core/money.js';
import { formatDateTime } from '../core/dates.js';
import { CATEGORIES } from '../services/shifts.js';

const money = (paisa) => format(paisa ?? 0);
const when = (iso) => (iso ? formatDateTime(Date.parse(iso)) : '');

const row = (label, value) => `<tr><td>${esc(label)}</td><td class="num" style="text-align:end">${esc(value)}</td></tr>`;

/**
 * summary: from shifts.shiftSummary(). closed: true for the Z-report (counted, expected and variance are shown).
 * Returns the report's HTML.
 */
export function reportHtml(summary, { title, closed = false }) {
  const { shift: sh, categories, digital, counts, movements, expected } = summary;
  const cashRows = CATEGORIES.filter((c) => categories[c] !== 0)
    .map((c) => row(t(`shift.cat.${c}`), money(categories[c])))
    .join('');
  const moveRows = movements
    .map((m) => `<tr><td>${esc(t(`shift.move.${m.type}`))}</td><td>${esc(m.reason)}</td><td style="text-align:end">${esc(money(m.amount))}</td></tr>`)
    .join('');
  const variance = closed ? sh.variance : null;
  return `
    <div class="doc shift-report" style="font-size:12px">
      <h2 style="text-align:center;margin:0">${esc(title)}</h2>
      <p style="text-align:center;margin:2px 0">${esc(sh.number)}</p>
      <table style="width:100%">
        ${row(t('shift.openedAt'), when(sh.openedAt))}
        ${closed ? row(t('shift.closedAt'), when(sh.closedAt)) : ''}
        ${row(t('shift.cashier'), sh.openedBy || '-')}
        ${row(t('shift.opening'), money(sh.openingCash))}
      </table>
      <h4>${esc(t('shift.sectionCash'))}</h4>
      <table style="width:100%">
        ${cashRows || `<tr><td colspan="2">${esc(t('shift.noCash'))}</td></tr>`}
        ${row(t('shift.expected'), money(expected))}
      </table>
      <h4>${esc(t('shift.sectionDigital'))}</h4>
      <table style="width:100%">
        ${row(t('shift.digitalSales'), money(digital.sales))}
        ${row(t('shift.digitalPractice'), money(digital.practice))}
        ${row(t('shift.digitalReceipts'), money(digital.customerReceipts))}
      </table>
      <h4>${esc(t('shift.sectionCounts'))}</h4>
      <table style="width:100%">
        ${row(t('shift.countSales'), String(counts.sales))}
        ${row(t('shift.countPractices'), String(counts.practices))}
        ${row(t('shift.countRefunds'), String(counts.refunds))}
        ${row(t('shift.countVoids'), String(counts.voids))}
      </table>
      ${
        closed
          ? `<h4>${esc(t('shift.sectionClose'))}</h4>
             <table style="width:100%">
               ${row(t('shift.counted'), money(sh.counted))}
               ${row(t('shift.expected'), money(sh.expected))}
               ${row(t('shift.variance'), `${variance > 0 ? '+' : ''}${money(variance)}`)}
             </table>
             ${sh.closingNote ? `<p>${esc(t('shift.closingNote'))}: ${esc(sh.closingNote)}</p>` : ''}`
          : ''
      }
      ${movements.length ? `<h4>${esc(t('shift.sectionMovements'))}</h4><table style="width:100%">${moveRows}</table>` : ''}
    </div>`;
}

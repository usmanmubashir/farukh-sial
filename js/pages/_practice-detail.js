// The practice drawer: one practice with its items, batches and costs, and the owner's void (with a reason).
// Used by the practice history page and by the practice reports, so both show and void a practice the same way.
import * as i18n from '../core/i18n.js';
import * as ui from '../core/ui.js';
import { esc } from '../core/ui.js';
import { format } from '../core/money.js';
import { formatDate } from '../core/dates.js';
import { getPractice, voidPractice } from '../services/practice.js';

const t = i18n.t;
const money = (paisa) => `<span class="money" data-count="${esc(paisa)}" data-format="money-plain">${esc(format(paisa, { symbol: false }))}</span>`;

export async function openPracticeDetail(id, { onChanged } = {}) {
  const p = await getPractice(id);
  const items = p.items.map((i) => `<tr><td>${esc(i.productName)} <span class="muted small">${esc(i.strength ?? '')}</span></td>
      <td>${esc(i.batchNo)}</td><td class="num">${esc(i.qtyUnits)}</td><td class="num">${money(i.lineList)}</td><td class="num">${money(i.lineCost)}</td></tr>`).join('');
  const voidBlock = p.voided
    ? `<p class="pl-voided-note">${esc(t('practiceList.voidedOn', { date: formatDate(p.void.voidDate), reason: p.void.reason }))}</p>`
    : `<form class="pl-void" data-void>
         <label class="field"><span>${esc(t('practiceList.voidReason'))}</span><input name="reason" required autocomplete="off"></label>
         <button type="submit" class="btn btn-danger">${esc(t('practiceList.voidButton'))}</button>
         <p class="muted small">${esc(t('practiceList.voidNote'))}</p>
       </form>`;
  const $body = $(`
    <div class="pl-detail">
      <dl class="doc-totals">
        <div><dt>${esc(t('practiceList.charged'))}</dt><dd>${money(p.chargedAmount)}</dd></div>
        <div><dt>${esc(t('practiceList.cost'))}</dt><dd>${money(p.costTotal)}</dd></div>
        <div><dt>${esc(t('practiceList.profit'))}</dt><dd class="${p.profit < 0 ? 'is-loss' : 'is-profit'}">${money(p.profit)}</dd></div>
        <div><dt>${esc(t('practiceList.calculated'))}</dt><dd>${money(p.calculatedTotal)}</dd></div>
      </dl>
      <div class="table-wrap"><table class="table"><thead><tr>
        <th>${esc(t('practiceList.medicine'))}</th><th>${esc(t('practiceList.batch'))}</th><th class="num">${esc(t('practiceList.units'))}</th>
        <th class="num">${esc(t('practiceList.listPrice'))}</th><th class="num">${esc(t('practiceList.cost'))}</th>
      </tr></thead><tbody>${items}</tbody></table></div>
      ${voidBlock}
    </div>`);
  const dialog = ui.openModal({ title: p.number, body: $body, actions: [{ label: t('btn.close') }] });
  $body.on('submit', '[data-void]', async (event) => {
    event.preventDefault();
    const reason = String($body.find('[name="reason"]').val() ?? '').trim();
    if (!reason) {
      ui.toast(t('practiceList.reasonNeeded'), { type: 'error' });
      return;
    }
    try {
      await voidPractice(p.id, { reason });
      dialog?.close?.();
      ui.toast(t('practiceList.voided', { number: p.number }), { type: 'success' });
      await onChanged?.();
    } catch (err) {
      console.warn('[practice-list] void failed', err);
      ui.toast(t('errors.generic'), { type: 'error' });
    }
  });
}


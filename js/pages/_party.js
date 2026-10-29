// Customers and suppliers share one list and one detail screen. The kind decides the account (1100 or 2000)
// and the words: a customer owes us, a supplier we owe.
//   owed > 0  : money due (customer owes us / we owe the supplier)
//   owed < 0  : advance (customer has paid ahead / we have paid ahead to the supplier)
import * as events from '../core/events.js';
import { debounce } from '../core/resilience.js';
import * as ui from '../core/ui.js';
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate, todayISO } from '../core/dates.js';
import { format, parseRupees } from '../core/money.js';
import { downloadText, rupeesForCsv, toCsv } from '../core/csv.js';
import * as db from '../core/db.js';
import { addParty, partyStatement, partySummaries, setPartyActive } from '../services/parties.js';
import { paymentAccounts, paymentVoucher, receiptVoucher, accountName } from '../services/ledger.js';
import { whatsappLink } from '../services/demand.js';
import { printPage } from '../services/printing.js';
import * as shared from './_doc-shared.js';

const DOC_LABEL = {
  opening: 'party.doc.opening',
  sale: 'party.doc.sale',
  saleReturn: 'party.doc.saleReturn',
  receipt: 'party.doc.receipt',
  payment: 'party.doc.payment',
  purchase: 'party.doc.purchase',
  purchaseReturn: 'party.doc.purchaseReturn',
  voucher: 'party.doc.voucher',
};

/** Signed text amount: "1,234.50", with the sign left to the label. */
const plain = (paisa) => format(Math.abs(paisa), { symbol: false });

/** Money parsed from a field where a leading minus means an advance. Returns { amount, ok }. */
export function parseSigned(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { amount: 0, ok: true };
  const negative = raw.startsWith('-');
  const value = parseRupees(negative ? raw.slice(1).trim() : raw);
  if (value === null) return { amount: 0, ok: false };
  return { amount: negative ? -value : value, ok: true };
}

function owedBadge(kind, owed) {
  if (owed === 0) return shared.badge(t('party.settled'), 'ok');
  if (owed < 0) return shared.badge(t('party.advance'), 'info');
  return shared.badge(kind === 'customer' ? t('party.owesUs') : t('party.weOwe'), 'warn');
}

const statusBadge = (party) =>
  party.active === false ? shared.badge(t('party.inactive'), '') : shared.badge(t('party.active'), 'ok');

/** Reminder text for WhatsApp. Uses the same wording depending on the balance sign. */
export function reminderText({ kind, name, owed, pharmacy }) {
  if (owed > 0) return t(kind === 'customer' ? 'party.wa.customerDue' : 'party.wa.supplierDue', { name, pharmacy, amount: plain(owed) });
  if (owed < 0) return t('party.wa.advance', { name, pharmacy, amount: plain(owed) });
  return t('party.wa.settled', { name, pharmacy });
}

/* ---------- List ---------- */

export function partyListPage(kind) {
  const isCustomer = kind === 'customer';
  let $host = null;
  let unsubscribe = null;
  let rows = [];
  let state = { status: 'active', query: '' };

  const visible = () => {
    const q = state.query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (state.status === 'all' || (state.status === 'active' ? row.active !== false : row.active === false)) &&
        (!q || row.name.toLowerCase().includes(q) || String(row.phone ?? '').toLowerCase().includes(q)),
    );
  };

  function paint() {
    const shown = visible();
    const activeRows = rows.filter((row) => row.active !== false);
    const total = activeRows.reduce((sum, row) => sum + row.owed, 0);
    $host.find('.party-total').html(
      `<span>${esc(t(isCustomer ? 'party.totalReceivable' : 'party.totalPayable'))}</span> ${money(Math.abs(total))}
       <span class="muted small">${esc(total < 0 ? t('party.netAdvance') : '')}</span>`,
    );
    $host.find('.doc-count').text(t(isCustomer ? 'party.countCustomers' : 'party.countSuppliers', { count: shown.length }));
    $host.find('tbody').html(
      shown.length
        ? shown
            .map(
              (row) => `
        <tr>
          <td data-label="${esc(t('party.col.name'))}"><a class="link-btn" href="#/${kind}s/${esc(row.id)}">${esc(row.name)}</a></td>
          <td data-label="${esc(t('party.col.phone'))}">${esc(row.phone)}</td>
          <td class="num" data-label="${esc(t('party.col.balance'))}">${money(Math.abs(row.owed))}</td>
          <td data-label="${esc(t('party.col.state'))}">${owedBadge(kind, row.owed)}</td>
          <td data-label="${esc(t('party.col.status'))}">${statusBadge(row)}</td>
        </tr>`,
            )
            .join('')
        : shared.emptyRow(5, t(isCustomer ? 'party.noneCustomers' : 'party.noneSuppliers')),
    );
  }

  async function load() {
    const summary = await partySummaries(kind, { includeInactive: true });
    rows = summary.rows;
    if (!$host) return;
    paint();
  }

  function exportCsv() {
    const columns = [
      { label: t('party.col.name'), value: (r) => r.name },
      { label: t('party.col.phone'), value: (r) => r.phone },
      { label: t('party.col.balance'), value: (r) => rupeesForCsv(r.owed) },
      { label: t('party.col.status'), value: (r) => (r.active === false ? t('party.inactive') : t('party.active')) },
    ];
    downloadText(`${kind}s-${todayISO()}.csv`, toCsv(columns, visible()));
  }

  function openAdd() {
    const $form = $(`
      <form class="form stack party-form" novalidate>
        <div class="float-field"><input name="name" placeholder=" " autocomplete="off" required><label>${esc(t('party.field.name'))} *</label></div>
        <div class="form-grid">
          <div class="float-field"><input name="phone" inputmode="tel" placeholder=" " autocomplete="off"><label>${esc(t('party.field.phone'))}</label></div>
          <div class="float-field"><input name="email" type="email" placeholder=" " autocomplete="off"><label>${esc(t('party.field.email'))}</label></div>
        </div>
        <div class="float-field"><input name="address" placeholder=" " autocomplete="off"><label>${esc(t('party.field.address'))}</label></div>
        <div class="form-grid">
          <div class="float-field"><input name="opening" inputmode="decimal" placeholder=" " autocomplete="off"><label>${esc(t(isCustomer ? 'party.field.openingCustomer' : 'party.field.openingSupplier'))}</label></div>
          <div class="float-field"><input name="asOf" type="date" value="${todayISO()}"><label>${esc(t('party.field.asOf'))}</label></div>
        </div>
        <p class="muted small">${esc(t('party.openingHelp'))}</p>
        <div class="float-field"><input name="note" placeholder=" " autocomplete="off"><label>${esc(t('party.field.note'))}</label></div>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-footer"><button type="submit" class="btn btn-primary btn-block">${esc(t('party.save'))}</button></div>
      </form>`);
    const dialog = ui.openModal({ title: t(isCustomer ? 'party.addCustomer' : 'party.addSupplier'), body: $form, actions: [] });
    $form.on('submit', async (event) => {
      event.preventDefault();
      const $error = $form.find('.form-error');
      const name = $form.find('[name="name"]').val().trim();
      const opening = parseSigned($form.find('[name="opening"]').val());
      if (!name) return $error.text(t('party.err.name')).prop('hidden', false);
      if (!opening.ok) return $error.text(t('party.err.amount')).prop('hidden', false);
      try {
        await addParty({
          kind,
          name,
          phone: $form.find('[name="phone"]').val(),
          email: $form.find('[name="email"]').val(),
          address: $form.find('[name="address"]').val(),
          note: $form.find('[name="note"]').val(),
          openingAmount: opening.amount,
          asOf: $form.find('[name="asOf"]').val() || todayISO(),
        });
        dialog.close();
        ui.toast(t('party.added'), { type: 'success' });
        await load();
      } catch (err) {
        $error.text(shared.errorText(err)).prop('hidden', false);
      }
    });
    $form.find('[name="name"]').trigger('focus');
  }

  function shell() {
    return `
      ${shared.pageHead(
        t(isCustomer ? 'party.customersTitle' : 'party.suppliersTitle'),
        `<button type="button" class="btn btn-ghost" data-action="csv">${esc(t('doc.csv'))}</button>
         <button type="button" class="btn btn-primary" data-action="add">${esc(t(isCustomer ? 'party.addCustomer' : 'party.addSupplier'))}</button>`,
      )}
      <p class="party-total doc-tiles-line"></p>
      <div class="doc-filters">
        ${shared.searchField(t(isCustomer ? 'party.searchCustomers' : 'party.searchSuppliers'), 'doc-search')}
        ${shared.chipGroup('status', [['active', t('party.active')], ['inactive', t('party.inactive')], ['all', t('doc.all')]], state.status, t('party.statusLabel'))}
      </div>
      <p class="muted small doc-count"></p>
      <div class="table-wrap">
        <table class="table table-cards">
          <thead><tr>
            <th>${esc(t('party.col.name'))}</th><th>${esc(t('party.col.phone'))}</th><th class="num">${esc(t('party.col.balance'))}</th>
            <th>${esc(t('party.col.state'))}</th><th>${esc(t('party.col.status'))}</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>`;
  }

  return {
    route: isCustomer ? '/customers' : '/suppliers',
    title: isCustomer ? 'nav.customers' : 'nav.suppliers',
    async render($root) {
      state = { status: 'active', query: '' };
      $root.html('<div class="doc-root party-root"></div>');
      $host = $root.children('.doc-root');
      $host.html(shell());
      const searchPaint = debounce(() => paint(), 150);
      $host.on('input', '.doc-search', (event) => {
        state.query = event.currentTarget.value;
        searchPaint();
      });
      $host.on('click', '[data-status]', (event) => {
        state.status = event.currentTarget.getAttribute('data-status');
        $host.find('[data-status]').attr('aria-pressed', 'false');
        event.currentTarget.setAttribute('aria-pressed', 'true');
        paint();
      });
      $host.on('click', '[data-action="add"]', openAdd);
      $host.on('click', '[data-action="csv"]', exportCsv);
      await load();
      unsubscribe = events.on('data:changed', ({ stores }) => {
        if (stores.some((s) => (isCustomer ? ['customers', 'ledgerEntries'] : ['suppliers', 'ledgerEntries']).includes(s))) load();
      });
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      $host = null;
      rows = [];
    },
  };
}

/* ---------- Detail ---------- */

export function partyDetailPage(kind) {
  const isCustomer = kind === 'customer';
  let $host = null;
  let unsubscribe = null;
  let partyId = null;

  async function load() {
    const data = await partyStatement(kind, partyId);
    const pharmacy = await db.getSetting('pharmacyName', '');
    if (!$host) return;
    paint(data, pharmacy);
    return data;
  }

  function ledgerRows(rows) {
    return rows
      .map(
        (row) => `
      <tr>
        <td data-label="${esc(t('party.col.date'))}">${esc(formatDate(row.date))}</td>
        <td data-label="${esc(t('party.col.document'))}">${esc(row.memo ?? '')}</td>
        <td data-label="${esc(t('party.col.type'))}">${esc(t(DOC_LABEL[row.docType] ?? 'party.doc.voucher'))}</td>
        <td class="num" data-label="${esc(t('party.col.debit'))}">${row.debit ? money(row.debit) : ''}</td>
        <td class="num" data-label="${esc(t('party.col.credit'))}">${row.credit ? money(row.credit) : ''}</td>
        <td class="num" data-label="${esc(t('party.col.balance'))}">${money(Math.abs(row.owed))}${row.owed < 0 ? ` <span class="muted small">${esc(t('party.advance'))}</span>` : ''}</td>
      </tr>`,
      )
      .join('');
  }

  function paint({ party, rows, owed }, pharmacy) {
    const contact = [party.phone, party.email, party.address].filter(Boolean).join(' · ');
    const reminder = reminderText({ kind, name: party.name, owed, pharmacy });
    const active = party.active !== false;
    $host.find('.party-head').html(`
      <div>
        <h2>${esc(party.name)} ${statusBadge(party)}</h2>
        <p class="muted small">${esc(contact)}</p>
        ${party.note ? `<p class="small">${esc(party.note)}</p>` : ''}
      </div>
      <div class="row party-actions">
        <button type="button" class="btn btn-primary" data-money>${esc(t(isCustomer ? 'party.receive' : 'party.pay'))}</button>
        <button type="button" class="btn btn-soft" data-statement>${esc(t('party.statement'))}</button>
        <a class="btn btn-soft" href="${esc(whatsappLink(reminder, party.phone))}" target="_blank" rel="noopener">${esc(t('party.whatsapp'))}</a>
        <button type="button" class="btn btn-ghost" data-toggle>${esc(t(active ? 'party.deactivate' : 'party.activate'))}</button>
        <a class="btn btn-ghost" href="#/${kind}s">${esc(t('party.back'))}</a>
      </div>`);
    $host.find('.party-tiles').html(
      shared.statTiles([
        [t(owed < 0 ? 'party.advanceHeld' : isCustomer ? 'party.balanceOwed' : 'party.balanceWeOwe'), money(Math.abs(owed))],
        [t('party.entries'), String(rows.length)],
        [t('party.lastMovement'), rows.length ? esc(formatDate(rows[rows.length - 1].date)) : '—'],
      ]),
    );
    $host.find('tbody').html(rows.length ? ledgerRows(rows) : shared.emptyRow(6, t('party.noEntries')));
    $host.find('.party-reminder').text(reminder);
    $host.data('statement', { party, rows, owed, pharmacy });
  }

  function printStatement() {
    const { party, rows, owed, pharmacy } = $host.data('statement');
    const body = rows
      .map(
        (row) => `<tr>
          <td>${esc(formatDate(row.date))}</td><td>${esc(row.memo ?? '')}</td><td>${esc(t(DOC_LABEL[row.docType] ?? 'party.doc.voucher'))}</td>
          <td>${row.debit ? esc(plain(row.debit)) : ''}</td><td>${row.credit ? esc(plain(row.credit)) : ''}</td>
          <td>${esc(plain(row.owed))}${row.owed < 0 ? ` ${esc(t('party.advance'))}` : ''}</td>
        </tr>`,
      )
      .join('');
    printPage(`
      <div class="doc">
        <h1>${esc(t('party.statementTitle'))}</h1>
        <p><strong>${esc(pharmacy)}</strong></p>
        <p>${esc(party.name)} ${esc(party.phone ?? '')} ${esc(party.address ?? '')}</p>
        <p>${esc(t('party.statementAsOf', { date: formatDate(todayISO()) }))}</p>
        <table>
          <thead><tr>
            <th>${esc(t('party.col.date'))}</th><th>${esc(t('party.col.document'))}</th><th>${esc(t('party.col.type'))}</th>
            <th>${esc(t('party.col.debit'))}</th><th>${esc(t('party.col.credit'))}</th><th>${esc(t('party.col.balance'))}</th>
          </tr></thead>
          <tbody>${body || `<tr><td colspan="6">${esc(t('party.noEntries'))}</td></tr>`}</tbody>
        </table>
        <p><strong>${esc(t(owed < 0 ? 'party.closingAdvance' : 'party.closingBalance', { amount: plain(owed) }))}</strong></p>
        <div class="sign"><span>${esc(t('party.signReceived'))}</span><span>${esc(t('party.signPharmacy'))}</span></div>
      </div>`);
  }

  function openMoney() {
    const data = $host.data('statement');
    const accounts = $host.data('accounts');
    const $form = $(`
      <form class="form stack party-money" novalidate>
        <div class="float-field"><input name="amount" inputmode="decimal" placeholder=" " autocomplete="off" required><label>${esc(t('party.field.amount'))} *</label></div>
        <div class="form-grid">
          <label class="field"><span>${esc(t('party.field.account'))}</span>
            <select name="account">${accounts.map((a) => `<option value="${esc(a.code)}">${esc(accountName(a))}</option>`).join('')}</select>
          </label>
          <div class="float-field"><input name="date" type="date" value="${todayISO()}"><label>${esc(t('party.field.date'))}</label></div>
        </div>
        <div class="float-field"><input name="note" placeholder=" " autocomplete="off"><label>${esc(t('party.field.note'))}</label></div>
        <p class="muted small">${esc(t(isCustomer ? 'party.receiveHelp' : 'party.payHelp', { amount: plain(data.owed) }))}</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-footer"><button type="submit" class="btn btn-primary btn-block">${esc(t(isCustomer ? 'party.receive' : 'party.pay'))}</button></div>
      </form>`);
    const dialog = ui.openModal({ title: t(isCustomer ? 'party.receiveTitle' : 'party.payTitle', { name: data.party.name }), body: $form, actions: [] });
    $form.on('submit', async (event) => {
      event.preventDefault();
      const $error = $form.find('.form-error');
      const amount = parseRupees($form.find('[name="amount"]').val().trim());
      if (!amount || amount <= 0) return $error.text(t('party.err.amount')).prop('hidden', false);
      try {
        const common = {
          amount,
          partyId,
          accountCode: $form.find('[name="account"]').val(),
          date: $form.find('[name="date"]').val() || todayISO(),
          note: $form.find('[name="note"]').val(),
        };
        const voucher = isCustomer ? await receiptVoucher(common) : await paymentVoucher(common);
        dialog.close();
        ui.toast(t('party.saved', { number: voucher.number }), { type: 'success' });
        await load();
      } catch (err) {
        $error.text(shared.errorText(err)).prop('hidden', false);
      }
    });
    $form.find('[name="amount"]').trigger('focus');
  }

  async function toggleActive() {
    const data = $host.data('statement');
    await setPartyActive(kind, partyId, data.party.active === false);
    ui.toast(t(data.party.active === false ? 'party.activated' : 'party.deactivated'), { type: 'success' });
    await load();
  }

  function shell() {
    return `
      <div class="party-head page-head"></div>
      <p class="muted small party-reminder doc-banner"></p>
      <div class="party-tiles"></div>
      <div class="table-wrap">
        <table class="table table-cards">
          <thead><tr>
            <th>${esc(t('party.col.date'))}</th><th>${esc(t('party.col.document'))}</th><th>${esc(t('party.col.type'))}</th>
            <th class="num">${esc(t('party.col.debit'))}</th><th class="num">${esc(t('party.col.credit'))}</th><th class="num">${esc(t('party.col.balance'))}</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>`;
  }

  return {
    route: isCustomer ? '/customers/:id' : '/suppliers/:id',
    title: isCustomer ? 'nav.customers' : 'nav.suppliers',
    async render($root, params) {
      partyId = params.id;
      $root.html('<div class="doc-root party-root"></div>');
      $host = $root.children('.doc-root');
      let data = null;
      try {
        data = await partyStatement(kind, partyId);
      } catch {
        data = null;
      }
      if (!data) {
        $host.html(`<section class="card empty-state"><h2>${esc(t('party.notFound'))}</h2>
          <a class="btn btn-primary" href="#/${kind}s">${esc(t('party.back'))}</a></section>`);
        return;
      }
      $host.html(shell());
      $host.on('click', '[data-money]', openMoney);
      $host.on('click', '[data-statement]', printStatement);
      $host.on('click', '[data-toggle]', toggleActive);
      $host.data('accounts', await paymentAccounts());
      await load();
      unsubscribe = events.on('data:changed', ({ stores }) => {
        if (stores.some((s) => ['ledgerEntries', 'sales', 'purchases', 'vouchers', 'returns', 'customers', 'suppliers'].includes(s))) load();
      });
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      $host = null;
    },
  };
}


// Cash Book & Payments. Pick a money account (cash in hand, a bank or a wallet) and see every movement on it:
// sales, purchases, receipts from customers, payments to suppliers, expenses, other income, transfers, returns.
// Five buttons post the usual vouchers: Receive, Pay, Expense, Income and Transfer.
import * as events from '../core/events.js';
import * as ui from '../core/ui.js';
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate, todayISO } from '../core/dates.js';
import { parseRupees } from '../core/money.js';
import { downloadText, rupeesForCsv, toCsv } from '../core/csv.js';
import { navigate } from '../core/router.js';
import { listCustomers, listSuppliers } from '../services/parties.js';
import {
  ACCOUNT,
  accountBalance,
  accountName,
  expenseVoucher,
  incomeVoucher,
  ledgerByAccount,
  listAccounts,
  paymentAccounts,
  paymentVoucher,
  receiptVoucher,
  transfer,
} from '../services/ledger.js';
import * as shared from './_doc-shared.js';

export const route = '/vouchers';
export const title = 'nav.cashBook';

/** Ledger docType → the filter group it belongs to. Legacy 'voucher' rows are sorted by their number prefix. */
const GROUP_OF = {
  sale: 'sales',
  purchase: 'purchases',
  receipt: 'receipts',
  payment: 'payments',
  expense: 'expenses',
  income: 'incomes',
  transfer: 'transfers',
  saleReturn: 'returns',
  purchaseReturn: 'returns',
  opening: 'other',
};
const LEGACY_PREFIX = { RCV: 'receipts', PAY: 'payments', TRF: 'transfers' };
const GROUPS = ['all', 'receipts', 'payments', 'expenses', 'incomes', 'transfers', 'sales', 'purchases', 'returns'];

let $host = null;
let unsubscribe = null;
let state = { account: ACCOUNT.cash, period: 'month', from: '', to: '', group: 'all' };
let accounts = [];
let entries = [];
let balanceOf = new Map();
let parties = new Map();

const groupOf = (row) => GROUP_OF[row.docType] ?? LEGACY_PREFIX[String(row.memo ?? '').slice(0, 3)] ?? 'other';

function visibleEntries() {
  const range = shared.rangeOf(state);
  return entries.filter(
    (row) => row.date >= range.from && row.date <= range.to && (state.group === 'all' || groupOf(row) === state.group),
  );
}

/** Received and paid for the period. Transfers move money between accounts, so they are left out of both. */
function totalsOf(rows) {
  const moved = rows.filter((row) => groupOf(row) !== 'transfers');
  return {
    received: moved.reduce((sum, row) => sum + row.debit, 0),
    paid: moved.reduce((sum, row) => sum + row.credit, 0),
  };
}

function rowHtml(row) {
  const party = row.partyId ? parties.get(row.partyId) ?? '' : '';
  return `
    <tr>
      <td data-label="${esc(t('cash.col.date'))}">${esc(formatDate(row.date))}</td>
      <td data-label="${esc(t('cash.col.document'))}">${esc(row.memo ?? '')}</td>
      <td data-label="${esc(t('cash.col.type'))}">${esc(t(`cash.group.${groupOf(row)}`))}</td>
      <td data-label="${esc(t('cash.col.party'))}">${esc(party)}</td>
      <td class="num" data-label="${esc(t('cash.col.in'))}">${row.debit ? money(row.debit) : ''}</td>
      <td class="num" data-label="${esc(t('cash.col.out'))}">${row.credit ? money(row.credit) : ''}</td>
      <td class="num" data-label="${esc(t('cash.col.balance'))}">${money(row.running)}</td>
    </tr>`;
}

function paint() {
  const shown = visibleEntries();
  const { received, paid } = totalsOf(shown);
  const cash = balanceOf.get(ACCOUNT.cash) ?? 0;
  const otherMoney = [...balanceOf.entries()]
    .filter(([code]) => code !== ACCOUNT.cash && accounts.find((a) => a.code === code)?.kind)
    .reduce((sum, [, value]) => sum + value, 0);
  $host.find('.cash-tiles').html(
    shared.statTiles([
      [t('cash.tile.cash'), money(cash)],
      [t('cash.tile.banks'), money(otherMoney)],
      [t('cash.tile.received'), money(received)],
      [t('cash.tile.paid'), money(paid)],
    ]),
  );
  $host.find('.doc-count').text(t('cash.count', { count: shown.length }));
  // Newest first on the screen; the running balance is computed in date order.
  const newestFirst = [...shown].reverse();
  $host.find('tbody').html(newestFirst.length ? newestFirst.map(rowHtml).join('') : shared.emptyRow(7, t('cash.none')));
}

async function load() {
  const [list, customers, suppliers] = await Promise.all([ledgerByAccount(state.account), listCustomers(), listSuppliers()]);
  entries = list;
  parties = new Map([...customers, ...suppliers].map((p) => [p.id, p.name]));
  accounts = await paymentAccounts();
  const cash = await accountBalance(ACCOUNT.cash);
  balanceOf = new Map([[ACCOUNT.cash, cash.balance]]);
  for (const account of accounts) {
    if (!balanceOf.has(account.code)) balanceOf.set(account.code, (await accountBalance(account.code)).balance);
  }
  if (!$host) return;
  $host.find('.cash-account').html(accountOptions()).val(state.account);
  paint();
}

/* ---------- Voucher forms ---------- */

function accountSelect(name, list, selected) {
  return `<select name="${name}">${list
    .map((a) => `<option value="${esc(a.code)}"${a.code === selected ? ' selected' : ''}>${esc(accountName(a))}</option>`)
    .join('')}</select>`;
}

const VOUCHER_FORMS = {
  receive: { title: 'cash.receive', party: 'customer' },
  pay: { title: 'cash.pay', party: 'supplier' },
  expense: { title: 'cash.expense' },
  income: { title: 'cash.income' },
  transfer: { title: 'cash.transfer' },
};

/** Account, party and category fields for one voucher kind. */
async function voucherFields(kind) {
  const moneyAccounts = accounts;
  const all = await listAccounts();
  const partyList = kind === 'receive' ? await listCustomers() : kind === 'pay' ? await listSuppliers() : [];
  const parties = partyList.filter((p) => p.active !== false);
  const categories = kind === 'expense'
    ? all.filter((a) => a.type === 'expense' && !['5000', '5100', '5200'].includes(a.code))
    : kind === 'income'
      ? all.filter((a) => a.type === 'income' && !['4000', '4100'].includes(a.code))
      : [];
  const from = state.account;
  const fields = [];
  if (VOUCHER_FORMS[kind].party) {
    fields.push(`<label class="field"><span>${esc(t(`cash.field.${VOUCHER_FORMS[kind].party}`))} *</span>
      <select name="party" required><option value="">${esc(t('cash.pickParty'))}</option>${parties
        .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
        .join('')}</select></label>`);
  }
  if (kind === 'transfer') {
    fields.push(`<label class="field"><span>${esc(t('cash.field.from'))}</span>${accountSelect('from', moneyAccounts, from)}</label>`);
    fields.push(`<label class="field"><span>${esc(t('cash.field.to'))}</span>${accountSelect('to', moneyAccounts, moneyAccounts.find((a) => a.code !== from)?.code ?? from)}</label>`);
  } else {
    if (categories.length) {
      const label = kind === 'expense' ? 'cash.field.expenseAccount' : 'cash.field.incomeAccount';
      const fallback = kind === 'expense' ? ACCOUNT.generalExpenses : ACCOUNT.otherIncome;
      fields.push(`<label class="field"><span>${esc(t(label))}</span>${accountSelect('category', categories, fallback)}</label>`);
    }
    const label = kind === 'receive' || kind === 'income' ? 'cash.field.receivedIn' : 'cash.field.paidFrom';
    fields.push(`<label class="field"><span>${esc(t(label))}</span>${accountSelect('account', moneyAccounts, from)}</label>`);
  }
  return fields.join('');
}

async function openVoucher(kind) {
  const fields = await voucherFields(kind);
  const $form = $(`
    <form class="form stack cash-form" novalidate>
      ${fields}
      <div class="form-grid">
        <div class="float-field"><input name="amount" inputmode="decimal" placeholder=" " autocomplete="off" required><label>${esc(t('cash.field.amount'))} *</label></div>
        <div class="float-field"><input name="date" type="date" value="${todayISO()}"><label>${esc(t('cash.field.date'))}</label></div>
      </div>
      <div class="float-field"><input name="note" placeholder=" " autocomplete="off"><label>${esc(t('cash.field.note'))}</label></div>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-footer"><button type="submit" class="btn btn-primary btn-block">${esc(t(VOUCHER_FORMS[kind].title))}</button></div>
    </form>`);
  const dialog = ui.openModal({ title: t(VOUCHER_FORMS[kind].title), body: $form, actions: [] });
  $form.on('submit', async (event) => {
    event.preventDefault();
    const $error = $form.find('.form-error');
    const field = (name) => $form.find(`[name="${name}"]`).val();
    const amount = parseRupees(String(field('amount') ?? '').trim());
    if (!amount || amount <= 0) return $error.text(t('cash.err.amount')).prop('hidden', false);
    const common = { amount, date: field('date') || todayISO(), note: field('note') };
    try {
      let voucher;
      if (kind === 'receive') voucher = await receiptVoucher({ ...common, partyId: field('party'), accountCode: field('account') });
      if (kind === 'pay') voucher = await paymentVoucher({ ...common, partyId: field('party'), accountCode: field('account') });
      if (kind === 'expense') voucher = await expenseVoucher({ ...common, expenseCode: field('category'), fromCode: field('account') });
      if (kind === 'income') voucher = await incomeVoucher({ ...common, incomeCode: field('category'), toCode: field('account') });
      if (kind === 'transfer') voucher = await transfer({ ...common, fromCode: field('from'), toCode: field('to') });
      dialog.close();
      ui.toast(t('cash.saved', { number: voucher.number }), { type: 'success' });
      await load();
    } catch (err) {
      $error.text(shared.errorText(err)).prop('hidden', false);
    }
  });
  $form.find('[name="amount"]').trigger('focus');
}

function accountOptions() {
  return accounts.map((a) => `<option value="${esc(a.code)}">${esc(accountName(a))}</option>`).join('');
}

function shell() {
  return `
    ${shared.pageHead(
      t('cash.title'),
      `<button type="button" class="btn btn-ghost" data-action="csv">${esc(t('doc.csv'))}</button>`,
    )}
    <div class="cash-tiles"></div>
    <div class="cash-actions row">
      <button type="button" class="btn btn-primary" data-voucher="receive">${esc(t('cash.receive'))}</button>
      <button type="button" class="btn btn-soft" data-voucher="pay">${esc(t('cash.pay'))}</button>
      <button type="button" class="btn btn-soft" data-voucher="expense">${esc(t('cash.expense'))}</button>
      <button type="button" class="btn btn-soft" data-voucher="income">${esc(t('cash.income'))}</button>
      <button type="button" class="btn btn-soft" data-voucher="transfer">${esc(t('cash.transfer'))}</button>
    </div>
    <div class="doc-filters cash-filters">
      <label class="field cash-account-pick"><span>${esc(t('cash.account'))}</span>
        <select class="cash-account">${accountOptions()}</select>
      </label>
      ${shared.periodBar(state)}
    </div>
    ${shared.chipGroup('group', GROUPS.map((g) => [g, t(`cash.group.${g}`)]), state.group, t('cash.groupLabel'))}
    <p class="muted small doc-count"></p>
    <div class="table-wrap">
      <table class="table table-cards">
        <thead><tr>
          <th>${esc(t('cash.col.date'))}</th><th>${esc(t('cash.col.document'))}</th><th>${esc(t('cash.col.type'))}</th>
          <th>${esc(t('cash.col.party'))}</th><th class="num">${esc(t('cash.col.in'))}</th><th class="num">${esc(t('cash.col.out'))}</th>
          <th class="num">${esc(t('cash.col.balance'))}</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <p class="muted small"><a class="link-btn" href="#/accounts/${esc(state.account)}">${esc(t('cash.openAccount'))}</a></p>`;
}

function exportCsv() {
  const columns = [
    { label: t('cash.col.date'), value: (r) => r.date },
    { label: t('cash.col.document'), value: (r) => r.memo ?? '' },
    { label: t('cash.col.type'), value: (r) => t(`cash.group.${groupOf(r)}`) },
    { label: t('cash.col.party'), value: (r) => (r.partyId ? parties.get(r.partyId) ?? '' : '') },
    { label: t('cash.col.in'), value: (r) => rupeesForCsv(r.debit) },
    { label: t('cash.col.out'), value: (r) => rupeesForCsv(r.credit) },
    { label: t('cash.col.balance'), value: (r) => rupeesForCsv(r.running) },
  ];
  downloadText(`cash-book-${state.account}-${todayISO()}.csv`, toCsv(columns, visibleEntries()));
}

function bind() {
  $host.on('change', '.cash-account', (event) => {
    state.account = event.currentTarget.value;
    navigate(`/vouchers?account=${encodeURIComponent(state.account)}`);
    load();
  });
  $host.on('click', '[data-voucher]', (event) => openVoucher(event.currentTarget.getAttribute('data-voucher')));
  $host.on('click', '[data-group]', (event) => {
    state.group = event.currentTarget.getAttribute('data-group');
    $host.find('[data-group]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    paint();
  });
  $host.on('click', '[data-period]', (event) => {
    $host.find('[data-period]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    state.period = event.currentTarget.getAttribute('data-period');
    $host.find('[name="from"], [name="to"]').val('');
    Object.assign(state, { from: '', to: '' });
    paint();
  });
  $host.on('change', '[name="from"], [name="to"]', () => {
    $host.find('[data-period]').attr('aria-pressed', 'false');
    Object.assign(state, shared.readPeriod($host), { period: 'custom' });
    paint();
  });
  $host.on('click', '[data-action="csv"]', exportCsv);
}

export async function render($root, params, query = {}) {
  state = { account: query.account ?? ACCOUNT.cash, period: 'month', from: '', to: '', group: 'all' };
  $root.html('<div class="doc-root cash-root"></div>');
  $host = $root.children('.doc-root');
  $host.html(shell());
  bind();
  await load();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['ledgerEntries', 'vouchers', 'customers', 'suppliers', 'accounts'].includes(s))) load();
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
  entries = [];
}

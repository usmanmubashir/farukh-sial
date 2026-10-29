// Accounts: the chart of accounts with live balances, grouped the way the owner reads them. System accounts
// are locked. Banks and wallets can be added here, and then appear as payment options in the sale and
// purchase screens. Opening an account shows its ledger with a running balance (the cash book for money accounts).
import * as events from '../core/events.js';
import * as ui from '../core/ui.js';
import { esc, money } from '../core/ui.js';
import { t } from '../core/i18n.js';
import { formatDate, todayISO } from '../core/dates.js';
import { downloadText, rupeesForCsv, toCsv } from '../core/csv.js';
import { addPaymentAccount, accountBalance, accountKind, accountName, ledgerByAccount, listAccounts, naturalBalance } from '../services/ledger.js';
import * as shared from './_doc-shared.js';
import { parseSigned } from './_party.js';

export const route = '/accounts';
export const title = 'nav.ledger';

/** The sections of the list, in order. A section takes the accounts whose code is listed, or whose kind matches. */
const SECTIONS = [
  { key: 'receivables', codes: ['1100', '2000'] },
  { key: 'cash', match: (a) => ['cash', 'bank', 'wallet'].includes(accountKind(a)) },
  { key: 'inventory', codes: ['1200'] },
  { key: 'income', types: ['income'] },
  { key: 'expense', types: ['expense'] },
  { key: 'liability', types: ['liability'] },
  { key: 'equity', types: ['equity'] },
];

const DOC_LABEL = {
  opening: 'acct.doc.opening',
  sale: 'acct.doc.sale',
  saleReturn: 'acct.doc.saleReturn',
  purchase: 'acct.doc.purchase',
  purchaseReturn: 'acct.doc.purchaseReturn',
  receipt: 'acct.doc.receipt',
  payment: 'acct.doc.payment',
  expense: 'acct.doc.expense',
  income: 'acct.doc.income',
  transfer: 'acct.doc.transfer',
  voucher: 'acct.doc.voucher',
};

let $host = null;
let unsubscribe = null;
let period = { period: 'all', from: '', to: '' };

function sectionOf(account) {
  return SECTIONS.find((s) => (s.codes ? s.codes.includes(account.code) : s.match ? s.match(account) : s.types?.includes(account.type)));
}

async function listPage() {
  const accounts = await listAccounts();
  const balances = new Map();
  for (const account of accounts) balances.set(account.code, await accountBalance(account.code));

  const sections = SECTIONS.map((section) => {
    const rows = accounts.filter((a) => sectionOf(a) === section);
    if (rows.length === 0) return '';
    return `
      <section class="card acct-section" aria-labelledby="acct-${section.key}">
        <h3 class="doc-legend" id="acct-${section.key}">${esc(t(`acct.section.${section.key}`))}</h3>
        <ul class="acct-list">
          ${rows
            .map((a) => {
              const value = naturalBalance(a, balances.get(a.code).balance);
              return `
            <li>
              <a class="acct-row" href="#/accounts/${esc(a.code)}">
                <span class="acct-main"><strong>${esc(accountName(a))}</strong>
                  <span class="muted small">${esc(a.code)} · ${esc(t(`acct.type.${a.type}`))}</span></span>
                <span class="acct-side">
                  <span class="num">${money(value)}</span>
                  ${a.system ? `<span class="badge">${esc(t('acct.locked'))}</span>` : ''}
                </span>
              </a>
            </li>`;
            })
            .join('')}
        </ul>
      </section>`;
  }).join('');

  $host.html(`
    ${shared.pageHead(
      t('acct.title'),
      `<button type="button" class="btn btn-primary" data-action="add">${esc(t('acct.addPayment'))}</button>`,
    )}
    <p class="muted">${esc(t('acct.intro'))}</p>
    ${sections}`);
}

function openAdd() {
  const $form = $(`
    <form class="form stack acct-form" novalidate>
      <div class="float-field"><input name="name" placeholder=" " autocomplete="off" required><label>${esc(t('acct.field.name'))} *</label></div>
      <label class="field"><span>${esc(t('acct.field.kind'))}</span>
        <select name="kind"><option value="bank">${esc(t('acct.kind.bank'))}</option><option value="wallet">${esc(t('acct.kind.wallet'))}</option></select>
      </label>
      <div class="form-grid">
        <div class="float-field"><input name="opening" inputmode="decimal" placeholder=" " autocomplete="off"><label>${esc(t('acct.field.opening'))}</label></div>
        <div class="float-field"><input name="date" type="date" value="${todayISO()}"><label>${esc(t('acct.field.asOf'))}</label></div>
      </div>
      <p class="muted small">${esc(t('acct.openingHelp'))}</p>
      <div class="float-field"><input name="note" placeholder=" " autocomplete="off"><label>${esc(t('acct.field.note'))}</label></div>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-footer"><button type="submit" class="btn btn-primary btn-block">${esc(t('acct.save'))}</button></div>
    </form>`);
  const dialog = ui.openModal({ title: t('acct.addPayment'), body: $form, actions: [] });
  $form.on('submit', async (event) => {
    event.preventDefault();
    const $error = $form.find('.form-error');
    const name = $form.find('[name="name"]').val().trim();
    const opening = parseSigned($form.find('[name="opening"]').val());
    if (!name) return $error.text(t('acct.err.name')).prop('hidden', false);
    if (!opening.ok) return $error.text(t('acct.err.amount')).prop('hidden', false);
    try {
      await addPaymentAccount({
        name,
        kind: $form.find('[name="kind"]').val(),
        openingBalance: opening.amount,
        date: $form.find('[name="date"]').val() || todayISO(),
        note: $form.find('[name="note"]').val(),
      });
      dialog.close();
      ui.toast(t('acct.added'), { type: 'success' });
      await listPage();
    } catch (err) {
      $error.text(shared.errorText(err)).prop('hidden', false);
    }
  });
  $form.find('[name="name"]').trigger('focus');
}

async function drillPage(code) {
  const accounts = await listAccounts();
  const account = accounts.find((a) => a.code === code);
  if (!account) {
    $host.html(`<section class="card empty-state"><h2>${esc(t('acct.notFound'))}</h2>
      <a class="btn btn-primary" href="#/accounts">${esc(t('acct.back'))}</a></section>`);
    return;
  }
  const current = await accountBalance(code);
  const isMoneyAccount = Boolean(accountKind(account));
  const rows = await ledgerByAccount(code);
  const range = shared.rangeOf(period);
  const shown = rows.filter((r) => r.date >= range.from && r.date <= range.to);
  const { debit, credit } = shown.reduce((sum, r) => ({ debit: sum.debit + r.debit, credit: sum.credit + r.credit }), { debit: 0, credit: 0 });

  const body = shown
    .slice()
    .reverse()
    .map(
      (r) => `
      <tr>
        <td data-label="${esc(t('acct.col.date'))}">${esc(formatDate(r.date))}</td>
        <td data-label="${esc(t('acct.col.document'))}">${esc(r.memo ?? '')}</td>
        <td data-label="${esc(t('acct.col.type'))}">${esc(t(DOC_LABEL[r.docType] ?? 'acct.doc.voucher'))}</td>
        <td class="num" data-label="${esc(t('acct.col.in'))}">${r.debit ? money(r.debit) : ''}</td>
        <td class="num" data-label="${esc(t('acct.col.out'))}">${r.credit ? money(r.credit) : ''}</td>
        <td class="num" data-label="${esc(t('acct.col.balance'))}">${money(naturalBalance(account, r.running))}</td>
      </tr>`,
    )
    .join('');

  $host.html(`
    ${shared.pageHead(
      accountName(account),
      `<a class="btn btn-ghost" href="#/accounts">${esc(t('acct.back'))}</a>
       ${isMoneyAccount ? `<a class="btn btn-soft" href="#/vouchers?account=${esc(code)}">${esc(t('acct.cashBook'))}</a>` : ''}
       <button type="button" class="btn btn-ghost" data-action="csv">${esc(t('doc.csv'))}</button>`,
    )}
    <p class="muted small">${esc(code)} · ${esc(t(`acct.type.${account.type}`))} · ${esc(account.system ? t('acct.locked') : t('acct.custom'))}</p>
    ${shared.statTiles([
      [t('acct.tile.balance'), money(naturalBalance(account, current.balance))],
      [t('acct.tile.in'), money(debit)],
      [t('acct.tile.out'), money(credit)],
    ])}
    ${shared.periodBar(period)}
    <div class="table-wrap">
      <table class="table table-cards">
        <thead><tr>
          <th>${esc(t('acct.col.date'))}</th><th>${esc(t('acct.col.document'))}</th><th>${esc(t('acct.col.type'))}</th>
          <th class="num">${esc(t('acct.col.in'))}</th><th class="num">${esc(t('acct.col.out'))}</th><th class="num">${esc(t('acct.col.balance'))}</th>
        </tr></thead>
        <tbody>${body || shared.emptyRow(6, t('acct.noEntries'))}</tbody>
      </table>
    </div>`);

  $host.data('drill', { account, rows: shown });
}

function exportDrill() {
  const { account, rows } = $host.data('drill');
  const columns = [
    { label: t('acct.col.date'), value: (r) => r.date },
    { label: t('acct.col.document'), value: (r) => r.memo ?? '' },
    { label: t('acct.col.type'), value: (r) => t(DOC_LABEL[r.docType] ?? 'acct.doc.voucher') },
    { label: t('acct.col.in'), value: (r) => rupeesForCsv(r.debit) },
    { label: t('acct.col.out'), value: (r) => rupeesForCsv(r.credit) },
    { label: t('acct.col.balance'), value: (r) => rupeesForCsv(naturalBalance(account, r.running)) },
  ];
  downloadText(`account-${account.code}-${todayISO()}.csv`, toCsv(columns, rows));
}

export async function render($root, params = {}) {
  period = { period: 'all', from: '', to: '' };
  $root.html('<div class="doc-root acct-root"></div>');
  $host = $root.children('.doc-root');
  $host.on('click', '[data-action="add"]', openAdd);
  $host.on('click', '[data-action="csv"]', exportDrill);
  $host.on('click', '[data-period]', (event) => {
    $host.find('[data-period]').attr('aria-pressed', 'false');
    event.currentTarget.setAttribute('aria-pressed', 'true');
    period = { period: event.currentTarget.getAttribute('data-period'), from: '', to: '' };
    drillPage(params.code);
  });
  $host.on('change', '[name="from"], [name="to"]', () => {
    period = { ...shared.readPeriod($host), period: 'custom' };
    drillPage(params.code);
  });
  if (params.code) await drillPage(params.code);
  else await listPage();
  unsubscribe = events.on('data:changed', ({ stores }) => {
    if (stores.some((s) => ['ledgerEntries', 'accounts'].includes(s))) {
      if (params.code) drillPage(params.code);
      else listPage();
    }
  });
}

export function destroy() {
  unsubscribe?.();
  unsubscribe = null;
  $host = null;
}

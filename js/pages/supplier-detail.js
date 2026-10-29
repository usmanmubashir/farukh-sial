// One supplier: ledger, pay them, statement, WhatsApp reminder, activate or deactivate.
import { partyDetailPage } from './_party.js';

const page = partyDetailPage('supplier');
export const { route, title, render, destroy } = page;

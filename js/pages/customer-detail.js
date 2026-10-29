// One customer: ledger, receive a payment, statement, WhatsApp reminder, activate or deactivate.
import { partyDetailPage } from './_party.js';

const page = partyDetailPage('customer');
export const { route, title, render, destroy } = page;

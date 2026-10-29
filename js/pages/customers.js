// Customers: who owes the pharmacy. Balances come from the ledger (account 1100).
import { partyListPage } from './_party.js';

const page = partyListPage('customer');
export const { route, title, render, destroy } = page;

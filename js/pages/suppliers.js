// Suppliers: whom the pharmacy owes. Balances come from the ledger (account 2000).
import { partyListPage } from './_party.js';

const page = partyListPage('supplier');
export const { route, title, render, destroy } = page;

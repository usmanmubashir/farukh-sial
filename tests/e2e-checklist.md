# End-to-end checklist (40 scenarios)

Run against a served copy of the app (`node tests/serve.mjs`, then open `http://localhost:8787/index.html`) on a fresh browser profile unless a step says otherwise. Mark each result: **Pass**, **Fail** (write what happened), or **Not run** (with the reason). Automated checks are noted in the last column and are run by the scripts in `scripts/` and `tests/`.

| # | Area | Scenario | Steps | Expected | Result |
|---|---|---|---|---|---|
| 1 | Setup | First run creates the owner | Open the app with no data. Enter pharmacy name, username, password (twice). Submit. | Lands on the dashboard, signed in. Header shows the pharmacy name. | Pass. Ran in the in-app browser on a fresh database. |
| 2 | Auth | Wrong password is refused | Sign out. Sign in with a wrong password. | An error appears under the form. Nothing is revealed about which part was wrong. | Pass. Message: "The username or password is incorrect." |
| 3 | Auth | Sign-out returns to the login screen | Use the avatar menu → Sign out → confirm. | Login screen. Pressing Back does not show private data. | Pass. Returns to #/login. |
| 4 | Auth | Session length is enforced | Set the session to 1 hour in Settings. Change the clock (or wait). Reload. | Asks for the password again. Data is still there after signing in. | Not run. Needs a one-hour wait or a clock change. |
| 5 | Medicines | Add a medicine | Medicines → Add. Fill name, strength, pack size, prices. Save. | It appears in the list at once, with a "Saved" toast. | Not run. |
| 6 | Medicines | Save is protected from a double tap | Add a medicine. Tap Save twice quickly. | One medicine is created, not two. | Partial. Guard checked with a probe form: 3 fast submits give 1 call, 3 fast clicks give 1. The medicine form itself was not exercised. |
| 7 | Medicines | Edit a price | Open a medicine, change the sale price, save. | The new price shows in the list and on the sale screen. | Not run. |
| 8 | Medicines | Popular medicines can be added | Settings → App and data → Add popular Pakistani medicines. | The list grows. Running it again does not duplicate the same names. | Not run. |
| 9 | Stock | A purchase creates a batch | Purchases → New. Add a medicine line with batch and expiry. Save. | Stock page shows the batch with the units received. | Not run. |
| 10 | Stock | Expiring batches are flagged | Create a batch that expires in 30 days. Open Expiry. | It is in the list and marked as soon to expire. | Not run. |
| 11 | Stock | Recalculate stock fixes a wrong cache | Settings → Recalculate stock. | Message says how many batches were checked and corrected. Stock figures do not change for a correct database. | Not run. |
| 12 | Sale | Keyboard-only sale of three items under 10 seconds | On the sale screen, search and add three medicines with the keyboard only. Press F4 and pay in cash. | Completes in under 10 s. Receipt screen appears. No mouse use. | Not run. Needs the keyboard timing run by hand. |
| 13 | Sale | Out-of-stock item is refused | Search a medicine with zero stock and try to add it. | It is not added. A clear message says it is out of stock. | Not run. |
| 14 | Sale | Rx medicine needs patient and doctor | Add a controlled medicine. Try to pay with the patient and doctor blank. | Payment is blocked until both are entered (rule on by default). | Not run. |
| 15 | Sale | Hold and resume a sale | Add items. Hold the sale. Start a new sale. Resume the held one. | The held items come back exactly. | Not run. |
| 16 | Sale | Discard a held sale can be undone | Hold a sale. Open held sales → Discard. Tap Undo in the toast. | The held sale is back in the list. | Not run. Undo is wired (services restoreHeldCart, toast action). Not clicked. |
| 17 | Sale | Void a sale on the same day | Sales → open today's sale → Void with a reason. | Stock returns to the batch. The sale shows as void. Ledger reverses. | Not run. |
| 18 | Returns | Sale return restocks | Returns → new sale return against a sale. | Stock goes back. Customer credit or refund is recorded. | Not run. |
| 19 | Returns | Purchase return reduces stock | Returns → new purchase return against a purchase. | Stock goes down. Supplier balance changes. | Not run. |
| 20 | Parties | Credit sale then receipt clears the balance | Create a credit sale for a customer, then take a receipt for the full amount. | Customer balance is zero. Trial balance still zero difference. | Not run. Ledger rules covered by tests/services.test.html (337 checks). |
| 21 | Parties | Supplier payment | Suppliers → open a supplier with a balance → Pay. | Supplier balance reduces. Cash book shows the payment. | Not run. |
| 22 | Cash | Expense voucher | Cash book → Expense. Enter amount and note. | Cash goes down. Entry appears in the list. | Not run. |
| 23 | Ledger | Trial balance is balanced | Accounts → check the trial balance total. | Debits equal credits. | Partial. The two-device simulation checks balance on each device (difference 0). |
| 24 | Reports | Daily sales agree with the dashboard | Note today's sales on the dashboard. Open Reports → daily sales. | Same totals. | Not run. Rollups covered by services tests. |
| 25 | Reports | CSV export opens in a spreadsheet | Reports → any report → Export CSV. Open the file. | Western digits, UTF-8 text, columns with headings. | Not run. |
| 26 | Language | Switch to Urdu and RTL | Tap اردو in the header. Visit every main page. | Labels are Urdu. Layout is right to left. Nothing is cut off at 380 px. | Pass for direction and overflow: dir=rtl, lang=ur, no horizontal scroll at 588 px. Not checked at 380 px. |
| 27 | Language | Urdu digits option | Settings → Number digits → Urdu. | Displayed numbers use Urdu digits. CSV still uses Western digits. | Not run. |
| 28 | Backup | Backup file downloads | Backup → Back up now. | A JSON (or gzip) file is saved. Toast confirms. | Not run. Needs a file save. |
| 29 | Backup | Restore refuses a wrong file | Backup → choose a non-backup file. | Error: not a Shifa Pharmacy backup. Nothing changes. | Not run. |
| 30 | Backup | Restore needs the typed word | Choose a valid backup. Do not type RESTORE. | Restore button stays disabled. | Not run. |
| 31 | Robustness | Uncaught error shows a toast and is logged | In the console run a function that throws inside the page's event loop (for example `setTimeout(() => { throw new Error('e2e') })`). | Toast "Something unexpected happened". An errorLog row exists in IndexedDB. | Pass. Toast "Something unexpected happened" shown, one row written to errorLog. |
| 32 | Security | No Content Security Policy violations | Open each main page with the console open. | No "Refused to" errors. | Pass. Lighthouse Best Practices 100 (no console errors). CSP was blocking app.js until this pass fixed it. |
| 33 | Robustness | Storage-full message | Not reproducible without filling the device. | Storage-full message shown if a write fails with QuotaExceededError. | Not run. Cannot fill the device in a test. |
| 34 | Robustness | Schema upgrade from v1 keeps the data | Open `tests/migration.html`. | All checks pass. | Pass. tests/migration.html: 12 of 12 checks, from a real v1 database to v5. |
| 35 | Sync | Bad sync server is reported, not silent | Settings → Sync: enter `https://invalid.example.test`, any key, email, password. Connect. | Error under the form. The app keeps working. | Pass. Error shown under the form. Note: the reason text is still English (open item). |
| 36 | Sync | Offline pill and queue | Turn off the network (DevTools → Offline). Make a sale. | Header says Offline. Sale is saved and queued. | Partial. Offline pill and banner verified. Queueing and auto-sync verified in the simulation, not via DevTools offline mode. |
| 37 | Sync | Two devices converge | Open `tests/sync-sim.html`. | 20 of 20 checks pass. | Pass. tests/sync-sim.html: 20 of 20 checks. |
| 38 | A11y | Focus stays inside a dialog | Open any dialog (for example sign-out confirm). Press Tab repeatedly. | Focus cycles inside the dialog. Escape closes it and returns focus. | Pass. Tab cycles inside the dialog for 8 presses; Escape closes it. |
| 39 | A11y | Reduce motion switch | Settings → Appearance → Reduce motion on. | Slides, bounces and counting stop. Turning it off restores them. | Pass. With the class on, transitions and animations drop to about 0 s. Toggle not clicked. |
| 40 | A11y | Contrast in light and dark | Run `node scripts/audit-contrast.mjs`. Switch to dark theme and look at the dashboard. | Audit passes. Text is readable in both themes. | Pass for the audit: scripts/audit-contrast.mjs passes in both themes. Dark theme not inspected by eye. |

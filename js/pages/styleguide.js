// Styleguide (dev only, see the route table in js/app.js). Shows every component and motion pattern,
// with toggles for theme, RTL and reduced motion.
// Exception to the i18n rule: this is a developer page, so its labels are plain English.
import * as anim from '../core/anim.js';
import * as i18n from '../core/i18n.js';
import * as store from '../core/store.js';
import * as ui from '../core/ui.js';

export const route = '/styleguide';
export const title = 'styleguide.title';

const ACCENTS = ['green', 'blue', 'orange', 'teal', 'purple', 'cyan', 'pink', 'amber'];
const TILE_ICONS = ['cart', 'products', 'purchase', 'stock', 'customers', 'ledger', 'reports', 'backup'];
const SWATCHES = [
  ['brand start', '#047857'], ['brand end', '#0f766e'], ['n-100', 'var(--n-100)'], ['n-300', 'var(--n-300)'],
  ['n-600', 'var(--n-600)'], ['n-900', 'var(--n-900)'], ['success', 'var(--c-ok)'], ['warning', 'var(--c-warn)'],
  ['danger', 'var(--c-danger)'], ['info', 'var(--c-info)'],
];

const section = (name, body) => `<section class="sg-section" data-anim="rise"><h2>${name}</h2>${body}</section>`;

function colours() {
  const brand = SWATCHES.map(([name, value]) => `<div class="swatch"><div class="swatch-chip" style="background:${value}"></div>${name}</div>`).join('');
  const accents = ACCENTS.map(
    (name) =>
      `<div class="swatch"><div class="swatch-chip" style="background:var(--accent-${name}-grad);box-shadow:0 10px 22px -8px var(--accent-${name}-glow)"></div>${name}</div>`,
  ).join('');
  return section(
    'Colour',
    `<div class="sg-grid cols-4">${brand}</div><h3>Feature accents (gradient, glow)</h3><div class="sg-grid cols-4">${accents}</div>`,
  );
}

function typography() {
  return section(
    'Type',
    `<p class="type-sample" style="font-size:var(--fs-3xl);font-weight:700">Display 2.8rem</p>
     <h1>Heading one</h1><h2>Heading two</h2><h3>Heading three</h3>
     <p>Body text. Inter with the fluid scale. Lines wrap at comfortable measure and keep a 1.5 rhythm.</p>
     <p class="small muted">Small muted text for hints and meta information.</p>
     <p>Money: <span class="money" style="font-size:var(--fs-xl);font-weight:700">Rs 12,480.50</span></p>
     <p lang="ur" dir="rtl" data-urdu-sample hidden style="font-size:var(--fs-lg)">آج کی فروخت مکمل ہو گئی۔</p>
     <p class="sg-note">The Urdu sample appears with the RTL toggle. Its font (about 140 KB) loads only then.</p>`,
  );
}

function buttons() {
  return section(
    'Buttons',
    `<div class="sg-row">
       <button class="btn btn-primary" data-magnetic>Primary</button>
       <button class="btn btn-soft">Soft</button>
       <button class="btn btn-ghost">Ghost</button>
       <button class="btn btn-danger">Danger</button>
       <button class="btn btn-primary btn-sm">Small</button>
       <button class="btn btn-ghost icon-btn" aria-label="Icon button">${ui.icon('settings')}</button>
       <button class="btn btn-primary" disabled>Disabled</button>
     </div>
     <div class="sg-row">
       <button class="btn btn-primary" data-demo="save"><span data-label-hide>Save sale</span></button>
       <span class="sg-note">Click Save: spinner, then check, then back to idle.</span>
     </div>`,
  );
}

function inputs() {
  return section(
    'Inputs and selection',
    `<div class="sg-grid cols-2">
       <div>
         <div class="float-field" data-demo-field>
           <input id="sg-float" placeholder=" " autocomplete="off">
           <label for="sg-float">Medicine name</label>
           <svg class="tick" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9.5 7.2 13.5 15 5"/></svg>
         </div>
         <div class="sg-row">
           <button class="btn btn-soft btn-sm" data-demo="validate">Validate</button>
           <span class="sg-note">Empty shakes. Filled ticks.</span>
         </div>
       </div>
       <div class="stack">
         <div class="field"><label for="sg-select">Payment method</label>
           <select id="sg-select"><option>Cash</option><option>Card</option><option>Easypaisa</option></select></div>
         <label class="switch"><input type="checkbox" checked><span class="switch-track"><span class="switch-thumb"></span></span><span>Print receipt</span></label>
         <label class="check"><input type="checkbox" checked><span class="check-box"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 9.5 7.5 13.5 14.5 5"/></svg></span><span>Send WhatsApp copy</span></label>
       </div>
     </div>
     <h3>Chips and segmented control</h3>
     <div class="sg-row">
       <button class="chip" aria-pressed="true">Tablets</button><button class="chip" aria-pressed="false">Syrups</button><button class="chip" aria-pressed="false">Injections</button>
     </div>
     <div class="seg" role="radiogroup" aria-label="Period" data-indicator>
       <span class="seg-indicator" aria-hidden="true"></span>
       <button class="seg-option" role="radio" aria-checked="true">Today</button>
       <button class="seg-option" role="radio" aria-checked="false">Week</button>
       <button class="seg-option" role="radio" aria-checked="false">Month</button>
     </div>
     <h3>Tabs</h3>
     <div class="tabs" role="tablist" data-indicator>
       <span class="tab-indicator" aria-hidden="true"></span>
       <button class="tab" role="tab" aria-selected="true">Stock</button>
       <button class="tab" role="tab" aria-selected="false">Batches</button>
       <button class="tab" role="tab" aria-selected="false">Movements</button>
     </div>`,
  );
}

function cards() {
  return section(
    'Cards, stats and charts',
    `<div class="sg-grid cols-3">
       <div class="card"><h3>Card</h3><p class="muted">Flat surface with a soft border.</p></div>
       <div class="card card--glass"><h3>Glass card</h3><p class="muted">Blur where supported, solid otherwise.</p></div>
       <div class="card card--interactive"><h3>Interactive</h3><p class="muted">Lifts on hover.</p></div>
     </div>
     <div class="sg-grid cols-3">
       <div class="card stat"><span class="stat-label">Today's sales</span><span class="stat-value" data-count="1248050" data-format="money" id="sg-stat">Rs 0</span><span class="badge badge--ok stat-delta">+12.4%</span></div>
       <div class="card stat"><span class="stat-label">Bills</span><span class="stat-value" data-count="86" data-format="int">0</span><button class="btn btn-soft btn-sm" data-demo="count">Count again</button></div>
       <div class="card stat"><span class="stat-label">Margin</span><span class="stat-value" data-count="18.5" data-format="percent">0%</span></div>
     </div>
     <div class="card">
       <div class="chart" aria-label="Sales by day">
         ${[40, 65, 52, 88, 74, 96, 60].map((h, i) => `<div class="chart-bar" style="--h:${h}%;--i:${i}" data-value="${h}"></div>`).join('')}
       </div>
       <svg class="chart-line" viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true">
         <path pathLength="1" d="M0 100 C 40 80, 60 90, 90 60 S 150 20, 180 50 S 240 90, 300 30"/>
       </svg>
     </div>`,
  );
}

function tiles() {
  const items = ACCENTS.map(
    (accent, i) => `
      <a class="tile" data-accent="${accent}" data-tilt href="#/styleguide">
        <span class="tile-icon">${ui.icon(TILE_ICONS[i])}</span>
        <span class="tile-title">${accent[0].toUpperCase()}${accent.slice(1)} tile</span>
        <span class="tile-sub">Tilt, shine and press</span>
      </a>`,
  ).join('');
  return section('Feature tiles', `<div class="sg-grid cols-4">${items}</div>`);
}

function tables() {
  return section(
    'Tables (cards on phones)',
    `<div class="table-wrap"><table class="table table-cards">
       <thead><tr><th>Medicine</th><th class="num">Qty</th><th class="num">Price</th><th>Expiry</th></tr></thead>
       <tbody>
         <tr><td data-label="Medicine">Panadol 500mg</td><td class="num" data-label="Qty">40</td><td class="num" data-label="Price"><span class="money">Rs 40.00</span></td><td data-label="Expiry"><span class="badge badge--warn">Soon</span></td></tr>
         <tr><td data-label="Medicine">Brufen 400</td><td class="num" data-label="Qty">12</td><td class="num" data-label="Price"><span class="money">Rs 60.00</span></td><td data-label="Expiry"><span class="badge badge--ok">Fine</span></td></tr>
       </tbody></table></div>`,
  );
}

function feedback() {
  return section(
    'Badges, status and feedback',
    `<div class="sg-row">
       <span class="badge">Info</span><span class="badge badge--ok">Paid</span><span class="badge badge--warn">Udhaar</span>
       <span class="badge badge--danger">Expired</span><span class="badge badge--accent">Rx</span>
     </div>
     <div class="sg-row">
       <span class="status-pill">Online</span><span class="status-pill is-syncing">Syncing</span><span class="status-pill is-offline">Offline</span>
     </div>
     <div class="sg-row">
       <button class="btn btn-soft" data-tip="Opens the sale screen" data-demo="tip">Hover for tooltip</button>
       <button class="btn btn-soft" data-demo="toast-ok">Success toast</button>
       <button class="btn btn-soft" data-demo="toast-err">Error toast</button>
       <button class="btn btn-soft" data-demo="toast-info">Info toast</button>
     </div>
     <div class="sg-grid cols-2">
       <div class="stack">${ui.skeleton(3)}</div>
       <div class="skeleton skeleton-card" aria-hidden="true"></div>
     </div>
     ${ui.emptyState({ iconName: 'products', title: 'No medicines yet', text: 'Add your first product to start selling.', actionLabel: 'Add product' })}`,
  );
}

function overlays() {
  return section(
    'Dialogs, sheets and palette',
    `<div class="sg-row">
       <button class="btn btn-primary" data-demo="modal">Open dialog</button>
       <button class="btn btn-danger" data-demo="confirm">Confirm delete</button>
       <button class="btn btn-soft" data-demo="palette">Command palette (Ctrl+K)</button>
     </div>
     <p class="sg-note">On phones, dialogs become bottom sheets: drag the handle down to close them.</p>`,
  );
}

function motion() {
  return section(
    'Motion demos',
    `<div class="sg-grid cols-2">
       <div class="sg-stage">
         <h3>Add to cart (fly, badge pop)</h3>
         <div class="sg-row">
           <div class="card" style="padding:12px;display:flex;gap:12px;align-items:center" data-demo-product>
             <span class="tile-icon" style="width:40px;height:40px">${ui.icon('products')}</span>
             <span>Panadol 500mg</span>
             <button class="btn btn-primary btn-sm" data-demo="add">Add</button>
           </div>
           <span class="sg-cart-target btn btn-soft btn-sm" data-demo-cart>Cart <span class="badge-count" id="sg-count">0</span></span>
         </div>
       </div>
       <div class="sg-stage">
         <h3>FLIP list (add, remove, reorder)</h3>
         <ul class="sg-list" id="sg-flip"></ul>
         <div class="sg-row" style="margin-top:12px">
           <button class="btn btn-soft btn-sm" data-demo="flip-add">Add item</button>
           <button class="btn btn-soft btn-sm" data-demo="flip-shuffle">Shuffle</button>
           <button class="btn btn-soft btn-sm" data-demo="flip-remove">Remove first</button>
         </div>
       </div>
     </div>
     <div class="sg-row">
       <button class="btn btn-primary" data-demo="celebrate">Complete a sale</button>
       <span class="sg-note">Full-screen success: check draws itself, receipt slides out, confetti falls.</span>
     </div>`,
  );
}

function hero() {
  return section(
    'Hero banner',
    `<div class="hero" data-anim="rise">
       <span class="capsule" style="--x:8%;--y:18%;--rot:-18deg;--t:7s"></span>
       <span class="capsule capsule--half" style="--x:28%;--y:62%;--rot:24deg;--t:9s"></span>
       <span class="capsule" style="--x:52%;--y:12%;--rot:12deg;--t:8s"></span>
       <h2 class="hero-title">Good morning, Al Rehman</h2>
       <p class="hero-sub">Today's sales are up 12% on last Monday.</p>
       <svg class="hero-ecg" viewBox="0 0 400 64" preserveAspectRatio="none" aria-hidden="true">
         <path pathLength="1" d="M0 40 H60 L72 40 L80 18 L92 58 L100 30 L108 40 H170 L182 40 L190 12 L202 60 L210 34 L218 40 H280 L292 40 L300 20 L312 56 L320 36 L328 40 H400"/>
       </svg>
     </div>`,
  );
}

function glass() {
  return section(
    'Glass surfaces',
    `<div class="sg-stage" style="background:linear-gradient(135deg,var(--accent-blue-soft),var(--accent-pink-soft),var(--accent-amber-soft))">
       <div class="glass" style="border-radius:var(--radius-xl);padding:var(--space-5)"><strong>Glass panel</strong>
       <p class="muted small">Sits over the gradient. Blur and tint come from --glass-bg and --glass-blur.</p></div>
     </div>`,
  );
}

function toolbar() {
  return `<div class="sg-toolbar" role="toolbar" aria-label="Styleguide controls">
    <strong>Styleguide</strong>
    <span class="sg-note">Theme</span>
    <div class="seg" data-indicator-group>
      <span class="seg-indicator" aria-hidden="true"></span>
      <button class="seg-option" data-mode-toggle="light" aria-checked="false">Light</button>
      <button class="seg-option" data-mode-toggle="dark" aria-checked="false">Dark</button>
    </div>
    <button class="chip" aria-pressed="false" data-toggle="rtl">RTL</button>
    <button class="chip" aria-pressed="false" data-toggle="reduce">Reduced motion</button>
    <span class="sg-note">Cart</span><span class="badge-count" data-cart-total>0</span>
  </div>`;
}

const page = () => `
  <div class="sg-page">
    ${toolbar()}
    ${hero()}
    ${colours()}
    ${typography()}
    ${buttons()}
    ${inputs()}
    ${cards()}
    ${tiles()}
    ${tables()}
    ${feedback()}
    ${overlays()}
    ${motion()}
    ${glass()}
  </div>`;

let cleanup = [];

export function render($root) {
  $root.html(page());
  const $page = $root.children('.sg-page');
  const cart = { count: 0 };
  const flipItems = ['Panadol 500mg', 'Brufen 400', 'Calpol 500'];
  const flipList = $page.find('#sg-flip');

  const renderFlip = () => {
    flipList.html(flipItems.map((name) => `<li data-key="${ui.esc(name)}"><span>${ui.esc(name)}</span><span class="badge">Stock</span></li>`).join(''));
  };
  renderFlip();

  const bump = () => {
    cart.count += 1;
    $page.find('#sg-count, [data-cart-total]').text(String(cart.count));
  };

  $page.on('click', '[data-mode-toggle]', (event) => {
    const mode = event.currentTarget.getAttribute('data-mode-toggle');
    document.documentElement.dataset.theme = mode;
    $page.find('[data-mode-toggle]').attr('aria-checked', 'false');
    event.currentTarget.setAttribute('aria-checked', 'true');
    anim.moveIndicator($page.find('[data-indicator-group]'), event.currentTarget);
  });

  $page.on('click', '[data-toggle]', (event) => {
    const el = event.currentTarget;
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', String(on));
    if (el.dataset.toggle === 'rtl') {
      document.documentElement.dir = on ? 'rtl' : i18n.isRtl() ? 'rtl' : 'ltr';
      document.documentElement.lang = on ? 'ur' : i18n.isRtl() ? 'ur' : 'en';
      $page.find('[data-urdu-sample]').prop('hidden', !on);
    }
    if (el.dataset.toggle === 'reduce') document.documentElement.classList.toggle('reduce-motion', on);
  });

  $page.on('click', '[data-demo]', async (event) => {
    const el = event.currentTarget;
    switch (el.dataset.demo) {
      case 'save':
        anim.buttonState(el, 'loading');
        setTimeout(() => anim.buttonState(el, 'success'), 1200);
        break;
      case 'validate': {
        const field = $page.find('[data-demo-field]')[0];
        const filled = field.querySelector('input').value.trim() !== '';
        anim.markField(field, filled ? 'valid' : 'invalid');
        break;
      }
      case 'count': {
        const stat = $page.find('[data-count="86"]')[0];
        anim.countUp(stat, Math.floor(Math.random() * 200), { format: 'int' });
        break;
      }
      case 'tip':
        break;
      case 'toast-ok':
        ui.toast('Sale saved', { type: 'success' });
        break;
      case 'toast-err':
        ui.toast('Could not save. Try again.', { type: 'error' });
        break;
      case 'toast-info':
        ui.toast('Changes will sync when online');
        break;
      case 'modal':
        ui.openModal({ title: 'Dialog', body: 'Dialogs use the glass surface. On phones they become sheets.', actions: [{ label: 'Close', variant: 'primary' }] });
        break;
      case 'confirm':
        await ui.confirmDialog({ title: 'Delete product?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
        break;
      case 'palette':
        ui.openPalette({ placeholder: i18n.t('palette.placeholder'), source: (q) => [{ label: `Search: ${q || '…'}`, hint: 'demo' }] });
        break;
      case 'add':
        await anim.flyToCart($page.find('[data-demo-product] .tile-icon'), $page.find('#sg-count'));
        bump();
        break;
      case 'flip-add':
        flipItems.push(`Item ${flipItems.length + 1}`);
        anim.flip(flipList, renderFlip);
        break;
      case 'flip-shuffle':
        anim.flip(flipList, () => {
          flipItems.reverse();
          renderFlip();
        });
        break;
      case 'flip-remove': {
        const first = flipList.children().first()[0];
        if (!first) break;
        await anim.removeWithMotion(first);
        flipItems.shift();
        anim.flip(flipList, renderFlip);
        break;
      }
      case 'celebrate':
        anim.celebrate({
          title: 'Sale complete',
          lines: [['Panadol 500mg × 2', 'Rs 80.00'], ['Cash', 'Rs 80.00']],
          total: 'Total Rs 80.00',
        });
        break;
      default:
        break;
    }
  });

  // Tooltips are CSS-only. Sliding indicators and their clicks are wired by anim.install().
  anim.syncIndicators($page[0]);
  anim.scanCounts($page[0]);

  // The theme toggle is a preview: it does not save, so leaving restores the saved choice.
  cleanup = [() => (document.documentElement.dataset.theme = ui.getTheme())];
}

export function destroy() {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  const lang = store.get('lang');
  document.documentElement.classList.remove('reduce-motion');
  document.documentElement.dir = i18n.isRtl(lang) ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
}

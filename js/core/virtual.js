// Virtual list. A report can hold 50,000 rows, so only the rows inside the scroll window are in the DOM.
// Rows have a fixed height (rowHeight, which must match the CSS of .vlist-row). The container scrolls; an inner
// space as tall as all the rows keeps the scrollbar honest; the visible slice is placed inside it.
// Scroll events are throttled to one paint per animation frame.

/**
 * Mounts a virtual list in `container`. render(row, index) returns the html for one row.
 * Returns { set(rows), refresh(), destroy(), get length }.
 */
export function virtualList(container, { rowHeight = 40, overscan = 12, render }) {
  const root = container;
  root.classList.add('vlist');
  root.innerHTML = '<div class="vlist-pinned"></div><div class="vlist-space"><div class="vlist-window"></div></div>';
  const pinned = root.querySelector('.vlist-pinned');
  const space = root.querySelector('.vlist-space');
  const windowEl = root.querySelector('.vlist-window');
  let rows = [];
  let frame = 0;
  let first = -1;
  let last = -1;

  function paint(force = false) {
    const viewport = root.clientHeight || 480;
    const start = Math.max(0, Math.floor(root.scrollTop / rowHeight) - overscan);
    const end = Math.min(rows.length, Math.ceil((root.scrollTop + viewport) / rowHeight) + overscan);
    if (!force && start === first && end === last) return;
    first = start;
    last = end;
    windowEl.style.transform = `translateY(${start * rowHeight}px)`;
    windowEl.innerHTML = rows.slice(start, end).map((row, i) => render(row, start + i)).join('');
  }

  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  root.addEventListener('scroll', onScroll, { passive: true });

  return {
    /** Html that stays at the top of the scroll box (headers, totals). It scrolls sideways with the rows. */
    pin(html) {
      pinned.innerHTML = html;
    },
    set(list) {
      rows = list;
      space.style.height = `${rows.length * rowHeight}px`;
      root.scrollTop = 0;
      first = -1;
      last = -1;
      paint(true);
    },
    refresh() {
      paint(true);
    },
    destroy() {
      root.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      root.classList.remove('vlist');
      root.innerHTML = '';
      rows = [];
    },
    get length() {
      return rows.length;
    },
  };
}

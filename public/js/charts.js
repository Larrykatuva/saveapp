// Analytics charts. Each [data-chart] holds its figures as JSON in a
// <script type="application/json"> child and is drawn here:
// - columns: one value per day; one series, stacked series, or diverging
//   (first series above the baseline, second below)
// - hbars: ranked horizontal bars, value at the tip
// - segmented: one whole split into parts
// Marks follow the dataviz rules: bars <= 24px with a 4px rounded data end,
// 2px surface gaps, hairline grid, text in ink colours (never the series
// colour), a legend for two or more series, and a hover readout. Every chart
// also has a table view in the page. Labels go in with textContent only.
(() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (name, attrs, parent) => {
    const node = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (parent) parent.append(node);
    return node;
  };
  const htmlEl = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };

  const compact = new Intl.NumberFormat('en-KE', { notation: 'compact', maximumFractionDigits: 1 });
  const full = value => value.toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const format = (value, data) => (data.format === 'money' ? `${data.currency} ${full(value)}` : full(value));
  const tick = value => (Math.abs(value) >= 10000 ? compact.format(value) : full(value));

  // Clean steps: 1, 2 or 5 times a power of ten; whole numbers for counts
  const ticksFor = (max, count, whole) => {
    if (max <= 0) return [0, whole ? 1 : 1];
    const raw = max / count;
    const power = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / power;
    let step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
    if (whole) step = Math.max(1, Math.round(step));
    // Stop at the first tick that reaches the maximum (no empty headroom)
    const ticks = [0];
    while (ticks[ticks.length - 1] < max - 1e-9) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(6)));
    if (ticks.length < 2) ticks.push(step);
    return ticks;
  };

  /* ------------------------------ Tooltip ------------------------------ */

  const tip = htmlEl('div', 'chart-tip', document.body);
  tip.hidden = true;
  tip.setAttribute('role', 'status');

  const place = (x, y) => {
    const pad = 14;
    const box = tip.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + box.width > window.innerWidth - 8) left = x - box.width - pad;
    if (top + box.height > window.innerHeight - 8) top = y - box.height - pad;
    tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  };

  // Values lead, names follow; each row keyed with a short stroke
  const showTip = (x, y, title, rows) => {
    tip.replaceChildren();
    htmlEl('p', 'chart-tip-title', tip, title);
    for (const row of rows) {
      const line = htmlEl('p', 'chart-tip-row', tip);
      htmlEl('span', 'chart-tip-key', line).style.background = row.color;
      htmlEl('strong', '', line, row.value);
      htmlEl('span', 'chart-tip-name', line, row.name);
    }
    tip.hidden = false;
    place(x, y);
  };
  const hideTip = () => {
    tip.hidden = true;
  };

  const legend = (root, items) => {
    const list = htmlEl('ul', 'chart-legend', root);
    for (const item of items) {
      const entry = htmlEl('li', '', list);
      htmlEl('span', 'chart-legend-swatch', entry).style.background = item.color;
      htmlEl('span', '', entry, item.name);
    }
    return list;
  };

  /* ------------------------------ Columns ------------------------------ */

  // Bar with a 4px rounded data end, square at the baseline
  const barPath = (x, base, end, width) => {
    const height = Math.abs(base - end);
    const r = Math.min(4, height, width / 2);
    const up = end < base;
    const edge = up ? end + r : end - r;
    return [
      `M${x},${base}`,
      `V${edge}`,
      `Q${x},${end} ${x + r},${end}`,
      `H${x + width - r}`,
      `Q${x + width},${end} ${x + width},${edge}`,
      `V${base}`,
      'Z',
    ].join(' ');
  };

  function columns(root, data) {
    const { labels, series } = data;
    const count = labels.length;
    const whole = data.format === 'count';
    let maxUp = 0;
    let maxDown = 0;
    for (let i = 0; i < count; i++) {
      if (data.diverging) {
        maxUp = Math.max(maxUp, series[0].values[i]);
        maxDown = Math.max(maxDown, series[1].values[i]);
      } else if (data.stacked) {
        maxUp = Math.max(maxUp, series.reduce((sum, item) => sum + item.values[i], 0));
      } else {
        maxUp = Math.max(maxUp, ...series.map(item => item.values[i]));
      }
    }
    const upTicks = ticksFor(maxUp, data.diverging ? 3 : 4, whole);
    const downTicks = data.diverging ? ticksFor(maxDown, 2, whole) : [0];
    const top = upTicks[upTicks.length - 1];
    const bottom = downTicks[downTicks.length - 1];

    const width = Math.max(260, root.clientWidth);
    const height = data.diverging ? 280 : 220;
    const longest = Math.max(...[...upTicks, ...downTicks].map(value => tick(value).length));
    const margin = { top: 10, right: 6, bottom: 28, left: Math.max(28, longest * 7 + 12) };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const y = value => margin.top + (plotHeight * (top - value)) / (top + bottom);

    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart-svg' }, root);

    // Recessive grid; the zero line is the baseline
    const tickValues = [...upTicks, ...downTicks.slice(1).map(value => -value)];
    for (const value of tickValues) {
      const at = Math.round(y(value)) + 0.5;
      svgEl('line', { x1: margin.left, x2: width - margin.right, y1: at, y2: at, class: value === 0 ? 'chart-axis' : 'chart-gridline' }, svg);
      svgEl('text', { x: margin.left - 8, y: at, class: 'chart-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, svg).textContent = tick(Math.abs(value));
    }

    const band = plotWidth / count;
    const barWidth = Math.max(2, Math.min(24, band * 0.64));
    const gap = band - barWidth > 2 ? 0 : 1;
    const maxLabels = Math.max(2, Math.floor(plotWidth / 58));
    const every = Math.ceil(count / maxLabels);
    const baseline = y(0);
    const marks = svgEl('g', {}, svg);
    const wash = svgEl('rect', { class: 'chart-hover', y: margin.top, height: plotHeight, width: band, x: -999 }, svg);
    svg.insertBefore(wash, marks);

    for (let i = 0; i < count; i++) {
      const x = margin.left + band * i + (band - barWidth) / 2 + gap / 2;
      const w = barWidth - gap;
      if (data.diverging) {
        const up = series[0].values[i];
        const down = series[1].values[i];
        if (up) svgEl('path', { d: barPath(x, baseline - 1, y(up), w), fill: series[0].color }, marks);
        if (down) svgEl('path', { d: barPath(x, baseline + 1, y(-down), w), fill: series[1].color }, marks);
      } else if (data.stacked) {
        let sum = 0;
        const shown = series.map((item, index) => ({ item, index })).filter(({ item }) => item.values[i]);
        shown.forEach(({ item }, position) => {
          const value = item.values[i];
          const base = y(sum) - (position ? 1 : 0);
          sum += value;
          const last = position === shown.length - 1;
          // 2px surface gap between segments; only the top one is rounded
          const end = y(sum) + (last ? 0 : 1);
          if (last) svgEl('path', { d: barPath(x, base, end, w), fill: item.color }, marks);
          else svgEl('rect', { x, y: end, width: w, height: Math.max(0, base - end), fill: item.color }, marks);
        });
      } else {
        const value = series[0].values[i];
        if (value) svgEl('path', { d: barPath(x, baseline, y(value), w), fill: series[0].color }, marks);
      }

      if (i % every === 0)
        svgEl('text', { x: margin.left + band * i + band / 2, y: height - 8, class: 'chart-tick', 'text-anchor': 'middle' }, svg).textContent = labels[i];

      // The whole day is the hit target; the readout lists every series
      const hit = svgEl('rect', { x: margin.left + band * i, y: margin.top, width: band, height: plotHeight, class: 'chart-hit' }, svg);
      const read = (cx, cy) => {
        wash.setAttribute('x', margin.left + band * i);
        const rows = series.map(item => ({ name: item.name, color: item.color, value: format(item.values[i], data) }));
        if (data.diverging)
          rows.push({ name: 'Net', color: 'transparent', value: format(series[0].values[i] - series[1].values[i], data) });
        showTip(cx, cy, labels[i], rows);
      };
      hit.addEventListener('pointermove', event => read(event.clientX, event.clientY));
      hit.addEventListener('pointerleave', () => {
        wash.setAttribute('x', -999);
        hideTip();
      });
    }

    if (series.length > 1) legend(root, series);
  }

  /* ---------------------------- Ranked bars ---------------------------- */

  function hbars(root, data) {
    const max = Math.max(0, ...data.items.map(item => item.value)) || 1;
    const list = htmlEl('ol', 'hbars', root);
    for (const item of data.items) {
      const row = htmlEl('li', 'hbar', list);
      const name = htmlEl('span', 'hbar-name', row);
      htmlEl('span', 'hbar-label', name, item.label);
      if (item.note) htmlEl('span', 'hbar-note', name, item.note);
      const track = htmlEl('span', 'hbar-track', row);
      const bar = htmlEl('span', 'hbar-bar', track);
      bar.style.width = `${item.value ? Math.max(1.5, (item.value / max) * 100) : 0}%`;
      bar.style.background = data.color;
      htmlEl('span', 'hbar-value', track, format(item.value, data));
    }
  }

  /* ---------------------------- Segmented bar --------------------------- */

  // White label inside a fill, near-black on yellow (palette rule)
  const inkOn = color => (color.toLowerCase() === '#eda100' ? '#0b0b0b' : '#ffffff');

  function segmented(root, data) {
    const parts = data.parts.filter(part => part.value > 0);
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    const bar = htmlEl('div', 'seg-bar', root);
    for (const part of parts) {
      const share = Math.round((part.value / total) * 100);
      const block = htmlEl('div', 'seg-block', bar);
      block.style.flexGrow = String(part.value);
      block.style.background = part.color;
      block.tabIndex = 0;
      block.setAttribute('aria-label', `${part.label}: ${format(part.value, data)}, ${share}%`);
      const label = htmlEl('span', 'seg-label', block, `${share}%`);
      label.style.color = inkOn(part.color);
      const read = (x, y) => showTip(x, y, part.label, [{ name: `${share}% of ${format(total, data)}`, color: part.color, value: format(part.value, data) }]);
      block.addEventListener('pointermove', event => read(event.clientX, event.clientY));
      block.addEventListener('pointerleave', hideTip);
      block.addEventListener('focus', () => {
        const box = block.getBoundingClientRect();
        read(box.left + box.width / 2, box.bottom);
      });
      block.addEventListener('blur', hideTip);
    }
    // A label that won't fit with padding is dropped (the table keeps it)
    requestAnimationFrame(() => {
      for (const label of bar.querySelectorAll('.seg-label'))
        if (label.scrollWidth + 16 > label.parentElement.clientWidth) label.remove();
    });
    legend(root, parts.map(part => ({ name: part.label, color: part.color })));
  }

  /* ------------------------------- Drawing ------------------------------ */

  const KINDS = { columns, hbars, segmented };

  const draw = root => {
    const source = root.querySelector('script[type="application/json"]');
    if (!source) return;
    const data = JSON.parse(source.textContent || '{}');
    for (const child of [...root.children]) if (child !== source) child.remove();
    KINDS[root.dataset.chart]?.(root, data);
  };

  const charts = [...document.querySelectorAll('[data-chart]')];
  charts.forEach(draw);

  // Columns depend on width: redraw when their card resizes
  let pending = null;
  const resize = new ResizeObserver(entries => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      for (const entry of entries) if (entry.target.dataset.chart === 'columns') draw(entry.target);
    });
  });
  charts.filter(root => root.dataset.chart === 'columns').forEach(root => resize.observe(root));
  window.addEventListener('scroll', hideTip, { passive: true });

  // Merchant filter (admin) applies as soon as it changes
  document.addEventListener('change', event => {
    const select = event.target.closest?.('[data-auto-submit-select]');
    if (select) select.form.submit();
  });
})();

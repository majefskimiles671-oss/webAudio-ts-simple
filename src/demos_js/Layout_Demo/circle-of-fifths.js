// circle-of-fifths.js
// An implementation of a linear circle of 5ths

const MAJOR      = ['C','G','D','A','E','B','G♭','D♭','A♭','E♭','B♭','F'];
const MINOR      = ['Am','Em','Bm','F♯m','C♯m','G♯m','E♭m','B♭m','Fm','Cm','Gm','Dm'];
const DIMINISHED = ['B°','F♯°','C♯°','G♯°','D♯°','A♯°','F°','C°','G°','D°','A°','E°'];

const KEY_SIGNATURES = {
  'C': 'No sharps or flats',
  'G': '1 sharp: F♯', 'D': '2 sharps: F♯ C♯', 'A': '3 sharps: F♯ C♯ G♯',
  'E': '4 sharps: F♯ C♯ G♯ D♯', 'B': '5 sharps: F♯ C♯ G♯ D♯ A♯',
  'G♭': '6 flats: B♭ E♭ A♭ D♭ G♭ C♭', 'D♭': '5 flats: B♭ E♭ A♭ D♭ G♭',
  'A♭': '4 flats: B♭ E♭ A♭ D♭', 'E♭': '3 flats: B♭ E♭ A♭',
  'B♭': '2 flats: B♭ E♭', 'F': '1 flat: B♭',
  'Am': 'No sharps or flats',
  'Em': '1 sharp: F♯', 'Bm': '2 sharps: F♯ C♯', 'F♯m': '3 sharps: F♯ C♯ G♯',
  'C♯m': '4 sharps: F♯ C♯ G♯ D♯', 'G♯m': '5 sharps: F♯ C♯ G♯ D♯ A♯',
  'E♭m': '6 flats: B♭ E♭ A♭ D♭ G♭ C♭', 'B♭m': '5 flats: B♭ E♭ A♭ D♭ G♭',
  'Fm': '4 flats: B♭ E♭ A♭ D♭', 'Cm': '3 flats: B♭ E♭ A♭',
  'Gm': '2 flats: B♭ E♭', 'Dm': '1 flat: B♭',
};

const CHORD_TONES = {
  'C': ['I','IV','V','ii','iii','vi','vii°'],
  'G': ['I','IV','V','ii','iii','vi','vii°'],
  'D': ['I','IV','V','ii','iii','vi','vii°'],
};

// Frequencies for Web Audio (octave 4)
const NOTE_FREQ = {
  'C': 261.63, 'D': 293.66, 'E': 329.63, 'F': 349.23,
  'G': 392.00, 'A': 440.00, 'B': 493.88,
  'C♯': 277.18, 'D♯': 311.13, 'F♯': 369.99, 'G♯': 415.30, 'A♯': 466.16,
  'D♭': 277.18, 'E♭': 311.13, 'G♭': 369.99, 'A♭': 415.30, 'B♭': 466.16,
};

function getFreq(keyName) {
  const base = keyName.replace('m','').replace('°','');
  return NOTE_FREQ[base] || 261.63;
}

// ---- Circle of Fifths Grid ----
// COF_CENTER: td column index (0-based) under the red outline.
// Overlay shape (centred on COF_CENTER):
//   row 0: [1][2][1]   orange / red / orange
//   row 1: [1][1][1]   orange
//   row 2: [0][1][0]   orange (centre only)
const COF_CENTER = 5;

let cofOffset = 0;

function renderCircleGrid(targetEl) {
  const el = targetEl || document.getElementById('bottom-panel-grid');
  if (!el) return;

  const rows = [
    { label: 'Maj', keys: MAJOR },
    { label: 'Min', keys: MINOR },
    { label: 'Dim', keys: DIMINISHED },
  ];

  const table = document.createElement('table');
  table.className = 'cof-grid';
  table.id = 'cof-table';

  rows.forEach(({ keys }) => {
    const tr = document.createElement('tr');
    for (let i = 0; i < 12; i++) {
      const td = document.createElement('td');
      td.textContent = keys[(cofOffset + i) % 12];
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });

  el.appendChild(table);

  // Measure cells after layout, then keep overlay in sync with resizes
  requestAnimationFrame(() => _rebuildOverlay(el));
  const ro = new ResizeObserver(() => _rebuildOverlay(el));
  ro.observe(el);

  // Click on a Maj cell → step it to the center
  table.addEventListener('click', (e) => {
    const td = e.target.closest('td');
    if (!td || td.parentElement !== table.rows[0]) return;
    const colIdx = Array.from(td.parentElement.cells).indexOf(td);
    _stepToCenter(colIdx - COF_CENTER);
  });
}

let _centerAnimating = false;

function _stepToCenter(rawDelta) {
  // Take the shortest path around the circle
  let delta = rawDelta;
  if (delta > 6) delta -= 12;
  else if (delta < -6) delta += 12;
  if (delta === 0) return;
  if (_centerAnimating) return;

  const table = document.getElementById('cof-table');
  if (!table || !table.rows.length) return;

  table.classList.remove('cof-anim-right', 'cof-anim-left');

  const arrays  = [MAJOR, MINOR, DIMINISHED];
  const steps   = Math.abs(delta);
  const dir     = Math.sign(delta);
  const tableW  = table.getBoundingClientRect().width;
  const cellW   = tableW / 12;
  const totalPx = steps * cellW;
  const dur     = Math.min(700, 200 + steps * 70);

  _centerAnimating = true;

  // Fix layout so adding extra cells doesn't compress existing ones
  table.style.tableLayout = 'fixed';
  table.style.width = ((12 + steps) * cellW) + 'px';

  // Append or prepend the incoming cells
  for (let r = 0; r < table.rows.length; r++) {
    const tr = table.rows[r];
    const firstCell = tr.cells[0]; // capture before loop mutates the live collection
    for (let i = 0; i < steps; i++) {
      const td = document.createElement('td');
      if (dir > 0) {
        td.textContent = arrays[r][(cofOffset + 12 + i) % 12];
        tr.appendChild(td);
      } else {
        td.textContent = arrays[r][(cofOffset - steps + i + 12) % 12];
        tr.insertBefore(td, firstCell);
      }
    }
  }

  // Start position (no transition) then animate to final
  table.style.transition = 'none';
  table.style.transform = dir < 0 ? `translateX(-${totalPx}px)` : 'translateX(0)';
  table.getBoundingClientRect(); // force reflow

  table.style.transition = `transform ${dur}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
  table.style.transform   = dir > 0 ? `translateX(-${totalPx}px)` : 'translateX(0)';

  table.addEventListener('transitionend', () => {
    cofOffset = (cofOffset + delta + 12) % 12;

    // Remove the extra cells
    for (let r = 0; r < table.rows.length; r++) {
      const tr = table.rows[r];
      for (let i = 0; i < steps; i++) {
        if (dir > 0) tr.removeChild(tr.lastElementChild);
        else         tr.removeChild(tr.cells[0]);
      }
    }

    // Reset layout and redraw text at new offset
    table.style.transition  = 'none';
    table.style.transform   = '';
    table.style.tableLayout = '';
    table.style.width       = '';

    document.querySelectorAll('#cof-table tr').forEach((tr, rowIdx) => {
      tr.querySelectorAll('td').forEach((td, colIdx) => {
        td.textContent = arrays[rowIdx][(cofOffset + colIdx) % 12];
      });
    });

    _centerAnimating = false;
  }, { once: true });
}

function _rebuildOverlay(el) {
  const table = document.getElementById('cof-table');
  if (!table) return;

  // Scale font-size so cells grow/shrink with available width.
  // 13 equal columns (1 th + 12 td); padding 10px each side.
  const colWidth = (el.clientWidth - 20) / 12;
  const fontSize = Math.max(10, Math.min(22, colWidth / 3));
  table.style.fontSize = fontSize + 'px';

  // getBoundingClientRect forces a synchronous reflow so SVG measurements
  // below reflect the new font size immediately.
  table.getBoundingClientRect();

  const old = document.getElementById('cof-overlay');
  if (old) old.remove();
  const svg = _buildOverlaySVG(el);
  if (svg) el.appendChild(svg);
}

function _buildOverlaySVG(el) {
  const table = document.getElementById('cof-table');
  if (!table || !table.rows.length) return null;

  const cr = el.getBoundingClientRect();

  // Measure a cell's position relative to the grid container
  const measure = (rowIdx, tdOffset) => {
    // cells[0] is the th; td index = 1 + COF_CENTER + tdOffset
    const cellEl = table.rows[rowIdx].cells[COF_CENTER + tdOffset];
    if (!cellEl) return null;
    const r = cellEl.getBoundingClientRect();
    return { l: r.left - cr.left, t: r.top - cr.top, r: r.right - cr.left, b: r.bottom - cr.top };
  };

  const c0m  = measure(0, -1); // row0 col center-1
  const c05  = measure(0,  0); // row0 col center  (red)
  const c0p  = measure(0, +1); // row0 col center+1
  const c2c  = measure(2,  0); // row2 col center
  const cg0  = measure(0, -4); // row0 col center-4 (green left)
  const cg1  = measure(0, -3); // row0 col center-3 (green mid)
  const cg2  = measure(0, -2); // row0 col center-2 (green right)
  const cg2b = measure(2, -3); // row2 col center-3 (green bottom)
  if (!c0m || !c05 || !c0p || !c2c || !cg0 || !cg1 || !cg2 || !cg2b) return null;

  const t0 = c0m.t, t2 = c2c.t, t3 = c2c.b;

  // Orange T-shape (cols center-1, center, center+1 / rows 0-1; centre only row 2)
  const l4 = c0m.l, l5 = c05.l, l6 = c0p.l, r6 = c0p.r;
  const orangePts = [l4,t0, r6,t0, r6,t2, l6,t2, l6,t3, l5,t3, l5,t2, l4,t2].join(' ');

  // Green T-shape (cols center-4, center-3, center-2 / rows 0-1; center-3 only row 2)
  const gL = cg0.l, gM = cg1.l, gR = cg2.l, gRR = cg2.r;
  const greenPts = [gL,t0, gRR,t0, gRR,t2, gR,t2, gR,t3, gM,t3, gM,t2, gL,t2].join(' ');

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'cof-overlay';

  const mkPoly = (pts, color) => {
    const p = document.createElementNS(NS, 'polygon');
    p.setAttribute('points', pts);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linejoin', 'miter');
    return p;
  };

  // Red rect — row0 col center only
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', l5);
  rect.setAttribute('y', t0);
  rect.setAttribute('width', c05.r - c05.l);
  rect.setAttribute('height', c05.b - c05.t);
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#ef4444');
  rect.setAttribute('stroke-width', '2');

  svg.appendChild(mkPoly(greenPts,  '#22c55e'));
  svg.appendChild(mkPoly(orangePts, '#d97706'));
  svg.appendChild(rect);
  return svg;
}

function _updateCofGrid(dir) {
  const table = document.getElementById('cof-table');
  if (table) {
    table.classList.remove('cof-anim-right', 'cof-anim-left');
    void table.offsetWidth;
    table.classList.add(dir >= 0 ? 'cof-anim-right' : 'cof-anim-left');
  }
  const arrays = [MAJOR, MINOR, DIMINISHED];
  document.querySelectorAll('#cof-table tr').forEach((tr, rowIdx) => {
    tr.querySelectorAll('td').forEach((td, colIdx) => {
      td.textContent = arrays[rowIdx][(cofOffset + colIdx) % 12];
    });
  });
}

// theoryCharts.js

let tcTabs = [
  { id: 'cof',   name: 'Circle of 5ths', type: 'cof'   },
  { id: 'modes', name: 'Modes',          type: 'modes' },
];
let tcActiveTab = 'cof';
let _tcDragging = false;
let _tcDragOffX = 0;
let _tcDragOffY = 0;
let _tcCofWidget = null; // persistent so its ResizeObserver + wheel handler survive tab switches

const TC_MODES_DATA = [
  ['Ionian',     'I maj<sup>7</sup>',    'ii<sup>7</sup>',      'iii<sup>7</sup>',      'IV maj<sup>7</sup>',   'V<sup>7</sup>',      'vi<sup>7</sup>',       'vii<sup>7♭5</sup>'],
  ['Dorian',     'i<sup>7</sup>',        'ii<sup>7</sup>',      '♭III maj<sup>7</sup>', 'IV<sup>7</sup>',       'v<sup>7</sup>',      'vi<sup>7♭5</sup>',     '♭VII maj<sup>7</sup>'],
  ['Phrygian',   'i<sup>7</sup>',        '♭II maj<sup>7</sup>', '♭III<sup>7</sup>',     'iv<sup>7</sup>',       'v<sup>7♭5</sup>',   '♭VI maj<sup>7</sup>',  '♭vii<sup>7</sup>'],
  ['Lydian',     'I maj<sup>7</sup>',    'II<sup>7</sup>',      'iii<sup>7</sup>',      '♯ iv<sup>7♭5</sup>',   'V maj<sup>7</sup>',  'vi<sup>7</sup>',        'vii<sup>7</sup>'],
  ['Mixolydian', 'I<sup>7</sup>',        'ii<sup>7</sup>',      'iii<sup>7♭5</sup>',   'IV maj<sup>7</sup>',   'v<sup>7</sup>',      'vi<sup>7</sup>',        '♭VII maj<sup>7</sup>'],
  ['Aeolian',    'i<sup>7</sup>',        'ii<sup>7♭5</sup>',   '♭III maj<sup>7</sup>', 'iv<sup>7</sup>',       'v<sup>7</sup>',      '♭VI maj<sup>7</sup>',  '♭VII<sup>7</sup>'],
  ['Locrian',    'i<sup>7♭5</sup>',      '♭II maj<sup>7</sup>', '♭iii<sup>7</sup>',    'iv<sup>7</sup>',       '♭V maj<sup>7</sup>', '♭VI<sup>7</sup>',      '♭vii<sup>7</sup>'],
];


function tcGetDialog() { return document.getElementById('theory-charts-dialog'); }
function tcGetBody()   { return document.getElementById('theory-charts-body');   }


function tcGetPanelState() {
  const dialog = tcGetDialog();
  return {
    left:      parseInt(dialog.style.left)   || 400,
    top:       parseInt(dialog.style.top)    || 80,
    width:     parseInt(dialog.style.width)  || dialog.offsetWidth  || undefined,
    height:    parseInt(dialog.style.height) || dialog.offsetHeight || undefined,
    visible:   dialog.classList.contains('cd-visible'),
    tabs:      tcTabs.map(t => ({ id: t.id, name: t.name, type: t.type, dataUrl: t.dataUrl ?? null })),
    activeTab: tcActiveTab,
  };
}

function tcSetPanelState(state) {
  if (!state) return;
  const dialog = tcGetDialog();
  if (state.width  != null) dialog.style.width  = state.width  + 'px';
  if (state.height != null) dialog.style.height = state.height + 'px';
  if (state.left   != null || state.top != null) {
    const w    = parseInt(dialog.style.width)  || 600;
    const h    = parseInt(dialog.style.height) || 400;
    const left = Math.min(Math.max(0, state.left ?? 400), window.innerWidth  - w);
    const top  = Math.min(Math.max(0, state.top  ?? 80),  window.innerHeight - h);
    dialog.style.left = left + 'px';
    dialog.style.top  = top  + 'px';
  }
  if (Array.isArray(state.tabs)) {
    const userTabs = state.tabs.filter(t => t.type === 'image');
    tcTabs = [
      { id: 'cof',   name: 'Circle of 5ths', type: 'cof'   },
      { id: 'modes', name: 'Modes',          type: 'modes' },
      ...userTabs,
    ];
  }
  if (state.activeTab != null) tcActiveTab = state.activeTab;
  if (state.visible) dialog.classList.add('cd-visible');
  tcRenderDialog();
}

function tcTogglePanel() {
  tcGetDialog().classList.toggle('cd-visible');
}


function tcRenderDialog() {
  const body = tcGetBody();
  if (!body) return;
  body.innerHTML = '';

  const activeTab = tcTabs.find(t => t.id === tcActiveTab) || tcTabs[0];
  const content = document.createElement('div');
  content.className = 'tc-content';

  if (activeTab.type === 'cof') {
    if (_tcCofWidget) content.appendChild(_tcCofWidget);
  } else if (activeTab.type === 'modes') {
    _tcRenderModes(content);
  } else if (activeTab.type === 'image') {
    _tcRenderImage(content, activeTab);
  }

  body.appendChild(content);
  _tcRenderTabStrip();
}

function _tcRenderTabStrip() {
  const dialog = tcGetDialog();
  let strip = dialog.querySelector('.cd-tab-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'cd-tab-strip';
    dialog.appendChild(strip);
  }
  strip.innerHTML = '';

  const makeTab = (tab) => {
    const el = document.createElement('div');
    el.className = 'cd-tab' + (tab.id === tcActiveTab ? ' cd-tab-active' : '');

    const label = document.createElement('span');
    label.textContent = tab.name;
    el.appendChild(label);

    if (tab.type === 'image') {
      const del = document.createElement('span');
      del.className = 'cd-tab-delete';
      del.textContent = '×';
      del.title = 'Remove tab';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Remove tab "${tab.name}"?`)) return;
        tcTabs = tcTabs.filter(t => t.id !== tab.id);
        if (tcActiveTab === tab.id) tcActiveTab = tcTabs[0]?.id ?? 'cof';
        tcRenderDialog();
        if (typeof saveProject === 'function') saveProject();
      });
      el.appendChild(del);

      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('.cd-tab-delete')) return;
        const name = prompt('Rename tab:', tab.name);
        if (name?.trim()) {
          tab.name = name.trim().slice(0, 15);
          tcRenderDialog();
          if (typeof saveProject === 'function') saveProject();
        }
      });
    }

    el.addEventListener('click', (e) => {
      if (e.target.closest('.cd-tab-delete')) return;
      tcActiveTab = tab.id;
      tcRenderDialog();
    });

    strip.appendChild(el);
  };

  const addBtn = document.createElement('div');
  addBtn.className = 'cd-tab cd-tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add image tab';
  addBtn.addEventListener('click', () => {
    const id = crypto.randomUUID();
    tcTabs.push({ id, name: 'Image', type: 'image', dataUrl: null });
    tcActiveTab = id;
    tcRenderDialog();
  });
  strip.appendChild(addBtn);

  for (const tab of tcTabs) makeTab(tab);
}

function _tcRenderModes(el) {
  const table = document.createElement('table');
  table.className = 'tc-modes-table';

  TC_MODES_DATA.forEach(row => {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => {
      const td = document.createElement('td');
      if (i === 0) td.className = 'tc-mode-name';
      td.innerHTML = cell;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  el.appendChild(table);
}

function _tcRenderImage(el, tab) {
  if (tab.dataUrl) {
    const img = document.createElement('img');
    img.className = 'tc-img-display';
    img.src = tab.dataUrl;
    el.appendChild(img);

    const replace = document.createElement('button');
    replace.className = 'tc-img-replace-btn';
    replace.textContent = 'Replace image';
    replace.addEventListener('click', () => _tcPickImage(tab));
    el.appendChild(replace);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'tc-img-placeholder';

    const icon = document.createElement('div');
    icon.className = 'tc-img-placeholder-icon';
    icon.textContent = '🖼';

    const label = document.createElement('div');
    label.textContent = 'Click to load an image';

    const hint = document.createElement('div');
    hint.className = 'tc-img-placeholder-hint';
    hint.textContent = 'PNG, JPG, GIF, SVG, WebP';

    placeholder.appendChild(icon);
    placeholder.appendChild(label);
    placeholder.appendChild(hint);
    placeholder.addEventListener('click', () => _tcPickImage(tab));
    el.appendChild(placeholder);
  }
}

function _tcPickImage(tab) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      tab.dataUrl = e.target.result;
      tab.name    = file.name.replace(/\.[^.]+$/, '').slice(0, 15);
      tcRenderDialog();
      if (typeof saveProject === 'function') saveProject();
    };
    reader.readAsDataURL(file);
  });
  input.click();
}


function _tcInitDrag() {
  const dialog   = tcGetDialog();
  const titlebar = dialog.querySelector('.cd-dialog-titlebar');

  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.cd-dialog-close')) return;
    _tcDragging = true;
    _tcDragOffX = e.clientX - dialog.offsetLeft;
    _tcDragOffY = e.clientY - dialog.offsetTop;
    titlebar.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!_tcDragging) return;
    dialog.style.left = (e.clientX - _tcDragOffX) + 'px';
    dialog.style.top  = (e.clientY - _tcDragOffY) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!_tcDragging) return;
    _tcDragging = false;
    tcGetDialog().querySelector('.cd-dialog-titlebar').style.cursor = '';
  });
}

function _tcInitResize() {
  const dialog = tcGetDialog();
  const MIN_W = 300, MIN_H = 150;

  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const handle = document.createElement('div');
    handle.className = `cd-resize-edge cd-resize-${edge}`;
    dialog.appendChild(handle);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startW = dialog.offsetWidth,  startH = dialog.offsetHeight;
      const startL = dialog.offsetLeft,   startT = dialog.offsetTop;

      const onMove = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (edge.includes('e')) { dialog.style.width  = Math.max(MIN_W, startW + dx) + 'px'; }
        if (edge.includes('w')) { const w = Math.max(MIN_W, startW - dx); dialog.style.width = w + 'px'; dialog.style.left = (startL + startW - w) + 'px'; }
        if (edge.includes('s')) { dialog.style.height = Math.max(MIN_H, startH + dy) + 'px'; }
        if (edge.includes('n')) { const h = Math.max(MIN_H, startH - dy); dialog.style.height = h + 'px'; dialog.style.top = (startT + startH - h) + 'px'; }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const content = dialog.querySelector('.tc-content');
        if (content) { content.scrollTop = 1; requestAnimationFrame(() => { content.scrollTop = 0; }); }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}


function tcInit() {
  // Build dialog
  const dialog = document.createElement('div');
  dialog.id = 'theory-charts-dialog';

  const titlebar = document.createElement('div');
  titlebar.className = 'cd-dialog-titlebar';

  const title = document.createElement('span');
  title.textContent = 'Theory Charts';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'cd-dialog-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', tcTogglePanel);

  titlebar.appendChild(title);
  titlebar.appendChild(closeBtn);

  const body = document.createElement('div');
  body.id = 'theory-charts-body';

  const inner = document.createElement('div');
  inner.className = 'cd-dialog-inner';
  inner.appendChild(titlebar);
  inner.appendChild(body);

  dialog.appendChild(inner);
  document.body.appendChild(dialog);

  dialog.style.top  = '80px';
  dialog.style.left = Math.max(20, (window.innerWidth - 640) / 2) + 'px';

  // Create persistent CoF widget — ResizeObserver + wheel handler live here forever
  _tcCofWidget = document.createElement('div');
  _tcCofWidget.id = 'tc-cof-widget';
  renderCircleGrid(_tcCofWidget);

  _tcInitDrag();
  _tcInitResize();
  tcRenderDialog();
}

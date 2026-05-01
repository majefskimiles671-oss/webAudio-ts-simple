// chordDiagrams.js
// Chord Diagrams - Self-contained floating panel for creating/saving guitar chord diagrams -----

// ============================================================
// State (Truth Layer) -----
// ============================================================

let chords = [
  {
    id: crypto.randomUUID(), name: "C", baseFret: 1, frets: 4, tab: "chords",
    tops: ["o", null, "o", null, null, "x"],
    dots: [[false,false,false,false],[true,false,false,false],[false,false,false,false],[false,true,false,false],[false,false,true,false],[false,false,false,false]],
  },
  {
    id: crypto.randomUUID(), name: "D", baseFret: 1, frets: 4, tab: "chords",
    tops: [null, null, null, "o", "x", "x"],
    dots: [[false,true,false,false],[false,false,true,false],[false,true,false,false],[false,false,false,false],[false,false,false,false],[false,false,false,false]],
  },
  {
    id: crypto.randomUUID(), name: "G", baseFret: 1, frets: 4, tab: "chords",
    tops: [null, "o", "o", "o", "x", null],
    dots: [[false,false,true,false],[false,false,false,false],[false,false,false,false],[false,false,false,false],[false,false,false,false],[false,false,true,false]],
  },
  {
    id: crypto.randomUUID(), name: "Am", baseFret: 1, frets: 4, tab: "chords",
    tops: ["o", null, null, null, "o", "x"],
    dots: [[false,false,false,false],[true,false,false,false],[false,true,false,false],[false,true,false,false],[false,false,false,false],[false,false,false,false]],
  },
  {
    id: crypto.randomUUID(), name: "Em", baseFret: 1, frets: 4, tab: "chords",
    tops: ["o", "o", "o", null, null, "o"],
    dots: [[false,false,false,false],[false,false,false,false],[false,false,false,false],[false,true,false,false],[false,true,false,false],[false,false,false,false]],
  },
  {
    id: crypto.randomUUID(), name: "Bm", baseFret: 1, frets: 4, tab: "chords",
    tops: [null, null, null, null, null, "x"],
    dots: [[false,true,false,false],[false,false,true,false],[false,false,false,true],[false,false,false,true],[false,true,false,false],[false,false,false,false]],
  },
  {
    id: crypto.randomUUID(), name: "F# dim", baseFret: 1, frets: 4, tab: "chords",
    tops: [null, null, null, null, "x", "x"],
    dots: [[false,true,false,false],[true,false,false,false],[false,true,false,false],[true,false,false,false],[false,false,false,false],[false,false,false,false]],
  },
  {
    id: crypto.randomUUID(), name: "C tanpura", baseFret: 1, frets: 6, tab: "tanpura",
    tops: ["x", null, "o", null, "x", null],
    dots: [[false,false,false,false,false,false],[true,false,false,false,false,false],[false,false,false,false,false,false],[false,false,false,false,true,false],[false,false,false,false,false,false],[false,false,true,false,false,false]],
  },
  {
    id: crypto.randomUUID(), name: "F tanpura", baseFret: 1, frets: 6, tab: "tanpura",
    tops: [null, null, null, "x", null, "x"],
    dots: [[true,false,false,false,false,false],[true,false,false,false,false,false],[false,false,false,false,true,false],[false,false,false,false,false,false],[false,false,true,false,false,false],[false,false,false,false,false,false]],
  },
  {
    id: crypto.randomUUID(), name: "G tanpura", baseFret: 1, frets: 6, tab: "tanpura",
    tops: [null, null, null, "o", null, "x"],
    dots: [[false,false,true,false,false,false],[false,false,true,false,false,false],[false,false,false,false,false,false],[false,false,false,false,false,false],[false,false,false,false,true,false],[false,false,false,false,false,false]],
  },
];
let cdTabs = [
  { id: "chords",  name: "Chords"  },
  { id: "tanpura", name: "Tanpura" },
];
let cdActiveTab = "all";
let currentTuning = tuning([64, 59, 55, 50, 45, 40]);
let _editingChord = null;
let _cdDragging = false;
let _cdDragOffX = 0;
let _cdDragOffY = 0;
let _cdZoom = 1;

function cdHighlightChord(id) {
  const body = document.getElementById("chord-diagrams-body");
  if (!body) return;
  if (!id) {
    // No chord on this marker — dim whichever card is currently highlighted
    body.querySelectorAll(".cd-chord-card.cd-card-highlighted").forEach(el => {
      el.classList.remove("cd-card-highlighted");
      el.classList.add("cd-card-dimmed");
    });
    return;
  }
  body.querySelectorAll(".cd-chord-card").forEach(el => {
    el.classList.remove("cd-card-highlighted", "cd-card-dimmed");
  });
  const card = body.querySelector(`.cd-chord-card[data-chord-id="${id}"]`);
  if (!card) return;
  card.classList.add("cd-card-highlighted");
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function cdEncodeChords() {
  return btoa(JSON.stringify(chords.map(c => ({
    name: c.name, baseFret: c.baseFret, frets: c.frets, tops: c.tops, dots: c.dots, tab: c.tab ?? null,
  }))));
}

function cdDecodeChords(str) {
  try { return JSON.parse(atob(str)); } catch { return null; }
}

// ============================================================
// Helpers (Pure Computation Layer) -----
// ============================================================

function cdMakeBlankChord() {
  return {
    id: crypto.randomUUID(),
    name: "",
    baseFret: 1,
    frets: 4,
    tops: Array(6).fill(null),
    dots: Array.from({ length: 6 }, () => Array(4).fill(false)),
    tab: cdActiveTab !== "all" ? cdActiveTab : (cdTabs[0]?.id ?? null),
  };
}

function cdCloneChord(c) {
  return {
    id: c.id,
    name: c.name,
    baseFret: c.baseFret,
    frets: c.frets ?? 5,
    tops: [...c.tops],
    dots: c.dots.map(row => [...row]),
    tab: c.tab ?? null,
  };
}


function cdGetDialog() {
  return document.getElementById("chord-diagrams-dialog");
}

function cdGetEditPopover() {
  return document.getElementById("chord-edit-popover");
}

function cdGetBody() {
  return document.getElementById("chord-diagrams-body");
}

function cdGetFooter() {
  return document.getElementById("chord-diagrams-footer");
}

// ============================================================
// Authority (Meaning Layer) -----
// ============================================================

function cdGetPanelState() {
  const dialog = cdGetDialog();
  return {
    left:    parseInt(dialog.style.left)   || 200,
    top:     parseInt(dialog.style.top)    || 80,
    width:   parseInt(dialog.style.width)  || dialog.offsetWidth  || undefined,
    height:  parseInt(dialog.style.height) || dialog.offsetHeight || undefined,
    zoom:      _cdZoom,
    visible:   dialog.classList.contains("cd-visible"),
    synthMode: (typeof cpGetSynthMode === "function") ? cpGetSynthMode() : "pluck",
    tabs:      cdTabs.map(t => ({ id: t.id, name: t.name })),
    activeTab: cdActiveTab,
  };
}

function cdSetPanelState(state) {
  if (!state) return;
  const dialog = cdGetDialog();
  if (state.width  != null) dialog.style.width  = state.width  + "px";
  if (state.height != null) dialog.style.height = state.height + "px";
  if (state.left   != null || state.top != null) {
    const w    = parseInt(dialog.style.width)  || 320;
    const h    = parseInt(dialog.style.height) || 400;
    const left = Math.min(Math.max(0, state.left ?? 200), window.innerWidth  - w);
    const top  = Math.min(Math.max(0, state.top  ?? 80),  window.innerHeight - h);
    dialog.style.left = left + "px";
    dialog.style.top  = top  + "px";
  }
  if (state.zoom  != null) {
    _cdZoom = state.zoom;
    dialog.style.setProperty("--cd-zoom", _cdZoom);
  }
  if (Array.isArray(state.tabs)) {
    cdTabs = state.tabs.map(t => ({ id: t.id, name: t.name }));
  }
  if (state.activeTab != null) {
    cdActiveTab = state.activeTab;
  }
  if (state.visible) {
    dialog.classList.add("cd-visible");
    dialog.querySelectorAll(".cd-grid-wrap").forEach(cdSyncFretLabel);
  }
  if (state.synthMode != null && typeof cpSetSynthMode === "function") {
    cpSetSynthMode(state.synthMode);
  }
}

function cdTogglePanel() {
  const dialog = cdGetDialog();
  dialog.classList.toggle("cd-visible");
  if (dialog.classList.contains("cd-visible")) {
    dialog.querySelectorAll(".cd-grid-wrap").forEach(cdSyncFretLabel);
  }
}

function cdOpenDialog(chordId = null) {
  cdGetDialog().classList.add("cd-visible");
  cdOpenEditPopover(chordId, null);
}

function cdShowList() {
  _editingChord = null;
  cdGetEditPopover().classList.remove("cd-popover-visible");
}

function cdOpenEditPopover(chordId, anchorEl) {
  if (chordId) {
    const existing = chords.find(c => c.id === chordId);
    _editingChord = existing ? cdCloneChord(existing) : cdMakeBlankChord();
  } else {
    _editingChord = cdMakeBlankChord();
  }
  cdRenderEditPopover();
  const pop = cdGetEditPopover();
  pop.classList.add("cd-popover-visible");
  requestAnimationFrame(() => {
    cdPositionPopover(anchorEl);
    pop.querySelectorAll(".cd-grid-wrap").forEach(cdSyncFretLabel);
    const nameInput = pop.querySelector(".cd-name-input");
    if (nameInput) nameInput.focus();
  });
}

function cdPositionPopover(anchorEl) {
  const pop = cdGetEditPopover();
  if (!anchorEl) {
    pop.style.left = "50%";
    pop.style.top  = "50%";
    pop.style.transform = "translate(-50%, -50%)";
    return;
  }
  pop.style.transform = "";
  const popW = pop.offsetWidth;
  const popH = pop.offsetHeight;
  const rect = anchorEl.getBoundingClientRect();
  let top  = rect.top - popH - 8;
  let left = rect.left + rect.width / 2 - popW / 2;
  if (top < 8) top = rect.bottom + 8;
  left = Math.max(8, Math.min(left, window.innerWidth  - popW - 8));
  top  = Math.max(8, Math.min(top,  window.innerHeight - popH - 8));
  pop.style.left = left + "px";
  pop.style.top  = top  + "px";
}

function cdDebugChord() {
  const c = _editingChord;
  if (!c) { console.log("[cdDebug] no chord open in editor"); return; }
  const { name, baseFret, frets, tops, dots } = c;
  console.log("[cdDebug] chord:", JSON.stringify({ name, baseFret, frets, tops, dots }));
}
window.cdDebugChord = cdDebugChord;

function cdSaveChord() {
  if (!_editingChord) return;
  const idx = chords.findIndex(c => c.id === _editingChord.id);
  if (idx !== -1) {
    chords[idx] = _editingChord;
  } else {
    chords.unshift(_editingChord);
  }
  if (typeof markDirty === "function") markDirty();
  document.dispatchEvent(new CustomEvent("chord-updated", { detail: { id: _editingChord.id } }));
  cdShowList();
  cdRenderDialog();
  if (typeof renderBottomPanel === "function") renderBottomPanel();
}

function cdDeleteChord(id) {
  chords = chords.filter(c => c.id !== id);
  if (typeof markDirty === "function") markDirty();
  cdShowList();
  cdRenderDialog();
  if (typeof renderBottomPanel === "function") renderBottomPanel();
}

function cdToggleDot(s, r) {
  if (!_editingChord) return;
  _editingChord.dots[s][r] = !_editingChord.dots[s][r];
  cdRenderEditor();
}

function cdCycleTop(s) {
  if (!_editingChord) return;
  const cycle = [null, "o", "x"];
  const cur = cycle.indexOf(_editingChord.tops[s]);
  _editingChord.tops[s] = cycle[(cur + 1) % cycle.length];
  cdRenderEditor();
}


// ============================================================
// Projection / Rendering (View Layer) -----
// ============================================================

function cdBuildGridEl(chord, interactive) {
  const wrap = document.createElement("div");
  wrap.className = "cd-grid-wrap";

  const label = document.createElement("span");
  label.className = "cd-fret-label";
  label.textContent = `${chord.baseFret}`;
  if (chord.baseFret === 1) label.style.visibility = "hidden";
  wrap.appendChild(label);

  const frets = chord.frets ?? 5;
  const grid = document.createElement("div");
  grid.className = "cd-grid" + (interactive ? "" : " cd-view") + (frets === 4 ? " cd-4frets" : frets === 6 ? " cd-6frets" : "");

  // Top row — above-nut indicators (render s=5..0 so low E appears left, high E right)
  for (let s = 5; s >= 0; s--) {
    const cell = document.createElement("div");
    cell.className = "cd-top-cell" + (s === 5 ? " cd-s-first" : s === 0 ? " cd-s-last" : "");
    cell.textContent = chord.tops[s] ?? "";
    if (interactive) {
      cell.addEventListener("click", () => cdCycleTop(s));
    }
    grid.appendChild(cell);
  }

  // Fret rows (same reverse order)
  for (let r = 0; r < frets; r++) {
    for (let s = 5; s >= 0; s--) {
      const cell = document.createElement("div");
      cell.className = "cd-fret-cell" + (s === 5 ? " cd-s-first" : s === 0 ? " cd-s-last" : "");
      if (chord.dots[s][r]) {
        const dot = document.createElement("div");
        dot.className = "cd-dot";
        cell.appendChild(dot);
      }
      if (interactive) {
        cell.addEventListener("click", () => cdToggleDot(s, r));
      }
      grid.appendChild(cell);
    }
  }

  wrap.appendChild(grid);
  return wrap;
}

function cdSyncFretLabel(wrap) {
  const label = wrap.querySelector(".cd-fret-label");
  const firstCell = wrap.querySelector(".cd-fret-cell.cd-s-first");
  if (!label || !firstCell) return;

  // Derive the zoom factor from the element itself so this works at any zoom level
  const zoom = firstCell.getBoundingClientRect().width / firstCell.offsetWidth || 1;

  // Vertical: align with first fret cell
  label.style.paddingTop = "0";
  const vertOffset = (firstCell.getBoundingClientRect().top - label.getBoundingClientRect().top) / zoom;
  const vertOffsetTweaked = vertOffset - 5;
  if (vertOffsetTweaked > 0) label.style.paddingTop = vertOffsetTweaked + "px";

}

function cdRenderEditor() {
  const pop = cdGetEditPopover();
  const existingWrap = pop ? pop.querySelector(".cd-grid-wrap") : null;
  if (existingWrap) {
    const newWrap = cdBuildGridEl(_editingChord, true);
    existingWrap.replaceWith(newWrap);
    cdSyncFretLabel(newWrap);
  }
}

function cdRenderEditPopover() {
  const inner = cdGetEditPopover().querySelector(".cd-popover-inner");
  inner.innerHTML = "";
  cdRenderEditorInto(inner);
}

function cdRenderDialog() {
  const body = cdGetBody();
  const footer = cdGetFooter();
  body.innerHTML = "";
  footer.innerHTML = "";
  cdRenderListInto(body);
  cdRenderListFooterInto(footer);
  cdRenderTabStrip();
}

function cdRenderTabStrip() {
  const dialog = cdGetDialog();
  let strip = dialog.querySelector(".cd-tab-strip");
  if (!strip) {
    strip = document.createElement("div");
    strip.className = "cd-tab-strip";
    dialog.appendChild(strip);
  }
  strip.innerHTML = "";

  const makeTab = (id, label) => {
    const el = document.createElement("div");
    el.className = "cd-tab" + (cdActiveTab === id ? " cd-tab-active" : "");
    el.addEventListener("click", () => { cdActiveTab = id; cdRenderDialog(); });
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    el.appendChild(labelSpan);
    if (id !== "all") {
      const delBtn = document.createElement("span");
      delBtn.className = "cd-tab-delete";
      delBtn.textContent = "×";
      delBtn.title = "Delete tab and its chords";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm(`Delete tab "${label}" and all its chords?`)) return;
        chords = chords.filter(c => c.tab !== id);
        cdTabs = cdTabs.filter(t => t.id !== id);
        if (cdActiveTab === id) cdActiveTab = "all";
        if (typeof markDirty === "function") markDirty();
        if (typeof renderBottomPanel === "function") renderBottomPanel();
        cdRenderDialog();
      });
      el.appendChild(delBtn);
    }
    strip.appendChild(el);
  };

  const addBtn = document.createElement("div");
  addBtn.className = "cd-tab cd-tab-add";
  addBtn.textContent = "+";
  addBtn.title = "Add tab";
  addBtn.addEventListener("click", () => {
    const name = prompt("New tab name:");
    if (!name?.trim()) return;
    const id = "tab-" + crypto.randomUUID().slice(0, 8);
    cdTabs.unshift({ id, name: name.trim() });
    cdActiveTab = id;
    cdRenderDialog();
  });
  strip.appendChild(addBtn);

  makeTab("all", "All");
  for (const t of cdTabs) makeTab(t.id, t.name);
}

function cdRenderListInto(container) {
  const visible = cdActiveTab === "all" ? chords : chords.filter(c => c.tab === cdActiveTab);
  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cd-empty";
    empty.textContent = "No chords in this tab.";
    container.appendChild(empty);
  } else {
    const row = document.createElement("div");
    row.className = "cd-chord-row";
    for (const chord of visible) {
      const card = document.createElement("div");
      card.className = "cd-chord-card";
      card.dataset.chordId = chord.id;
      card.addEventListener("click", () => cdOpenEditPopover(chord.id, card));

      const name = document.createElement("div");
      name.className = "cd-card-name";
      name.textContent = chord.name || "—";

      const gridWrap = cdBuildGridEl(chord, false);
      const col = document.createElement("div");
      col.className = "cd-name-grid-col";
      col.appendChild(name);
      col.appendChild(gridWrap.querySelector(".cd-grid"));
      gridWrap.appendChild(col);

      const playBtn = document.createElement("button");
      playBtn.className = "cd-play-btn";
      playBtn.textContent = "▶";
      playBtn.title = "Click: strum  •  Double-click: spaced notes";
      cdAttachPlayHandlers(playBtn, () => chord);
      card.appendChild(gridWrap);
      card.appendChild(playBtn);
      row.appendChild(card);
    }
    container.appendChild(row);
    row.querySelectorAll(".cd-grid-wrap").forEach(cdSyncFretLabel);
  }

}

function cdRenderListFooterInto(footer) {
  const addBtn = document.createElement("button");
  addBtn.className = "cd-add-btn";
  addBtn.textContent = "+ Add Chord";
  addBtn.addEventListener("click", () => cdOpenEditPopover(null, addBtn));

  const zoomWrap = document.createElement("div");
  zoomWrap.className = "cd-zoom-wrap";

  const zoomOut = document.createElement("button");
  zoomOut.className = "cd-zoom-btn";
  zoomOut.textContent = "−";
  zoomOut.addEventListener("click", () => {
    _cdZoom = Math.max(0.5, _cdZoom - 0.5);
    cdGetDialog().style.setProperty("--cd-zoom", _cdZoom);
    cdGetBody().querySelectorAll(".cd-grid-wrap").forEach(cdSyncFretLabel);
  });

  const zoomIn = document.createElement("button");
  zoomIn.className = "cd-zoom-btn";
  zoomIn.textContent = "+";
  zoomIn.addEventListener("click", () => {
    _cdZoom = Math.min(6, _cdZoom + 0.5);
    cdGetDialog().style.setProperty("--cd-zoom", _cdZoom);
    cdGetBody().querySelectorAll(".cd-grid-wrap").forEach(cdSyncFretLabel);
  });

  zoomWrap.appendChild(zoomOut);
  zoomWrap.appendChild(zoomIn);
  footer.appendChild(addBtn);
  footer.appendChild(cdBuildSoundToggle());
  footer.appendChild(zoomWrap);
}

function cdRenderEditorInto(container) {
  // Chord name
  const nameInput = document.createElement("input");
  nameInput.className = "cd-name-input";
  nameInput.type = "text";
  nameInput.placeholder = "Chord name…";
  nameInput.value = _editingChord.name;
  nameInput.addEventListener("input", () => { _editingChord.name = nameInput.value; });
  container.appendChild(nameInput);

  // Controls row: fret + rows
  const controls = document.createElement("div");
  controls.className = "cd-editor-controls";

  const fretLabel = document.createElement("span");
  fretLabel.className = "cd-basefret-label";
  fretLabel.textContent = "Fret";

  const fretInput = document.createElement("input");
  fretInput.className = "cd-basefret-input";
  fretInput.type = "number";
  fretInput.min = 1;
  fretInput.max = 12;
  fretInput.value = _editingChord.baseFret;
  fretInput.addEventListener("input", () => {
    const n = Math.max(1, Math.min(12, parseInt(fretInput.value) || 1));
    _editingChord.baseFret = n;
    cdRenderEditor();
  });

  const rowsLabel = document.createElement("span");
  rowsLabel.className = "cd-basefret-label";
  rowsLabel.textContent = "Rows";

  const rowsSeg = document.createElement("div");
  rowsSeg.className = "cd-rows-seg";
  [4, 5, 6].forEach(n => {
    const btn = document.createElement("button");
    btn.className = "cd-rows-btn" + (_editingChord.frets === n ? " active" : "");
    btn.textContent = n;
    btn.addEventListener("click", () => {
      const prev = _editingChord.frets;
      _editingChord.frets = n;
      for (let s = 0; s < 6; s++) {
        while (_editingChord.dots[s].length > n) _editingChord.dots[s].pop();
        while (_editingChord.dots[s].length < n) _editingChord.dots[s].push(false);
      }
      if (prev !== n) cdRenderEditPopover();
    });
    rowsSeg.appendChild(btn);
  });

  controls.appendChild(fretLabel);
  controls.appendChild(fretInput);
  controls.appendChild(rowsLabel);
  controls.appendChild(rowsSeg);
  container.appendChild(controls);

  // Diagram grid
  const editorWrap = cdBuildGridEl(_editingChord, true);
  container.appendChild(editorWrap);
  cdSyncFretLabel(editorWrap);

  // Footer
  const footer = document.createElement("div");
  footer.className = "cd-dialog-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "cd-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", cdShowList);


  const popPlayBtn = document.createElement("button");
  popPlayBtn.className = "cd-btn-cancel cd-btn-play-pop";
  popPlayBtn.textContent = "▶ Play";
  popPlayBtn.title = "Click: strum  •  Double-click: spaced notes";
  cdAttachPlayHandlers(popPlayBtn, () => _editingChord);

  const rightGroup = document.createElement("div");
  rightGroup.className = "cd-editor-footer-right";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "cd-btn-delete-chord";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => cdDeleteChord(_editingChord.id));

  const saveBtn = document.createElement("button");
  saveBtn.className = "cd-btn-save";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", cdSaveChord);

  const playWrap = document.createElement("div");
  playWrap.className = "cd-play-wrap";
  playWrap.appendChild(popPlayBtn);

  rightGroup.appendChild(deleteBtn);
  rightGroup.appendChild(saveBtn);
  footer.appendChild(cancelBtn);
  footer.appendChild(rightGroup);
  container.appendChild(playWrap);
  container.appendChild(footer);
}

// ============================================================
// Event Handlers (Intent Layer) -----
// ============================================================

function cdInitDrag() {
  const dialog = cdGetDialog();
  const titlebar = dialog.querySelector(".cd-dialog-titlebar");

  titlebar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".cd-dialog-close")) return;
    _cdDragging = true;
    _cdDragOffX = e.clientX - dialog.offsetLeft;
    _cdDragOffY = e.clientY - dialog.offsetTop;
    titlebar.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!_cdDragging) return;
    dialog.style.left = `${e.clientX - _cdDragOffX}px`;
    dialog.style.top  = `${e.clientY - _cdDragOffY}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!_cdDragging) return;
    _cdDragging = false;
    titlebar.style.cursor = "";
  });
}

function cdInitResize() {
  const dialog = cdGetDialog();
  for (const edge of ['n', 's', 'e', 'w']) {
    const handle = document.createElement('div');
    handle.className = `cd-resize-edge cd-resize-${edge}`;
    dialog.appendChild(handle);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startW = dialog.offsetWidth, startH = dialog.offsetHeight;
      const startL = dialog.offsetLeft,  startT = dialog.offsetTop;

      const onMove = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (edge === 'e') {
          dialog.style.width = Math.max(200, startW + dx) + 'px';
        } else if (edge === 'w') {
          const w = Math.max(200, startW - dx);
          dialog.style.width = w + 'px';
          dialog.style.left  = (startL + startW - w) + 'px';
        } else if (edge === 's') {
          dialog.style.height = Math.max(120, startH + dy) + 'px';
        } else if (edge === 'n') {
          const h = Math.max(120, startH - dy);
          dialog.style.height = h + 'px';
          dialog.style.top    = (startT + startH - h) + 'px';
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

// ============================================================
// Initialization -----
// ============================================================

function cdInit() {
  const dialog = document.createElement("div");
  dialog.id = "chord-diagrams-dialog";

  const titlebar = document.createElement("div");
  titlebar.className = "cd-dialog-titlebar";

  const title = document.createElement("span");
  title.textContent = "Chord Diagrams";

  const closeBtn = document.createElement("button");
  closeBtn.className = "cd-dialog-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", cdTogglePanel);

  const shareBtn = document.createElement("button");
  shareBtn.className = "cd-dialog-share";
  shareBtn.textContent = "⬆";
  shareBtn.title = "Copy share link";
  shareBtn.addEventListener("click", () => {
    const url = location.href.split('#')[0] + '#chords=' + cdEncodeChords();
    navigator.clipboard.writeText(url).then(() => {
      shareBtn.textContent = "✓";
      setTimeout(() => shareBtn.textContent = "⬆", 1500);
    });
  });

  titlebar.appendChild(title);
  titlebar.appendChild(shareBtn);
  titlebar.appendChild(closeBtn);

  const body = document.createElement("div");
  body.id = "chord-diagrams-body";

  const footer = document.createElement("div");
  footer.id = "chord-diagrams-footer";

  const inner = document.createElement("div");
  inner.className = "cd-dialog-inner";
  inner.appendChild(titlebar);
  inner.appendChild(body);
  inner.appendChild(footer);
  dialog.appendChild(inner);
  document.body.appendChild(dialog);
  dialog.classList.add("cd-visible");

  dialog.style.top  = "210px";
  dialog.style.left = (window.innerWidth - dialog.offsetWidth - 50) + "px";
  dialog.style.setProperty("--cd-zoom", _cdZoom);
  window.addEventListener("resize", () => {
    dialog.style.left = (window.innerWidth - dialog.offsetWidth - 50) + "px";
  });
  cdInitDrag();
  cdInitResize();
  cdRenderDialog();

  const _hashChords = window.location.hash.startsWith('#chords=')
    ? cdDecodeChords(window.location.hash.slice('#chords='.length))
    : null;
  if (_hashChords) {
    chords.length = 0;
    for (const c of _hashChords) {
      const f = c.frets ?? 4;
      chords.push({
        id:       crypto.randomUUID(),
        name:     c.name ?? "",
        baseFret: c.baseFret ?? 1,
        frets:    f,
        tops:     c.tops ?? Array(6).fill(null),
        dots:     Array.isArray(c.dots) ? c.dots : Array.from({ length: 6 }, () => Array(f).fill(false)),
        tab:      c.tab ?? null,
      });
    }
    cdRenderDialog();
  }

  const popover = document.createElement("div");
  popover.id = "chord-edit-popover";
  const popoverInner = document.createElement("div");
  popoverInner.className = "cd-popover-inner";
  popover.appendChild(popoverInner);
  document.body.appendChild(popover);

  document.addEventListener("mousedown", (e) => {
    const pop = cdGetEditPopover();
    if (pop.classList.contains("cd-popover-visible") && !pop.contains(e.target)) {
      pop.classList.remove("cd-popover-visible");
      _editingChord = null;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const pop = cdGetEditPopover();
      if (pop.classList.contains("cd-popover-visible")) {
        pop.classList.remove("cd-popover-visible");
        _editingChord = null;
      }
    }
  });
}

cdInit();
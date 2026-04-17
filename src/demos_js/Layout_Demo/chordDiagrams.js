// chordDiagrams.js
// Chord Diagrams - Self-contained floating panel for creating/saving guitar chord diagrams -----

// ============================================================
// State (Truth Layer) -----
// ============================================================

let chords = [];
let _editingChord = null;
let _cdDragging = false;
let _cdDragOffX = 0;
let _cdDragOffY = 0;
let _cdZoom = 1;

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
  };
}

function cdGetDialog() {
  return document.getElementById("chord-diagrams-dialog");
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
    left:    parseInt(dialog.style.left) || 200,
    top:     parseInt(dialog.style.top)  || 80,
    width:   dialog.offsetWidth,
    height:  dialog.offsetHeight,
    zoom:    _cdZoom,
    visible: dialog.classList.contains("cd-visible"),
  };
}

function cdSetPanelState(state) {
  if (!state) return;
  const dialog = cdGetDialog();
  if (state.left  != null) dialog.style.left   = state.left  + "px";
  if (state.top   != null) dialog.style.top    = state.top   + "px";
  if (state.width != null) dialog.style.width  = state.width + "px";
  if (state.height!= null) dialog.style.height = state.height + "px";
  if (state.zoom  != null) {
    _cdZoom = state.zoom;
    dialog.style.setProperty("--cd-zoom", _cdZoom);
  }
  if (state.visible) {
    dialog.classList.add("cd-visible");
    dialog.querySelectorAll(".cd-grid-wrap").forEach(cdSyncFretLabel);
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
  if (chordId) {
    const existing = chords.find(c => c.id === chordId);
    _editingChord = existing ? cdCloneChord(existing) : cdMakeBlankChord();
  } else {
    _editingChord = cdMakeBlankChord();
  }
  cdGetDialog().classList.add("cd-visible");
  cdRenderDialog();
}

function cdShowList() {
  _editingChord = null;
  cdRenderDialog();
}

function cdSaveChord() {
  if (!_editingChord) return;
  const idx = chords.findIndex(c => c.id === _editingChord.id);
  if (idx !== -1) {
    chords[idx] = _editingChord;
  } else {
    chords.push(_editingChord);
  }
  if (typeof markDirty === "function") markDirty();
  cdShowList();
}

function cdDeleteChord(id) {
  chords = chords.filter(c => c.id !== id);
  if (typeof markDirty === "function") markDirty();
  cdRenderDialog();
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
  grid.className = "cd-grid" + (interactive ? "" : " cd-view") + (frets === 4 ? " cd-4frets" : "");

  // Top row — above-nut indicators
  for (let s = 0; s < 6; s++) {
    const cell = document.createElement("div");
    cell.className = "cd-top-cell" + (s === 0 ? " cd-s-first" : s === 5 ? " cd-s-last" : "");
    cell.textContent = chord.tops[s] ?? "";
    if (interactive) {
      cell.addEventListener("click", () => cdCycleTop(s));
    }
    grid.appendChild(cell);
  }

  // Fret rows
  for (let r = 0; r < frets; r++) {
    for (let s = 0; s < 6; s++) {
      const cell = document.createElement("div");
      cell.className = "cd-fret-cell" + (s === 0 ? " cd-s-first" : s === 5 ? " cd-s-last" : "");
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
  if (vertOffset > 0) label.style.paddingTop = vertOffset + "px";

  // Horizontal: slide label right so it sits just left of the first string line
  label.style.position = "relative";
  label.style.left = "0";
  const firstStringX = firstCell.getBoundingClientRect().left + firstCell.getBoundingClientRect().width / 2;
  const shift = (firstStringX - label.getBoundingClientRect().right - 2) / zoom;
  if (shift > 0) label.style.left = shift + "px";
}

function cdRenderEditor() {
  const body = cdGetBody();
  const existingWrap = body.querySelector(".cd-grid-wrap");
  if (existingWrap) {
    const newWrap = cdBuildGridEl(_editingChord, true);
    existingWrap.replaceWith(newWrap);
    cdSyncFretLabel(newWrap);
  }
}

function cdRenderDialog() {
  const body = cdGetBody();
  const footer = cdGetFooter();
  body.innerHTML = "";
  footer.innerHTML = "";
  if (_editingChord) {
    cdRenderEditorInto(body);
  } else {
    cdRenderListInto(body);
    cdRenderListFooterInto(footer);
  }
}

function cdRenderListInto(container) {
  if (chords.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cd-empty";
    empty.textContent = "No chords saved yet.";
    container.appendChild(empty);
  } else {
    const row = document.createElement("div");
    row.className = "cd-chord-row";
    for (const chord of chords) {
      const card = document.createElement("div");
      card.className = "cd-chord-card";

      const name = document.createElement("div");
      name.className = "cd-card-name";
      name.textContent = chord.name || "—";

      const gridWrap = cdBuildGridEl(chord, false);
      const col = document.createElement("div");
      col.className = "cd-name-grid-col";
      col.appendChild(name);
      col.appendChild(gridWrap.querySelector(".cd-grid"));
      gridWrap.appendChild(col);
      card.appendChild(gridWrap);

      const actions = document.createElement("div");
      actions.className = "cd-card-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "cd-card-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => cdOpenDialog(chord.id));

      const delBtn = document.createElement("button");
      delBtn.className = "cd-card-btn cd-btn-delete";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => cdDeleteChord(chord.id));

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
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
  addBtn.addEventListener("click", () => cdOpenDialog());

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
  footer.appendChild(zoomWrap);
}

function cdRenderEditorInto(container) {
  // Name + baseFret row
  const nameRow = document.createElement("div");
  nameRow.className = "cd-name-row";

  const nameInput = document.createElement("input");
  nameInput.className = "cd-name-input";
  nameInput.type = "text";
  nameInput.placeholder = "Chord name…";
  nameInput.value = _editingChord.name;
  nameInput.addEventListener("input", () => { _editingChord.name = nameInput.value; });

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
  [4, 5].forEach(n => {
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
      if (prev !== n) cdRenderDialog();
    });
    rowsSeg.appendChild(btn);
  });

  nameRow.appendChild(nameInput);
  nameRow.appendChild(fretLabel);
  nameRow.appendChild(fretInput);
  nameRow.appendChild(rowsLabel);
  nameRow.appendChild(rowsSeg);
  container.appendChild(nameRow);

  // Diagram grid
  const editorWrap = cdBuildGridEl(_editingChord, true);
  container.appendChild(editorWrap);
  cdSyncFretLabel(editorWrap);

  // Footer buttons
  const footer = document.createElement("div");
  footer.className = "cd-dialog-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "cd-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", cdShowList);

  const saveBtn = document.createElement("button");
  saveBtn.className = "cd-btn-save";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", cdSaveChord);

  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);
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

  titlebar.appendChild(title);
  titlebar.appendChild(closeBtn);

  const body = document.createElement("div");
  body.id = "chord-diagrams-body";

  const footer = document.createElement("div");
  footer.id = "chord-diagrams-footer";

  dialog.appendChild(titlebar);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  document.body.appendChild(dialog);

  dialog.style.setProperty("--cd-zoom", _cdZoom);
  cdInitDrag();
  cdRenderDialog();
}

cdInit();
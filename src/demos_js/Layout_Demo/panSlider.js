// panSlider.js
// Helpers - Custom Pan Slider - Component -----

// Single document-level drag handlers shared across all instances.
let _activePanDrag = null;

document.addEventListener("mousemove", (e) => {
  if (!_activePanDrag) return;
  _activePanDrag._handleMove(e);
});

document.addEventListener("mouseup", () => {
  if (!_activePanDrag) return;
  _activePanDrag.removeAttribute("data-dragging");
  _activePanDrag = null;
});

class PanSlider extends HTMLElement {
  connectedCallback() {
    this._min          = parseFloat(this.getAttribute("min")   ?? -100);
    this._max          = parseFloat(this.getAttribute("max")   ??  100);
    this._value        = parseFloat(this.getAttribute("value") ??    0);
    this._snapZone     = (this._max - this._min) * 0.05; // 5% of range snaps to center
    this._render();
  }

  get value() { return this._value; }

  set value(v) {
    this._value = Math.max(this._min, Math.min(this._max, Number(v)));
    this._update();
  }

  _render() {
    this.innerHTML = `
      <span class="ps-label">L</span>
      <div class="ps-track">
        <div class="ps-center-tick"></div>
        <div class="ps-fill"></div>
        <div class="ps-thumb"></div>
      </div>
      <span class="ps-label">R</span>`;

    const track = this.querySelector(".ps-track");

    this.addEventListener("mousedown", (e) => {
      _activePanDrag = this;
      this.setAttribute("data-dragging", "");
      this._handleMove(e);
      e.preventDefault();
    });

    [-80, -20, 20, 80].forEach(v => {
      const tick = document.createElement("div");
      tick.className = "ps-tick";
      tick.style.left = `${((v - this._min) / (this._max - this._min)) * 100}%`;
      track.appendChild(tick);
    });

    this.addEventListener("dblclick", () => {
      this.value = 0;
      this.dispatchEvent(new Event("input", { bubbles: true }));
    });

    this._update();
  }

  _handleMove(e) {
    const rect = this.querySelector(".ps-track").getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let val    = this._min + pct * (this._max - this._min);
    if (Math.abs(val) <= this._snapZone) val = 0;
    this._value = val;
    this._update();
    this.dispatchEvent(new Event("input", { bubbles: true }));
  }

  _update() {
    const range      = this._max - this._min;
    const pct        = ((this._value - this._min) / range) * 100;
    const centerPct  = ((-this._min) / range) * 100; // 50 for symmetric range

    const fill  = this.querySelector(".ps-fill");
    const thumb = this.querySelector(".ps-thumb");

    if (this._value >= 0) {
      fill.style.left  = `${centerPct}%`;
      fill.style.width = `${pct - centerPct}%`;
    } else {
      fill.style.left  = `${pct}%`;
      fill.style.width = `${centerPct - pct}%`;
    }

    thumb.style.left = `${pct}%`;
  }
}

customElements.define("pan-slider", PanSlider);

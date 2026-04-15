// gainSlider.js
// Helpers - Custom Gain Slider - Component -----

// Single document-level drag handlers shared across all instances.
let _activeDrag = null;

document.addEventListener("mousemove", (e) => {
  if (!_activeDrag) return;
  _activeDrag._handleMove(e);
});

document.addEventListener("mouseup", () => {
  if (!_activeDrag) return;
  _activeDrag.removeAttribute("data-dragging");
  _activeDrag = null;
});

class GainSlider extends HTMLElement {
  connectedCallback() {
    this._min   = parseFloat(this.getAttribute("min")   ?? 0);
    this._max   = parseFloat(this.getAttribute("max")   ?? 100);
    this._value = parseFloat(this.getAttribute("value") ?? 80);
    this._render();
  }

  get value() { return this._value; }

  set value(v) {
    this._value = Math.max(this._min, Math.min(this._max, Number(v)));
    this._update();
  }

  _render() {
    this.innerHTML = `
      <div class="gs-track">
        <div class="gs-fill"></div>
        <div class="gs-thumb"></div>
      </div>`;

    this.querySelector(".gs-track").addEventListener("mousedown", (e) => {
      _activeDrag = this;
      this.setAttribute("data-dragging", "");
      this._handleMove(e);
      e.preventDefault();
    });

    this._update();
  }

  _handleMove(e) {
    const rect = this.querySelector(".gs-track").getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this._value = this._min + pct * (this._max - this._min);
    this._update();
    this.dispatchEvent(new Event("input", { bubbles: true }));
  }

  _update() {
    const pct = ((this._value - this._min) / (this._max - this._min)) * 100;
    this.querySelector(".gs-fill").style.width = `${pct}%`;
    this.querySelector(".gs-thumb").style.left = `${pct}%`;
  }
}

customElements.define("gain-slider", GainSlider);

// onboarding.js

// ============================================================
// Onboarding -----
// ============================================================

// const ONBOARDING_STEPS = [
//   {
//     targets: [".recording-lane.control-row", ".recording-lane.timeline-row"],
//     text: "This is the recording lane, where recordings go first. The default track names are very clever. Click the name to edit it. Then click next",
//   },
//   {
//     target: "#recordBtn",
//     text: "Use the record button to arm recording. Click it now.Then click next.",
//   },
//   {
//     target: "#meter",
//     text: "When recording is armed, this meter will show the input level.  Try making some noise to see it react.",
//   },
//   {
//     target: "#playBtn",
//     text: "Use the play button to start the recording. Click it now. Then Click Next.",
//   },
//   {
//     target: "#playBtn",
//     text: "Click the play button again to stop the recording. Click it now. Then Click Next.",
//   },
//   {
//     target: "#returnToBeginningBtn",
//     text: "Use the return to beginning button to reset the playback position. Then Click Next.",
//   },
// ];

const ONBOARDING_STEPS = [
  {
    targets: [".recording-lane.control-row", ".recording-lane.timeline-row"],
    text: "This is the recording lane, where recordings go first. The default track names are very clever and evocative. Click the name to edit it. Then click next",
  },
  {
    targets: ["#recordBtn", "#playBtn", "#returnToBeginningBtn"],
    text: "Use the record button to arm recording. The play button begins and ends recording when record is armed.",
  },
];

function startOnboarding() {
  if (!ONBOARDING_STEPS.length) return;

  const overlay = document.createElement("div");
  overlay.id = "onboarding-overlay";

  const spotlight = document.createElement("div");
  spotlight.id = "onboarding-spotlight";

  const card = document.createElement("div");
  card.id = "onboarding-card";
  card.innerHTML = `
    <p id="onboarding-text"></p>
    <div class="onboarding-footer">
      <span id="onboarding-counter"></span>
      <div class="onboarding-btns">
        <button id="onboarding-skip">Skip</button>
        <button id="onboarding-next">Next →</button>
      </div>
    </div>
  `;

  overlay.appendChild(spotlight);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let step = 0;

  function positionCard(rect, pad) {
    const cardWidth = card.offsetWidth;
    const margin = 12;
    let left = Math.max(margin, Math.min(rect.left - pad, window.innerWidth - cardWidth - margin));
    card.style.left = `${left}px`;
    card.style.right = "auto";
    const spaceBelow = window.innerHeight - (rect.bottom + pad + margin);
    if (spaceBelow > 120) {
      card.style.top = `${rect.bottom + pad + margin}px`;
      card.style.bottom = "auto";
    } else {
      card.style.top = "auto";
      card.style.bottom = `${window.innerHeight - (rect.top - pad - margin)}px`;
    }
  }

  function show(index) {
    const { target, targets, text } = ONBOARDING_STEPS[index];
    const selectors = targets ?? [target];
    const rects = selectors.map(s => document.querySelector(s)).filter(Boolean).map(el => el.getBoundingClientRect());
    if (!rects.length) return;
    const rect = {
      left:   Math.min(...rects.map(r => r.left)),
      top:    Math.min(...rects.map(r => r.top)),
      right:  Math.max(...rects.map(r => r.right)),
      bottom: Math.max(...rects.map(r => r.bottom)),
    };
    const pad = 8;
    spotlight.style.left   = `${rect.left - pad}px`;
    spotlight.style.top    = `${rect.top  - pad}px`;
    spotlight.style.width  = `${rect.right  - rect.left + pad * 2}px`;
    spotlight.style.height = `${rect.bottom - rect.top  + pad * 2}px`;
    document.getElementById("onboarding-text").textContent = text;
    document.getElementById("onboarding-counter").textContent = `${index + 1} / ${ONBOARDING_STEPS.length}`;
    document.getElementById("onboarding-next").textContent =
      index === ONBOARDING_STEPS.length - 1 ? "Done ✓" : "Next →";
    positionCard(rect, pad);
  }

  function dismiss() {
    overlay.classList.add("onboarding-exit");
    overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
  }

  document.getElementById("onboarding-skip").onclick = dismiss;
  document.getElementById("onboarding-next").onclick = () => {
    if (step === ONBOARDING_STEPS.length - 1) {
      dismiss();
    } else {
      step++;
      show(step);
    }
  };

  show(0);
}

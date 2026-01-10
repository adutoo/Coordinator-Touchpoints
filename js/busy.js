// js/busy.js
let refCount = 0;
let shownAt = 0;
let hideTimer = null;

const MIN_SHOW_MS = 250; // prevents flicker

function ensureUI() {
  if (document.getElementById("busyOverlay")) return;

  const style = document.createElement("style");
  style.id = "busyStyles";
  style.textContent = `
    #busyOverlay{
      position:fixed; inset:0; z-index:9999;
      display:none; align-items:center; justify-content:center;
      background:rgba(0,0,0,0.55);
      backdrop-filter: blur(6px);
    }
    #busyCard{
      width:min(520px, calc(100vw - 28px));
      border-radius:18px;
      border:1px solid rgba(255,255,255,0.14);
      background: rgba(10,10,18,0.92);
      box-shadow: 0 22px 60px rgba(0,0,0,0.55);
      padding: 16px 16px 14px;
    }
    #busyTitle{
      font-weight:800;
      font-size:15px;
      color: rgba(255,255,255,0.92);
      margin: 0 0 6px;
    }
    #busySub{
      font-size:12px;
      color: rgba(255,255,255,0.68);
      margin: 0 0 12px;
      white-space: pre-wrap;
    }
    .busyBar{
      height: 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      overflow:hidden;
      border: 1px solid rgba(255,255,255,0.10);
    }
    .busyFill{
      height:100%;
      width: 0%;
      border-radius: 999px;
      background: rgba(124,92,255,0.95);
      transition: width .15s ease;
    }
    .busyFill.indet{
      width: 40%;
      background: linear-gradient(90deg, rgba(124,92,255,0.35), rgba(124,92,255,0.95), rgba(124,92,255,0.35));
      animation: busyMove 1.1s ease-in-out infinite;
    }
    @keyframes busyMove{
      0% { transform: translateX(-120%); }
      50% { transform: translateX(70%); }
      100% { transform: translateX(220%); }
    }
    #busyPct{
      margin-top: 10px;
      font-size: 12px;
      color: rgba(255,255,255,0.72);
      display:flex;
      justify-content:space-between;
      gap:10px;
    }
    #busyPct span{
      opacity:0.95;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "busyOverlay";
  overlay.innerHTML = `
    <div id="busyCard">
      <div id="busyTitle">Working…</div>
      <div id="busySub">Please wait</div>
      <div class="busyBar"><div id="busyFill" class="busyFill indet"></div></div>
      <div id="busyPct">
        <span id="busyLeft">Processing…</span>
        <span id="busyRight"></span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function setVisible(v) {
  ensureUI();
  const overlay = document.getElementById("busyOverlay");
  overlay.style.display = v ? "flex" : "none";
}

export function showBusy(title = "Working…", sub = "Please wait", pct = null) {
  ensureUI();

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  refCount++;
  shownAt = Date.now();

  const t = document.getElementById("busyTitle");
  const s = document.getElementById("busySub");
  const fill = document.getElementById("busyFill");
  const left = document.getElementById("busyLeft");
  const right = document.getElementById("busyRight");

  t.textContent = title;
  s.textContent = sub || "";

  // pct = null => indeterminate
  if (pct === null || pct === undefined) {
    fill.classList.add("indet");
    fill.style.width = "40%";
    right.textContent = "";
    left.textContent = "Processing…";
  } else {
    const p = Math.max(0, Math.min(100, Number(pct)));
    fill.classList.remove("indet");
    fill.style.width = `${p}%`;
    right.textContent = `${Math.round(p)}%`;
    left.textContent = sub || "Processing…";
  }

  setVisible(true);
}

export function setBusyProgress(pct = null, sub = "") {
  ensureUI();
  const fill = document.getElementById("busyFill");
  const left = document.getElementById("busyLeft");
  const right = document.getElementById("busyRight");

  if (pct === null || pct === undefined) {
    fill.classList.add("indet");
    fill.style.width = "40%";
    right.textContent = "";
  } else {
    const p = Math.max(0, Math.min(100, Number(pct)));
    fill.classList.remove("indet");
    fill.style.width = `${p}%`;
    right.textContent = `${Math.round(p)}%`;
  }
  left.textContent = sub || "Processing…";
}

export function hideBusy() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;

  const elapsed = Date.now() - shownAt;
  const wait = Math.max(0, MIN_SHOW_MS - elapsed);

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    setVisible(false);
    hideTimer = null;
  }, wait);
}

export async function withBusy(title, fn, { sub = "Please wait", pct = null } = {}) {
  showBusy(title, sub, pct);
  try {
    return await fn();
  } finally {
    hideBusy();
  }
}

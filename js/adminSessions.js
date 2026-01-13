// js/adminSessions.js
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy } from "./busy.js";
import {
  ensureSessionConfigLoaded,
  getSessionConfigSync,
  saveSessionConfig,
  getSessionRange,
  setSessionLabel,
  listSessionsFallback
} from "./session.js";

const listEl = document.getElementById("sessList");
const defEl = document.getElementById("sessDefault");
const saveBtn = document.getElementById("sessSave");
const useBtn = document.getElementById("sessUseDefault");
const msgEl = document.getElementById("sessMsg");
const previewEl = document.getElementById("sessRangePreview");

let __busyDepth = 0;
async function runBusy(title, fn) {
  if (__busyDepth > 0) return await fn();
  __busyDepth++;
  try { return await withBusy(title, fn); }
  finally { __busyDepth--; }
}

function show(text, isErr = false) {
  if (!msgEl) return;
  msgEl.style.display = "block";
  msgEl.style.borderColor = isErr ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msgEl.style.color = isErr ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  msgEl.textContent = text;
}
function hide() { if (msgEl) msgEl.style.display = "none"; }

function parseSessionsText() {
  const lines = (listEl.value || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const uniq = Array.from(new Set(lines)).sort((a, b) => a.localeCompare(b));
  const bad = uniq.filter(s => !/^(\d{4}-\d{2}|\d{4}-\d{4})$/.test(s));
  if (bad.length) throw new Error(`Invalid session: ${bad[0]} (use like 2025-26)`);

  return uniq;
}

function renderPreview(label) {
  if (!previewEl) return;
  if (!label) { previewEl.textContent = ""; return; }
  const r = getSessionRange(label);
  const fmt = (d) =>
    `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`;
  previewEl.textContent = `Range: ${fmt(r.start)} → ${fmt(r.end)} (To is end-exclusive)`;
}

function renderDefaultOptions(sessions, selected) {
  defEl.innerHTML = sessions.map(s => `<option value="${s}">${s}</option>`).join("");
  defEl.value = sessions.includes(selected) ? selected : (sessions[sessions.length - 1] || "");
  refreshSelect(defEl);
  renderPreview(defEl.value);
}

export async function mountSessionAdminUI() {
  if (!listEl || !defEl || !saveBtn || !useBtn || !msgEl) return;

  enhanceSelect(defEl, { placeholder: "Select default..." });

  await ensureSessionConfigLoaded();
  const cfg = getSessionConfigSync();

  const sessions = cfg?.sessions?.length ? cfg.sessions : listSessionsFallback();
  const def = cfg?.default || sessions[sessions.length - 1] || "";

  listEl.value = sessions.join("\n");
  renderDefaultOptions(sessions, def);
  hide();

  listEl.addEventListener("input", () => {
    try {
      const s = parseSessionsText();
      renderDefaultOptions(s, defEl.value);
      hide();
    } catch (e) {
      show(e?.message || String(e), true);
    }
  });

  defEl.addEventListener("change", () => renderPreview(defEl.value));

  saveBtn.addEventListener("click", async () => {
    hide();
    await runBusy("Saving sessions…", async () => {
      const sessions = parseSessionsText();
      if (!sessions.length) throw new Error("Enter at least one session.");

      let def = defEl.value;
      if (!sessions.includes(def)) def = sessions[sessions.length - 1];

      await saveSessionConfig({ sessions, default: def });
      renderDefaultOptions(sessions, def);
      show("Sessions saved globally ✅");
    }).catch(err => show(err?.message || String(err), true));
  });

  useBtn.addEventListener("click", () => {
    const def = defEl.value;
    if (!def) return;
    setSessionLabel(def);
    show(`Using session ${def} on this device ✅`);
  });
}

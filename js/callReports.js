// js/callReports.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { requireAuth } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";

const reportMsg = document.getElementById("reportMsg");
const rowsEl = document.getElementById("rows");
const metaLine = document.getElementById("metaLine");
const pageMeta = document.getElementById("pageMeta");

const searchBox = document.getElementById("searchBox");
const reloadBtn = document.getElementById("reloadBtn");

const fltCoordinator = document.getElementById("fltCoordinator");
const fltCallType = document.getElementById("fltCallType"); // existing single-select (we will replace it visually)
const fltFrom = document.getElementById("fltFrom");
const fltTo = document.getElementById("fltTo");
const applyFiltersBtn = document.getElementById("applyFiltersBtn");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const exportBtn = document.getElementById("exportBtn");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const CALL_PROMPT_KEY = "call_summary_prompt";
const COORD_CFG_KEY = "coordinators_config";

let page = 1;
const PAGE_SIZE = 25;

let lastData = [];
let coordMap = new Map(); // number -> email
let profileByEmail = new Map(); // email -> {display_name,email}

// -------------------- Multi-select state --------------------
let selectedCallTypes = new Set(); // keys like "INCOMING"
let selectedDurationThresholds = new Set(); // numbers (seconds)

let callTypeMS = null;
let durationMS = null;

const DURATION_OPTIONS = [
  { key: 10, label: "More than 10 sec" },
  { key: 30, label: "More than 30 sec" },
  { key: 60, label: "More than 60 sec" },
  { key: 120, label: "More than 2 min" },
  { key: 300, label: "More than 5 min" },
];

// -------------------- UI helpers --------------------
function show(el, text, isErr = false) {
  if (!el) return;
  el.style.display = "block";
  el.style.borderColor = isErr ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  el.style.color = isErr ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  el.textContent = text;
}
function hide(el) {
  if (!el) return;
  el.style.display = "none";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeNumber(n) {
  let s = String(n ?? "").trim();
  s = s.replace(/[()\-\s]/g, "");
  if (s.startsWith("+")) s = "+" + s.slice(1).replace(/[^\d]/g, "");
  else s = s.replace(/[^\d]/g, "");
  return s;
}

function fmt(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return String(ts);
  }
}

// -------------------- progress bar (indeterminate) --------------------
function ensureBusyCss() {
  if (document.getElementById("crBusyCss")) return;
  const st = document.createElement("style");
  st.id = "crBusyCss";
  st.textContent = `
    .cr-busywrap{display:flex;flex-direction:column;gap:8px}
    .cr-bar{height:8px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.10)}
    .cr-bar > i{display:block;height:100%;width:35%;background:rgba(124,92,255,.9);border-radius:999px;animation:crmove 1s linear infinite}
    @keyframes crmove{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
    .cr-muted{font-size:12px;opacity:.75}
    .cr-rowspin{display:inline-flex;align-items:center;gap:8px}
    .cr-dot{width:8px;height:8px;border-radius:50%;background:rgba(124,92,255,.9);box-shadow:0 0 0 2px rgba(124,92,255,.25)}
  `;
  document.head.appendChild(st);
}

function showProgress(text = "Working…") {
  ensureBusyCss();
  if (!reportMsg) return;
  reportMsg.style.display = "block";
  reportMsg.style.borderColor = "rgba(124,92,255,0.55)";
  reportMsg.style.color = "rgba(255,255,255,0.85)";
  reportMsg.innerHTML = `
    <div class="cr-busywrap">
      <div class="cr-rowspin"><span class="cr-dot"></span><span>${escapeHtml(text)}</span></div>
      <div class="cr-bar"><i></i></div>
      <div class="cr-muted">Please wait…</div>
    </div>
  `;
}

function showErr(text) {
  if (!reportMsg) return;
  reportMsg.innerHTML = "";
  show(reportMsg, text, true);
}

function showOk(text) {
  if (!reportMsg) return;
  reportMsg.innerHTML = "";
  show(reportMsg, text, false);
}

// -------------------- Multi-select UI (same dark style) --------------------
function ensureMsCss() {
  if (document.getElementById("crMsCss")) return;
  const st = document.createElement("style");
  st.id = "crMsCss";
  st.textContent = `
    .cr-ms-wrap{position:relative;width:100%}
    .cr-ms-btn{
      width:100%;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      padding:10px 12px;
      border-radius:14px;
      border:1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.18);
      color: rgba(255,255,255,0.90);
      cursor:pointer;
      min-height: 42px;
    }
    .cr-ms-btn:focus{outline:none; box-shadow:0 0 0 2px rgba(124,92,255,0.35); border-color: rgba(124,92,255,0.55);}
    .cr-ms-panel{
      position:absolute;
      left:0; right:0;
      top: calc(100% + 8px);
      z-index: 60;
      border-radius:14px;
      border:1px solid rgba(255,255,255,0.14);
      background: rgba(10,10,16,0.92);
      box-shadow: 0 18px 50px rgba(0,0,0,0.55);
      overflow:hidden;
      display:none;
    }
    .cr-ms-head{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      padding:10px 10px;
      border-bottom:1px solid rgba(255,255,255,0.08);
    }
    .cr-ms-title{ font-size:12px; color: rgba(255,255,255,0.7); }
    .cr-ms-actions{ display:flex; gap:8px; }
    .cr-ms-mini{
      padding:6px 10px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.2);
      color: rgba(255,255,255,0.85);
      cursor:pointer;
      font-size:12px;
    }
    .cr-ms-list{ max-height: 260px; overflow:auto; padding: 6px; }
    .cr-ms-item{
      display:flex;
      align-items:center;
      gap:10px;
      padding:8px 10px;
      border-radius:12px;
      cursor:pointer;
      color: rgba(255,255,255,0.90);
    }
    .cr-ms-item:hover{ background: rgba(255,255,255,0.06); }
    .cr-ms-item input{ width:16px; height:16px; accent-color: rgb(124,92,255); }
    .cr-ms-caret{ opacity:0.7; }
  `;
  document.head.appendChild(st);
}

function getFieldBox(el) {
  return el?.closest?.(".field") || el?.parentElement || null;
}

function makeMultiSelect({ mountEl, id, title, options, selectedSet, onChange }) {
  ensureMsCss();

  // avoid duplicates
  if (document.getElementById(id)) {
    return mountEl._msInstance || null;
  }

  const wrap = document.createElement("div");
  wrap.className = "cr-ms-wrap";
  wrap.id = id;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cr-ms-btn";

  const btnText = document.createElement("span");
  btnText.textContent = "All";

  const caret = document.createElement("span");
  caret.className = "cr-ms-caret";
  caret.textContent = "▾";

  btn.appendChild(btnText);
  btn.appendChild(caret);

  const panel = document.createElement("div");
  panel.className = "cr-ms-panel";

  const head = document.createElement("div");
  head.className = "cr-ms-head";

  const headTitle = document.createElement("div");
  headTitle.className = "cr-ms-title";
  headTitle.textContent = title;

  const actions = document.createElement("div");
  actions.className = "cr-ms-actions";

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "cr-ms-mini";
  allBtn.textContent = "All";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "cr-ms-mini";
  clearBtn.textContent = "Clear";

  actions.appendChild(allBtn);
  actions.appendChild(clearBtn);

  head.appendChild(headTitle);
  head.appendChild(actions);

  const list = document.createElement("div");
  list.className = "cr-ms-list";

  panel.appendChild(head);
  panel.appendChild(list);

  wrap.appendChild(btn);
  wrap.appendChild(panel);

  mountEl.appendChild(wrap);

  const labelForKey = (k) => {
    const hit = options.find(o => String(o.key) === String(k));
    return hit?.label ?? String(k);
  };

  function renderBtn() {
    const n = selectedSet.size;
    if (n === 0) { btnText.textContent = "All"; return; }
    if (n === 1) { btnText.textContent = labelForKey(Array.from(selectedSet)[0]); return; }
    btnText.textContent = `${n} selected`;
  }

  function renderList() {
    list.innerHTML = options.map(opt => {
      const checked = selectedSet.has(opt.key);
      return `
        <div class="cr-ms-item" data-key="${escapeHtml(String(opt.key))}">
          <input type="checkbox" ${checked ? "checked" : ""} />
          <div>${escapeHtml(opt.label)}</div>
        </div>
      `;
    }).join("");

    list.querySelectorAll(".cr-ms-item").forEach(row => {
      row.addEventListener("mousedown", (e) => e.preventDefault()); // keep open

      row.addEventListener("click", () => {
        const keyStr = row.getAttribute("data-key");
        const opt = options.find(o => String(o.key) === String(keyStr));
        if (!opt) return;

        if (selectedSet.has(opt.key)) selectedSet.delete(opt.key);
        else selectedSet.add(opt.key);

        renderList();
        renderBtn();
        onChange?.();
      });
    });

    renderBtn();
  }

  function open() { panel.style.display = "block"; }
  function close() { panel.style.display = "none"; }
  function toggle() { panel.style.display = panel.style.display === "block" ? "none" : "block"; }

  btn.addEventListener("click", toggle);
  allBtn.addEventListener("click", () => {
    selectedSet.clear();
    renderList();
    renderBtn();
    close();
    onChange?.();
  });
  clearBtn.addEventListener("click", () => {
    selectedSet.clear();
    renderList();
    renderBtn();
    onChange?.();
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) close();
  });

  renderList();

  const api = {
    wrap,
    rerender: renderList,
    setOptions(newOpts) {
      options = newOpts || [];
      const valid = new Set(options.map(o => String(o.key)));
      for (const k of Array.from(selectedSet)) {
        if (!valid.has(String(k))) selectedSet.delete(k);
      }
      renderList();
    },
    clearSelection() {
      selectedSet.clear();
      renderList();
    }
  };

  mountEl._msInstance = api;
  return api;
}

// ✅ Duration multi-select behavior: OR semantics => min threshold
function getDurationThresholdMin() {
  if (!selectedDurationThresholds.size) return null;
  return Math.min(...Array.from(selectedDurationThresholds).map(x => Number(x) || 0));
}

// -------------------- settings helpers --------------------
async function readAppSetting(key) {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

function parsePromptValue(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.prompt === "string") return v.prompt;
  return "";
}

function parseCoordValue(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object" && Array.isArray(v.coordinators)) return v.coordinators;
  if (typeof v === "object" && Array.isArray(v.list)) return v.list;
  return [];
}

function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

function deriveDateParts(ts) {
  const d = new Date(ts);
  const day = d.toISOString().slice(0, 10);
  const week = isoWeekNumber(d);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const year = d.getFullYear();
  return { day, week, month, year };
}

function coordinatorLabelByNumber(num) {
  const n = normalizeNumber(num);
  const email = coordMap.get(n);
  if (!email) return n || "";
  const p = profileByEmail.get(email);
  return p?.display_name ? `${p.display_name} (${email})` : email;
}

// -------------------- summary parsing for prefill --------------------
function normalizeSummaryText(s) {
  let t = String(s || "").trim();
  if (!t) return "";
  t = t.replace(/\s*POSITIVES\s*:/gi, "POSITIVES:\n");
  t = t.replace(/\s*SUGGESTIONS\s*:/gi, "\nSUGGESTIONS:\n");
  t = t.replace(/\s-\s/g, "\n- ");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function extractSection(text, header) {
  const t = normalizeSummaryText(text);
  const up = t.toUpperCase();
  const h = header.toUpperCase() + ":";
  const i = up.indexOf(h);
  if (i < 0) return "";
  const j = up.indexOf("SUGGESTIONS:", i + h.length);
  const chunk = header.toUpperCase() === "POSITIVES"
    ? t.slice(i + h.length, j >= 0 ? j : undefined)
    : t.slice(i + h.length);

  const lines = chunk.split("\n").map(x => x.trim()).filter(Boolean);
  const bullets = lines.filter(x => x.startsWith("-"));
  return (bullets.length ? bullets : lines).join("\n").trim();
}

function splitSummary(summary) {
  const positives = extractSection(summary, "POSITIVES");
  const suggestions = extractSection(summary, "SUGGESTIONS");
  return {
    positives: positives || "- (None mentioned)",
    suggestions: suggestions || "- (None mentioned)",
    normalized: normalizeSummaryText(summary),
  };
}

// -------------------- Install filters (FIX GLITCH) --------------------
function installCallTypeMultiInSameField() {
  if (!fltCallType) return;

  const field = getFieldBox(fltCallType);
  if (!field) return;

  // If already installed, do nothing
  if (field.dataset.msInstalled === "1") return;
  field.dataset.msInstalled = "1";

  // Fix label in SAME field (no extra field -> no grid glitch)
  let labelEl = field.querySelector("label");
  if (!labelEl) {
    labelEl = document.createElement("label");
    field.prepend(labelEl);
  }
  labelEl.textContent = "Call Type (Multi)";

  // Remove any custom select wrapper inside this field (from enhanceSelect)
  // Keep label + the original select hidden for reference.
  Array.from(field.children).forEach(ch => {
    if (ch === labelEl) return;
    if (ch === fltCallType) return;
    ch.remove();
  });

  // Build options
  if (fltCallType.options.length <= 1) {
    fltCallType.innerHTML = `
      <option value=""></option>
      <option value="INCOMING">INCOMING</option>
      <option value="OUTGOING">OUTGOING</option>
      <option value="MISSED">MISSED</option>
      <option value="REJECTED">REJECTED</option>
    `;
  }

  const opts = Array.from(fltCallType.options)
    .map(o => ({ key: o.value, label: (o.textContent || o.value || "").trim() }))
    .filter(o => String(o.key || "").trim() !== "");

  fltCallType.style.display = "none";

  callTypeMS = makeMultiSelect({
    mountEl: field,
    id: "callTypeMulti",
    title: "Select call types",
    options: opts,
    selectedSet: selectedCallTypes,
    onChange: () => {}
  });

  // Add duration field right after call type field (one new field)
  const existingDurField = document.getElementById("durationFieldBox");
  if (!existingDurField) {
    const durField = document.createElement("div");
    durField.id = "durationFieldBox";
    durField.className = field.className; // keep same grid span
    durField.innerHTML = `<label>Call Duration (Multi)</label>`;
    field.insertAdjacentElement("afterend", durField);

    durationMS = makeMultiSelect({
      mountEl: durField,
      id: "durationMulti",
      title: "Select duration filters",
      options: DURATION_OPTIONS,
      selectedSet: selectedDurationThresholds,
      onChange: () => {}
    });
  }
}

// -------------------- load coordinator directory --------------------
async function loadCoordinatorDirectory() {
  coordMap.clear();
  profileByEmail.clear();

  const v = await readAppSetting(COORD_CFG_KEY).catch(() => null);
  const list = parseCoordValue(v)
    .map((x) => ({
      number: normalizeNumber(x?.number),
      email: String(x?.email ?? "").trim().toLowerCase(),
    }))
    .filter((x) => x.number && x.email && x.email.includes("@"));

  for (const c of list) coordMap.set(c.number, c.email);

  const emails = Array.from(new Set(list.map((x) => x.email)));
  if (emails.length) {
    const { data, error } = await sb.from("profiles").select("email,display_name").in("email", emails);
    if (!error && data) {
      for (const p of data) profileByEmail.set(String(p.email).toLowerCase(), p);
    }
  }

  if (fltCoordinator) {
    fltCoordinator.innerHTML =
      `<option value=""></option>` +
      Array.from(coordMap.keys())
        .sort()
        .map((num) => {
          const label = coordinatorLabelByNumber(num);
          return `<option value="${escapeHtml(num)}">${escapeHtml(label)}</option>`;
        })
        .join("");
    try { refreshSelect(fltCoordinator); } catch {}
  }
}

// -------------------- query + render --------------------
function buildQuery({ withCount = true } = {}) {
  let q = sb
    .from("call_logs")
    .select(
      "id,created_at,parent_number,coordinator_number,call_start,call_end,duration_seconds,contact_name,call_type,call_summary,call_transcript",
      withCount ? { count: "exact" } : undefined
    );

  const coordNum = (fltCoordinator?.value || "").trim();
  const from = (fltFrom?.value || "").trim();
  const to = (fltTo?.value || "").trim();
  const search = (searchBox?.value || "").trim();

  if (coordNum) q = q.eq("coordinator_number", coordNum);

  // ✅ Call Type multi
  const types = Array.from(selectedCallTypes);
  if (types.length) q = q.in("call_type", types);

  // ✅ Duration multi (OR semantics => min threshold)
  const minThr = getDurationThresholdMin();
  if (minThr !== null) q = q.gte("duration_seconds", minThr);

  if (from) q = q.gte("created_at", new Date(from + "T00:00:00").toISOString());
  if (to) q = q.lte("created_at", new Date(to + "T23:59:59").toISOString());

  if (search) {
    const esc = search.replace(/,/g, " ");
    q = q.or(`parent_number.ilike.%${esc}%,contact_name.ilike.%${esc}%,call_summary.ilike.%${esc}%`);
  }

  const fromIdx = (page - 1) * PAGE_SIZE;
  const toIdx = fromIdx + PAGE_SIZE - 1;

  q = q.order("created_at", { ascending: false }).range(fromIdx, toIdx);
  return q;
}

function renderTable(data, totalCount = 0) {
  lastData = data || [];

  if (!rowsEl) return;

  if (!lastData.length) {
    rowsEl.innerHTML = `<tr><td colspan="16">No data.</td></tr>`;
    return;
  }

  rowsEl.innerHTML = lastData.map((r) => {
    const ts = r.created_at;
    const parts = deriveDateParts(ts);
    const coordName = coordinatorLabelByNumber(r.coordinator_number);

    const transcript = String(r.call_transcript || "").trim();
    const transcriptCell = transcript
      ? `<details><summary class="muted">View transcript</summary><div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(transcript)}</div></details>`
      : `—`;

    const rawSummary = String(r.call_summary || "").trim();
    const summary = rawSummary ? normalizeSummaryText(rawSummary) : "—";
    const hasSummary = !!rawSummary;

    return `
      <tr data-id="${r.id}">
        <td>${escapeHtml(fmt(ts))}</td>
        <td>${escapeHtml(r.parent_number || "")}</td>
        <td>${escapeHtml(r.coordinator_number || "")}</td>
        <td>${escapeHtml(r.call_start || "—")}</td>
        <td>${escapeHtml(r.call_end || "—")}</td>
        <td>${escapeHtml(r.duration_seconds ?? "")}</td>
        <td>${escapeHtml(r.contact_name || "")}</td>
        <td>${escapeHtml(r.call_type || "")}</td>
        <td class="cell-summary" style="white-space:pre-wrap;">${escapeHtml(summary)}</td>
        <td>${transcriptCell}</td>
        <td>${escapeHtml(coordName)}</td>
        <td>${escapeHtml(parts.day)}</td>
        <td>${escapeHtml(parts.week)}</td>
        <td>${escapeHtml(parts.month)}</td>
        <td>${escapeHtml(parts.year)}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn" data-act="gen">Generate</button>
          <button class="btn primary" data-act="new" ${hasSummary ? "" : "disabled"}>New Entry</button>
        </td>
      </tr>
    `;
  }).join("");

  const totalPages = Math.max(1, Math.ceil((totalCount || lastData.length) / PAGE_SIZE));
  if (pageMeta) pageMeta.textContent = `Page ${page} / ${totalPages}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;

  if (metaLine) {
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = (page - 1) * PAGE_SIZE + lastData.length;
    metaLine.textContent = `Showing ${start}-${end} of ${totalCount || lastData.length}`;
  }
}

async function fetchData() {
  if (!rowsEl) return;
  showProgress("Loading call logs…");
  rowsEl.innerHTML = `<tr><td colspan="16">Loading…</td></tr>`;

  const { data, error, count } = await buildQuery();
  if (error) {
    console.error(error);
    showErr(error.message);
    rowsEl.innerHTML = `<tr><td colspan="16">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  hide(reportMsg);
  renderTable(data || [], count || 0);
}

// -------------------- generate summary --------------------
async function generateForRow(rowId, btnEl) {
  const row = lastData.find((x) => String(x.id) === String(rowId));
  if (!row) return;

  const transcript = String(row.call_transcript || "").trim();
  if (!transcript) return showErr("Transcript is empty. Cannot generate.");

  let prompt = "";
  try {
    const v = await readAppSetting(CALL_PROMPT_KEY);
    prompt = parsePromptValue(v) || "";
  } catch (e) {
    console.error(e);
  }
  if (!prompt) return showErr("Call summary prompt is missing. Set it in Admin → Call Summary Prompt.");

  showProgress("Generating summary…");
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "Generating…";
  }

  try {
    const { data, error } = await sb.functions.invoke("generate-call-summary", {
      body: { prompt, transcript },
    });

    if (error) {
      console.error("invoke error:", error);
      return showErr(`Generate failed: ${error.message}`);
    }

    if (!data?.ok || !data?.summary) {
      return showErr(data?.msg || "Generate failed.");
    }

    const summary = normalizeSummaryText(String(data.summary).trim());

    const { error: upErr } = await sb.from("call_logs").update({ call_summary: summary }).eq("id", row.id);
    if (upErr) return showErr(`Save failed: ${upErr.message}`);

    row.call_summary = summary;

    const tr = rowsEl?.querySelector(`tr[data-id="${row.id}"]`);
    if (tr) {
      const cell = tr.querySelector(".cell-summary");
      if (cell) cell.textContent = summary;

      const newBtn = tr.querySelector(`button[data-act="new"]`);
      if (newBtn) newBtn.disabled = false;
    }

    showOk("Summary generated ✅");
  } catch (e) {
    console.error(e);
    showErr(`Failed: ${String(e?.message || e)}`);
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = "Generate";
    }
  }
}

// -------------------- new entry prefill --------------------
function setPrefill(payloadObj) {
  const s = JSON.stringify(payloadObj);
  const keys = ["callPrefill", "entryPrefill", "touchpointPrefill", "prefill", "fromCallPrefill"];
  for (const k of keys) {
    try { sessionStorage.setItem(k, s); } catch {}
    try { localStorage.setItem(k, s); } catch {}
  }
}

function newEntryFromRow(rowId) {
  hide(reportMsg);

  const row = lastData.find((x) => String(x.id) === String(rowId));
  if (!row) return;

  const rawSummary = String(row.call_summary || "").trim();
  if (!rawSummary) return showErr("Generate summary first.");

  const { positives, suggestions, normalized } = splitSummary(rawSummary);

  const payload = {
    fromCall: true,
    source: "callReports",
    call_id: row.id,
    parent_number: row.parent_number || "",
    contact_name: row.contact_name || "",
    call_type: row.call_type || "",
    created_at: row.created_at,

    positives,
    suggestions,
    positives_text: positives,
    suggestions_text: suggestions,
    positive: positives,
    suggestion: suggestions,
    strengths: positives,
    weaknesses: suggestions,
    summary_normalized: normalized,
  };

  setPrefill(payload);
  window.location.href = "entry.html?fromCall=1";
}

// -------------------- export excel --------------------
async function exportExcel() {
  hide(reportMsg);
  showProgress("Preparing Excel…");

  const coordNum = (fltCoordinator?.value || "").trim();
  const from = (fltFrom?.value || "").trim();
  const to = (fltTo?.value || "").trim();
  const search = (searchBox?.value || "").trim();

  let q = sb
    .from("call_logs")
    .select("id,created_at,parent_number,coordinator_number,call_start,call_end,duration_seconds,contact_name,call_type,call_summary,call_transcript")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (coordNum) q = q.eq("coordinator_number", coordNum);

  const types = Array.from(selectedCallTypes);
  if (types.length) q = q.in("call_type", types);

  const minThr = getDurationThresholdMin();
  if (minThr !== null) q = q.gte("duration_seconds", minThr);

  if (from) q = q.gte("created_at", new Date(from + "T00:00:00").toISOString());
  if (to) q = q.lte("created_at", new Date(to + "T23:59:59").toISOString());

  if (search) {
    const esc = search.replace(/,/g, " ");
    q = q.or(`parent_number.ilike.%${esc}%,contact_name.ilike.%${esc}%,call_summary.ilike.%${esc}%`);
  }

  const { data, error } = await q;
  if (error) {
    showErr(error.message);
    return;
  }

  const out = (data || []).map((r) => {
    const parts = deriveDateParts(r.created_at);
    return {
      Timestamp: fmt(r.created_at),
      "Parent Number": r.parent_number || "",
      "Coordinator Number": r.coordinator_number || "",
      "Call Start": r.call_start || "",
      "Call End": r.call_end || "",
      "Duration (s)": r.duration_seconds ?? "",
      "Contact Name": r.contact_name || "",
      "Call Type": r.call_type || "",
      "Call Summary": r.call_summary || "",
      "Call Transcript": r.call_transcript || "",
      Coordinator: coordinatorLabelByNumber(r.coordinator_number),
      Day: parts.day,
      Week: parts.week,
      Month: parts.month,
      Year: parts.year,
    };
  });

  try {
    const ws = window.XLSX.utils.json_to_sheet(out);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Call Reports");
    const fname = `call_reports_${new Date().toISOString().slice(0, 10)}.xlsx`;
    window.XLSX.writeFile(wb, fname);
    showOk("Excel exported ✅");
  } catch (e) {
    console.error(e);
    showErr(String(e?.message || e));
  }
}

// -------------------- events --------------------
function wireEvents() {
  // ✅ install multiselects (fixed layout)
  installCallTypeMultiInSameField();

  // keep other selects enhanced
  try {
    enhanceSelect(fltCoordinator, {
      placeholder: fltCoordinator?.getAttribute("data-placeholder") || "All coordinators",
      search: true,
    });
  } catch {}

  reloadBtn?.addEventListener("click", () => fetchData());

  let t = null;
  searchBox?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      page = 1;
      fetchData();
    }, 250);
  });

  applyFiltersBtn?.addEventListener("click", () => {
    page = 1;
    fetchData();
  });

  clearFiltersBtn?.addEventListener("click", () => {
    if (fltCoordinator) fltCoordinator.value = "";
    if (fltFrom) fltFrom.value = "";
    if (fltTo) fltTo.value = "";
    try { refreshSelect(fltCoordinator); } catch {}

    selectedCallTypes.clear();
    selectedDurationThresholds.clear();
    callTypeMS?.rerender?.();
    durationMS?.rerender?.();

    page = 1;
    fetchData();
  });

  exportBtn?.addEventListener("click", exportExcel);

  prevBtn?.addEventListener("click", () => {
    if (page > 1) {
      page--;
      fetchData();
    }
  });
  nextBtn?.addEventListener("click", () => {
    page++;
    fetchData();
  });

  rowsEl?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;

    const tr = btn.closest("tr[data-id]");
    if (!tr) return;

    const id = tr.getAttribute("data-id");
    const act = btn.getAttribute("data-act");

    if (act === "gen") {
      await generateForRow(id, btn);
      return;
    }

    if (act === "new") {
      newEntryFromRow(id);
      return;
    }
  });
}

// -------------------- boot --------------------
(async () => {
  await requireAuth();
  await mountNav("callReports");
  wireEvents();
  await loadCoordinatorDirectory();
  await fetchData();
})();

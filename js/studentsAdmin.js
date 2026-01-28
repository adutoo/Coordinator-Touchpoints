// js/studentsAdmin.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { requireAuth } from "./auth.js";
import { withBusy, setBusyProgress } from "./busy.js";

/**
 * Students table editor (Admin)
 * - Spreadsheet-like grid
 * - Inline edits + Add/Delete + Save
 * - Import CSV/XLSX via popup + Export XLSX
 * - Schema management via Edge Function:
 *    - action: "schema" { table }
 *    - action: "add_column" { table,name,type }
 *    - action: "drop_column" { table,name }
 */

// -------------------- Config --------------------
const STUDENTS_TABLE = "students";
const SCHEMA_FN = "students-schema-admin";
const PAGE_SIZE = 100;

const PINNED_COLS = ["child_name", "student_name", "class_name", "section", "sr_number"];
const READONLY_COLS = ["id", "created_at"]; // never editable, never sent in upserts
const PROTECTED_COLS = new Set(["id", "created_at"]); // cannot drop

// -------------------- DOM --------------------
const elMsg = document.getElementById("smMsg");
const elSearch = document.getElementById("smSearch");
const elReload = document.getElementById("smReload");
const elAddRow = document.getElementById("smAddRow");
const elSave = document.getElementById("smSave");
const elExport = document.getElementById("smExport");

const elThead = document.getElementById("smThead");
const elTbody = document.getElementById("smTbody");

const elMetaTop = document.getElementById("smMetaTop");
const elMeta = document.getElementById("smMeta");
const elPage = document.getElementById("smPage");
const elPrev = document.getElementById("smPrev");
const elNext = document.getElementById("smNext");
const elDirtyPill = document.getElementById("smDirtyPill");

// NOTE: DO NOT rely only on this reference because mountNav() can re-render buttons later.
const elUpload = document.getElementById("smUpload");

// -------------------- State --------------------
let me = null;
let profile = null;
let page = 0;
let totalCount = 0;

let columns = []; // [{name,type?}]
let rows = []; // current page rows

const dirtyByKey = new Map(); // key -> patch
const newKeys = new Set(); // keys that are new rows

// -------------------- Utils --------------------
function showMsg(text, isErr = false) {
  if (!elMsg) return;
  elMsg.style.display = "block";
  elMsg.style.borderColor = isErr ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  elMsg.style.color = isErr ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  elMsg.textContent = text;
}
function hideMsg() {
  if (!elMsg) return;
  elMsg.style.display = "none";
  elMsg.textContent = "";
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function humanize(name) {
  return String(name || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function getPreferredUpsertKey() {
  const names = columns.map((c) => c.name);
  if (names.includes("child_name")) return "child_name";
  if (names.includes("sr_number")) return "sr_number";
  if (names.includes("id")) return "id";
  return names[0] || "child_name";
}

function inferColumnsFromRows(sampleRows) {
  const set = new Set();
  for (const r of sampleRows || []) Object.keys(r || {}).forEach((k) => set.add(k));
  set.delete("__key");

  const list = Array.from(set);
  const pinned = PINNED_COLS.filter((c) => list.includes(c));
  const rest = list.filter((c) => !pinned.includes(c)).sort((a, b) => a.localeCompare(b));
  return [...pinned, ...rest].map((name) => ({ name }));
}

function reorderColumnsBySchema(schemaCols) {
  const names = schemaCols.map((x) => x.name);
  const pinned = PINNED_COLS.filter((c) => names.includes(c));
  const rest = names.filter((c) => !pinned.includes(c));
  return [...pinned, ...rest].map((n) => schemaCols.find((x) => x.name === n));
}

/**
 * ✅ FIX: Row keys MUST be stable.
 * Always use __key for UI tracking, so it does not change when child_name is typed.
 */
function getRowKey(row) {
  if (row?.__key) return String(row.__key);
  // fallback (should rarely happen)
  if (row?.id !== undefined && row?.id !== null && String(row.id) !== "") return `id:${row.id}`;
  return `tmp:${Math.random().toString(16).slice(2)}`;
}

function parseKey(k) {
  const s = String(k || "");
  if (s.startsWith("id:")) return { field: "id", value: s.slice(3) };
  if (s.startsWith("child:")) return { field: "child_name", value: s.slice(6) };
  return { field: null, value: s };
}

function markDirtyPill() {
  const has = dirtyByKey.size > 0 || newKeys.size > 0;
  if (!elDirtyPill) return;
  elDirtyPill.style.display = has ? "inline-flex" : "none";
}

function sanitizeColumnName(input) {
  let s = String(input || "").trim().toLowerCase();
  s = s.replace(/\s+/g, "_").replace(/-+/g, "_");
  s = s.replace(/[^a-z0-9_]/g, "");
  s = s.replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "");
  if (!s || !/^[a-z_]/.test(s)) return "";
  return s;
}

// -------------------- Admin Guard --------------------
async function guardAdmin() {
  await requireAuth();
  const out = await mountNav("students_admin");
  me = out?.me || null;
  profile = out?.profile || null;

  if (profile?.role !== "admin") {
    showMsg("Access denied. Admins only.", true);
    throw new Error("not_admin");
  }
}

// -------------------- Schema calls --------------------
async function invokeSchema(body) {
  const { data, error } = await sb.functions.invoke(SCHEMA_FN, { body });

  if (error) {
    const parts = [];
    parts.push(error?.message ? String(error.message) : "Edge Function error");

    const ctx = error?.context;
    if (ctx?.status) parts.push(`HTTP ${ctx.status}`);
    if (ctx?.body) {
      try {
        const raw = typeof ctx.body === "string" ? ctx.body : JSON.stringify(ctx.body);
        if (raw) parts.push(raw);
      } catch {}
    }
    throw new Error(parts.join(" — "));
  }

  if (data && data.ok === false) {
    throw new Error(String(data.error || "Schema function returned ok:false"));
  }

  return data;
}

async function fetchSchemaSafe() {
  try {
    const data = await invokeSchema({ action: "schema", table: STUDENTS_TABLE });
    if (!data?.ok || !Array.isArray(data.columns)) return null;

    return data.columns
      .map((c) => ({
        name: String(c.name ?? c.column_name ?? ""),
        type: String(c.type ?? c.data_type ?? ""),
      }))
      .filter((x) => x.name);
  } catch {
    return null;
  }
}

async function addColumn(name, type) {
  const safeName = sanitizeColumnName(name);
  if (!safeName) throw new Error('Invalid column name. Use snake_case like "father_name".');
  if (PROTECTED_COLS.has(safeName)) throw new Error(`"${safeName}" is protected.`);

  const data = await invokeSchema({
    action: "add_column",
    table: STUDENTS_TABLE,
    name: safeName,
    type: String(type || "text").trim(),
  });

  if (!data?.ok) throw new Error(data?.error || "add_column failed");
  return true;
}

async function dropColumn(name) {
  if (PROTECTED_COLS.has(name)) throw new Error("This column cannot be deleted.");
  const data = await invokeSchema({ action: "drop_column", table: STUDENTS_TABLE, name });
  if (!data?.ok) throw new Error(data?.error || "drop_column failed");
  return true;
}

// -------------------- Query --------------------
function buildQuery({ includeCount = true } = {}) {
  const q = sb.from(STUDENTS_TABLE).select("*", includeCount ? { count: "exact" } : undefined);

  const s = String(elSearch?.value || "").trim();
  if (s) {
    const escS = s.replace(/,/g, " ");
    const colNames = columns.map((c) => c.name);
    const searchCols = ["child_name", "student_name", "class_name", "section", "sr_number"].filter((c) => colNames.includes(c));

    const parts = (searchCols.length ? searchCols : ["child_name", "student_name", "class_name", "section", "sr_number"]).map(
      (c) => `${c}.ilike.%${escS}%`
    );

    q.or(parts.join(","));
  }

  const colNames = columns.map((c) => c.name);
  if (colNames.includes("child_name")) q.order("child_name", { ascending: true });
  else if (colNames.includes("id")) q.order("id", { ascending: true });

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  q.range(from, to);

  return q;
}

// -------------------- Render --------------------
function renderHeader() {
  const cols = columns.map((c) => c.name);
  const ths = [];

  ths.push(`<tr>`);
  ths.push(`<th class="sm-sticky-1 sm-rownum">#</th>`);

  cols.forEach((c, idx) => {
    const sticky = idx === 0 ? "sm-sticky-2" : "";
    const canDrop = !PROTECTED_COLS.has(c);

    ths.push(`
      <th class="${sticky} sm-colhead" data-col="${esc(c)}">
        <div class="sm-colhead-inner">
          <span class="sm-coltitle">${esc(humanize(c))}</span>
          ${
            canDrop
              ? `<button
                   class="sm-col-del"
                   data-act="drop-col"
                   data-col="${esc(c)}"
                   title="Delete column"
                   type="button"
                   style="visibility:hidden; opacity:0; transition:opacity .12s;"
                 >🗑</button>`
              : ""
          }
        </div>
      </th>
    `);
  });

  ths.push(`
    <th class="sm-actions">
      <button class="sm-col-add" data-act="add-col" title="Add column" type="button">+</button>
    </th>
  `);

  ths.push(`</tr>`);
  elThead.innerHTML = ths.join("");
}

function trashSvg() {
  return `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M6 7l1 14h10l1-14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M9 7V4h6v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function renderBody() {
  const cols = columns.map((c) => c.name);
  const html = [];

  rows.forEach((r, rIndex) => {
    const key = getRowKey(r);
    const isNew = newKeys.has(key);
    const isDirty = dirtyByKey.has(key);

    html.push(`<tr data-key="${esc(key)}" class="${isNew ? "sm-new" : ""} ${isDirty ? "sm-dirty" : ""}">`);
    html.push(`<td class="sm-sticky-1 sm-rownum">${page * PAGE_SIZE + rIndex + 1}</td>`);

    cols.forEach((c, cIndex) => {
      const sticky = cIndex === 0 ? "sm-sticky-2" : "";
      const val = r?.[c] ?? "";
      const isRO = READONLY_COLS.includes(c);

      html.push(`
        <td class="${sticky}">
          <input
            class="sm-cell ${isRO ? "sm-readonly" : ""}"
            data-r="${esc(key)}"
            data-col="${esc(c)}"
            data-ri="${rIndex}"
            data-ci="${cIndex}"
            value="${esc(val)}"
            ${isRO ? "readonly" : ""}
          />
        </td>
      `);
    });

    html.push(`
      <td class="sm-actions">
        <button class="sm-icon-btn danger" data-act="del-row" data-r="${esc(key)}" title="Delete row" type="button">
          ${trashSvg()}
        </button>
      </td>
    `);

    html.push(`</tr>`);
  });

  elTbody.innerHTML = html.join("");

  elTbody.querySelectorAll("input.sm-cell").forEach((inp) => {
    inp.addEventListener("input", () => {
      const col = inp.dataset.col;
      if (READONLY_COLS.includes(col)) return;

      const key = inp.dataset.r; // ✅ stable now
      const value = inp.value;

      const row = rows.find((x) => getRowKey(x) === key);
      if (!row) return;

      row[col] = value;

      if (!dirtyByKey.has(key)) dirtyByKey.set(key, {});
      dirtyByKey.get(key)[col] = value;

      const tr = elTbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
      if (tr) tr.classList.add("sm-dirty");
      markDirtyPill();
    });
  });
}

function updateMeta() {
  const from = page * PAGE_SIZE;
  const to = Math.min(from + PAGE_SIZE, totalCount);

  if (elMeta) elMeta.textContent = `Showing ${Math.min(from + 1, totalCount)}–${Math.min(to, totalCount)} of ${totalCount}`;
  if (elMetaTop) elMetaTop.textContent = `Rows: ${totalCount}`;

  const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  if (elPage) elPage.textContent = `Page ${page + 1} / ${pages}`;

  if (elPrev) elPrev.disabled = page <= 0;
  if (elNext) elNext.disabled = from + PAGE_SIZE >= totalCount;
}

// -------------------- Load --------------------
async function loadPage() {
  hideMsg();

  await withBusy("Loading students…", async () => {
    setBusyProgress(15, "Fetching schema…");
    const sch = await fetchSchemaSafe();

    setBusyProgress(35, "Fetching data…");
    const { data, error, count } = await buildQuery({ includeCount: true });
    if (error) throw error;

    totalCount = count ?? 0;

    // ✅ FIX: assign stable __key for DB rows
    rows = (data || []).map((r) => ({
      ...r,
      __key: r?.id !== undefined && r?.id !== null && String(r.id) !== "" ? `id:${r.id}` : `tmp:${Date.now()}-${Math.random().toString(16).slice(2)}`,
    }));

    if (sch) columns = reorderColumnsBySchema(sch);
    else columns = inferColumnsFromRows(rows);

    setBusyProgress(75, "Rendering…");
    renderHeader();
    renderBody();
    updateMeta();
    markDirtyPill();

    setBusyProgress(100, "Done");
  }).catch((e) => {
    console.error(e);
    showMsg(String(e?.message || e), true);
  });
}

// -------------------- Row actions --------------------
function addRow() {
  hideMsg();
  const obj = {};
  for (const c of columns) obj[c.name] = "";
  obj.__key = `tmp:${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const key = getRowKey(obj);
  rows.unshift(obj);
  newKeys.add(key);

  renderBody();
  markDirtyPill();

  const first = elTbody.querySelector(`input.sm-cell[data-r="${CSS.escape(key)}"][data-ci="0"]`);
  if (first) first.focus();
}

async function deleteRow(key) {
  hideMsg();
  const row = rows.find((r) => getRowKey(r) === key);
  if (!row) return;

  const isNew = newKeys.has(key);
  if (isNew) {
    rows = rows.filter((r) => getRowKey(r) !== key);
    newKeys.delete(key);
    dirtyByKey.delete(key);
    renderBody();
    markDirtyPill();
    return;
  }

  if (!confirm("Delete this student row?")) return;

  const where = parseKey(key);
  if (!where.field) return showMsg("Cannot delete: no key field found.", true);

  await withBusy("Deleting…", async () => {
    setBusyProgress(40, "Deleting row…");
    const { error } = await sb.from(STUDENTS_TABLE).delete().eq(where.field, where.value);
    if (error) throw error;

    setBusyProgress(80, "Reloading…");
    await loadPage();
    showMsg("Deleted ✅");
  }).catch((e) => showMsg(String(e?.message || e), true));
}

function stripReadonlyCols(obj) {
  const out = { ...obj };
  for (const c of READONLY_COLS) delete out[c];
  delete out.__key;
  return out;
}

async function saveChanges() {
  hideMsg();
  if (dirtyByKey.size === 0 && newKeys.size === 0) return showMsg("No changes to save.");

  const upsertKey = getPreferredUpsertKey();
  const updates = [];
  const inserts = [];

  for (const [key, patch] of dirtyByKey.entries()) {
    const row = rows.find((r) => getRowKey(r) === key);
    if (!row) continue;

    const merged = stripReadonlyCols({ ...row, ...patch });
    if (newKeys.has(key)) continue;
    updates.push(merged);
  }

  for (const key of newKeys.values()) {
    const row = rows.find((r) => getRowKey(r) === key);
    if (!row) continue;

    const out = stripReadonlyCols(row);
    if (isBlank(out[upsertKey])) return showMsg(`New row is missing "${upsertKey}". Fill it before saving.`, true);
    inserts.push(out);
  }

  if (!updates.length && !inserts.length) {
    // ✅ avoids "Saved" when nothing is actually queued
    return showMsg("No valid changes to save. (Tip: make sure new rows have required fields filled.)", true);
  }

  await withBusy("Saving changes…", async () => {
    const total = updates.length + inserts.length;
    const chunk = 200;

    if (updates.length) {
      setBusyProgress(15, `Saving ${updates.length} updates…`);
      for (let i = 0; i < updates.length; i += chunk) {
        const batch = updates.slice(i, i + chunk);
        const { error } = await sb.from(STUDENTS_TABLE).upsert(batch, { onConflict: upsertKey });
        if (error) throw error;

        const pct = 15 + Math.round(((i + batch.length) / Math.max(1, total)) * 70);
        setBusyProgress(Math.min(85, pct), `Saved ${Math.min(updates.length, i + batch.length)}/${updates.length}…`);
      }
    }

    if (inserts.length) {
      setBusyProgress(60, `Saving ${inserts.length} new rows…`);
      for (let i = 0; i < inserts.length; i += chunk) {
        const batch = inserts.slice(i, i + chunk);
        const { error } = await sb.from(STUDENTS_TABLE).upsert(batch, { onConflict: upsertKey });
        if (error) throw error;

        const pct = 60 + Math.round(((i + batch.length) / Math.max(1, inserts.length)) * 30);
        setBusyProgress(Math.min(95, pct), `Saved ${Math.min(inserts.length, i + batch.length)}/${inserts.length}…`);
      }
    }

    setBusyProgress(100, "Done");
    dirtyByKey.clear();
    newKeys.clear();
    markDirtyPill();

    await loadPage();
    showMsg("Saved ✅");
  }).catch((e) => showMsg(String(e?.message || e), true));
}

// -------------------- Import popup (FIXED) --------------------
// (unchanged from your file)
function ensureImportModal() {
  let modal = document.getElementById("smImportModal");

  if (modal) {
    const ok =
      modal.querySelector("#smImportFile") &&
      modal.querySelector("#smImportMode") &&
      modal.querySelector("#smImportUpsertKey") &&
      modal.querySelector("#smImportRun") &&
      modal.querySelector("#smImportClose");

    if (!ok) {
      modal.remove();
      modal = null;
    }
  }

  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "smImportModal";
  modal.style.cssText = `
    position: fixed; inset: 0;
    z-index: 2147483647;
    display: none;
    align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55);
  `;

  modal.innerHTML = `
    <div style="
      width: min(720px, calc(100vw - 24px));
      border-radius: 16px;
      background: rgba(20,24,32,0.96);
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 20px 60px rgba(0,0,0,0.55);
      padding: 16px;
      color: rgba(255,255,255,0.9);
    ">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="font-weight:700;">Import Students</div>
        <button id="smImportClose" class="btn sm-mini" type="button">Close</button>
      </div>

      <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <div>
          <div style="font-size:12px; opacity:.8; margin-bottom:6px;">File (CSV or XLSX)</div>
          <input id="smImportFile" type="file" accept=".csv,.xlsx" style="width:100%;" />
        </div>
        <div>
          <div style="font-size:12px; opacity:.8; margin-bottom:6px;">Mode</div>
          <select id="smImportMode" style="width:100%; height:36px;">
            <option value="upsert">Upsert (update existing)</option>
            <option value="insert">Insert (new only)</option>
          </select>
        </div>
        <div style="grid-column: 1 / -1;">
          <div style="font-size:12px; opacity:.8; margin-bottom:6px;">Upsert Key (for Upsert mode)</div>
          <select id="smImportUpsertKey" style="width:100%; height:36px;"></select>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
        <button id="smImportRun" class="btn primary" type="button">Import</button>
      </div>

      <div style="margin-top:10px; font-size:12px; opacity:.75;">
        CSV headers should match column names (case-insensitive). Unknown headers are ignored.
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeImportModal();
  });

  modal.querySelector("#smImportClose").addEventListener("click", closeImportModal);
  modal.querySelector("#smImportRun").addEventListener("click", () =>
    importFromModal().catch((err) => {
      console.error(err);
      showMsg(String(err?.message || err), true);
    })
  );

  return modal;
}

function openImportModal() {
  hideMsg();

  const modal = ensureImportModal();
  const sel = modal.querySelector("#smImportUpsertKey");
  if (!sel) {
    showMsg("Import popup failed to mount. Hard refresh the page (Ctrl+Shift+R).", true);
    return;
  }

  const names = columns.map((c) => c.name);
  sel.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  sel.value = getPreferredUpsertKey();

  modal.style.display = "flex";

  const fileInp = modal.querySelector("#smImportFile");
  if (fileInp) fileInp.focus();
}

function closeImportModal() {
  const modal = document.getElementById("smImportModal");
  if (modal) modal.style.display = "none";
}

function parseCsv(text) {
  const out = [];
  let cur = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === ",") {
      cur.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      cur.push(cell);
      out.push(cur);
      cur = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || cur.length) {
    cur.push(cell);
    out.push(cur);
  }
  return out.filter((r) => r.some((x) => String(x).trim() !== ""));
}

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase();
}

async function importFromModal() {
  const modal = ensureImportModal();
  const file = modal.querySelector("#smImportFile")?.files?.[0];
  if (!file) return showMsg("Choose a file first.", true);

  const mode = String(modal.querySelector("#smImportMode").value || "upsert");
  const upsertKey = String(modal.querySelector("#smImportUpsertKey").value || getPreferredUpsertKey());

  await withBusy("Importing…", async () => {
    setBusyProgress(10, "Reading file…");

    const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
    let records = [];

    if (isXlsx) {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      records = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
    } else {
      const text = await file.text();
      const grid = parseCsv(text);
      const headers = grid[0].map(normalizeHeader);
      records = grid.slice(1).map((r) => {
        const obj = {};
        for (let i = 0; i < headers.length; i++) obj[headers[i]] = r[i] ?? "";
        return obj;
      });
    }

    if (!records.length) {
      setBusyProgress(100, "Done");
      return showMsg("No rows found in file.", true);
    }

    setBusyProgress(35, "Mapping headers…");
    const colNames = columns.map((c) => c.name);
    const colMap = new Map(colNames.map((c) => [normalizeHeader(c), c]));

    const cleaned = records
      .map((r) => {
        const out = {};
        for (const [k, v] of Object.entries(r)) {
          const real = colMap.get(normalizeHeader(k));
          if (!real) continue;
          if (READONLY_COLS.includes(real)) continue;
          out[real] = v;
        }
        return out;
      })
      .filter((o) => Object.keys(o).length);

    if (!cleaned.length) {
      setBusyProgress(100, "Done");
      return showMsg("No matching headers found. Make sure file headers match your column names.", true);
    }

    if (mode === "upsert") {
      const bad = cleaned.find((x) => isBlank(x[upsertKey]));
      if (bad) {
        setBusyProgress(100, "Done");
        return showMsg(`Some rows are missing "${upsertKey}". Fix file and retry.`, true);
      }
    }

    setBusyProgress(55, `Writing ${cleaned.length} rows…`);
    const chunk = 200;

    for (let i = 0; i < cleaned.length; i += chunk) {
      const batch = cleaned.slice(i, i + chunk);
      const res =
        mode === "insert"
          ? await sb.from(STUDENTS_TABLE).insert(batch)
          : await sb.from(STUDENTS_TABLE).upsert(batch, { onConflict: upsertKey });

      if (res.error) throw res.error;

      const pct = Math.min(95, 55 + Math.round((i / cleaned.length) * 40));
      setBusyProgress(pct, `Imported ${Math.min(cleaned.length, i + chunk)}/${cleaned.length}…`);
    }

    setBusyProgress(100, "Done");
    closeImportModal();
    showMsg(`Imported ${cleaned.length} rows ✅`);
    await loadPage();
  });
}

// -------------------- Export --------------------
// (unchanged from your file)
function buildExportColNames(allRows) {
  const keys = new Set();

  for (const r of allRows || []) {
    for (const k of Object.keys(r || {})) keys.add(k);
  }

  for (const c of columns || []) keys.add(c.name);

  keys.delete("__key");

  const list = Array.from(keys);

  const pinned = PINNED_COLS.filter((c) => list.includes(c));
  const rest = list.filter((c) => !pinned.includes(c)).sort((a, b) => a.localeCompare(b));

  return [...pinned, ...rest];
}

async function exportXlsx() {
  hideMsg();

  await withBusy("Exporting…", async () => {
    setBusyProgress(10, "Fetching rows…");

    const all = [];
    const chunk = 1000;
    let offset = 0;

    while (true) {
      let q = sb.from(STUDENTS_TABLE).select("*").range(offset, offset + chunk - 1);

      const s = String(elSearch?.value || "").trim();
      if (s) {
        const escS = s.replace(/,/g, " ");
        q = q.or(
          `child_name.ilike.%${escS}%,student_name.ilike.%${escS}%,class_name.ilike.%${escS}%,section.ilike.%${escS}%,sr_number.ilike.%${escS}%`
        );
      }

      if (columns.map((c) => c.name).includes("child_name")) q = q.order("child_name", { ascending: true });

      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) break;

      all.push(...data);
      offset += data.length;

      if (data.length < chunk || all.length >= 5000) break;
      setBusyProgress(Math.min(70, 10 + Math.round((all.length / 5000) * 60)), `Fetched ${all.length}…`);
    }

    if (!all.length) {
      setBusyProgress(100, "Done");
      return showMsg("No rows to export.", true);
    }

    setBusyProgress(80, "Building XLSX…");

    const colNames = buildExportColNames(all);

    const out = all.map((r) => {
      const o = {};
      for (const c of colNames) o[humanize(c)] = r?.[c] ?? "";
      return o;
    });

    const ws = window.XLSX.utils.json_to_sheet(out);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Students");

    const name = `Students_${new Date().toISOString().slice(0, 10)}.xlsx`;
    window.XLSX.writeFile(wb, name);

    setBusyProgress(100, "Done");
    showMsg(`Exported ${out.length} rows ✅`);
  }).catch((e) => showMsg(String(e?.message || e), true));
}

// -------------------- Add Column modal --------------------
// (unchanged from your file)
function ensureAddColumnModal() {
  let modal = document.getElementById("smAddColModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "smAddColModal";
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55);
  `;
  modal.innerHTML = `
    <div style="
      width: min(520px, calc(100vw - 24px));
      border-radius: 16px;
      background: rgba(20,24,32,0.95);
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 20px 60px rgba(0,0,0,0.55);
      padding: 16px;
      color: rgba(255,255,255,0.9);
    ">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="font-weight:700;">Add Column</div>
        <button id="smAddColClose" class="btn sm-mini" type="button">Close</button>
      </div>

      <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <div style="grid-column:1/-1;">
          <div style="font-size:12px; opacity:.8; margin-bottom:6px;">Column name</div>
          <input id="smAddColName" placeholder="e.g. father_name" style="width:100%; height:36px;" />
          <div id="smAddColHint" style="margin-top:6px; font-size:12px; opacity:.75;"></div>
        </div>
        <div style="grid-column:1/-1;">
          <div style="font-size:12px; opacity:.8; margin-bottom:6px;">Type</div>
          <select id="smAddColType" style="width:100%; height:36px;">
            <option value="text">text</option>
            <option value="integer">integer</option>
            <option value="bigint">bigint</option>
            <option value="boolean">boolean</option>
            <option value="date">date</option>
            <option value="timestamp with time zone">timestamp with time zone</option>
          </select>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
        <button id="smAddColRun" class="btn primary" type="button">Add</button>
      </div>
      <div style="margin-top:10px; font-size:12px; opacity:.75;">
        Tip: Use snake_case like <b>father_name</b>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeAddColumnModal();
  });
  modal.querySelector("#smAddColClose").addEventListener("click", closeAddColumnModal);

  const nameInp = modal.querySelector("#smAddColName");
  const hint = modal.querySelector("#smAddColHint");
  nameInp.addEventListener("input", () => {
    const raw = String(nameInp.value || "");
    const safe = sanitizeColumnName(raw);
    hint.textContent = safe ? `Will be created as: ${safe}` : `Invalid name. Use letters/numbers/underscore.`;
  });

  modal.querySelector("#smAddColRun").addEventListener("click", async () => {
    const rawName = String(modal.querySelector("#smAddColName").value || "").trim();
    const type = String(modal.querySelector("#smAddColType").value || "text").trim();
    if (!rawName) return showMsg("Column name is required.", true);

    await withBusy("Adding column…", async () => {
      setBusyProgress(30, "Calling schema function…");
      await addColumn(rawName, type);
      setBusyProgress(80, "Reloading…");
      closeAddColumnModal();
      await loadPage();
      showMsg("Column added ✅");
    }).catch((e) => showMsg(String(e?.message || e), true));
  });

  return modal;
}

function openAddColumnModal() {
  ensureAddColumnModal().style.display = "flex";
}
function closeAddColumnModal() {
  const modal = document.getElementById("smAddColModal");
  if (modal) modal.style.display = "none";
}

// -------------------- Upload click (SUPER FIX) --------------------
// (unchanged from your file)
let _uploadDelegatedInstalled = false;

function isUploadTriggerElement(el) {
  if (!el) return false;

  const id = String(el.id || "").trim().toLowerCase();
  if (id === "smupload") return true;

  const act = String(el.getAttribute?.("data-act") || "").trim().toLowerCase();
  if (act === "upload" || act === "import") return true;

  const txt = String(el.textContent || "").trim().toLowerCase();
  if (txt === "upload" || txt === "import") {
    const tag = String(el.tagName || "").toUpperCase();
    const isBtnLike = tag === "BUTTON" || tag === "A" || el.getAttribute?.("role") === "button";
    const cls = String(el.className || "").toLowerCase();
    if (isBtnLike || cls.includes("btn")) return true;
  }

  return false;
}

function installUploadHandler() {
  if (_uploadDelegatedInstalled) return;
  _uploadDelegatedInstalled = true;

  const direct = document.getElementById("smUpload");
  if (direct && direct.tagName === "BUTTON" && !direct.getAttribute("type")) {
    direct.setAttribute("type", "button");
  }
  direct?.addEventListener?.("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openImportModal();
  });

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      if (!target) return;

      const node =
        target.closest?.("#smUpload") ||
        target.closest?.("[data-act='upload']") ||
        target.closest?.("[data-act='import']") ||
        target.closest?.("button") ||
        target.closest?.("a") ||
        target.closest?.("[role='button']");

      if (!node) return;
      if (!isUploadTriggerElement(node)) return;

      e.preventDefault();
      e.stopPropagation();
      openImportModal();
    },
    true
  );
}

// -------------------- Events --------------------
function wireEvents() {
  let t = null;
  elSearch?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      page = 0;
      loadPage();
    }, 250);
  });

  elReload?.addEventListener("click", () => loadPage());
  elAddRow?.addEventListener("click", addRow);
  elSave?.addEventListener("click", saveChanges);
  elExport?.addEventListener("click", exportXlsx);

  elPrev?.addEventListener("click", () => {
    if (page > 0) {
      page--;
      loadPage();
    }
  });
  elNext?.addEventListener("click", () => {
    page++;
    loadPage();
  });

  elTbody?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act='del-row']");
    if (!btn) return;
    const key = btn.getAttribute("data-r");
    if (!key) return;
    deleteRow(key);
  });

  elThead?.addEventListener("mouseover", (e) => {
    const th = e.target.closest("th.sm-colhead");
    if (!th) return;
    th.querySelectorAll(".sm-col-del").forEach((b) => {
      b.style.visibility = "visible";
      b.style.opacity = "1";
    });
  });
  elThead?.addEventListener("mouseout", (e) => {
    const th = e.target.closest("th.sm-colhead");
    if (!th) return;
    if (th.contains(e.relatedTarget)) return;
    th.querySelectorAll(".sm-col-del").forEach((b) => {
      b.style.opacity = "0";
      b.style.visibility = "hidden";
    });
  });

  elThead?.addEventListener("click", async (e) => {
    const dropBtn = e.target.closest("button[data-act='drop-col']");
    if (dropBtn) {
      const col = dropBtn.getAttribute("data-col");
      if (!col) return;
      if (PROTECTED_COLS.has(col)) return showMsg("This column cannot be deleted.", true);

      const typed = prompt(`Type DELETE to drop column "${col}". This will remove all data in that column.`);
      if (typed !== "DELETE") return;

      await withBusy("Dropping column…", async () => {
        setBusyProgress(30, "Calling schema function…");
        await dropColumn(col);
        setBusyProgress(80, "Reloading…");
        await loadPage();
        showMsg("Column dropped ✅");
      }).catch((err) => showMsg(String(err?.message || err), true));

      return;
    }

    const addBtn = e.target.closest("button[data-act='add-col']");
    if (addBtn) openAddColumnModal();
  });

  installUploadHandler();
}

// -------------------- Boot --------------------
(async () => {
  try {
    await guardAdmin();
    wireEvents();
    await loadPage();
  } catch (e) {
    console.warn(e);
  }
})();

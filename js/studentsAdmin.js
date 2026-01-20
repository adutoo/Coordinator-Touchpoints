// js/studentsAdmin.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { requireAuth } from "./auth.js";
import { withBusy, setBusyProgress } from "./busy.js";

/**
 * Students table editor (Admin)
 * - Spreadsheet-like grid
 * - Inline edits + Add/Delete + Save
 * - Import CSV/XLSX (modal) + Export XLSX
 * - Schema management via Edge Function (Add/Drop column)
 */

const STUDENTS_TABLE = "students";
const SCHEMA_FN = "students-schema-admin";
const ALTER_FN  = "students-schema-admin";

const PAGE_SIZE = 100;
const PINNED_COLS = ["child_name", "student_name", "class_name", "section", "sr_number"];
const PROTECTED_COLS = new Set(["id", "created_at"]); // never show header delete for these

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

// Import modal
const elUploadOpen = document.getElementById("smUploadOpen");
const elImportModal = document.getElementById("smImportModal");
const elImportClose = document.getElementById("smImportClose");
const elFile = document.getElementById("smFile");
const elImport = document.getElementById("smImport");
const elImportMode = document.getElementById("smImportMode");
const elUpsertKey = document.getElementById("smUpsertKey");

// Add column modal
const elColModal = document.getElementById("smColModal");
const elColClose = document.getElementById("smColClose");
const elAddColName = document.getElementById("smAddColName");
const elAddColType = document.getElementById("smAddColType");
const elAddColBtn = document.getElementById("smAddColBtn");

// -------------------- State --------------------
let me = null;
let profile = null;

let page = 0;
let totalCount = 0;

let columns = []; // [{name,type}]
let rows = [];    // current page rows

const dirtyByKey = new Map(); // key -> patch
const newKeys = new Set();    // key set for new rows

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

function trashIcon() {
  // lucide-like trash icon (inline svg)
  return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6h18"></path>
      <path d="M8 6V4h8v2"></path>
      <path d="M19 6l-1 14H6L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  `;
}

function openModal(el) {
  if (!el) return;
  el.classList.add("open");
}
function closeModal(el) {
  if (!el) return;
  el.classList.remove("open");
}

function inferColumnsFromRows(sampleRows) {
  const set = new Set();
  for (const r of (sampleRows || [])) Object.keys(r || {}).forEach(k => set.add(k));
  set.delete("__key");
  set.delete("__isNew");

  const list = Array.from(set);

  const pinned = PINNED_COLS.filter(c => list.includes(c));
  const rest = list.filter(c => !pinned.includes(c)).sort((a,b)=>a.localeCompare(b));
  return [...pinned, ...rest].map(name => ({ name, type: "" }));
}

function reorderColumnsBySchema(schemaCols) {
  const names = schemaCols.map(x => x.name);
  const pinned = PINNED_COLS.filter(c => names.includes(c));
  const rest = names.filter(c => !pinned.includes(c));
  return [...pinned, ...rest].map(n => schemaCols.find(x => x.name === n));
}

function getRowKey(row) {
  if (row?.id !== undefined && row?.id !== null && String(row.id) !== "") return `id:${row.id}`;
  const cn = row?.child_name;
  if (cn !== undefined && cn !== null && String(cn).trim() !== "") return `child:${String(cn).trim()}`;
  return row?.__key || `tmp:${Math.random().toString(16).slice(2)}`;
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

// -------------------- Schema --------------------
async function fetchSchemaSafe() {
  try {
    const { data, error } = await sb.functions.invoke(SCHEMA_FN, {
      body: { action: "schema", table: STUDENTS_TABLE }
    });
    if (error) throw error;
    if (!data?.ok || !Array.isArray(data.columns)) throw new Error("schema invalid");

    // edge function returns: column_name / data_type
    return data.columns.map(c => ({
      name: String(c.column_name || c.name),
      type: String(c.data_type || c.type || "")
    }));
  } catch {
    return null;
  }
}

function fillUpsertKeyDropdown() {
  const names = (columns || []).map(c => c.name);
  const candidates = [];
  if (names.includes("child_name")) candidates.push("child_name");
  if (names.includes("id")) candidates.push("id");
  for (const n of names) if (!candidates.includes(n)) candidates.push(n);

  elUpsertKey.innerHTML = candidates.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  if (candidates.includes("child_name")) elUpsertKey.value = "child_name";
  else if (candidates.includes("id")) elUpsertKey.value = "id";
}

async function schemaAddColumnDirect() {
  hideMsg();
  const name = String(elAddColName.value || "").trim();
  const type = String(elAddColType.value || "text").trim();
  if (!name) return showMsg("Column name is required.", true);

  await withBusy("Adding column…", async () => {
    setBusyProgress(35, "Calling Edge Function…");
    const { data, error } = await sb.functions.invoke(ALTER_FN, {
      body: { action: "add_column", table: STUDENTS_TABLE, name, type }
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "add_column failed");

    setBusyProgress(80, "Refreshing…");
    elAddColName.value = "";
    closeModal(elColModal);
    await loadPage();
    showMsg("Column added ✅");
    setBusyProgress(100, "Done");
  }).catch(e => showMsg(String(e?.message || e), true));
}

async function schemaDropColumnDirect(colName) {
  hideMsg();
  const col = String(colName || "").trim();
  if (!col) return;

  if (!confirm(`Drop column "${col}"?\nThis will delete all data inside that column.`)) return;

  await withBusy("Dropping column…", async () => {
    setBusyProgress(35, "Calling Edge Function…");
    const { data, error } = await sb.functions.invoke(ALTER_FN, {
      body: { action: "drop_column", table: STUDENTS_TABLE, name: col }
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "drop_column failed");

    setBusyProgress(80, "Refreshing…");
    await loadPage();
    showMsg("Column dropped ✅");
    setBusyProgress(100, "Done");
  }).catch(e => showMsg(String(e?.message || e), true));
}

// -------------------- Query --------------------
function buildQuery({ includeCount = true } = {}) {
  let q = sb.from(STUDENTS_TABLE).select("*", includeCount ? { count: "exact" } : undefined);

  const s = String(elSearch.value || "").trim();
  if (s) {
    const escS = s.replace(/,/g, " ");
    const colNames = (columns || []).map(c => c.name);
    const searchCols = ["child_name", "student_name", "class_name", "section", "sr_number"]
      .filter(c => colNames.includes(c));

    const orParts = (searchCols.length ? searchCols : ["child_name","student_name","class_name","section","sr_number"])
      .map(c => `${c}.ilike.%${escS}%`);

    q = q.or(orParts.join(","));
  }

  const colNames = (columns || []).map(c => c.name);
  if (colNames.includes("child_name")) q = q.order("child_name", { ascending: true });
  else if (colNames.includes("id")) q = q.order("id", { ascending: true });

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  q = q.range(from, to);

  return q;
}

// -------------------- Render --------------------
function renderHeader() {
  const cols = (columns || []).map(c => c.name);

  const ths = [];
  ths.push(`<tr>`);
  ths.push(`<th class="sm-sticky-1 sm-rownum">#</th>`);

  cols.forEach((c, idx) => {
    const sticky = idx === 0 ? "sm-sticky-2" : "";
    const canDrop = !PROTECTED_COLS.has(String(c).toLowerCase());
    ths.push(`
      <th class="sm-th ${sticky}">
        <div class="sm-th-inner">
          <span>${esc(humanize(c))}</span>
          ${canDrop ? `<button class="sm-col-del" type="button" data-act="col-del" data-col="${esc(c)}" title="Delete column">${trashIcon()}</button>` : `<span></span>`}
        </div>
      </th>
    `);
  });

  // Far right end "+" button (add column)
  ths.push(`
    <th class="sm-actions">
      <div class="row" style="justify-content:flex-end;">
        <button id="smAddColPlus" class="sm-addcol-btn" type="button" title="Add column">+</button>
      </div>
    </th>
  `);

  ths.push(`</tr>`);
  elThead.innerHTML = ths.join("");
}

function renderBody() {
  const cols = (columns || []).map(c => c.name);
  const html = [];

  rows.forEach((r, rIndex) => {
    const key = getRowKey(r);
    const isNew = newKeys.has(key);
    const isDirty = dirtyByKey.has(key);

    html.push(`<tr data-key="${esc(key)}" class="${isNew ? "sm-new" : ""} ${isDirty ? "sm-dirty" : ""}">`);
    html.push(`<td class="sm-sticky-1 sm-rownum">${page * PAGE_SIZE + rIndex + 1}</td>`);

    cols.forEach((c, cIndex) => {
      const val = r?.[c] ?? "";
      const sticky = cIndex === 0 ? "sm-sticky-2" : "";
      html.push(`
        <td class="${sticky}">
          <input
            class="sm-cell"
            data-r="${esc(key)}"
            data-col="${esc(c)}"
            data-ri="${rIndex}"
            data-ci="${cIndex}"
            value="${esc(val)}"
          />
        </td>
      `);
    });

    // row delete icon (dustbin)
    html.push(`
      <td class="sm-actions">
        <button class="sm-icon-btn" type="button" data-act="del" data-r="${esc(key)}" title="Delete row">
          ${trashIcon()}
        </button>
      </td>
    `);

    html.push(`</tr>`);
  });

  elTbody.innerHTML = html.join("");

  // cell events
  elTbody.querySelectorAll("input.sm-cell").forEach(inp => {
    inp.addEventListener("input", () => {
      const key = inp.dataset.r;
      const col = inp.dataset.col;
      const value = inp.value;

      const row = rows.find(x => getRowKey(x) === key);
      if (!row) return;

      row[col] = value;

      if (!dirtyByKey.has(key)) dirtyByKey.set(key, {});
      dirtyByKey.get(key)[col] = value;

      markDirtyRow(key);
      markDirtyPill();
    });

    // multi-cell paste
    inp.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData)?.getData("text");
      if (!text) return;
      if (!text.includes("\t") && !text.includes("\n")) return;

      e.preventDefault();

      const startRI = Number(inp.dataset.ri);
      const startCI = Number(inp.dataset.ci);
      const matrix = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((line, i, arr) => !(i === arr.length - 1 && line === ""))
        .map(line => line.split("\t"));

      const colNames = (columns || []).map(c => c.name);

      for (let rOff = 0; rOff < matrix.length; rOff++) {
        const rr = rows[startRI + rOff];
        if (!rr) break;
        const rowKey = getRowKey(rr);

        for (let cOff = 0; cOff < matrix[rOff].length; cOff++) {
          const colName = colNames[startCI + cOff];
          if (!colName) break;

          const v = matrix[rOff][cOff];
          rr[colName] = v;

          if (!dirtyByKey.has(rowKey)) dirtyByKey.set(rowKey, {});
          dirtyByKey.get(rowKey)[colName] = v;

          const sel = `input.sm-cell[data-r="${CSS.escape(rowKey)}"][data-col="${CSS.escape(colName)}"]`;
          const cellInp = elTbody.querySelector(sel);
          if (cellInp) cellInp.value = v;

          markDirtyRow(rowKey);
        }
      }
      markDirtyPill();
    });

    // Enter moves down
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const ri = Number(inp.dataset.ri);
        const ci = Number(inp.dataset.ci);
        const next = elTbody.querySelector(`input.sm-cell[data-ri="${ri + 1}"][data-ci="${ci}"]`);
        if (next) next.focus();
      }
    });
  });
}

function markDirtyRow(key) {
  const tr = elTbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  if (tr) tr.classList.add("sm-dirty");
}

function updateMeta() {
  const from = page * PAGE_SIZE;
  const to = Math.min(from + PAGE_SIZE, totalCount);

  if (elMeta) elMeta.textContent = `Showing ${Math.min(from + 1, totalCount)}–${Math.min(to, totalCount)} of ${totalCount}`;
  if (elMetaTop) elMetaTop.textContent = `Rows: ${totalCount}`;

  const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  if (elPage) elPage.textContent = `Page ${page + 1} / ${pages}`;

  if (elPrev) elPrev.disabled = page <= 0;
  if (elNext) elNext.disabled = (from + PAGE_SIZE) >= totalCount;
}

// -------------------- Load --------------------
async function loadPage() {
  hideMsg();

  await withBusy("Loading students…", async () => {
    setBusyProgress(15, "Fetching schema…");
    const sch = await fetchSchemaSafe();

    setBusyProgress(30, "Fetching data…");
    const { data, error, count } = await buildQuery({ includeCount: true });
    if (error) throw error;

    totalCount = count ?? 0;
    rows = (data || []).map(r => ({ ...r }));

    if (sch) columns = reorderColumnsBySchema(sch);
    else columns = inferColumnsFromRows(rows);

    fillUpsertKeyDropdown();

    setBusyProgress(75, "Rendering…");
    renderHeader();
    renderBody();
    updateMeta();
    setBusyProgress(100, "Done");

    markDirtyPill();
  }).catch(e => {
    console.error(e);
    showMsg(String(e?.message || e), true);
  });
}

// -------------------- Add / Delete / Save --------------------
function addRow() {
  hideMsg();

  const obj = {};
  for (const c of (columns || [])) obj[c.name] = "";

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

  const row = rows.find(r => getRowKey(r) === key);
  if (!row) return;

  const isNew = newKeys.has(key);
  if (isNew) {
    rows = rows.filter(r => getRowKey(r) !== key);
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
  }).catch(e => showMsg(String(e?.message || e), true));
}

async function saveChanges() {
  hideMsg();

  if (dirtyByKey.size === 0 && newKeys.size === 0) return showMsg("No changes to save.");

  const upsertKey = String(elUpsertKey.value || "").trim();
  if (!upsertKey) return showMsg("Select an Upsert Key first.", true);

  const payloads = [];
  for (const [key, patch] of dirtyByKey.entries()) {
    const row = rows.find(r => getRowKey(r) === key);
    if (!row) continue;

    const out = { ...row, ...patch };
    delete out.__key;
    delete out.__isNew;

    if (newKeys.has(key)) continue;
    payloads.push(out);
  }

  const newPayloads = [];
  for (const key of newKeys.values()) {
    const row = rows.find(r => getRowKey(r) === key);
    if (!row) continue;

    const out = { ...row };
    delete out.__key;
    delete out.__isNew;

    if (isBlank(out[upsertKey])) return showMsg(`New row is missing "${upsertKey}". Fill it before saving.`, true);
    newPayloads.push(out);
  }

  await withBusy("Saving changes…", async () => {
    let done = 0;
    const total = payloads.length + newPayloads.length;
    function bump(stepText) {
      done++;
      const pct = Math.min(99, Math.round((done / Math.max(1, total)) * 90) + 10);
      setBusyProgress(pct, stepText);
    }

    if (payloads.length) {
      setBusyProgress(10, `Saving ${payloads.length} updates…`);
      const chunk = 200;
      for (let i = 0; i < payloads.length; i += chunk) {
        const batch = payloads.slice(i, i + chunk);
        const { error } = await sb.from(STUDENTS_TABLE).upsert(batch, { onConflict: upsertKey });
        if (error) throw error;
        bump("Updates saved…");
      }
    }

    if (newPayloads.length) {
      setBusyProgress(55, `Saving ${newPayloads.length} new rows…`);
      const chunk = 200;
      for (let i = 0; i < newPayloads.length; i += chunk) {
        const batch = newPayloads.slice(i, i + chunk);
        const { error } = await sb.from(STUDENTS_TABLE).upsert(batch, { onConflict: upsertKey });
        if (error) throw error;
        bump("New rows saved…");
      }
    }

    setBusyProgress(100, "Done");

    dirtyByKey.clear();
    newKeys.clear();
    markDirtyPill();

    await loadPage();
    showMsg("Saved ✅");
  }).catch(e => showMsg(String(e?.message || e), true));
}

// -------------------- Import / Export --------------------
function parseCsv(text) {
  const rows = [];
  let cur = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }

    if (!inQuotes && ch === ",") { cur.push(cell); cell = ""; continue; }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      cur.push(cell);
      rows.push(cur);
      cur = [];
      cell = "";
      continue;
    }
    cell += ch;
  }

  if (cell.length || cur.length) { cur.push(cell); rows.push(cur); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase();
}

async function importFile() {
  hideMsg();

  const file = elFile?.files?.[0];
  if (!file) return showMsg("Choose a CSV/XLSX file first.", true);

  const mode = String(elImportMode.value || "upsert");
  const upsertKey = String(elUpsertKey.value || "").trim();
  if (mode === "upsert" && !upsertKey) return showMsg("Select Upsert Key.", true);

  await withBusy("Importing…", async () => {
    setBusyProgress(10, "Reading file…");
    const ext = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";

    let records = [];
    if (ext === "xlsx") {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      records = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
    } else {
      const text = await file.text();
      const grid = parseCsv(text);
      const headers = grid[0].map(normalizeHeader);
      records = grid.slice(1).map(r => {
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
    const colNames = (columns || []).map(c => c.name);
    const colMap = new Map(colNames.map(c => [normalizeHeader(c), c]));

    const cleaned = records.map(r => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        const real = colMap.get(normalizeHeader(k));
        if (!real) continue;
        out[real] = v;
      }
      return out;
    }).filter(o => Object.keys(o).length);

    if (!cleaned.length) {
      setBusyProgress(100, "Done");
      return showMsg("No matching headers found. Make sure file headers match your column names.", true);
    }

    if (mode === "upsert") {
      const bad = cleaned.find(x => isBlank(x[upsertKey]));
      if (bad) {
        setBusyProgress(100, "Done");
        return showMsg(`Some rows are missing "${upsertKey}". Fix file and retry.`, true);
      }
    }

    setBusyProgress(55, `Writing ${cleaned.length} rows…`);
    const chunk = 200;
    for (let i = 0; i < cleaned.length; i += chunk) {
      const batch = cleaned.slice(i, i + chunk);
      const res = (mode === "insert")
        ? await sb.from(STUDENTS_TABLE).insert(batch)
        : await sb.from(STUDENTS_TABLE).upsert(batch, { onConflict: upsertKey });

      if (res.error) throw res.error;

      const pct = Math.min(95, 55 + Math.round((i / cleaned.length) * 40));
      setBusyProgress(pct, `Imported ${Math.min(cleaned.length, i + chunk)}/${cleaned.length}…`);
    }

    setBusyProgress(100, "Done");
    showMsg(`Imported ${cleaned.length} rows ✅`);
    elFile.value = "";
    closeModal(elImportModal);
    await loadPage();
  }).catch(e => showMsg(String(e?.message || e), true));
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

      const s = String(elSearch.value || "").trim();
      if (s) {
        const escS = s.replace(/,/g, " ");
        q = q.or(
          `child_name.ilike.%${escS}%,student_name.ilike.%${escS}%,class_name.ilike.%${escS}%,section.ilike.%${escS}%,sr_number.ilike.%${escS}%`
        );
      }

      const colNames = (columns || []).map(c => c.name);
      if (colNames.includes("child_name")) q = q.order("child_name", { ascending: true });
      else if (colNames.includes("id")) q = q.order("id", { ascending: true });

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
    const colNames = (columns || []).map(c => c.name);
    const out = all.map(r => {
      const o = {};
      for (const c of colNames) o[humanize(c)] = r?.[c] ?? "";
      return o;
    });

    const ws = window.XLSX.utils.json_to_sheet(out);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Students");

    const name = `Students_${new Date().toISOString().slice(0,10)}.xlsx`;
    window.XLSX.writeFile(wb, name);

    setBusyProgress(100, "Done");
    showMsg(`Exported ${out.length} rows ✅`);
  }).catch(e => showMsg(String(e?.message || e), true));
}

// -------------------- Events --------------------
function wireEvents() {
  // search debounce
  let t = null;
  elSearch?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { page = 0; loadPage(); }, 250);
  });

  elReload?.addEventListener("click", () => loadPage());
  elAddRow?.addEventListener("click", addRow);
  elSave?.addEventListener("click", saveChanges);
  elExport?.addEventListener("click", exportXlsx);

  elPrev?.addEventListener("click", () => { if (page > 0) { page--; loadPage(); } });
  elNext?.addEventListener("click", () => { page++; loadPage(); });

  // upload modal open/close
  elUploadOpen?.addEventListener("click", () => openModal(elImportModal));
  elImportClose?.addEventListener("click", () => closeModal(elImportModal));
  elImportModal?.addEventListener("click", (e) => {
    if (e.target === elImportModal) closeModal(elImportModal);
  });

  // import action
  elImport?.addEventListener("click", importFile);

  // add column modal open/close (the "+" button is created in header each render)
  elColClose?.addEventListener("click", () => closeModal(elColModal));
  elColModal?.addEventListener("click", (e) => {
    if (e.target === elColModal) closeModal(elColModal);
  });
  elAddColBtn?.addEventListener("click", schemaAddColumnDirect);

  // header actions (column delete + add column "+")
  elThead?.addEventListener("click", (e) => {
    const delBtn = e.target.closest("button[data-act='col-del']");
    if (delBtn) {
      const col = delBtn.getAttribute("data-col");
      if (col) schemaDropColumnDirect(col);
      return;
    }

    const plusBtn = e.target.closest("#smAddColPlus");
    if (plusBtn) {
      openModal(elColModal);
      setTimeout(() => elAddColName?.focus(), 0);
      return;
    }
  });

  // row delete (dustbin)
  elTbody?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act='del']");
    if (!btn) return;
    const key = btn.getAttribute("data-r");
    if (!key) return;
    deleteRow(key);
  });

  // ESC closes modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal(elImportModal);
      closeModal(elColModal);
    }
  });
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

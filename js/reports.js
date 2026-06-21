// js/reports.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy, setBusyProgress } from "./busy.js";
import {
  listSessions,
  getSessionLabel,
  setSessionLabel,
  getSessionRange,
  applySessionToDateInputs,
  clampRangeToSession,
} from "./session.js";

const sessionFilter = document.getElementById("sessionFilter");
const objectiveFilter = document.getElementById("objectiveFilter");
const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const q = document.getElementById("q");

const coordFilterWrap = document.getElementById("coordFilterWrap");
const coordFilter = document.getElementById("coordFilter");
const ownerTh = document.getElementById("ownerTh");

const pageHeading = document.getElementById("pageHeading");
const pageSubtitle = document.getElementById("pageSubtitle");

const applyBtn = document.getElementById("applyBtn");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");

const todayBtn = document.getElementById("todayBtn");
const weekBtn = document.getElementById("weekBtn");
const monthBtn = document.getElementById("monthBtn");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const rowsEl = document.getElementById("rows");
const msg = document.getElementById("msg");
const meta = document.getElementById("meta");
const pageInfo = document.getElementById("pageInfo");

const PAGE_SIZE = 100;
let page = 0;
let totalCount = 0;
let isAdmin = false;
let currentUserName = ""; // ← auto-set on boot
const COL_COUNT_NORMAL = 16;
const COL_COUNT_ADMIN = 17; // +Owner column

function show(text, isError = false) {
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(239,68,68,0.55)" : "rgba(37,99,235,0.55)";
  msg.style.color = isError ? "var(--danger)" : "var(--muted)";
  msg.textContent = text;
}
function hideMsg() { msg.style.display = "none"; }
function td(v) { return (v ?? "").toString(); }
function pad2(n) { return String(n).padStart(2, "0"); }
function colCount() { return isAdmin ? COL_COUNT_ADMIN : COL_COUNT_NORMAL; }

function fmtTS(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// supports YYYY-MM-DD and DD-MM-YYYY
function parseDateInput(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return { y, m, d };
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split("-").map(Number);
    return { y, m, d };
  }
  return null;
}

// start of day
function toStartISO(val) {
  const p = parseDateInput(val);
  if (!p) return null;
  return new Date(p.y, p.m - 1, p.d, 0, 0, 0, 0).toISOString();
}

// ---- Quick ranges use endExclusive (tomorrow 00:00) so "Today" includes full day
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function startOfWeekMonday(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // Sun=0
  const diff = (day + 6) % 7; // Monday=0
  return addDays(x, -diff);
}
function setRangeToday() {
  const now = new Date();
  const from = startOfDay(now);
  const to = addDays(from, 1); // endExclusive
  const sess = sessionFilter?.value || getSessionLabel();
  const clamped = clampRangeToSession(from, to, sess);
  fromDate.value = `${clamped.from.getFullYear()}-${pad2(clamped.from.getMonth() + 1)}-${pad2(clamped.from.getDate())}`;
  toDate.value = `${clamped.to.getFullYear()}-${pad2(clamped.to.getMonth() + 1)}-${pad2(clamped.to.getDate())}`;
}
function setRangeThisWeek() {
  const now = new Date();
  const from = startOfWeekMonday(now);
  const to = addDays(startOfDay(now), 1); // endExclusive tomorrow
  const sess = sessionFilter?.value || getSessionLabel();
  const clamped = clampRangeToSession(from, to, sess);
  fromDate.value = `${clamped.from.getFullYear()}-${pad2(clamped.from.getMonth() + 1)}-${pad2(clamped.from.getDate())}`;
  toDate.value = `${clamped.to.getFullYear()}-${pad2(clamped.to.getMonth() + 1)}-${pad2(clamped.to.getDate())}`;
}
function setRangeThisMonth() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const to = addDays(startOfDay(now), 1); // endExclusive tomorrow
  const sess = sessionFilter?.value || getSessionLabel();
  const clamped = clampRangeToSession(from, to, sess);
  fromDate.value = `${clamped.from.getFullYear()}-${pad2(clamped.from.getMonth() + 1)}-${pad2(clamped.from.getDate())}`;
  toDate.value = `${clamped.to.getFullYear()}-${pad2(clamped.to.getMonth() + 1)}-${pad2(clamped.to.getDate())}`;
}

// ---- Determine active owner filter ----
function getActiveOwnerFilter() {
  // Admin with coord filter: use selected value ("" = all)
  if (isAdmin && coordFilter) {
    return coordFilter.value; // "" means all, otherwise specific coordinator name
  }
  // Non-admin: always own name
  return currentUserName;
}

// -------------------- Query builder --------------------
function buildBaseQuery({ includeCount = false } = {}) {
  let query = sb
    .from("touchpoints")
    .select("*", includeCount ? { count: "exact" } : undefined)
    .order("touch_timestamp", { ascending: false });

  // Hide broken/partial rows
  query = query
    .not("child_name", "is", null).neq("child_name", "")
    .not("medium", "is", null).neq("medium", "")
    .not("objective", "is", null).neq("objective", "");

  // ✅ Filter by coordinator (admin can see all or specific, non-admin sees own)
  const ownerFilter = getActiveOwnerFilter();
  if (ownerFilter) {
    query = query.eq("owner_name", ownerFilter);
  }

  if (objectiveFilter?.value) query = query.eq("objective", objectiveFilter.value);

  const sessLabel = sessionFilter?.value || getSessionLabel();
  const sess = getSessionRange(sessLabel);

  // Date range: treat To as endExclusive
  const startISO = toStartISO(fromDate?.value);
  const endExclusiveISO = toStartISO(toDate?.value);

  // If user empties dates, fallback to session boundaries
  const start = startISO ? new Date(startISO) : new Date(sess.start);
  const end = endExclusiveISO ? new Date(endExclusiveISO) : new Date(sess.end);

  // Clamp inside session
  const clamped = clampRangeToSession(start, end, sessLabel);

  query = query.gte("touch_timestamp", clamped.from.toISOString());
  query = query.lt("touch_timestamp", clamped.to.toISOString());

  const text = (q?.value || "").trim();
  if (text) {
    const esc = text.replace(/,/g, " ");
    query = query.or(
      `child_name.ilike.%${esc}%,student_name.ilike.%${esc}%,ticket_number.ilike.%${esc}%,sr_number.ilike.%${esc}%`
    );
  }

  return query;
}

// ---------- RAW DB ops (no popup inside) ----------
async function detectAdminRaw() {
  const { data: u } = await sb.auth.getUser();
  const user = u?.user;
  if (!user) return false;

  const { data, error } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) return false;
  return data?.role === "admin";
}

async function loadCoordinatorFilterRaw() {
  if (!coordFilter) return;
  const { data, error } = await sb.from("profiles").select("display_name").order("display_name");
  if (error) { console.warn("Could not load coordinators:", error); return; }

  const uniq = Array.from(new Set((data || []).map(x => x.display_name).filter(Boolean)));
  coordFilter.innerHTML =
    `<option value="">All Coordinators</option>` +
    uniq.map(n => `<option value="${n}">${n}</option>`).join("");

  enhanceSelect(coordFilter, { placeholder: "All Coordinators", search: true, searchThreshold: 0 });
  refreshSelect(coordFilter);
}

async function loadObjectivesRaw() {
  if (!objectiveFilter) return;

  const { data, error } = await sb
    .from("objectives")
    .select("label,is_active,sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .order("label");

  if (error) throw error;

  objectiveFilter.innerHTML =
    `<option value="">All</option>` +
    (data || []).map(o => `<option value="${o.label}">${o.label}</option>`).join("");

  enhanceSelect(objectiveFilter, { placeholder: "All objectives", search: true });
  refreshSelect(objectiveFilter);
}

async function loadPageRaw() {
  hideMsg();
  rowsEl.innerHTML = `<tr><td colspan="${colCount()}">Loading...</td></tr>`;

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await buildBaseQuery({ includeCount: true }).range(from, to);
  if (error) throw error;

  totalCount = count ?? 0;

  meta.textContent = `Showing ${Math.min(from + 1, totalCount)}–${Math.min(to + 1, totalCount)} of ${totalCount}`;
  pageInfo.textContent = `Page ${page + 1} / ${Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}`;

  prevBtn.disabled = page <= 0;
  nextBtn.disabled = (to + 1) >= totalCount;

  if (!data?.length) {
    rowsEl.innerHTML = `<tr><td colspan="${colCount()}">No results.</td></tr>`;
    return;
  }

  rowsEl.innerHTML = data.map(r => `
    <tr>
      <td>${td(r.child_name)}</td>
      <td>${td(r.medium)}</td>
      <td>${td(r.objective)}</td>
      <td style="white-space:pre-wrap;">${td(r.comments_concat || r.positives || "")}</td>
      <td>${td(r.ticket_number)}</td>
      <td>${td(r.ticket_raised)}</td>
      ${isAdmin ? `<td>${td(r.owner_name)}</td>` : ""}
      <td>${fmtTS(r.touch_timestamp)}</td>
      <td>${td(r.student_name)}</td>
      <td>${td(r.class_name)}</td>
      <td>${td(r.section)}</td>
      <td>${td(r.sr_number)}</td>
      <td>${td(r.week)}</td>
      <td>${td(r.month)}</td>
      <td>${td(r.year)}</td>
      <td>${td(r.time)}</td>
      <td class="reports-actions">
        ${isAdmin ? `<button class="btn danger" type="button" data-del="${r.id}">Delete</button>` : `<span class="muted">—</span>`}
      </td>
    </tr>
  `).join("");
}

async function deleteTouchpointRaw(rawId) {
  const id = /^\d+$/.test(String(rawId)) ? Number(rawId) : rawId;

  const { data: deletedRows, error } = await sb
    .from("touchpoints")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return deletedRows || [];
}

async function exportAllFilteredRaw() {
  const all = [];
  let offset = 0;
  const chunk = 1000;

  while (true) {
    setBusyProgress(null, `Fetching rows… (${all.length} loaded)`);
    const { data, error } = await buildBaseQuery().range(offset, offset + chunk - 1);
    if (error) throw error;
    if (!data?.length) break;

    all.push(...data);
    offset += data.length;
    if (data.length < chunk) break;
  }

  if (!all.length) {
    show("No rows to export.", true);
    return;
  }

  setBusyProgress(null, `Building XLSX… (${all.length} rows)`);

  const rows = all.map(r => {
    const base = {
      "Child Name": td(r.child_name),
      "Medium": td(r.medium),
      "Objective": td(r.objective),
      "Summary": td(r.comments_concat || r.positives || ""),
      "Ticket Number": td(r.ticket_number),
      "Ticket raised?": td(r.ticket_raised),
    };
    if (isAdmin) base["Owner"] = td(r.owner_name);
    Object.assign(base, {
      "Timestamp": fmtTS(r.touch_timestamp),
      "Name": td(r.student_name),
      "Class": td(r.class_name),
      "Section": td(r.section),
      "SR Number": td(r.sr_number),
      "Week": td(r.week),
      "Month": td(r.month),
      "Year": td(r.year),
      "Time": td(r.time),
    });
    return base;
  });

  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  const sheetName = isAdmin ? "All Entries" : "My Entries";
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const label = isAdmin ? "Entries_Report" : "My_Entries_Report";
  const name = `${label}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  window.XLSX.writeFile(wb, name);

  show(`Exported ${rows.length} rows ✅`);
}

// ---------- PUBLIC wrappers ----------
async function loadPage() {
  await withBusy("Loading entries…", async () => {
    setBusyProgress(null, "Loading data…");
    await loadPageRaw();
  }).catch((err) => {
    console.error(err);
    rowsEl.innerHTML = `<tr><td colspan="${colCount()}">${td(err?.message || String(err))}</td></tr>`;
    show(err?.message || String(err), true);
  });
}

async function exportAllFiltered() {
  hideMsg();
  await withBusy("Preparing export…", async () => {
    await exportAllFilteredRaw();
  }).catch((err) => {
    console.error(err);
    show(err?.message || String(err), true);
  });
}

// ✅ Delete handler (admin only)
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-del]");
  if (!btn) return;
  if (!isAdmin) return;

  const rawId = btn.getAttribute("data-del");
  if (!rawId) return;

  const ok = confirm("Delete this entry from database?");
  if (!ok) return;

  hideMsg();
  await withBusy("Deleting…", async () => {
    setBusyProgress(null, "Deleting from DB…");
    const deletedRows = await deleteTouchpointRaw(rawId);

    if (!deletedRows || deletedRows.length === 0) {
      show(
        "Not deleted (0 rows affected). This is usually due to Row Level Security (RLS) policy on touchpoints. Add an admin DELETE policy in Supabase.",
        true
      );
      return;
    }

    show("Deleted ✅");
    setBusyProgress(null, "Refreshing…");
    await loadPageRaw();
  }).catch((err) => {
    console.error(err);
    show(`Delete failed: ${err?.message || String(err)}`, true);
  });
});

// ---------- Session UI ----------
function initSessionUI() {
  if (!sessionFilter) return;

  const sessions = listSessions({ past: 6, future: 1 });
  sessionFilter.innerHTML = sessions.map(s => `<option value="${s}">${s}</option>`).join("");

  const cur = getSessionLabel();
  sessionFilter.value = cur;

  enhanceSelect(sessionFilter, { placeholder: "Select session...", search: true });
  refreshSelect(sessionFilter);

  // Set From/To as session boundaries by default
  applySessionToDateInputs(fromDate, toDate, cur);

  sessionFilter.addEventListener("change", async () => {
    const val = sessionFilter.value;
    setSessionLabel(val);
    applySessionToDateInputs(fromDate, toDate, val);
    page = 0;
    await loadPage();
  });
}

// ---- Admin UI setup ----
function setupAdminUI() {
  // Show coordinator filter
  if (coordFilterWrap) coordFilterWrap.style.display = "";

  // Show Owner column header
  if (ownerTh) ownerTh.style.display = "";

  // Update page heading
  if (pageHeading) pageHeading.textContent = "All Entries";
  if (pageSubtitle) pageSubtitle.textContent = "All coordinator entries. Filter by coordinator, date range + objective.";

  // Coordinator filter change handler
  if (coordFilter) {
    coordFilter.addEventListener("change", async () => {
      page = 0;
      await loadPage();
    });
  }
}

// ---------- Boot ----------
(async () => {
  const { me, profile } = await mountNav("reports");

  // ✅ Set current user name for auto-filtering
  currentUserName = profile?.display_name ?? "";

  await withBusy("Loading entries…", async () => {
    setBusyProgress(null, "Checking access…");
    isAdmin = await detectAdminRaw();

    // If admin, show coordinator filter + Owner column
    if (isAdmin) {
      setupAdminUI();
      setBusyProgress(null, "Loading coordinators…");
      await loadCoordinatorFilterRaw();
    }

    setBusyProgress(null, "Loading session…");
    initSessionUI();

    setBusyProgress(null, "Loading objectives…");
    await loadObjectivesRaw();

    setBusyProgress(null, "Loading entries…");
    await loadPageRaw();
  }).catch((err) => {
    console.error(err);
    show(err?.message || String(err), true);
  });
})();

// ---------- Events ----------
applyBtn.addEventListener("click", async () => { page = 0; await loadPage(); });

clearBtn.addEventListener("click", async () => {
  if (objectiveFilter) {
    objectiveFilter.value = "";
    refreshSelect(objectiveFilter);
  }

  // Reset coordinator filter for admin
  if (isAdmin && coordFilter) {
    coordFilter.value = "";
    refreshSelect(coordFilter);
  }

  q.value = "";

  // Reset to session boundaries
  const sess = sessionFilter?.value || getSessionLabel();
  applySessionToDateInputs(fromDate, toDate, sess);

  page = 0;
  hideMsg();
  await loadPage();
});

todayBtn.addEventListener("click", async () => { setRangeToday(); page = 0; await loadPage(); });
weekBtn.addEventListener("click", async () => { setRangeThisWeek(); page = 0; await loadPage(); });
monthBtn.addEventListener("click", async () => { setRangeThisMonth(); page = 0; await loadPage(); });

prevBtn.addEventListener("click", async () => { if (page > 0) { page--; await loadPage(); } });
nextBtn.addEventListener("click", async () => { page++; await loadPage(); });

exportBtn.addEventListener("click", exportAllFiltered);

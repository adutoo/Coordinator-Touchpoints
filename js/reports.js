// js/reports.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy, setBusyProgress } from "./busy.js";

const coordFilter = document.getElementById("coordFilter");
const objectiveFilter = document.getElementById("objectiveFilter"); // ✅ NEW

const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const q = document.getElementById("q");

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

function show(text, isError = false) {
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.style.color = isError ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  msg.textContent = text;
}
function hideMsg() { msg.style.display = "none"; }
function td(v) { return (v ?? "").toString(); }
function pad2(n) { return String(n).padStart(2, "0"); }

// Excel-safe: YYYY-MM-DD HH:mm:ss
function fmtTS(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ✅ robust date input parsing (supports YYYY-MM-DD and DD-MM-YYYY)
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

function toStartISO(val) {
  const p = parseDateInput(val);
  if (!p) return null;
  return new Date(p.y, p.m - 1, p.d, 0, 0, 0, 0).toISOString();
}

function toEndISO(val) {
  const p = parseDateInput(val);
  if (!p) return null;
  return new Date(p.y, p.m - 1, p.d, 23, 59, 59, 999).toISOString();
}

function setDefaultRangeLast7Days() {
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 6);

  const f = `${from.getFullYear()}-${pad2(from.getMonth() + 1)}-${pad2(from.getDate())}`;
  const t = `${to.getFullYear()}-${pad2(to.getMonth() + 1)}-${pad2(to.getDate())}`;

  fromDate.value = f;
  toDate.value = t;
}

function setRangeToday() {
  const now = new Date();
  const d = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  fromDate.value = d;
  toDate.value = d;
}

function setRangeThisWeek() {
  const now = new Date();
  const x = new Date(now);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // Sun=0
  const diff = (day + 6) % 7; // Monday=0
  x.setDate(x.getDate() - diff);

  const f = `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
  const t = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  fromDate.value = f;
  toDate.value = t;
}

function setRangeThisMonth() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const f = `${monthStart.getFullYear()}-${pad2(monthStart.getMonth() + 1)}-${pad2(monthStart.getDate())}`;
  const t = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  fromDate.value = f;
  toDate.value = t;
}

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

  if (coordFilter?.value) query = query.eq("owner_name", coordFilter.value);

  // ✅ Objective filter
  if (objectiveFilter?.value) query = query.eq("objective", objectiveFilter.value);

  const start = toStartISO(fromDate.value);
  const end = toEndISO(toDate.value);
  if (start) query = query.gte("touch_timestamp", start);
  if (end) query = query.lte("touch_timestamp", end);

  const text = q.value.trim();
  if (text) {
    const esc = text.replace(/,/g, " ");
    query = query.or(
      `child_name.ilike.%${esc}%,student_name.ilike.%${esc}%,ticket_number.ilike.%${esc}%`
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

async function loadCoordinatorsRaw() {
  const { data, error } = await sb.from("profiles").select("display_name").order("display_name");
  if (error) throw error;

  const uniq = Array.from(new Set((data || []).map(x => x.display_name).filter(Boolean)));
  coordFilter.innerHTML =
    `<option value="">All</option>` +
    uniq.map(n => `<option value="${n}">${n}</option>`).join("");

  enhanceSelect(coordFilter, { placeholder: "All coordinators", search: true, searchThreshold: 0 });
  refreshSelect(coordFilter);
}

async function loadObjectivesRaw() {
  if (!objectiveFilter) return;

  // Prefer objectives master table (admin-managed)
  const { data, error } = await sb
    .from("objectives")
    .select("label,is_active,sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .order("label");

  if (error) throw error;

  const labels = (data || []).map(x => x.label).filter(Boolean);

  objectiveFilter.innerHTML =
    `<option value="">All</option>` +
    labels.map(l => `<option value="${l}">${l}</option>`).join("");

  enhanceSelect(objectiveFilter, { placeholder: "All objectives", search: true, searchThreshold: 0 });
  refreshSelect(objectiveFilter);
}

async function loadPageRaw() {
  hideMsg();
  rowsEl.innerHTML = `<tr><td colspan="21">Loading...</td></tr>`;

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
    rowsEl.innerHTML = `<tr><td colspan="21">No results.</td></tr>`;
    return;
  }

  rowsEl.innerHTML = data.map(r => `
    <tr>
      <td>${td(r.child_name)}</td>
      <td>${td(r.medium)}</td>
      <td>${td(r.objective)}</td>
      <td>${td(r.positives)}</td>
      <td>${td(r.suggestion)}</td>
      <td>${td(r.ticket_number)}</td>
      <td>${td(r.ticket_raised)}</td>
      <td>${td(r.owner_email)}</td>
      <td>${fmtTS(r.touch_timestamp)}</td>
      <td>${td(r.correct_owner)}</td>
      <td>${td(r.student_name)}</td>
      <td>${td(r.class_name)}</td>
      <td>${td(r.section)}</td>
      <td>${td(r.sr_number)}</td>
      <td>${td(r.owner_name)}</td>
      <td>${td(r.week)}</td>
      <td>${td(r.month)}</td>
      <td>${td(r.year)}</td>
      <td style="white-space:pre-wrap;">${td(r.comments_concat)}</td>
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

  const rows = all.map(r => ({
    "Child Name": td(r.child_name),
    "Medium": td(r.medium),
    "Objective": td(r.objective),
    "Positives / Strengths / What good we are doing": td(r.positives),
    "Suggestion / Weakness / What we or the student need to improve /Questions": td(r.suggestion),
    "Ticket Number": td(r.ticket_number),
    "Ticket raised?": td(r.ticket_raised),
    "Owner": td(r.owner_email),
    "Timestamp": fmtTS(r.touch_timestamp),
    "Correct Owner": td(r.correct_owner),
    "Name": td(r.student_name),
    "Class": td(r.class_name),
    "Section": td(r.section),
    "SR Number": td(r.sr_number),
    "Owner Name": td(r.owner_name),
    "Week": td(r.week),
    "Month": td(r.month),
    "Year": td(r.year),
    "Comments Concat": td(r.comments_concat),
    "Time": td(r.time),
  }));

  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Report");

  const name = `Coordinator_Touchpoints_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
  window.XLSX.writeFile(wb, name);

  show(`Exported ${rows.length} rows ✅`);
}

// ---------- PUBLIC wrappers (show popup progress) ----------
async function loadPage() {
  await withBusy("Loading report…", async () => {
    setBusyProgress(null, "Loading data…");
    await loadPageRaw();
  }).catch((err) => {
    console.error(err);
    rowsEl.innerHTML = `<tr><td colspan="21">${td(err?.message || String(err))}</td></tr>`;
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

// ✅ Delete handler with verification + progress popup
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

// ---------- Boot ----------
(async () => {
  await mountNav("reports");

  await withBusy("Loading reports…", async () => {
    setBusyProgress(null, "Checking access…");
    isAdmin = await detectAdminRaw();

    setBusyProgress(null, "Loading coordinators…");
    await loadCoordinatorsRaw();

    setBusyProgress(null, "Loading objectives…");
    await loadObjectivesRaw();

    setBusyProgress(null, "Loading report…");
    setDefaultRangeLast7Days();
    await loadPageRaw();
  }).catch((err) => {
    console.error(err);
    show(err?.message || String(err), true);
  });
})();

// ---------- Events ----------
applyBtn.addEventListener("click", async () => { page = 0; await loadPage(); });

clearBtn.addEventListener("click", async () => {
  coordFilter.value = "";
  refreshSelect(coordFilter);

  if (objectiveFilter) {
    objectiveFilter.value = "";
    refreshSelect(objectiveFilter);
  }

  q.value = "";
  setDefaultRangeLast7Days();
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

// js/reports.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";

const coordFilter = document.getElementById("coordFilter");
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

function show(text, isError=false){
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.textContent = text;
}

function hideMsg(){ msg.style.display = "none"; }

function td(v){ return (v ?? "").toString(); }

function toStartISO(yyyy_mm_dd){
  if (!yyyy_mm_dd) return null;
  const [y,m,d] = yyyy_mm_dd.split("-").map(Number);
  return new Date(y, m-1, d, 0,0,0,0).toISOString();
}
function toEndISO(yyyy_mm_dd){
  if (!yyyy_mm_dd) return null;
  const [y,m,d] = yyyy_mm_dd.split("-").map(Number);
  return new Date(y, m-1, d, 23,59,59,999).toISOString();
}

function setDefaultRangeLast7Days(){
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 6);

  const pad = (n)=> String(n).padStart(2,"0");
  const f = `${from.getFullYear()}-${pad(from.getMonth()+1)}-${pad(from.getDate())}`;
  const t = `${to.getFullYear()}-${pad(to.getMonth()+1)}-${pad(to.getDate())}`;

  fromDate.value = f;
  toDate.value = t;
}

function setRangeToday(){
  const now = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  fromDate.value = d;
  toDate.value = d;
}

function setRangeThisWeek(){
  const now = new Date();
  const x = new Date(now);
  x.setHours(0,0,0,0);
  const day = x.getDay(); // Sun=0
  const diff = (day + 6) % 7; // Monday=0
  x.setDate(x.getDate() - diff);
  const weekStart = x;

  const pad = (n)=> String(n).padStart(2,"0");
  const f = `${weekStart.getFullYear()}-${pad(weekStart.getMonth()+1)}-${pad(weekStart.getDate())}`;
  const t = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

  fromDate.value = f;
  toDate.value = t;
}

function setRangeThisMonth(){
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const pad = (n)=> String(n).padStart(2,"0");
  const f = `${monthStart.getFullYear()}-${pad(monthStart.getMonth()+1)}-${pad(monthStart.getDate())}`;
  const t = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

  fromDate.value = f;
  toDate.value = t;
}

async function loadCoordinators(){
  const { data, error } = await sb.from("profiles").select("display_name").order("display_name");
  if (error) return show(error.message, true);

  const uniq = Array.from(new Set((data || []).map(x => x.display_name).filter(Boolean)));
  coordFilter.innerHTML =
    `<option value="">All</option>` +
    uniq.map(n => `<option value="${n}">${n}</option>`).join("");
}

function buildBaseQuery({ includeCount=false } = {}){
  let query = sb
    .from("touchpoints")
    .select("*", includeCount ? { count: "exact" } : undefined)
    .order("touch_timestamp", { ascending: false });

  if (coordFilter.value) query = query.eq("owner_name", coordFilter.value);

  const start = toStartISO(fromDate.value);
  const end = toEndISO(toDate.value);

  if (start) query = query.gte("touch_timestamp", start);
  if (end) query = query.lte("touch_timestamp", end);

  const text = q.value.trim();
  if (text) {
    // Search across multiple columns
    // NOTE: ilike needs PostgREST "or" syntax
    const esc = text.replace(/,/g, " "); // avoid breaking OR
    query = query.or(
      `child_name.ilike.%${esc}%,student_name.ilike.%${esc}%,ticket_number.ilike.%${esc}%`
    );
  }

  return query;
}

async function loadPage(){
  hideMsg();
  rowsEl.innerHTML = `<tr><td colspan="20">Loading...</td></tr>`;

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const q1 = buildBaseQuery({ includeCount: true }).range(from, to);

  const { data, error, count } = await q1;
  if (error) {
    rowsEl.innerHTML = `<tr><td colspan="20">${error.message}</td></tr>`;
    return;
  }

  totalCount = count ?? 0;

  meta.textContent = `Showing ${Math.min(from + 1, totalCount)}–${Math.min(to + 1, totalCount)} of ${totalCount}`;
  pageInfo.textContent = `Page ${page + 1} / ${Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}`;

  prevBtn.disabled = page <= 0;
  nextBtn.disabled = (to + 1) >= totalCount;

  if (!data?.length){
    rowsEl.innerHTML = `<tr><td colspan="20">No results.</td></tr>`;
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
      <td>${r.touch_timestamp ? new Date(r.touch_timestamp).toLocaleString() : ""}</td>
      <td>${td(r.correct_owner)}</td>
      <td>${td(r.student_name)}</td>
      <td>${td(r.class_name)}</td>
      <td>${td(r.section)}</td>
      <td>${td(r.sr_number)}</td>
      <td>${td(r.owner_name)}</td>
      <td>${td(r.week)}</td>
      <td>${td(r.month)}</td>
      <td>${td(r.year)}</td>
      <td>${td(r.comments_concat)}</td>
      <td>${td(r.time)}</td>
    </tr>
  `).join("");
}

async function exportAllFiltered(){
  hideMsg();
  show("Preparing export… (fetching all filtered rows)");

  // Fetch in chunks to avoid limits
  const all = [];
  let offset = 0;
  const chunk = 1000;

  while (true) {
    const from = offset;
    const to = offset + chunk - 1;
    const { data, error } = await buildBaseQuery().range(from, to);
    if (error) return show(error.message, true);
    if (!data?.length) break;

    all.push(...data);
    offset += data.length;

    if (data.length < chunk) break;
  }

  if (!all.length) return show("No rows to export.", true);

  // Convert to export-friendly JSON with exact headers
  const rows = all.map(r => ({
    "Child Name": td(r.child_name),
    "Medium": td(r.medium),
    "Objective": td(r.objective),
    "Positives / Strengths / What good we are doing": td(r.positives),
    "Suggestion / Weakness / What we or the student need to improve /Questions": td(r.suggestion),
    "Ticket Number": td(r.ticket_number),
    "Ticket raised?": td(r.ticket_raised),
    "Owner": td(r.owner_email),
    "Timestamp": r.touch_timestamp ? new Date(r.touch_timestamp).toLocaleString() : "",
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

  const name = `Coordinator_Touchpoints_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
  window.XLSX.writeFile(wb, name);

  show(`Exported ${rows.length} rows ✅`);
}

(async () => {
  await mountNav("reports");
  await loadCoordinators();
  setDefaultRangeLast7Days();
  await loadPage();
})();

applyBtn.addEventListener("click", async () => { page = 0; await loadPage(); });

clearBtn.addEventListener("click", async () => {
  coordFilter.value = "";
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

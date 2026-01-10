// js/ticketReports.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe, getMyProfile } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy, showBusy, hideBusy, setBusyProgress } from "./busy.js";

const deptFilter = document.getElementById("deptFilter");
const repFilter = document.getElementById("repFilter");
const ownFilter = document.getElementById("ownFilter");
const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const q = document.getElementById("q");

const applyBtn = document.getElementById("applyBtn");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const rowsEl = document.getElementById("rows");
const msg = document.getElementById("msg");
const meta = document.getElementById("meta");
const pageInfo = document.getElementById("pageInfo");

const PAGE_SIZE = 50;
let page = 0;
let totalCount = 0;

// dropdown sources
let USERS = [];    // [{email, display_name}]
let STATUSES = []; // [{label}]

function show(text, isError=false){
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.textContent = text;
}
function hideMsg(){ msg.style.display = "none"; }

function escHtml(v){
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escAttr(v){ return escHtml(v).replaceAll('"', "&quot;"); }
function td(v){ return escHtml((v ?? "").toString()); }

function pad(n){ return String(n).padStart(2,"0"); }
function fmtDateTime(iso){
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
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
function isoWeekNumber(dateObj) {
  const now = new Date(dateObj);
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function fetchAllColumn(table, col){
  const out = [];
  const chunk = 1000;
  let offset = 0;
  while (true){
    const { data, error } = await sb.from(table).select(col).range(offset, offset + chunk - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    offset += data.length;
    if (data.length < chunk) break;
  }
  return out;
}

async function loadFilters(){
  hideMsg();

  // Departments
  const dR = await sb.from("ticket_departments")
    .select("label,is_active,sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .order("label");
  if (dR.error) return show(dR.error.message, true);

  deptFilter.innerHTML =
    `<option value="">All</option>` +
    (dR.data || []).map(x => `<option value="${escAttr(x.label)}">${escHtml(x.label)}</option>`).join("");

  // Reporters (distinct) - MUST page
  let reporters = [];
  try {
    const rows = await fetchAllColumn("tickets", "reporter_email");
    reporters = rows.map(r => r.reporter_email).filter(Boolean);
  } catch (e) {
    return show(e.message || String(e), true);
  }
  const uniqReporters = Array.from(new Set(reporters)).sort((a,b) => String(a).localeCompare(String(b)));

  repFilter.innerHTML =
    `<option value="">All</option>` +
    uniqReporters.map(x => `<option value="${escAttr(x)}">${escHtml(x)}</option>`).join("");

  // Ownership users (profiles)
  const uR = await sb.from("profiles").select("email,display_name,role").order("display_name");
  if (uR.error) return show(uR.error.message, true);

  USERS = (uR.data || [])
    .filter(u => u?.email)
    .map(u => ({ email: String(u.email), display_name: String(u.display_name || u.email) }));

  ownFilter.innerHTML =
    `<option value="">All</option>
     <option value="__unassigned__">Unassigned</option>` +
    USERS.map(u => `<option value="${escAttr(u.email)}">${escHtml(u.display_name)}</option>`).join("");

  // Ticket Statuses (DB)
  const sR = await sb.from("ticket_statuses")
    .select("label,is_active,sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .order("label");
  if (sR.error) return show(sR.error.message, true);

  STATUSES = (sR.data || []).map(x => ({ label: x.label }));

  enhanceSelect(deptFilter, { placeholder: "All", search: true });
  enhanceSelect(repFilter, { placeholder: "All", search: true });
  enhanceSelect(ownFilter, { placeholder: "All", search: true });

  refreshSelect(deptFilter);
  refreshSelect(repFilter);
  refreshSelect(ownFilter);
}

function buildBaseQuery({ includeCount=false } = {}){
  let query = sb
    .from("tickets")
    .select("*", includeCount ? { count: "exact" } : undefined)
    .order("raised_at", { ascending: false });

  if (deptFilter.value) query = query.eq("department", deptFilter.value);
  if (repFilter.value) query = query.eq("reporter_email", repFilter.value);

  if (ownFilter.value) {
    if (ownFilter.value === "__unassigned__") query = query.is("change_ownership", null);
    else query = query.eq("change_ownership", ownFilter.value);
  }

  const start = toStartISO(fromDate.value);
  const end = toEndISO(toDate.value);
  if (start) query = query.gte("raised_at", start);
  if (end) query = query.lte("raised_at", end);

  const text = q.value.trim();
  if (text) {
    const esc = text.replace(/,/g, " ");
    query = query.or(
      `ticket_number.ilike.%${esc}%,student_child_name.ilike.%${esc}%,student_name.ilike.%${esc}%,category.ilike.%${esc}%`
    );
  }
  return query;
}

async function fetchDerivedForTickets(ticketNumbers){
  if (!ticketNumbers.length) return new Map();

  const objectives = ["Ticket: Action", "Ticket: Parent Update"];

  const { data, error } = await sb
    .from("touchpoints")
    .select("ticket_number,objective,comments_concat,week,year,touch_timestamp")
    .in("ticket_number", ticketNumbers)
    .in("objective", objectives)
    .order("touch_timestamp", { ascending: true });

  if (error) {
    console.warn("Derived fetch failed:", error.message);
    return new Map();
  }

  const now = new Date();
  const curWeek = isoWeekNumber(now);
  const curYear = now.getFullYear();

  const map = new Map();
  for (const r of (data || [])) {
    const k = r.ticket_number;
    if (!map.has(k)) map.set(k, { action: [], parent: [], actionWeek: 0, parentWeek: 0 });

    const rec = map.get(k);
    if (r.objective === "Ticket: Action") {
      if (r.comments_concat) rec.action.push(String(r.comments_concat));
      if (Number(r.week) === curWeek && Number(r.year) === curYear) rec.actionWeek++;
    } else if (r.objective === "Ticket: Parent Update") {
      if (r.comments_concat) rec.parent.push(String(r.comments_concat));
      if (Number(r.week) === curWeek && Number(r.year) === curYear) rec.parentWeek++;
    }
  }

  for (const [k, v] of map.entries()) {
    v.actionText = v.action.join("\n");
    v.parentText = v.parent.join("\n");
  }
  return map;
}

function makeUserSelectOptions(currentVal){
  const opts = [`<option value=""></option>`];
  const cur = currentVal ? String(currentVal) : "";

  if (cur && !USERS.some(u => u.email === cur)) {
    opts.push(`<option value="${escAttr(cur)}" selected>${escHtml(cur)}</option>`);
  }

  for (const u of USERS){
    const sel = u.email === cur ? "selected" : "";
    opts.push(`<option value="${escAttr(u.email)}" ${sel}>${escHtml(u.display_name)}</option>`);
  }
  return opts.join("");
}

function makeStatusSelectOptions(currentVal){
  const opts = [`<option value=""></option>`];
  const cur = currentVal ? String(currentVal) : "";

  if (cur && !STATUSES.some(s => s.label === cur)) {
    opts.push(`<option value="${escAttr(cur)}" selected>${escHtml(cur)}</option>`);
  }

  for (const s of STATUSES){
    const sel = s.label === cur ? "selected" : "";
    opts.push(`<option value="${escAttr(s.label)}" ${sel}>${escHtml(s.label)}</option>`);
  }
  return opts.join("");
}

function renderEditable(ticket, meEmail, isAdmin, derived){
  const canEdit = isAdmin || (ticket.point_of_contact === meEmail) || (ticket.point_of_resolution === meEmail);

  const textArea = (name, val) => {
    if (!canEdit) return `<div class="muted" style="white-space:pre-wrap;">${td(val)}</div>`;
    return `<textarea class="cellArea" data-ticket="${escAttr(ticket.ticket_number)}" data-field="${escAttr(name)}">${escHtml(val ?? "")}</textarea>`;
  };

  const dateInput = (name, val) => {
    if (!canEdit) return `<div class="muted">${td(val)}</div>`;
    return `<input class="cellEdit" type="date" data-ticket="${escAttr(ticket.ticket_number)}" data-field="${escAttr(name)}" value="${escAttr(val || "")}" />`;
  };

  const selectInput = (name, optionsHtml, currentVal) => {
    if (!canEdit) return `<div class="muted">${td(currentVal)}</div>`;
    return `<select class="cellSelect" data-ticket="${escAttr(ticket.ticket_number)}" data-field="${escAttr(name)}">${optionsHtml}</select>`;
  };

  return {
    change_ownership: selectInput("change_ownership", makeUserSelectOptions(ticket.change_ownership), ticket.change_ownership),
    follow_up_action_count_remarks: textArea("follow_up_action_count_remarks", ticket.follow_up_action_count_remarks),
    next_follow_up_date: dateInput("next_follow_up_date", ticket.next_follow_up_date),
    ticket_status: selectInput("ticket_status", makeStatusSelectOptions(ticket.ticket_status), ticket.ticket_status),

    derivedAction: td(derived?.actionText || ""),
    derivedParent: td(derived?.parentText || ""),
    derivedActionWeek: td(derived?.actionWeek ?? 0),
    derivedParentWeek: td(derived?.parentWeek ?? 0),
  };
}

async function loadPage(){
  hideMsg();
  rowsEl.innerHTML = `<tr><td colspan="24">Loading...</td></tr>`;

  return await withBusy("Loading Ticket Reports…", async () => {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await buildBaseQuery({ includeCount:true }).range(from, to);
    if (error) {
      rowsEl.innerHTML = `<tr><td colspan="24">${escHtml(error.message)}</td></tr>`;
      return;
    }

    totalCount = count ?? 0;
    meta.textContent = `Showing ${Math.min(from + 1, totalCount)}–${Math.min(to + 1, totalCount)} of ${totalCount}`;
    pageInfo.textContent = `Page ${page + 1} / ${Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}`;

    prevBtn.disabled = page <= 0;
    nextBtn.disabled = (to + 1) >= totalCount;

    if (!data?.length){
      rowsEl.innerHTML = `<tr><td colspan="24">No results.</td></tr>`;
      return;
    }

    const me = await getMe();
    const profile = me ? await getMyProfile(me.id) : null;
    const meEmail = me?.email || "";
    const isAdmin = profile?.role === "admin";

    setBusyProgress(null, "Loading linked touchpoints…");
    const ticketNumbers = data.map(x => x.ticket_number).filter(Boolean);
    const derivedMap = await fetchDerivedForTickets(ticketNumbers);

    rowsEl.innerHTML = data.map(t => {
      const d = derivedMap.get(t.ticket_number);
      const e = renderEditable(t, meEmail, isAdmin, d);

      return `
        <tr>
          <td>${td(t.ticket_number)}</td>
          <td>${td(t.student_child_name)}</td>
          <td>${td(t.issue_raised_by)}</td>
          <td>${td(t.department)}</td>
          <td>${td(t.subject)}</td>
          <td>${td(t.category)}</td>
          <td style="max-width:420px; white-space:pre-wrap;">${td(t.description)}</td>
          <td>${td(fmtDateTime(t.raised_at))}</td>
          <td>${td(t.reporter_email)}</td>
          <td>${td(t.reporter_mobile)}</td>

          <td>${td(t.class_name)}</td>
          <td>${td(t.section)}</td>
          <td>${td(t.scholar_number)}</td>

          <td>${td(t.point_of_contact)}</td>
          <td>${td(t.point_of_resolution)}</td>

          <td>${e.change_ownership}</td>
          <td>${e.follow_up_action_count_remarks}</td>
          <td>${e.next_follow_up_date}</td>
          <td>${e.ticket_status}</td>

          <td style="white-space:pre-wrap; max-width:420px;">${e.derivedAction}</td>
          <td style="white-space:pre-wrap; max-width:420px;">${e.derivedParent}</td>
          <td>${e.derivedActionWeek}</td>
          <td>${e.derivedParentWeek}</td>

          <td><button class="btn danger delBtn" data-ticket="${escAttr(t.ticket_number)}">Delete</button></td>
        </tr>
      `;
    }).join("");

    // textarea/date => update on blur
    rowsEl.querySelectorAll("input.cellEdit, textarea.cellArea").forEach(inp => {
      inp.addEventListener("blur", async () => {
        const ticket_number = inp.dataset.ticket;
        const field = inp.dataset.field;
        const value = (inp.value ?? "").trim();

        const patch = {};
        patch[field] = value ? value : null;

        await withBusy("Saving changes…", async () => {
          const { error } = await sb.from("tickets").update(patch).eq("ticket_number", ticket_number);
          if (error) show(error.message, true);
        });
      });
    });

    // selects => update on change
    rowsEl.querySelectorAll("select.cellSelect").forEach(sel => {
      sel.addEventListener("change", async () => {
        const ticket_number = sel.dataset.ticket;
        const field = sel.dataset.field;
        const value = (sel.value ?? "").trim();

        const patch = {};
        patch[field] = value ? value : null;

        await withBusy("Saving changes…", async () => {
          const { error } = await sb.from("tickets").update(patch).eq("ticket_number", ticket_number);
          if (error) show(error.message, true);
        });
      });
    });

    // delete
    rowsEl.querySelectorAll(".delBtn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ticket_number = btn.dataset.ticket;
        if (!confirm(`Delete ticket ${ticket_number}?`)) return;

        await withBusy("Deleting ticket…", async () => {
          const { error } = await sb.from("tickets").delete().eq("ticket_number", ticket_number);
          if (error) return show(error.message, true);
        });

        await loadPage();
      });
    });
  });
}

const EXPORT_HEADERS = [
  "Ticket Number","Student Name","Issue Raised By","Department","Subject","Category","Description","Date","Reporter","Mobile Number",
  "Date Of Incident","Time Of Incident","Incident Reported By","Location Of Incident","Class","Section","Scholar Number","Segment",
  "Point Of Contact","Point Of Resolution","Keep In Loop","Change Ownership",
  "Follow-Up/Action Dates","Follow-Up/Action Type","Follow-Up/Action Count And Remarks","Next Follow Up Date",
  "Psych Counseling Status","Card Status","Punishment Execution Remark","Ticket Status","Parent Notified On Conclusion",
  "POC Follow Up Dates","POC Follow Up Remarks","Resolution Date","Auditor Email","Audit Date","Audit Score","Audit Categories",
  "Audit Remarks","Comments by POR",
  "Ticket Action Comments (filled by formula, don't enter anything in this column)",
  "Ticket Parent Updates (filled by formula, don't enter anything in this column)",
  "#Ticket Actions this week","#Ticket Parent Updates this week"
];

function getTicketVal(t, header, derived){
  if (header.startsWith("Ticket Action Comments (filled by formula")) return "";
  if (header.startsWith("Ticket Parent Updates (filled by formula")) return "";

  switch (header) {
    case "Ticket Number": return t.ticket_number ?? "";
    case "Student Name": return t.student_child_name ?? "";
    case "Issue Raised By": return t.issue_raised_by ?? "";
    case "Department": return t.department ?? "";
    case "Subject": return t.subject ?? "";
    case "Category": return t.category ?? "";
    case "Description": return t.description ?? "";
    case "Date": return fmtDateTime(t.raised_at) ?? "";
    case "Reporter": return t.reporter_email ?? "";
    case "Mobile Number": return (t.reporter_mobile ?? "").toString();
    case "Date Of Incident": return t.date_of_incident ?? "";
    case "Time Of Incident": return t.time_of_incident ?? "";
    case "Incident Reported By": return t.incident_reported_by ?? "";
    case "Location Of Incident": return t.location_of_incident ?? "";
    case "Class": return t.class_name ?? "";
    case "Section": return t.section ?? "";
    case "Scholar Number": return t.scholar_number ?? "";
    case "Segment": return t.segment ?? "";
    case "Point Of Contact": return t.point_of_contact ?? "";
    case "Point Of Resolution": return t.point_of_resolution ?? "";
    case "Keep In Loop": return t.keep_in_loop ?? "";
    case "Change Ownership": return t.change_ownership ?? "";
    case "Follow-Up/Action Dates": return t.follow_up_action_dates ?? "";
    case "Follow-Up/Action Type": return t.follow_up_action_type ?? "";
    case "Follow-Up/Action Count And Remarks": return t.follow_up_action_count_remarks ?? "";
    case "Next Follow Up Date": return t.next_follow_up_date ?? "";
    case "Psych Counseling Status": return t.psych_counseling_status ?? "";
    case "Card Status": return t.card_status ?? "";
    case "Punishment Execution Remark": return t.punishment_execution_remark ?? "";
    case "Ticket Status": return t.ticket_status ?? "";
    case "Parent Notified On Conclusion": return t.parent_notified_on_conclusion ?? "";
    case "POC Follow Up Dates": return t.poc_follow_up_dates ?? "";
    case "POC Follow Up Remarks": return t.poc_follow_up_remarks ?? "";
    case "Resolution Date": return t.resolution_date ?? "";
    case "Auditor Email": return t.auditor_email ?? "";
    case "Audit Date": return t.audit_date ?? "";
    case "Audit Score": return t.audit_score ?? "";
    case "Audit Categories": return t.audit_categories ?? "";
    case "Audit Remarks": return t.audit_remarks ?? "";
    case "Comments by POR": return t.comments_by_por ?? "";
    case "#Ticket Actions this week": return derived?.actionWeek ?? 0;
    case "#Ticket Parent Updates this week": return derived?.parentWeek ?? 0;
    default:
      return "";
  }
}

async function exportAllFiltered(){
  hideMsg();

  return await withBusy("Exporting report…", async () => {
    // get count (for progress)
    setBusyProgress(null, "Counting rows…");
    const head = await buildBaseQuery({ includeCount:true }).range(0, 0);
    const total = head?.count ?? 0;

    const all = [];
    let offset = 0;
    const chunk = 1000;

    while (true) {
      const pct = total ? (offset / total) * 100 : null;
      setBusyProgress(pct, `Downloading rows… (${offset}/${total || "?"})`);

      const { data, error } = await buildBaseQuery().range(offset, offset + chunk - 1);
      if (error) {
        show(error.message, true);
        return;
      }
      if (!data?.length) break;

      all.push(...data);
      offset += data.length;
      if (data.length < chunk) break;
    }

    if (!all.length) {
      show("No rows to export.", true);
      return;
    }

    setBusyProgress(null, "Computing weekly counts…");
    const derivedMap = await fetchDerivedForTickets(all.map(x => x.ticket_number).filter(Boolean));

    setBusyProgress(null, "Building Excel…");
    const rows = all.map(t => {
      const d = derivedMap.get(t.ticket_number) || { actionWeek: 0, parentWeek: 0 };
      const obj = {};
      for (const h of EXPORT_HEADERS) obj[h] = getTicketVal(t, h, d);
      return obj;
    });

    const ws = window.XLSX.utils.json_to_sheet(rows, { header: EXPORT_HEADERS });
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Tickets");

    const name = `Ticket_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    window.XLSX.writeFile(wb, name);

    show(`Exported ${rows.length} rows ✅`);
  });
}

function setDefaultRangeLast7Days(){
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  const f = `${from.getFullYear()}-${pad(from.getMonth()+1)}-${pad(from.getDate())}`;
  const t = `${to.getFullYear()}-${pad(to.getMonth()+1)}-${pad(to.getDate())}`;
  fromDate.value = f;
  toDate.value = t;
}

(async () => {
  await mountNav("ticket-reports");

  await withBusy("Loading filters…", async () => {
    await loadFilters();
  });

  setDefaultRangeLast7Days();
  await loadPage();
})();

applyBtn.addEventListener("click", async () => { page = 0; await loadPage(); });

clearBtn.addEventListener("click", async () => {
  deptFilter.value = "";
  repFilter.value = "";
  ownFilter.value = "";
  q.value = "";
  setDefaultRangeLast7Days();
  refreshSelect(deptFilter);
  refreshSelect(repFilter);
  refreshSelect(ownFilter);
  page = 0;
  hideMsg();
  await loadPage();
});

prevBtn.addEventListener("click", async () => { if (page > 0) { page--; await loadPage(); } });
nextBtn.addEventListener("click", async () => { page++; await loadPage(); });

exportBtn.addEventListener("click", exportAllFiltered);

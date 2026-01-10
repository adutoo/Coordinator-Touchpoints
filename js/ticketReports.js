// js/ticketReports.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";

const deptFilter = document.getElementById("deptFilter");
const repFilter = document.getElementById("repFilter");
const ownerFilter = document.getElementById("ownerFilter"); // ✅ NEW

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

// ✅ cached dropdown sources
let USERS = [];          // from profiles
let STATUSES = [];       // from ticket_statuses (labels)
let USERS_BY_EMAIL = new Map();
let USERS_BY_NAME = new Map();

function show(text, isError=false){
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.textContent = text;
}
function hideMsg(){ msg.style.display = "none"; }

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function td(v){ return escapeHtml((v ?? "").toString()); }

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

function userLabelByEmail(email){
  if (!email) return "";
  const u = USERS_BY_EMAIL.get(email);
  if (!u) return email;
  const n = u.display_name || "";
  return n ? `${n} (${email})` : email;
}

function resolveOwnershipValue(raw){
  const v = (raw || "").trim();
  if (!v) return "";
  if (USERS_BY_EMAIL.has(v)) return v; // already email
  if (USERS_BY_NAME.has(v)) return USERS_BY_NAME.get(v).email; // legacy name -> email
  return v; // unknown legacy value
}

async function loadFilters(){
  // Departments
  const dR = await sb
    .from("ticket_departments")
    .select("label")
    .eq("is_active", true)
    .order("sort_order")
    .order("label");
  if (dR.error) return show(dR.error.message, true);

  deptFilter.innerHTML =
    `<option value="">All</option>` +
    (dR.data || []).map(x => `<option value="${escapeHtml(x.label)}">${escapeHtml(x.label)}</option>`).join("");

  // Reporters (distinct)
  const rR = await sb.from("tickets").select("reporter_email").order("reporter_email");
  if (rR.error) return show(rR.error.message, true);
  const uniq = Array.from(new Set((rR.data || []).map(x => x.reporter_email).filter(Boolean)));

  repFilter.innerHTML =
    `<option value="">All</option>` +
    uniq.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");

  // ✅ Users for Change Ownership dropdown + Ownership filter
  const uR = await sb
    .from("profiles")
    .select("email, display_name, role")
    .order("display_name");
  if (uR.error) return show(uR.error.message, true);

  USERS = (uR.data || []).filter(u => u.email);
  USERS_BY_EMAIL = new Map(USERS.map(u => [u.email, u]));
  USERS_BY_NAME = new Map(USERS.map(u => [u.display_name || "", u]).filter(([k]) => !!k));

  ownerFilter.innerHTML =
    `<option value="">All</option>` +
    USERS.map(u => {
      const label = u.display_name ? `${u.display_name} (${u.email})` : u.email;
      return `<option value="${escapeHtml(u.email)}">${escapeHtml(label)}</option>`;
    }).join("");

  // ✅ Ticket Status dropdown values from DB (admin editable)
  const sR = await sb
    .from("ticket_statuses")
    .select("label")
    .eq("is_active", true)
    .order("sort_order")
    .order("label");
  if (sR.error) return show(sR.error.message, true);

  STATUSES = (sR.data || []).map(x => x.label).filter(Boolean);

  enhanceSelect(deptFilter, { placeholder: "All", search: true });
  enhanceSelect(repFilter, { placeholder: "All", search: true });
  enhanceSelect(ownerFilter, { placeholder: "All", search: true }); // ✅ NEW
}

function buildBaseQuery({ includeCount=false } = {}){
  let query = sb
    .from("tickets")
    .select("*", includeCount ? { count: "exact" } : undefined)
    .order("raised_at", { ascending: false });

  if (deptFilter.value) query = query.eq("department", deptFilter.value);
  if (repFilter.value) query = query.eq("reporter_email", repFilter.value);

  // ✅ Ownership filter
  if (ownerFilter.value) query = query.eq("change_ownership", ownerFilter.value);

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
    if (!map.has(k)) {
      map.set(k, { action: [], parent: [], actionWeek: 0, parentWeek: 0 });
    }
    const obj = r.objective;
    const rec = map.get(k);

    if (obj === "Ticket: Action") {
      if (r.comments_concat) rec.action.push(String(r.comments_concat));
      if (Number(r.week) === curWeek && Number(r.year) === curYear) rec.actionWeek++;
    } else if (obj === "Ticket: Parent Update") {
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

function renderEditable(ticket, meEmail, isAdmin, derived){
  const canEdit = isAdmin || (ticket.point_of_contact === meEmail) || (ticket.point_of_resolution === meEmail);

  const textField = (name, val, type="text") => {
    if (!canEdit) return `<div class="muted">${td(val)}</div>`;
    if (type === "date") {
      return `<input class="cellEdit" type="date" data-ticket="${escapeHtml(ticket.ticket_number)}" data-field="${escapeHtml(name)}" value="${escapeHtml(val || "")}" />`;
    }
    return `<input class="cellEdit" type="text" data-ticket="${escapeHtml(ticket.ticket_number)}" data-field="${escapeHtml(name)}" value="${escapeHtml(val ?? "")}" />`;
  };

  // ✅ Change Ownership dropdown (users from profiles)
  const ownershipField = () => {
    const raw = (ticket.change_ownership || "").trim();
    const selected = resolveOwnershipValue(raw);

    if (!canEdit) {
      // show nice label if it is an email
      if (USERS_BY_EMAIL.has(raw)) return `<div class="muted">${td(userLabelByEmail(raw))}</div>`;
      return `<div class="muted">${td(raw)}</div>`;
    }

    let opts = `<option value="">—</option>`;

    // keep legacy value visible if it's not in list
    if (raw && !USERS_BY_EMAIL.has(selected)) {
      opts += `<option value="${escapeHtml(raw)}" selected>${escapeHtml(raw)} (legacy)</option>`;
    }

    opts += USERS.map(u => {
      const label = u.display_name ? `${u.display_name} (${u.email})` : u.email;
      const sel = u.email === selected ? "selected" : "";
      return `<option value="${escapeHtml(u.email)}" ${sel}>${escapeHtml(label)}</option>`;
    }).join("");

    return `
      <select class="cellSelect"
        data-ticket="${escapeHtml(ticket.ticket_number)}"
        data-field="change_ownership">
        ${opts}
      </select>
    `;
  };

  // ✅ Ticket Status dropdown (from ticket_statuses)
  const statusField = () => {
    const cur = (ticket.ticket_status || "").trim();

    if (!canEdit) return `<div class="muted">${td(cur)}</div>`;

    let opts = `<option value="">—</option>`;

    // keep current value visible even if admin deactivated it
    if (cur && !STATUSES.includes(cur)) {
      opts += `<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)} (legacy)</option>`;
    }

    opts += STATUSES.map(s => {
      const sel = s === cur ? "selected" : "";
      return `<option value="${escapeHtml(s)}" ${sel}>${escapeHtml(s)}</option>`;
    }).join("");

    return `
      <select class="cellSelect"
        data-ticket="${escapeHtml(ticket.ticket_number)}"
        data-field="ticket_status">
        ${opts}
      </select>
    `;
  };

  return {
    change_ownership: ownershipField(),
    follow_up_action_count_remarks: textField("follow_up_action_count_remarks", ticket.follow_up_action_count_remarks),
    next_follow_up_date: textField("next_follow_up_date", ticket.next_follow_up_date, "date"),
    ticket_status: statusField(),
    derivedAction: td(derived?.actionText || ""),
    derivedParent: td(derived?.parentText || ""),
    derivedActionWeek: td(derived?.actionWeek ?? 0),
    derivedParentWeek: td(derived?.parentWeek ?? 0),
  };
}

async function getIsAdmin(meEmail){
  if (!meEmail) return false;
  const { data, error } = await sb.from("profiles").select("role").eq("email", meEmail).maybeSingle();
  if (error) return false;
  return (data?.role || "") === "admin";
}

async function loadPage(){
  hideMsg();
  rowsEl.innerHTML = `<tr><td colspan="24">Loading...</td></tr>`;

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await buildBaseQuery({ includeCount:true }).range(from, to);
  if (error) {
    rowsEl.innerHTML = `<tr><td colspan="24">${escapeHtml(error.message)}</td></tr>`;
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
  const meEmail = me?.email || "";
  const isAdmin = await getIsAdmin(meEmail);

  const ticketNumbers = data.map(x => x.ticket_number);
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
        <td>${escapeHtml(fmtDateTime(t.raised_at))}</td>
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

        <td><button class="btn danger delBtn" data-ticket="${escapeHtml(t.ticket_number)}">Delete</button></td>
      </tr>
    `;
  }).join("");

  // ✅ inline edit:
  // - inputs/datepicker: blur
  rowsEl.querySelectorAll("input.cellEdit").forEach(inp => {
    inp.addEventListener("blur", async () => {
      const ticket_number = inp.dataset.ticket;
      const field = inp.dataset.field;
      const value = inp.value;

      const patch = {};
      patch[field] = value || null;

      const { error } = await sb.from("tickets").update(patch).eq("ticket_number", ticket_number);
      if (error) show(error.message, true);
    });
  });

  // - selects: change
  rowsEl.querySelectorAll("select.cellSelect").forEach(sel => {
    sel.addEventListener("change", async () => {
      const ticket_number = sel.dataset.ticket;
      const field = sel.dataset.field;
      const value = sel.value;

      const patch = {};
      patch[field] = value || null;

      const { error } = await sb.from("tickets").update(patch).eq("ticket_number", ticket_number);
      if (error) show(error.message, true);
    });
  });

  // delete
  rowsEl.querySelectorAll(".delBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ticket_number = btn.dataset.ticket;
      if (!confirm(`Delete ticket ${ticket_number}?`)) return;

      const { error } = await sb.from("tickets").delete().eq("ticket_number", ticket_number);
      if (error) return show(error.message, true);

      await loadPage();
    });
  });
}

async function exportAllFiltered() {
  hideMsg();
  show("Preparing export…");

  const headers = [
    "Ticket Number",
    "Student Name",
    "Issue Raised By",
    "Department",
    "Subject",
    "Category",
    "Description",
    "Date",
    "Reporter",
    "Mobile Number",
    "Date Of Incident",
    "Time Of Incident",
    "Incident Reported By",
    "Location Of Incident",
    "Class",
    "Section",
    "Scholar Number",
    "Segment",
    "Point Of Contact",
    "Point Of Resolution",
    "Keep In Loop",
    "Change Ownership",
    "Follow-Up/Action Dates",
    "Follow-Up/Action Type",
    "Follow-Up/Action Count And Remarks",
    "Next Follow Up Date",
    "Psych Counseling Status",
    "Card Status",
    "Punishment Execution Remark",
    "Ticket Status",
    "Parent Notified On Conclusion",
    "POC Follow Up Dates",
    "POC Follow Up Remarks",
    "Resolution Date",
    "Auditor Email",
    "Audit Date",
    "Audit Score",
    "Audit Categories",
    "Audit Remarks",
    "Comments by POR",
    "Ticket Action Comments (filled by formula, don't enter anything in this column)",
    "Ticket Parent Updates (filled by formula, don't enter anything in this column)",
    "#Ticket Actions this week",
    "#Ticket Parent Updates this week",
  ];

  const pick = (obj, keys) => {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return "";
  };
  const td2 = (v) => (v ?? "").toString();

  // Fetch all rows (paged)
  const all = [];
  let offset = 0;
  const chunk = 1000;

  while (true) {
    const { data, error } = await buildBaseQuery().range(offset, offset + chunk - 1);
    if (error) return show(error.message, true);
    if (!data?.length) break;
    all.push(...data);
    offset += data.length;
    if (data.length < chunk) break;
  }

  if (!all.length) return show("No rows to export.", true);

  // Weekly counts from touchpoints
  const derived = await fetchDerivedForTickets(all.map(x => x.ticket_number));

  // Build AOA (Array-of-Arrays) with fixed headers => ALWAYS exports all columns
  const aoa = [headers];

  for (const t of all) {
    const d = derived.get(t.ticket_number) || { actionWeek: 0, parentWeek: 0 };

    const auditCatsVal = pick(t, ["audit_categories"]);
    const auditCats =
      Array.isArray(auditCatsVal) ? auditCatsVal.join(", ")
      : (typeof auditCatsVal === "object" && auditCatsVal) ? JSON.stringify(auditCatsVal)
      : td2(auditCatsVal);

    const rowObj = {
      "Ticket Number": td2(pick(t, ["ticket_number"])),
      "Student Name": td2(pick(t, ["student_child_name", "student_name"])),
      "Issue Raised By": td2(pick(t, ["issue_raised_by"])),
      "Department": td2(pick(t, ["department"])),
      "Subject": td2(pick(t, ["subject"])),
      "Category": td2(pick(t, ["category"])),
      "Description": td2(pick(t, ["description"])),
      "Date": fmtDateTime(pick(t, ["raised_at"])),
      "Reporter": td2(pick(t, ["reporter_email"])),
      "Mobile Number": td2(pick(t, ["reporter_mobile"])),

      "Date Of Incident": td2(pick(t, ["date_of_incident"])),
      "Time Of Incident": td2(pick(t, ["time_of_incident"])),
      "Incident Reported By": td2(pick(t, ["incident_reported_by"])),
      "Location Of Incident": td2(pick(t, ["location_of_incident"])),

      "Class": td2(pick(t, ["class_name"])),
      "Section": td2(pick(t, ["section"])),
      "Scholar Number": td2(pick(t, ["scholar_number", "sr_number"])),
      "Segment": td2(pick(t, ["segment"])),

      "Point Of Contact": td2(pick(t, ["point_of_contact"])),
      "Point Of Resolution": td2(pick(t, ["point_of_resolution"])),
      "Keep In Loop": td2(pick(t, ["keep_in_loop"])),

      "Change Ownership": td2(pick(t, ["change_ownership"])),

      "Follow-Up/Action Dates": td2(pick(t, ["follow_up_action_dates", "follow_up_dates"])),
      "Follow-Up/Action Type": td2(pick(t, ["follow_up_action_type", "follow_up_type"])),
      "Follow-Up/Action Count And Remarks": td2(pick(t, ["follow_up_action_count_remarks"])),
      "Next Follow Up Date": td2(pick(t, ["next_follow_up_date"])),

      "Psych Counseling Status": td2(pick(t, ["psych_counseling_status", "psychological_counseling_status"])),
      "Card Status": td2(pick(t, ["card_status"])),
      "Punishment Execution Remark": td2(pick(t, ["punishment_execution_remark"])),
      "Ticket Status": td2(pick(t, ["ticket_status"])),

      "Parent Notified On Conclusion": td2(pick(t, ["parent_notified_on_conclusion"])),

      "POC Follow Up Dates": td2(pick(t, ["poc_follow_up_dates"])),
      "POC Follow Up Remarks": td2(pick(t, ["poc_follow_up_remarks"])),

      "Resolution Date": td2(pick(t, ["resolution_date"])),

      "Auditor Email": td2(pick(t, ["auditor_email"])),
      "Audit Date": td2(pick(t, ["audit_date"])),
      "Audit Score": td2(pick(t, ["audit_score"])),
      "Audit Categories": auditCats,
      "Audit Remarks": td2(pick(t, ["audit_remarks"])),
      "Comments by POR": td2(pick(t, ["comments_by_por", "por_comments"])),

      // you asked these should be blank
      "Ticket Action Comments (filled by formula, don't enter anything in this column)": "",
      "Ticket Parent Updates (filled by formula, don't enter anything in this column)": "",

      "#Ticket Actions this week": td2(d.actionWeek ?? 0),
      "#Ticket Parent Updates this week": td2(d.parentWeek ?? 0),
    };

    aoa.push(headers.map(h => rowObj[h] ?? ""));
  }

  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Tickets");

  const name = `Ticket_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
  window.XLSX.writeFile(wb, name);

  show(`Exported ${all.length} rows ✅`);
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
  await loadFilters();               // loads USERS + STATUSES too
  setDefaultRangeLast7Days();
  await loadPage();
})();

applyBtn.addEventListener("click", async () => { page = 0; await loadPage(); });

clearBtn.addEventListener("click", async () => {
  deptFilter.value = "";
  repFilter.value = "";
  ownerFilter.value = ""; // ✅ NEW
  q.value = "";
  setDefaultRangeLast7Days();

  refreshSelect(deptFilter);
  refreshSelect(repFilter);
  refreshSelect(ownerFilter);

  page = 0;
  hideMsg();
  await loadPage();
});

prevBtn.addEventListener("click", async () => { if (page > 0) { page--; await loadPage(); } });
nextBtn.addEventListener("click", async () => { page++; await loadPage(); });

exportBtn.addEventListener("click", exportAllFiltered);

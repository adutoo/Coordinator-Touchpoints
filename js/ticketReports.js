// js/ticketReports.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe } from "./auth.js";
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

// -------------------- DOM --------------------
const sessionFilter = document.getElementById("sessionFilter");

const pocFilter = document.getElementById("pocFilter");
const porFilter = document.getElementById("porFilter");
const ownerFilter = document.getElementById("ownerFilter");

const deptFilter = document.getElementById("deptFilter");
const catFilter = document.getElementById("catFilter");
const subjFilter = document.getElementById("subjFilter");

const classFilter = document.getElementById("classFilter");
const sectionFilter = document.getElementById("sectionFilter");

const repFilter = document.getElementById("repFilter");
const actionsWeekFilter = document.getElementById("actionsWeekFilter");
const parentWeekFilter = document.getElementById("parentWeekFilter");

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

// Ticket status multiselect
const statusMsBtn = document.getElementById("statusMsBtn");
const statusMsText = document.getElementById("statusMsText");
const statusMsPanel = document.getElementById("statusMsPanel");
const statusMsList = document.getElementById("statusMsList");
const statusMsAll = document.getElementById("statusMsAll");
const statusMsClear = document.getElementById("statusMsClear");

const PAGE_SIZE = 50;
let page = 0;
let totalCount = 0;

// multiselect state
let statusOptions = []; // labels
let selectedStatuses = new Set(); // labels
let includeBlankStatus = false; // "(Blank)"

// ownership options for inline dropdown
let ownershipOptions = []; // distinct change_ownership values from tickets

// current user context (for edit permission)
let __meEmail = "";
let __isAdmin = false;

// -------------------- Busy wrapper (avoid nested popups) --------------------
let __busyDepth = 0;
async function runBusy(title, fn) {
  if (__busyDepth > 0) return await fn();
  __busyDepth++;
  try {
    return await withBusy(title, fn);
  } finally {
    __busyDepth--;
  }
}

// -------------------- UI helpers --------------------
function show(text, isError = false) {
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.textContent = text;
}
function hideMsg() { msg.style.display = "none"; }

function escText(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function escAttr(s) {
  return escText(s).replaceAll('"', "&quot;");
}
function td(v) { return (v ?? "").toString(); }

function pad(n) { return String(n).padStart(2, "0"); }
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function toStartISO(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return null;
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function isoWeekNumber(dateObj) {
  const now = new Date(dateObj);
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// -------------------- Session UI --------------------
function initSessionUI() {
  if (!sessionFilter) return;

  const sessions = listSessions({ past: 6, future: 1 });
  sessionFilter.innerHTML = sessions.map(s => `<option value="${escAttr(s)}">${escText(s)}</option>`).join("");

  const cur = getSessionLabel();
  sessionFilter.value = cur;

  enhanceSelect(sessionFilter, { placeholder: "Select session...", search: true, searchThreshold: 0 });
  refreshSelect(sessionFilter);

  // Default dates = session boundaries
  applySessionToDateInputs(fromDate, toDate, cur);

  sessionFilter.addEventListener("change", async () => {
    const val = sessionFilter.value;
    setSessionLabel(val);

    // Reset dates to session boundaries
    applySessionToDateInputs(fromDate, toDate, val);

    page = 0;
    await loadPage();
  });
}

// -------------------- Fetch helpers (paged) --------------------
async function fetchDistinctPaged(table, col, { where = null, order = col } = {}) {
  const set = new Set();
  const chunk = 1000;
  let offset = 0;

  while (true) {
    let query = sb.from(table).select(col).order(order).range(offset, offset + chunk - 1);
    if (where) {
      for (const w of where) {
        if (w.op === "eq") query = query.eq(w.col, w.val);
        if (w.op === "is") query = query.is(w.col, w.val);
      }
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;

    for (const r of data) {
      const v = r?.[col];
      if (v !== null && v !== undefined && String(v).trim() !== "") set.add(String(v));
    }

    offset += data.length;
    if (data.length < chunk) break;
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// -------------------- Ticket Status Multiselect --------------------
function closeStatusMs() { statusMsPanel.style.display = "none"; }
function openStatusMs() { statusMsPanel.style.display = "block"; }

function renderStatusMsButton() {
  const n = selectedStatuses.size + (includeBlankStatus ? 1 : 0);
  if (n === 0) { statusMsText.textContent = "All"; return; }
  if (n === 1) {
    statusMsText.textContent = includeBlankStatus ? "(Blank)" : Array.from(selectedStatuses)[0];
    return;
  }
  statusMsText.textContent = `${n} selected`;
}

function renderStatusMsList() {
  const items = [
    { label: "(Blank)", key: "__blank__" },
    ...statusOptions.map(s => ({ label: s, key: s }))
  ];

  statusMsList.innerHTML = items.map(it => {
    const checked = it.key === "__blank__" ? includeBlankStatus : selectedStatuses.has(it.key);
    return `
      <div class="ms-item" data-key="${escAttr(it.key)}">
        <input type="checkbox" ${checked ? "checked" : ""} />
        <div>${escText(it.label)}</div>
      </div>
    `;
  }).join("");

  statusMsList.querySelectorAll(".ms-item").forEach(row => {
    row.addEventListener("click", () => {
      const key = row.getAttribute("data-key");
      if (!key) return;

      if (key === "__blank__") includeBlankStatus = !includeBlankStatus;
      else {
        if (selectedStatuses.has(key)) selectedStatuses.delete(key);
        else selectedStatuses.add(key);
      }

      renderStatusMsList();
      renderStatusMsButton();
    });
  });

  renderStatusMsButton();
}

statusMsBtn.addEventListener("click", () => {
  const isOpen = statusMsPanel.style.display === "block";
  if (isOpen) closeStatusMs();
  else openStatusMs();
});

statusMsAll.addEventListener("click", () => {
  selectedStatuses.clear();
  includeBlankStatus = false;
  renderStatusMsList();
  renderStatusMsButton();
  closeStatusMs();
});

statusMsClear.addEventListener("click", () => {
  selectedStatuses.clear();
  includeBlankStatus = false;
  renderStatusMsList();
  renderStatusMsButton();
});

document.addEventListener("click", (e) => {
  const inside = e.target.closest("#statusMsWrap");
  if (!inside) closeStatusMs();
});

// -------------------- Filters load --------------------
async function loadFilters() {
  await runBusy("Loading filters…", async () => {
    setBusyProgress(10, "Loading validation lists…");

    // Departments (active)
    const dR = await sb
      .from("ticket_departments")
      .select("label")
      .eq("is_active", true)
      .order("sort_order")
      .order("label");
    if (dR.error) return show(dR.error.message, true);

    deptFilter.innerHTML =
      `<option value="">All</option>` +
      (dR.data || []).map(x => `<option value="${escAttr(x.label)}">${escText(x.label)}</option>`).join("");

    // Subjects (active)
    const sR = await sb
      .from("ticket_subjects")
      .select("label")
      .eq("is_active", true)
      .order("sort_order")
      .order("label");
    if (sR.error) return show(sR.error.message, true);

    subjFilter.innerHTML =
      `<option value="">All</option>` +
      (sR.data || []).map(x => `<option value="${escAttr(x.label)}">${escText(x.label)}</option>`).join("");

    // Categories (active) - distinct labels
    const cats = await fetchDistinctPaged("ticket_categories", "label", {
      where: [{ op: "eq", col: "is_active", val: true }],
      order: "label",
    });
    catFilter.innerHTML =
      `<option value="">All</option>` +
      cats.map(x => `<option value="${escAttr(x)}">${escText(x)}</option>`).join("");

    setBusyProgress(35, "Loading distinct values from tickets…");

    // Reporter / POC / POR / Ownership / Class / Section
    const [rep, poc, por, own, cls, sec] = await Promise.all([
      fetchDistinctPaged("tickets", "reporter_email", { order: "reporter_email" }),
      fetchDistinctPaged("tickets", "point_of_contact", { order: "point_of_contact" }),
      fetchDistinctPaged("tickets", "point_of_resolution", { order: "point_of_resolution" }),
      fetchDistinctPaged("tickets", "change_ownership", { order: "change_ownership" }),
      fetchDistinctPaged("tickets", "class_name", { order: "class_name" }),
      fetchDistinctPaged("tickets", "section", { order: "section" }),
    ]);

    // store for inline dropdown options
    ownershipOptions = (own || []).filter(Boolean);

    repFilter.innerHTML = `<option value="">All</option>` + rep.map(x => `<option value="${escAttr(x)}">${escText(x)}</option>`).join("");
    pocFilter.innerHTML = `<option value="">All</option>` + poc.map(x => `<option value="${escAttr(x)}">${escText(x)}</option>`).join("");
    porFilter.innerHTML = `<option value="">All</option>` + por.map(x => `<option value="${escAttr(x)}">${escText(x)}</option>`).join("");
    ownerFilter.innerHTML =
      `<option value="">All</option>` +
      [`(Unassigned)`, ...ownershipOptions].map(x => `<option value="${escAttr(x)}">${escText(x)}</option>`).join("");

    classFilter.innerHTML = `<option value="">All</option>` + cls.map(x => `<option value="${escAttr(x)}">${escText(x)}</option>`).join("");
    sectionFilter.innerHTML = `<option value="">All</option>` + sec.map(x => `<option value="${escAttr(x)}">${escText(x)}</option>`).join("");

    // Week count filters (fixed choices)
    const wkOpts = [
      { v: "", t: "All" },
      { v: "0", t: "0" },
      { v: "1", t: "1" },
      { v: "2", t: "2" },
      { v: "3", t: "3" },
      { v: "4", t: "4" },
      { v: "5+", t: "5+" },
    ];
    actionsWeekFilter.innerHTML = wkOpts.map(o => `<option value="${escAttr(o.v)}">${escText(o.t)}</option>`).join("");
    parentWeekFilter.innerHTML = wkOpts.map(o => `<option value="${escAttr(o.v)}">${escText(o.t)}</option>`).join("");

    setBusyProgress(60, "Loading ticket statuses…");

    const stR = await sb
      .from("ticket_statuses")
      .select("label")
      .eq("is_active", true)
      .order("sort_order")
      .order("label");
    if (stR.error) return show(stR.error.message, true);

    statusOptions = (stR.data || []).map(x => x.label).filter(Boolean);
    selectedStatuses.clear();
    includeBlankStatus = false;
    renderStatusMsList();
    renderStatusMsButton();

    setBusyProgress(85, "Enhancing dropdowns…");

    const mk = (el, ph) => enhanceSelect(el, { placeholder: ph, search: true, searchThreshold: 0 });

    mk(pocFilter, "All");
    mk(porFilter, "All");
    mk(ownerFilter, "All");

    mk(deptFilter, "All");
    mk(catFilter, "All");
    mk(subjFilter, "All");

    mk(classFilter, "All");
    mk(sectionFilter, "All");

    mk(repFilter, "All");
    mk(actionsWeekFilter, "All");
    mk(parentWeekFilter, "All");

    setBusyProgress(100, "Done");
  });
}

// -------------------- Query builder (SESSION-AWARE) --------------------
function buildServerQuery({ includeCount = false } = {}) {
  let query = sb
    .from("tickets")
    .select("*", includeCount ? { count: "exact" } : undefined)
    .order("raised_at", { ascending: false });

  // Line 1 filters
  if (pocFilter.value) query = query.eq("point_of_contact", pocFilter.value);
  if (porFilter.value) query = query.eq("point_of_resolution", porFilter.value);
  if (ownerFilter.value) {
    if (ownerFilter.value === "(Unassigned)") {
      query = query.or("change_ownership.is.null,change_ownership.eq.");
    } else {
      query = query.eq("change_ownership", ownerFilter.value);
    }
  }

  // Line 2 filters
  if (deptFilter.value) query = query.eq("department", deptFilter.value);
  if (catFilter.value) query = query.eq("category", catFilter.value);
  if (subjFilter.value) query = query.eq("subject", subjFilter.value);

  // Line 3 filters
  if (classFilter.value) query = query.eq("class_name", classFilter.value);
  if (sectionFilter.value) query = query.eq("section", sectionFilter.value);

  // Reporter
  if (repFilter.value) query = query.eq("reporter_email", repFilter.value);

  // ✅ Session + Date range (To is end-exclusive)
  const sessLabel = sessionFilter?.value || getSessionLabel();
  const sess = getSessionRange(sessLabel);

  const startISO = toStartISO(fromDate.value);
  const endExclusiveISO = toStartISO(toDate.value);

  const start = startISO ? new Date(startISO) : new Date(sess.start);
  const end = endExclusiveISO ? new Date(endExclusiveISO) : new Date(sess.end);

  const clamped = clampRangeToSession(start, end, sessLabel);

  query = query.gte("raised_at", clamped.from.toISOString());
  query = query.lt("raised_at", clamped.to.toISOString());

  // Search
  const text = q.value.trim();
  if (text) {
    const esc = text.replace(/,/g, " ");
    query = query.or(
      `ticket_number.ilike.%${esc}%,student_child_name.ilike.%${esc}%,student_name.ilike.%${esc}%,category.ilike.%${esc}%`
    );
  }

  // Ticket Status (multi) - server side only when safe:
  const hasSome = selectedStatuses.size > 0;
  const hasBlank = includeBlankStatus === true;

  if (hasBlank && !hasSome) {
    query = query.or("ticket_status.is.null,ticket_status.eq.");
  } else if (!hasBlank && hasSome) {
    query = query.in("ticket_status", Array.from(selectedStatuses));
  }

  return query;
}

function derivedFiltersActive() {
  const a = actionsWeekFilter.value;
  const p = parentWeekFilter.value;
  return !!(a && a !== "") || !!(p && p !== "");
}

function statusNeedsClientMode() {
  const hasSome = selectedStatuses.size > 0;
  const hasBlank = includeBlankStatus === true;
  return hasBlank && hasSome;
}

function matchCountFilter(val, n) {
  if (!val) return true;
  if (val === "5+") return n >= 5;
  const target = Number(val);
  return n === target;
}

// -------------------- Derived fetch (CHUNKED) --------------------
async function fetchDerivedForTickets(ticketNumbers) {
  const map = new Map();
  if (!ticketNumbers?.length) return map;

  const objectives = ["Ticket: Action", "Ticket: Parent Update"];
  const now = new Date();
  const curWeek = isoWeekNumber(now);
  const curYear = now.getFullYear();

  const chunkSize = 200;
  for (let i = 0; i < ticketNumbers.length; i += chunkSize) {
    const batch = ticketNumbers.slice(i, i + chunkSize);

    const { data, error } = await sb
      .from("touchpoints")
      .select("ticket_number,objective,comments_concat,week,year,touch_timestamp")
      .in("ticket_number", batch)
      .in("objective", objectives)
      .order("touch_timestamp", { ascending: true });

    if (error) {
      console.warn("Derived fetch failed:", error.message);
      continue;
    }

    for (const r of (data || [])) {
      const k = r.ticket_number;
      if (!map.has(k)) map.set(k, { action: [], parent: [], actionWeek: 0, parentWeek: 0, actionText: "", parentText: "" });
      const rec = map.get(k);

      if (r.objective === "Ticket: Action") {
        if (r.comments_concat) rec.action.push(String(r.comments_concat));
        if (Number(r.week) === curWeek && Number(r.year) === curYear) rec.actionWeek++;
      } else if (r.objective === "Ticket: Parent Update") {
        if (r.comments_concat) rec.parent.push(String(r.comments_concat));
        if (Number(r.week) === curWeek && Number(r.year) === curYear) rec.parentWeek++;
      }
    }
  }

  for (const [k, v] of map.entries()) {
    v.actionText = v.action.join("\n");
    v.parentText = v.parent.join("\n");
  }

  return map;
}

// -------------------- Render helpers --------------------
function buildSelectHtml({ ticketNumber, fieldName, value, options, placeholder, disabled }) {
  const cur = (value ?? "").toString().trim();
  const seen = new Set();
  const opts = [];

  // blank option
  opts.push(`<option value="">${escText(placeholder)}</option>`);

  for (const o of (options || [])) {
    const v = String(o ?? "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    opts.push(`<option value="${escAttr(v)}"${v === cur ? " selected" : ""}>${escText(v)}</option>`);
  }

  // ensure current is visible even if not in list
  if (cur && !seen.has(cur)) {
    opts.push(`<option value="${escAttr(cur)}" selected>${escText(cur)}</option>`);
  }

  return `
    <select class="cellSelect" data-ticket="${escAttr(ticketNumber)}" data-field="${escAttr(fieldName)}" ${disabled ? "disabled" : ""}>
      ${opts.join("")}
    </select>
  `;
}

function renderEditable(ticket, meEmail, derived) {
  const canEdit =
    __isAdmin ||
    (ticket.point_of_contact === meEmail) ||
    (ticket.point_of_resolution === meEmail);

  const ticketNo = ticket.ticket_number;

  const inputText = (name, val) => `
    <input class="cellEdit" type="text"
      data-ticket="${escAttr(ticketNo)}" data-field="${escAttr(name)}"
      value="${escAttr(val ?? "")}" ${canEdit ? "" : "disabled"} />
  `;

  const inputDate = (name, val) => `
    <input class="cellEdit" type="date"
      data-ticket="${escAttr(ticketNo)}" data-field="${escAttr(name)}"
      value="${escAttr(val ?? "")}" ${canEdit ? "" : "disabled"} />
  `;

  const ownershipDropdown = buildSelectHtml({
    ticketNumber: ticketNo,
    fieldName: "change_ownership",
    value: ticket.change_ownership,
    options: ownershipOptions,
    placeholder: "(Unassigned)",
    disabled: !canEdit,
  });

  const statusDropdown = buildSelectHtml({
    ticketNumber: ticketNo,
    fieldName: "ticket_status",
    value: ticket.ticket_status,
    options: statusOptions,
    placeholder: "(Blank)",
    disabled: !canEdit,
  });

  return {
    change_ownership: ownershipDropdown,
    follow_up_action_count_remarks: inputText("follow_up_action_count_remarks", ticket.follow_up_action_count_remarks),
    next_follow_up_date: inputDate("next_follow_up_date", ticket.next_follow_up_date),
    ticket_status: statusDropdown,

    derivedAction: td(derived?.actionText || ""),
    derivedParent: td(derived?.parentText || ""),
    derivedActionWeek: td(derived?.actionWeek ?? 0),
    derivedParentWeek: td(derived?.parentWeek ?? 0),
  };
}

function bindInlineEdits() {
  // inputs (blur) + date/select (change)
  rowsEl.querySelectorAll(".cellEdit, .cellSelect").forEach(el => {
    const ticket_number = el.dataset.ticket;
    const field = el.dataset.field;

    if (!ticket_number || !field) return;
    if (el.disabled) return;

    const save = async () => {
      const value = (el.value ?? "").toString().trim();
      const patch = {};
      patch[field] = value === "" ? null : value;

      await runBusy("Saving…", async () => {
        const { error } = await sb.from("tickets").update(patch).eq("ticket_number", ticket_number);
        if (error) show(error.message, true);
      });
    };

    // selects + date inputs should save on change
    const isSelect = el.classList.contains("cellSelect") || el.tagName === "SELECT";
    const isDate = el.tagName === "INPUT" && el.type === "date";

    if (isSelect || isDate) el.addEventListener("change", save);
    else el.addEventListener("blur", save);
  });

  rowsEl.querySelectorAll(".delBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ticket_number = btn.dataset.ticket;
      if (!confirm(`Delete ticket ${ticket_number}?`)) return;

      await runBusy("Deleting ticket…", async () => {
        const { error } = await sb.from("tickets").delete().eq("ticket_number", ticket_number);
        if (error) return show(error.message, true);
        await loadPage();
      });
    });
  });
}

// -------------------- Data fetch (paged/all) --------------------
async function fetchAllTicketsForClientMode() {
  const all = [];
  const chunk = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await buildServerQuery({ includeCount: false }).range(offset, offset + chunk - 1);
    if (error) throw error;
    if (!data?.length) break;

    all.push(...data);
    offset += data.length;
    if (data.length < chunk) break;
  }

  return all;
}

// -------------------- Main load --------------------
async function loadPage() {
  hideMsg();
  rowsEl.innerHTML = `<tr><td colspan="24">Loading...</td></tr>`;

  const needClient = derivedFiltersActive() || statusNeedsClientMode();
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  await runBusy(needClient ? "Loading tickets (advanced filter)…" : "Loading tickets…", async () => {
    setBusyProgress(10, "Fetching tickets…");

    if (!needClient) {
      const { data, error, count } = await buildServerQuery({ includeCount: true }).range(from, to);
      if (error) {
        rowsEl.innerHTML = `<tr><td colspan="24">${escText(error.message)}</td></tr>`;
        return;
      }

      totalCount = count ?? 0;
      meta.textContent = `Showing ${Math.min(from + 1, totalCount)}–${Math.min(to + 1, totalCount)} of ${totalCount}`;
      pageInfo.textContent = `Page ${page + 1} / ${Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}`;

      prevBtn.disabled = page <= 0;
      nextBtn.disabled = (to + 1) >= totalCount;

      if (!data?.length) {
        rowsEl.innerHTML = `<tr><td colspan="24">No results.</td></tr>`;
        return;
      }

      setBusyProgress(55, "Loading derived weekly counts…");

      const ticketNumbers = data.map(x => x.ticket_number);
      const derivedMap = await fetchDerivedForTickets(ticketNumbers);

      setBusyProgress(85, "Rendering…");
      rowsEl.innerHTML = data.map(t => {
        const d = derivedMap.get(t.ticket_number);
        const e = renderEditable(t, __meEmail, d);

        return `
          <tr>
            <td>${escText(t.ticket_number)}</td>
            <td>${escText(t.student_child_name)}</td>
            <td>${escText(t.issue_raised_by)}</td>
            <td>${escText(t.department)}</td>
            <td>${escText(t.subject)}</td>
            <td>${escText(t.category)}</td>
            <td style="max-width:420px; white-space:pre-wrap;">${escText(t.description)}</td>
            <td>${escText(fmtDateTime(t.raised_at))}</td>
            <td>${escText(t.reporter_email)}</td>
            <td>${escText(t.reporter_mobile)}</td>

            <td>${escText(t.class_name)}</td>
            <td>${escText(t.section)}</td>
            <td>${escText(t.scholar_number)}</td>

            <td>${escText(t.point_of_contact)}</td>
            <td>${escText(t.point_of_resolution)}</td>

            <td>${e.change_ownership}</td>
            <td>${e.follow_up_action_count_remarks}</td>
            <td>${e.next_follow_up_date}</td>
            <td>${e.ticket_status}</td>

            <td style="white-space:pre-wrap; max-width:420px;">${escText(e.derivedAction)}</td>
            <td style="white-space:pre-wrap; max-width:420px;">${escText(e.derivedParent)}</td>
            <td>${escText(e.derivedActionWeek)}</td>
            <td>${escText(e.derivedParentWeek)}</td>

            <td><button class="btn danger delBtn" data-ticket="${escAttr(t.ticket_number)}">Delete</button></td>
          </tr>
        `;
      }).join("");

      bindInlineEdits();
      setBusyProgress(100, "Done");
      return;
    }

    // -------- CLIENT MODE --------
    const allTickets = await fetchAllTicketsForClientMode();

    setBusyProgress(40, "Loading derived weekly counts…");
    const allNums = allTickets.map(x => x.ticket_number);
    const derivedMap = await fetchDerivedForTickets(allNums);

    setBusyProgress(70, "Applying advanced filters…");
    const aVal = actionsWeekFilter.value;
    const pVal = parentWeekFilter.value;

    let filtered = allTickets.filter(t => {
      const d = derivedMap.get(t.ticket_number) || { actionWeek: 0, parentWeek: 0 };
      if (!matchCountFilter(aVal, d.actionWeek ?? 0)) return false;
      if (!matchCountFilter(pVal, d.parentWeek ?? 0)) return false;

      const hasSome = selectedStatuses.size > 0;
      const hasBlank = includeBlankStatus === true;
      if (hasSome || hasBlank) {
        const st = (t.ticket_status ?? "").toString().trim();
        const isBlank = st === "";
        const okNonBlank = hasSome ? selectedStatuses.has(st) : false;
        const okBlank = hasBlank ? isBlank : false;
        if (!(okNonBlank || okBlank)) return false;
      }

      return true;
    });

    totalCount = filtered.length;

    const maxPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    if (page >= maxPages) page = maxPages - 1;

    const fFrom = page * PAGE_SIZE;
    const fTo = Math.min(fFrom + PAGE_SIZE, totalCount);

    meta.textContent = `Showing ${Math.min(fFrom + 1, totalCount)}–${Math.min(fTo, totalCount)} of ${totalCount}`;
    pageInfo.textContent = `Page ${page + 1} / ${maxPages}`;

    prevBtn.disabled = page <= 0;
    nextBtn.disabled = (fTo) >= totalCount;

    const slice = filtered.slice(fFrom, fTo);

    if (!slice.length) {
      rowsEl.innerHTML = `<tr><td colspan="24">No results.</td></tr>`;
      setBusyProgress(100, "Done");
      return;
    }

    setBusyProgress(85, "Rendering…");
    rowsEl.innerHTML = slice.map(t => {
      const d = derivedMap.get(t.ticket_number);
      const e = renderEditable(t, __meEmail, d);

      return `
        <tr>
          <td>${escText(t.ticket_number)}</td>
          <td>${escText(t.student_child_name)}</td>
          <td>${escText(t.issue_raised_by)}</td>
          <td>${escText(t.department)}</td>
          <td>${escText(t.subject)}</td>
          <td>${escText(t.category)}</td>
          <td style="max-width:420px; white-space:pre-wrap;">${escText(t.description)}</td>
          <td>${escText(fmtDateTime(t.raised_at))}</td>
          <td>${escText(t.reporter_email)}</td>
          <td>${escText(t.reporter_mobile)}</td>

          <td>${escText(t.class_name)}</td>
          <td>${escText(t.section)}</td>
          <td>${escText(t.scholar_number)}</td>

          <td>${escText(t.point_of_contact)}</td>
          <td>${escText(t.point_of_resolution)}</td>

          <td>${e.change_ownership}</td>
          <td>${e.follow_up_action_count_remarks}</td>
          <td>${e.next_follow_up_date}</td>
          <td>${e.ticket_status}</td>

          <td style="white-space:pre-wrap; max-width:420px;">${escText(e.derivedAction)}</td>
          <td style="white-space:pre-wrap; max-width:420px;">${escText(e.derivedParent)}</td>
          <td>${escText(e.derivedActionWeek)}</td>
          <td>${escText(e.derivedParentWeek)}</td>

          <td><button class="btn danger delBtn" data-ticket="${escAttr(t.ticket_number)}">Delete</button></td>
        </tr>
      `;
    }).join("");

    bindInlineEdits();
    setBusyProgress(100, "Done");
  });
}

// -------------------- Export --------------------
async function exportAllFiltered() {
  hideMsg();

  await runBusy("Preparing export…", async () => {
    setBusyProgress(10, "Fetching all filtered tickets…");

    const allTickets = await fetchAllTicketsForClientMode();

    setBusyProgress(45, "Loading derived weekly counts…");
    const derived = await fetchDerivedForTickets(allTickets.map(x => x.ticket_number));

    setBusyProgress(70, "Applying advanced filters…");
    const aVal = actionsWeekFilter.value;
    const pVal = parentWeekFilter.value;

    let filtered = allTickets.filter(t => {
      const d = derived.get(t.ticket_number) || { actionWeek: 0, parentWeek: 0 };
      if (!matchCountFilter(aVal, d.actionWeek ?? 0)) return false;
      if (!matchCountFilter(pVal, d.parentWeek ?? 0)) return false;

      const hasSome = selectedStatuses.size > 0;
      const hasBlank = includeBlankStatus === true;
      if (hasSome || hasBlank) {
        const st = (t.ticket_status ?? "").toString().trim();
        const isBlank = st === "";
        const okNonBlank = hasSome ? selectedStatuses.has(st) : false;
        const okBlank = hasBlank ? isBlank : false;
        if (!(okNonBlank || okBlank)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      show("No rows to export.", true);
      setBusyProgress(100, "Done");
      return;
    }

    setBusyProgress(85, "Building XLSX…");

    const HEADER = [
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

      // ✅ these were missing / empty earlier — now filled from derived touchpoints
      "Ticket Action Comments",
      "Ticket Parent Updates",

      // ✅ exact names you asked for
      "#Actions this week",
      "#Parent Updates this week",
    ];

    const rows = filtered.map(t => {
      const d = derived.get(t.ticket_number) || { actionWeek: 0, parentWeek: 0, actionText: "", parentText: "" };

      return {
        "Ticket Number": td(t.ticket_number),
        "Student Name": td(t.student_child_name),
        "Issue Raised By": td(t.issue_raised_by),
        "Department": td(t.department),
        "Subject": td(t.subject),
        "Category": td(t.category),
        "Description": td(t.description),
        "Date": fmtDateTime(t.raised_at),
        "Reporter": td(t.reporter_email),
        "Mobile Number": td(t.reporter_mobile),

        "Date Of Incident": td(t.date_of_incident),
        "Time Of Incident": td(t.time_of_incident),
        "Incident Reported By": td(t.incident_reported_by),
        "Location Of Incident": td(t.location_of_incident),

        "Class": td(t.class_name),
        "Section": td(t.section),
        "Scholar Number": td(t.scholar_number),
        "Segment": td(t.segment),

        "Point Of Contact": td(t.point_of_contact),
        "Point Of Resolution": td(t.point_of_resolution),
        "Keep In Loop": td(t.keep_in_loop),

        "Change Ownership": td(t.change_ownership),

        "Follow-Up/Action Dates": td(t.follow_up_action_dates),
        "Follow-Up/Action Type": td(t.follow_up_action_type),

        "Follow-Up/Action Count And Remarks": td(t.follow_up_action_count_remarks),
        "Next Follow Up Date": td(t.next_follow_up_date),

        "Psych Counseling Status": td(t.psych_counseling_status),
        "Card Status": td(t.card_status),
        "Punishment Execution Remark": td(t.punishment_execution_remark),

        "Ticket Status": td(t.ticket_status),

        "Parent Notified On Conclusion": td(t.parent_notified_on_conclusion),
        "POC Follow Up Dates": td(t.poc_follow_up_dates),
        "POC Follow Up Remarks": td(t.poc_follow_up_remarks),
        "Resolution Date": td(t.resolution_date),

        "Auditor Email": td(t.auditor_email),
        "Audit Date": td(t.audit_date),
        "Audit Score": td(t.audit_score),
        "Audit Categories": td(t.audit_categories),
        "Audit Remarks": td(t.audit_remarks),

        "Comments by POR": td(t.comments_by_por),

        // ✅ derived values
        "Ticket Action Comments": td(d.actionText ?? ""),
        "Ticket Parent Updates": td(d.parentText ?? ""),

        // ✅ weekly counts
        "#Actions this week": td(d.actionWeek ?? 0),
        "#Parent Updates this week": td(d.parentWeek ?? 0),
      };
    });

    const ws = window.XLSX.utils.json_to_sheet(rows, { header: HEADER });
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Tickets");

    const sessLabel = sessionFilter?.value || getSessionLabel();
    const name = `Ticket_Report_${sessLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    window.XLSX.writeFile(wb, name);

    show(`Exported ${rows.length} rows ✅`);
    setBusyProgress(100, "Done");
  });
}

// -------------------- Boot --------------------
(async () => {
  const nav = await mountNav("ticket_reports");

  // get permission context (admin can edit)
  const me = await getMe();
  __meEmail = me?.email || "";
  __isAdmin = (nav?.profile?.role === "admin");

  initSessionUI();
  await loadFilters();

  // Ensure date inputs are session boundaries if user had blank/changed something
  const sess = sessionFilter?.value || getSessionLabel();
  applySessionToDateInputs(fromDate, toDate, sess);

  await loadPage();
})();

// -------------------- Events --------------------
applyBtn.addEventListener("click", async () => { page = 0; await loadPage(); });

clearBtn.addEventListener("click", async () => {
  pocFilter.value = "";
  porFilter.value = "";
  ownerFilter.value = "";

  deptFilter.value = "";
  catFilter.value = "";
  subjFilter.value = "";

  classFilter.value = "";
  sectionFilter.value = "";

  repFilter.value = "";
  actionsWeekFilter.value = "";
  parentWeekFilter.value = "";

  q.value = "";

  // reset multiselect
  selectedStatuses.clear();
  includeBlankStatus = false;
  renderStatusMsList();
  renderStatusMsButton();

  // reset dates to session boundaries
  const sess = sessionFilter?.value || getSessionLabel();
  applySessionToDateInputs(fromDate, toDate, sess);

  [
    pocFilter, porFilter, ownerFilter,
    deptFilter, catFilter, subjFilter,
    classFilter, sectionFilter,
    repFilter, actionsWeekFilter, parentWeekFilter
  ].forEach(refreshSelect);

  page = 0;
  hideMsg();
  await loadPage();
});

prevBtn.addEventListener("click", async () => { if (page > 0) { page--; await loadPage(); } });
nextBtn.addEventListener("click", async () => { page++; await loadPage(); });

exportBtn.addEventListener("click", exportAllFiltered);

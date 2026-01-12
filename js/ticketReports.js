// js/ticketReports.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy, setBusyProgress } from "./busy.js";

// -------------------- DOM --------------------
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
let includeBlankStatus = false; // checkbox state for "(Blank)"

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
function toEndISO(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return null;
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function isoWeekNumber(dateObj) {
  const now = new Date(dateObj);
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function setDefaultRangeLast7Days() {
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  fromDate.value = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
  toDate.value = `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`;
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
  if (n === 0) {
    statusMsText.textContent = "All";
    return;
  }
  if (n === 1) {
    if (includeBlankStatus) statusMsText.textContent = "(Blank)";
    else statusMsText.textContent = Array.from(selectedStatuses)[0];
    return;
  }
  statusMsText.textContent = `${n} selected`;
}

function renderStatusMsList() {
  // build list with (Blank) + statuses
  const items = [
    { label: "(Blank)", key: "__blank__" },
    ...statusOptions.map(s => ({ label: s, key: s }))
  ];

  statusMsList.innerHTML = items.map(it => {
    const checked =
      it.key === "__blank__" ? includeBlankStatus : selectedStatuses.has(it.key);
    return `
      <div class="ms-item" data-key="${it.key}">
        <input type="checkbox" ${checked ? "checked" : ""} />
        <div>${it.label}</div>
      </div>
    `;
  }).join("");

  statusMsList.querySelectorAll(".ms-item").forEach(row => {
    row.addEventListener("click", (e) => {
      // allow checkbox click too
      const key = row.getAttribute("data-key");
      if (!key) return;

      if (key === "__blank__") {
        includeBlankStatus = !includeBlankStatus;
      } else {
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
      (dR.data || []).map(x => `<option value="${x.label}">${x.label}</option>`).join("");

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
      (sR.data || []).map(x => `<option value="${x.label}">${x.label}</option>`).join("");

    // Categories (active) - distinct labels (since table has issue_raised_by too)
    const cats = await fetchDistinctPaged("ticket_categories", "label", {
      where: [{ op: "eq", col: "is_active", val: true }],
      order: "label",
    });
    catFilter.innerHTML =
      `<option value="">All</option>` +
      cats.map(x => `<option value="${x}">${x}</option>`).join("");

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

    repFilter.innerHTML =
      `<option value="">All</option>` +
      rep.map(x => `<option value="${x}">${x}</option>`).join("");

    pocFilter.innerHTML =
      `<option value="">All</option>` +
      poc.map(x => `<option value="${x}">${x}</option>`).join("");

    porFilter.innerHTML =
      `<option value="">All</option>` +
      por.map(x => `<option value="${x}">${x}</option>`).join("");

    ownerFilter.innerHTML =
      `<option value="">All</option>` +
      [`(Unassigned)`, ...own].map(x => `<option value="${x}">${x}</option>`).join("");

    classFilter.innerHTML =
      `<option value="">All</option>` +
      cls.map(x => `<option value="${x}">${x}</option>`).join("");

    sectionFilter.innerHTML =
      `<option value="">All</option>` +
      sec.map(x => `<option value="${x}">${x}</option>`).join("");

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
    actionsWeekFilter.innerHTML = wkOpts.map(o => `<option value="${o.v}">${o.t}</option>`).join("");
    parentWeekFilter.innerHTML = wkOpts.map(o => `<option value="${o.v}">${o.t}</option>`).join("");

    setBusyProgress(60, "Loading ticket statuses…");

    // Ticket statuses (active) for multiselect
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

    // Enhance selects
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

// -------------------- Query builder --------------------
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

  // Date range
  const start = toStartISO(fromDate.value);
  const end = toEndISO(toDate.value);
  if (start) query = query.gte("raised_at", start);
  if (end) query = query.lte("raised_at", end);

  // Search
  const text = q.value.trim();
  if (text) {
    const esc = text.replace(/,/g, " ");
    query = query.or(
      `ticket_number.ilike.%${esc}%,student_child_name.ilike.%${esc}%,student_name.ilike.%${esc}%,category.ilike.%${esc}%`
    );
  }

  // Ticket Status (multi)
  const hasSome = selectedStatuses.size > 0;
  const hasBlank = includeBlankStatus === true;

  // server-side only when safe:
  // - only blank -> OR null/empty
  // - only non-blank -> IN(...)
  // if blank + nonblank together => client mode
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
  return hasBlank && hasSome; // blank + others together
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

  const chunkSize = 200; // safe for URL length
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
      if (!map.has(k)) {
        map.set(k, { action: [], parent: [], actionWeek: 0, parentWeek: 0 });
      }
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
function renderEditable(ticket, meEmail, derived) {
  const canEdit =
    (ticket.point_of_contact === meEmail) ||
    (ticket.point_of_resolution === meEmail);

  const field = (name, val, type = "text") => {
    if (!canEdit) return `<div class="muted">${td(val)}</div>`;
    if (type === "date") {
      return `<input class="cellEdit" type="date" data-ticket="${ticket.ticket_number}" data-field="${name}" value="${val || ""}" />`;
    }
    return `<input class="cellEdit" type="text" data-ticket="${ticket.ticket_number}" data-field="${name}" value="${td(val)}" />`;
  };

  return {
    change_ownership: field("change_ownership", ticket.change_ownership),
    follow_up_action_count_remarks: field("follow_up_action_count_remarks", ticket.follow_up_action_count_remarks),
    next_follow_up_date: field("next_follow_up_date", ticket.next_follow_up_date, "date"),
    ticket_status: field("ticket_status", ticket.ticket_status),

    derivedAction: td(derived?.actionText || ""),
    derivedParent: td(derived?.parentText || ""),
    derivedActionWeek: td(derived?.actionWeek ?? 0),
    derivedParentWeek: td(derived?.parentWeek ?? 0),
  };
}

function bindInlineEdits() {
  rowsEl.querySelectorAll(".cellEdit").forEach(inp => {
    inp.addEventListener("blur", async () => {
      const ticket_number = inp.dataset.ticket;
      const field = inp.dataset.field;
      const value = inp.value;

      const patch = {};
      patch[field] = value || null;

      await runBusy("Saving…", async () => {
        const { error } = await sb.from("tickets").update(patch).eq("ticket_number", ticket_number);
        if (error) show(error.message, true);
      });
    });
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
        rowsEl.innerHTML = `<tr><td colspan="24">${error.message}</td></tr>`;
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
      const me = await getMe();
      const meEmail = me?.email || "";

      const ticketNumbers = data.map(x => x.ticket_number);
      const derivedMap = await fetchDerivedForTickets(ticketNumbers);

      setBusyProgress(85, "Rendering…");
      rowsEl.innerHTML = data.map(t => {
        const d = derivedMap.get(t.ticket_number);
        const e = renderEditable(t, meEmail, d);

        return `
          <tr>
            <td>${td(t.ticket_number)}</td>
            <td>${td(t.student_child_name)}</td>
            <td>${td(t.issue_raised_by)}</td>
            <td>${td(t.department)}</td>
            <td>${td(t.subject)}</td>
            <td>${td(t.category)}</td>
            <td style="max-width:420px; white-space:pre-wrap;">${td(t.description)}</td>
            <td>${fmtDateTime(t.raised_at)}</td>
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

            <td><button class="btn danger delBtn" data-ticket="${t.ticket_number}">Delete</button></td>
          </tr>
        `;
      }).join("");

      bindInlineEdits();
      setBusyProgress(100, "Done");
      return;
    }

    // -------- CLIENT MODE (for derived filters or blank+multi status) --------
    const allTickets = await fetchAllTicketsForClientMode();

    setBusyProgress(40, "Loading derived weekly counts…");
    const allNums = allTickets.map(x => x.ticket_number);
    const derivedMap = await fetchDerivedForTickets(allNums);

    setBusyProgress(70, "Applying advanced filters…");
    const aVal = actionsWeekFilter.value;
    const pVal = parentWeekFilter.value;

    // apply derived filters
    let filtered = allTickets.filter(t => {
      const d = derivedMap.get(t.ticket_number) || { actionWeek: 0, parentWeek: 0 };
      if (!matchCountFilter(aVal, d.actionWeek ?? 0)) return false;
      if (!matchCountFilter(pVal, d.parentWeek ?? 0)) return false;

      // status filter when blank+others (or blank-only already handled server-side but ok)
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

    // already ordered by raised_at desc from server query, so keep order
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

    const me = await getMe();
    const meEmail = me?.email || "";

    setBusyProgress(85, "Rendering…");
    rowsEl.innerHTML = slice.map(t => {
      const d = derivedMap.get(t.ticket_number);
      const e = renderEditable(t, meEmail, d);

      return `
        <tr>
          <td>${td(t.ticket_number)}</td>
          <td>${td(t.student_child_name)}</td>
          <td>${td(t.issue_raised_by)}</td>
          <td>${td(t.department)}</td>
          <td>${td(t.subject)}</td>
          <td>${td(t.category)}</td>
          <td style="max-width:420px; white-space:pre-wrap;">${td(t.description)}</td>
          <td>${fmtDateTime(t.raised_at)}</td>
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

          <td><button class="btn danger delBtn" data-ticket="${t.ticket_number}">Delete</button></td>
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

    // Export uses CLIENT MODE logic always (so it matches filters exactly)
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

      // status multi
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

    // NOTE: You earlier asked many headers even if empty -> we include them.
    // For the two "formula" columns, we export them EMPTY as you requested.
    const rows = filtered.map(t => {
      const d = derived.get(t.ticket_number) || { actionWeek: 0, parentWeek: 0 };

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

        // You asked these columns even if empty:
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

        // Formula columns (export EMPTY)
        "Ticket Action Comments (filled by formula, don't enter anything in this column)": "",
        "Ticket Parent Updates (filled by formula, don't enter anything in this column)": "",

        "#Ticket Actions this week": td(d.actionWeek ?? 0),
        "#Ticket Parent Updates this week": td(d.parentWeek ?? 0),
      };
    });

    const ws = window.XLSX.utils.json_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Tickets");

    const name = `Ticket_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    window.XLSX.writeFile(wb, name);

    show(`Exported ${rows.length} rows ✅`);
    setBusyProgress(100, "Done");
  });
}

// -------------------- Boot --------------------
(async () => {
  await mountNav("ticket-reports");
  await loadFilters();
  setDefaultRangeLast7Days();
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
  setDefaultRangeLast7Days();

  // reset multiselect
  selectedStatuses.clear();
  includeBlankStatus = false;
  renderStatusMsList();
  renderStatusMsButton();

  // refresh custom selects
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

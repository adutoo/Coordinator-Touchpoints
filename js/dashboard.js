// js/dashboard.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy, setBusyProgress } from "./busy.js";

const kpisEl = document.getElementById("kpis");
const recentRows = document.getElementById("recentRows");
const recentTicketsRows = document.getElementById("recentTicketsRows");

const compToday = document.getElementById("compToday");
const compWeek = document.getElementById("compWeek");
const compMonth = document.getElementById("compMonth");

const adminFilterCard = document.getElementById("adminFilterCard");
const coordFilter = document.getElementById("coordFilter");

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

function updateComparison(el, yourCount, schoolCount, yourLabel, schoolLabel) {
  if (!el) return;
  const boxes = el.querySelectorAll(".stat-value");
  const labels = el.querySelectorAll(".stat-label");
  if (boxes.length >= 2) {
    boxes[0].textContent = yourCount;
    boxes[1].textContent = schoolCount;
  }
  if (labels.length >= 2 && yourLabel && schoolLabel) {
    labels[0].textContent = yourLabel;
    labels[1].textContent = schoolLabel;
  }
}

// ---- State ----
let __isAdmin = false;
let __ownerName = "";
let __userEmail = "";

// ---- Load dashboard data (reusable for admin filter changes) ----
async function loadDashboardData(filterOwnerName) {
  // filterOwnerName: "" means "All" (admin viewing all), otherwise filter to specific coordinator
  const viewingAll = !filterOwnerName;
  const viewingSelf = filterOwnerName === __ownerName;

  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const weekStart = startOfWeekMonday(now);
  const weekEnd = tomorrowStart;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = tomorrowStart;

  // ---- Build queries ----
  // "Selected" counts — either filtered coordinator or all
  function tpQuery() { return sb.from("touchpoints").select("id", { count: "exact", head: true }); }
  function filteredTP() {
    let q = tpQuery();
    if (!viewingAll) q = q.eq("owner_name", filterOwnerName);
    return q;
  }

  const [
    // School totals (always all)
    totalTP, todayTP, weekTP, monthTP,
    totalT, todayT, weekT, monthT,
    // Filtered totals (selected coordinator or all)
    fTodayTP, fWeekTP, fMonthTP, fTotalTP,
    fTotalT,
  ] = await Promise.all([
    // School totals
    tpQuery(),
    tpQuery().gte("touch_timestamp", todayStart.toISOString()).lt("touch_timestamp", tomorrowStart.toISOString()),
    tpQuery().gte("touch_timestamp", weekStart.toISOString()).lt("touch_timestamp", weekEnd.toISOString()),
    tpQuery().gte("touch_timestamp", monthStart.toISOString()).lt("touch_timestamp", monthEnd.toISOString()),

    // Tickets school totals
    sb.from("tickets").select("ticket_number", { count: "exact", head: true }),
    sb.from("tickets").select("ticket_number", { count: "exact", head: true })
      .gte("raised_at", todayStart.toISOString()).lt("raised_at", tomorrowStart.toISOString()),
    sb.from("tickets").select("ticket_number", { count: "exact", head: true })
      .gte("raised_at", weekStart.toISOString()).lt("raised_at", weekEnd.toISOString()),
    sb.from("tickets").select("ticket_number", { count: "exact", head: true })
      .gte("raised_at", monthStart.toISOString()).lt("raised_at", monthEnd.toISOString()),

    // Filtered touchpoint counts
    filteredTP().gte("touch_timestamp", todayStart.toISOString()).lt("touch_timestamp", tomorrowStart.toISOString()),
    filteredTP().gte("touch_timestamp", weekStart.toISOString()).lt("touch_timestamp", weekEnd.toISOString()),
    filteredTP().gte("touch_timestamp", monthStart.toISOString()).lt("touch_timestamp", monthEnd.toISOString()),
    filteredTP(),

    // Filtered ticket count (by reporter_email if specific, else all)
    viewingAll
      ? sb.from("tickets").select("ticket_number", { count: "exact", head: true })
      : sb.from("tickets").select("ticket_number", { count: "exact", head: true })
          .eq("reporter_email", __userEmail),
  ]);

  // Labels
  const prefix = viewingAll ? "All" : (viewingSelf ? "Your" : filterOwnerName.split(" ")[0] + "'s");

  // KPI pills
  const cards = [
    { value: fTotalTP.count ?? 0, label: `${prefix} Total Entries` },
    { value: fTodayTP.count ?? 0, label: `${prefix} Entries Today` },
    { value: fWeekTP.count ?? 0, label: `${prefix} Entries This Week` },
    { value: fMonthTP.count ?? 0, label: `${prefix} Entries This Month` },
    { value: totalT.count ?? 0, label: "School Total Tickets" },
    { value: fTotalT.count ?? 0, label: `${prefix} Total Tickets` },
  ];

  if (kpisEl) {
    kpisEl.innerHTML = cards
      .map(
        (c, i) => `
      <div class="pill ${i >= 4 ? 'orange' : ''}">
        <b>${c.value}</b>
        <span>${c.label}</span>
      </div>
    `
      )
      .join("");
  }

  // Update headings dynamically
  const overviewCard = kpisEl?.closest(".card");
  if (overviewCard) {
    overviewCard.querySelector("h2").textContent = viewingAll ? "School Overview" : `${prefix} Overview`;
    overviewCard.querySelector(".muted").textContent = viewingAll
      ? "All coordinators combined."
      : (viewingSelf ? "Your entries compared to the whole school." : `${filterOwnerName}'s entries compared to the school.`);
  }

  // Comparison labels
  const leftLabel = viewingAll ? "All Entries" : `${prefix} Entries`;
  const rightLabel = "School Total";

  updateComparison(compToday, fTodayTP.count ?? 0, todayTP.count ?? 0, leftLabel, rightLabel);
  updateComparison(compWeek, fWeekTP.count ?? 0, weekTP.count ?? 0, leftLabel, rightLabel);
  updateComparison(compMonth, fMonthTP.count ?? 0, monthTP.count ?? 0, leftLabel, rightLabel);

  // Update comparison card heading
  const compCard = compToday?.closest(".card");
  if (compCard) {
    compCard.querySelector("h2").textContent = viewingAll ? "School Activity" : `${prefix} Activity vs School`;
  }

  // Recent touchpoints
  if (recentRows) {
    let recentQuery = sb.from("touchpoints")
      .select("touch_timestamp, owner_name, child_name, medium, objective")
      .order("touch_timestamp", { ascending: false })
      .limit(10);

    if (!viewingAll) recentQuery = recentQuery.eq("owner_name", filterOwnerName);

    const { data: recent, error: recentErr } = await recentQuery;

    const recentCard = recentRows.closest(".card");
    if (recentCard) {
      recentCard.querySelector("h2").textContent = viewingAll ? "Recent Entries (All)" : `${prefix} Recent Entries`;
    }

    // Show Owner column if viewing all
    const recentThead = recentRows.closest("table")?.querySelector("thead tr");
    if (recentThead) {
      if (viewingAll) {
        recentThead.innerHTML = `<th>Timestamp</th><th>Coordinator</th><th>Child</th><th>Medium</th><th>Objective</th>`;
      } else {
        recentThead.innerHTML = `<th>Timestamp</th><th>Child</th><th>Medium</th><th>Objective</th>`;
      }
    }

    const cols = viewingAll ? 5 : 4;
    if (recentErr) {
      recentRows.innerHTML = `<tr><td colspan="${cols}">${recentErr.message}</td></tr>`;
    } else if (!recent?.length) {
      recentRows.innerHTML = `<tr><td colspan="${cols}">No entries yet.</td></tr>`;
    } else {
      recentRows.innerHTML = (recent || [])
        .map(
          (r) => `
        <tr>
          <td>${r.touch_timestamp ? new Date(r.touch_timestamp).toLocaleString() : ""}</td>
          ${viewingAll ? `<td>${r.owner_name ?? ""}</td>` : ""}
          <td>${r.child_name ?? ""}</td>
          <td>${r.medium ?? ""}</td>
          <td>${r.objective ?? ""}</td>
        </tr>
      `
        )
        .join("");
    }
  }

  // Recent tickets
  if (recentTicketsRows) {
    let ticketQuery = sb.from("tickets")
      .select("raised_at, ticket_number, student_child_name, department, ticket_status, reporter_email")
      .order("raised_at", { ascending: false })
      .limit(10);

    if (!viewingAll) ticketQuery = ticketQuery.eq("reporter_email", __userEmail);

    const { data: tRecent, error: tErr } = await ticketQuery;

    const ticketCard = recentTicketsRows.closest(".card");
    if (ticketCard) {
      ticketCard.querySelector("h2").textContent = viewingAll ? "Recent Tickets (All)" : `${prefix} Recent Tickets`;
    }

    if (tErr) {
      recentTicketsRows.innerHTML = `<tr><td colspan="5">${tErr.message}</td></tr>`;
    } else if (!tRecent?.length) {
      recentTicketsRows.innerHTML = `<tr><td colspan="5">No tickets yet.</td></tr>`;
    } else {
      recentTicketsRows.innerHTML = (tRecent || [])
        .map(
          (t) => `
        <tr>
          <td>${t.raised_at ? new Date(t.raised_at).toLocaleString() : ""}</td>
          <td>${t.ticket_number ?? ""}</td>
          <td>${t.student_child_name ?? ""}</td>
          <td>${t.department ?? ""}</td>
          <td>${t.ticket_status ?? ""}</td>
        </tr>
      `
        )
        .join("");
    }
  }
}

// ---- Admin: load coordinators list ----
async function loadCoordinatorFilter() {
  const { data, error } = await sb.from("profiles").select("display_name").order("display_name");
  if (error) { console.warn("Could not load coordinators:", error); return; }

  const uniq = Array.from(new Set((data || []).map(x => x.display_name).filter(Boolean)));
  coordFilter.innerHTML =
    `<option value="">All Coordinators</option>` +
    uniq.map(n => `<option value="${n}">${n}</option>`).join("");

  enhanceSelect(coordFilter, { placeholder: "All Coordinators", search: true, searchThreshold: 0 });
  refreshSelect(coordFilter);
}

// ---- Boot ----
(async () => {
  await runBusy("Loading dashboard…", async () => {
    setBusyProgress(null, "Loading navigation…");
    const { me, profile } = await mountNav("dashboard");

    __ownerName = profile?.display_name ?? "";
    __userEmail = me?.email ?? "";
    __isAdmin = profile?.role === "admin";

    // If admin, show coordinator filter & load list
    if (__isAdmin && adminFilterCard) {
      adminFilterCard.style.display = "";
      setBusyProgress(null, "Loading coordinators…");
      await loadCoordinatorFilter();
    }

    // Load data — for admin default to "All", for coordinator default to own
    setBusyProgress(10, "Loading KPIs…");
    const initialFilter = __isAdmin ? "" : __ownerName;
    await loadDashboardData(initialFilter);

    setBusyProgress(100, "Done");
  });
})();

// ---- Admin filter change ----
if (coordFilter) {
  coordFilter.addEventListener("change", async () => {
    if (!__isAdmin) return;
    const selected = coordFilter.value; // "" = All, otherwise coordinator name

    // If a specific coordinator is selected, we need their email for ticket filtering
    if (selected) {
      // Look up email from profiles
      const { data } = await sb.from("profiles").select("email").eq("display_name", selected).maybeSingle();
      __userEmail = data?.email ?? "";
    } else {
      // Reset to logged-in user's email (for "All" view, tickets won't filter by email)
      const { data: u } = await sb.auth.getUser();
      __userEmail = u?.user?.email ?? "";
    }

    await runBusy("Refreshing dashboard…", async () => {
      await loadDashboardData(selected);
    });
  });
}

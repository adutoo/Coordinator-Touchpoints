// js/dashboard.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { withBusy, setBusyProgress } from "./busy.js";

const kpisEl = document.getElementById("kpis");
const recentRows = document.getElementById("recentRows");
const todayByCoord = document.getElementById("todayByCoord");
const weekByCoord = document.getElementById("weekByCoord");

// ✅ Optional (only if you add these tables in dashboard.html)
const recentTicketsRows = document.getElementById("recentTicketsRows"); // tbody
const todayTicketsByDept = document.getElementById("todayTicketsByDept"); // tbody
const weekTicketsByDept = document.getElementById("weekTicketsByDept"); // tbody

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

// -------------------- Touchpoints counts by owner --------------------
async function loadOwnerCounts(tbodyEl, start, end) {
  if (!tbodyEl) return;
  tbodyEl.innerHTML = `<tr><td colspan="2">Loading...</td></tr>`;

  const { data, error } = await sb.rpc("tp_counts_by_owner", {
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });

  if (error) {
    tbodyEl.innerHTML = `<tr><td colspan="2">${error.message}</td></tr>`;
    return;
  }

  if (!data?.length) {
    tbodyEl.innerHTML = `<tr><td colspan="2">No entries.</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = data
    .map(
      (r) => `
    <tr>
      <td>${r.owner_name ?? "(Unknown)"}</td>
      <td>${r.entries ?? 0}</td>
    </tr>
  `
    )
    .join("");
}

// -------------------- Tickets counts by department (optional tables) --------------------
async function loadTicketDeptCounts(tbodyEl, start, end) {
  if (!tbodyEl) return;

  tbodyEl.innerHTML = `<tr><td colspan="2">Loading...</td></tr>`;

  const counts = new Map();
  const chunk = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from("tickets")
      .select("department")
      .gte("raised_at", start.toISOString())
      .lt("raised_at", end.toISOString())
      .range(offset, offset + chunk - 1);

    if (error) {
      tbodyEl.innerHTML = `<tr><td colspan="2">${error.message}</td></tr>`;
      return;
    }

    if (!data?.length) break;

    for (const r of data) {
      const k = (r.department || "(Blank)").toString();
      counts.set(k, (counts.get(k) || 0) + 1);
    }

    offset += data.length;
    if (data.length < chunk) break;
  }

  if (counts.size === 0) {
    tbodyEl.innerHTML = `<tr><td colspan="2">No tickets.</td></tr>`;
    return;
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  tbodyEl.innerHTML = sorted
    .map(
      ([dept, n]) => `
      <tr>
        <td>${dept}</td>
        <td>${n}</td>
      </tr>
    `
    )
    .join("");
}

(async () => {
  await runBusy("Loading dashboard…", async () => {
    setBusyProgress(null, "Loading navigation…");
    await mountNav("dashboard");

    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);

    const weekStart = startOfWeekMonday(now);
    const weekEnd = tomorrowStart;

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = tomorrowStart;

    // KPIs (Touchpoints + Tickets)
    setBusyProgress(10, "Loading KPIs…");

    // ✅ FIX: use proper ranges (gte + lt) so month/week/today never counts wrong
    const [
      totalTP,
      todayTP,
      weekTP,
      monthTP,

      totalT,
      todayT,
      weekT,
      monthT,
    ] = await Promise.all([
      // totals (no range)
      sb.from("touchpoints").select("id", { count: "exact", head: true }),
      // ranges
      sb.from("touchpoints")
        .select("id", { count: "exact", head: true })
        .gte("touch_timestamp", todayStart.toISOString())
        .lt("touch_timestamp", tomorrowStart.toISOString()),
      sb.from("touchpoints")
        .select("id", { count: "exact", head: true })
        .gte("touch_timestamp", weekStart.toISOString())
        .lt("touch_timestamp", weekEnd.toISOString()),
      sb.from("touchpoints")
        .select("id", { count: "exact", head: true })
        .gte("touch_timestamp", monthStart.toISOString())
        .lt("touch_timestamp", monthEnd.toISOString()),

      // tickets totals
      sb.from("tickets").select("ticket_number", { count: "exact", head: true }),
      // tickets ranges
      sb.from("tickets")
        .select("ticket_number", { count: "exact", head: true })
        .gte("raised_at", todayStart.toISOString())
        .lt("raised_at", tomorrowStart.toISOString()),
      sb.from("tickets")
        .select("ticket_number", { count: "exact", head: true })
        .gte("raised_at", weekStart.toISOString())
        .lt("raised_at", weekEnd.toISOString()),
      sb.from("tickets")
        .select("ticket_number", { count: "exact", head: true })
        .gte("raised_at", monthStart.toISOString())
        .lt("raised_at", monthEnd.toISOString()),
    ]);

    const cards = [
      // touchpoints
      { value: totalTP.count ?? 0, label: "Total Entries" },
      { value: todayTP.count ?? 0, label: "Entries Today" },
      { value: weekTP.count ?? 0, label: "Entries This Week" },
      { value: monthTP.count ?? 0, label: "Entries This Month" },

      // tickets
      { value: totalT.count ?? 0, label: "Total Tickets" },
      { value: todayT.count ?? 0, label: "Tickets Today" },
      { value: weekT.count ?? 0, label: "Tickets This Week" },
      { value: monthT.count ?? 0, label: "Tickets This Month" },
    ];

    if (kpisEl) {
      kpisEl.innerHTML = cards
        .map(
          (c) => `
        <div class="pill">
          <b>${c.value}</b>
          <span>${c.label}</span>
        </div>
      `
        )
        .join("");
    }

    // Recent touchpoints
    setBusyProgress(35, "Loading recent entries…");
    if (recentRows) {
      const { data: recent, error: recentErr } = await sb
        .from("touchpoints")
        .select("touch_timestamp, owner_name, child_name, medium, objective")
        .order("touch_timestamp", { ascending: false })
        .limit(10);

      if (recentErr) {
        recentRows.innerHTML = `<tr><td colspan="5">${recentErr.message}</td></tr>`;
      } else {
        recentRows.innerHTML = (recent || [])
          .map(
            (r) => `
          <tr>
            <td>${r.touch_timestamp ? new Date(r.touch_timestamp).toLocaleString() : ""}</td>
            <td>${r.owner_name ?? ""}</td>
            <td>${r.child_name ?? ""}</td>
            <td>${r.medium ?? ""}</td>
            <td>${r.objective ?? ""}</td>
          </tr>
        `
          )
          .join("");
      }
    }

    // ✅ Recent tickets (optional table)
    setBusyProgress(55, "Loading recent tickets…");
    if (recentTicketsRows) {
      const { data: tRecent, error: tErr } = await sb
        .from("tickets")
        .select("raised_at, ticket_number, student_child_name, department, category, ticket_status")
        .order("raised_at", { ascending: false })
        .limit(10);

      if (tErr) {
        recentTicketsRows.innerHTML = `<tr><td colspan="6">${tErr.message}</td></tr>`;
      } else {
        recentTicketsRows.innerHTML = (tRecent || [])
          .map(
            (t) => `
          <tr>
            <td>${t.raised_at ? new Date(t.raised_at).toLocaleString() : ""}</td>
            <td>${t.ticket_number ?? ""}</td>
            <td>${t.student_child_name ?? ""}</td>
            <td>${t.department ?? ""}</td>
            <td>${t.category ?? ""}</td>
            <td>${t.ticket_status ?? ""}</td>
          </tr>
        `
          )
          .join("");
      }
    }

    // Coordinator activity (touchpoints)
    setBusyProgress(70, "Loading coordinator stats…");
    await loadOwnerCounts(todayByCoord, todayStart, tomorrowStart);
    await loadOwnerCounts(weekByCoord, weekStart, weekEnd);

    // ✅ Ticket stats by department (optional tables)
    setBusyProgress(85, "Loading ticket department stats…");
    await loadTicketDeptCounts(todayTicketsByDept, todayStart, tomorrowStart);
    await loadTicketDeptCounts(weekTicketsByDept, weekStart, weekEnd);

    setBusyProgress(100, "Done");
  });
})();

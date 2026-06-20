// js/dashboard.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { withBusy, setBusyProgress } from "./busy.js";

const kpisEl = document.getElementById("kpis");
const recentRows = document.getElementById("recentRows");
const recentTicketsRows = document.getElementById("recentTicketsRows");

const compToday = document.getElementById("compToday");
const compWeek = document.getElementById("compWeek");
const compMonth = document.getElementById("compMonth");

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

function updateComparison(el, yourCount, schoolCount) {
  if (!el) return;
  const boxes = el.querySelectorAll(".stat-value");
  if (boxes.length >= 2) {
    boxes[0].textContent = yourCount;
    boxes[1].textContent = schoolCount;
  }
}

(async () => {
  await runBusy("Loading dashboard…", async () => {
    setBusyProgress(null, "Loading navigation…");
    const { me, profile } = await mountNav("dashboard");

    const ownerName = profile?.display_name ?? "";

    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);

    const weekStart = startOfWeekMonday(now);
    const weekEnd = tomorrowStart;

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = tomorrowStart;

    // KPIs — Your entries + School entries
    setBusyProgress(10, "Loading KPIs…");

    const [
      // School totals
      totalTP, todayTP, weekTP, monthTP,
      totalT, todayT, weekT, monthT,
      // Your totals
      myTodayTP, myWeekTP, myMonthTP, myTotalTP,
      myTotalT,
    ] = await Promise.all([
      // School totals
      sb.from("touchpoints").select("id", { count: "exact", head: true }),
      sb.from("touchpoints").select("id", { count: "exact", head: true })
        .gte("touch_timestamp", todayStart.toISOString())
        .lt("touch_timestamp", tomorrowStart.toISOString()),
      sb.from("touchpoints").select("id", { count: "exact", head: true })
        .gte("touch_timestamp", weekStart.toISOString())
        .lt("touch_timestamp", weekEnd.toISOString()),
      sb.from("touchpoints").select("id", { count: "exact", head: true })
        .gte("touch_timestamp", monthStart.toISOString())
        .lt("touch_timestamp", monthEnd.toISOString()),

      // Tickets school totals
      sb.from("tickets").select("ticket_number", { count: "exact", head: true }),
      sb.from("tickets").select("ticket_number", { count: "exact", head: true })
        .gte("raised_at", todayStart.toISOString())
        .lt("raised_at", tomorrowStart.toISOString()),
      sb.from("tickets").select("ticket_number", { count: "exact", head: true })
        .gte("raised_at", weekStart.toISOString())
        .lt("raised_at", weekEnd.toISOString()),
      sb.from("tickets").select("ticket_number", { count: "exact", head: true })
        .gte("raised_at", monthStart.toISOString())
        .lt("raised_at", monthEnd.toISOString()),

      // Your touchpoint counts
      sb.from("touchpoints").select("id", { count: "exact", head: true })
        .eq("owner_name", ownerName)
        .gte("touch_timestamp", todayStart.toISOString())
        .lt("touch_timestamp", tomorrowStart.toISOString()),
      sb.from("touchpoints").select("id", { count: "exact", head: true })
        .eq("owner_name", ownerName)
        .gte("touch_timestamp", weekStart.toISOString())
        .lt("touch_timestamp", weekEnd.toISOString()),
      sb.from("touchpoints").select("id", { count: "exact", head: true })
        .eq("owner_name", ownerName)
        .gte("touch_timestamp", monthStart.toISOString())
        .lt("touch_timestamp", monthEnd.toISOString()),
      sb.from("touchpoints").select("id", { count: "exact", head: true })
        .eq("owner_name", ownerName),

      // Your ticket count
      sb.from("tickets").select("ticket_number", { count: "exact", head: true })
        .eq("reporter_email", me?.email ?? ""),
    ]);

    // KPI pills: Your entries
    const cards = [
      { value: myTotalTP.count ?? 0, label: "Your Total Entries" },
      { value: myTodayTP.count ?? 0, label: "Your Entries Today" },
      { value: myWeekTP.count ?? 0, label: "Your Entries This Week" },
      { value: myMonthTP.count ?? 0, label: "Your Entries This Month" },
      { value: totalT.count ?? 0, label: "School Total Tickets" },
      { value: myTotalT.count ?? 0, label: "Your Total Tickets" },
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

    // Competitive comparison boxes
    setBusyProgress(40, "Loading comparisons…");
    updateComparison(compToday, myTodayTP.count ?? 0, todayTP.count ?? 0);
    updateComparison(compWeek, myWeekTP.count ?? 0, weekTP.count ?? 0);
    updateComparison(compMonth, myMonthTP.count ?? 0, monthTP.count ?? 0);

    // Recent touchpoints (yours only)
    setBusyProgress(55, "Loading recent entries…");
    if (recentRows) {
      const { data: recent, error: recentErr } = await sb
        .from("touchpoints")
        .select("touch_timestamp, child_name, medium, objective")
        .eq("owner_name", ownerName)
        .order("touch_timestamp", { ascending: false })
        .limit(10);

      if (recentErr) {
        recentRows.innerHTML = `<tr><td colspan="4">${recentErr.message}</td></tr>`;
      } else {
        recentRows.innerHTML = (recent || [])
          .map(
            (r) => `
          <tr>
            <td>${r.touch_timestamp ? new Date(r.touch_timestamp).toLocaleString() : ""}</td>
            <td>${r.child_name ?? ""}</td>
            <td>${r.medium ?? ""}</td>
            <td>${r.objective ?? ""}</td>
          </tr>
        `
          )
          .join("");

        if (!recent?.length) {
          recentRows.innerHTML = `<tr><td colspan="4">No entries yet.</td></tr>`;
        }
      }
    }

    // Recent tickets (yours)
    setBusyProgress(75, "Loading recent tickets…");
    if (recentTicketsRows) {
      const { data: tRecent, error: tErr } = await sb
        .from("tickets")
        .select("raised_at, ticket_number, student_child_name, department, ticket_status")
        .eq("reporter_email", me?.email ?? "")
        .order("raised_at", { ascending: false })
        .limit(10);

      if (tErr) {
        recentTicketsRows.innerHTML = `<tr><td colspan="5">${tErr.message}</td></tr>`;
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

        if (!tRecent?.length) {
          recentTicketsRows.innerHTML = `<tr><td colspan="5">No tickets yet.</td></tr>`;
        }
      }
    }

    setBusyProgress(100, "Done");
  });
})();

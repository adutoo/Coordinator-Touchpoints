// js/dashboard.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";

const kpisEl = document.getElementById("kpis");
const recentRows = document.getElementById("recentRows");
const todayByCoord = document.getElementById("todayByCoord");
const weekByCoord = document.getElementById("weekByCoord");

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

async function loadOwnerCounts(tbodyEl, start, end) {
  tbodyEl.innerHTML = `<tr><td colspan="2">Loading...</td></tr>`;

  const { data, error } = await sb.rpc("tp_counts_by_owner", { p_start: start.toISOString(), p_end: end.toISOString() }); // :contentReference[oaicite:3]{index=3}
  if (error) {
    tbodyEl.innerHTML = `<tr><td colspan="2">${error.message}</td></tr>`;
    return;
  }

  if (!data?.length) {
    tbodyEl.innerHTML = `<tr><td colspan="2">No entries.</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = data.map(r => `
    <tr>
      <td>${r.owner_name ?? "(Unknown)"}</td>
      <td>${r.entries ?? 0}</td>
    </tr>
  `).join("");
}

(async () => {
  await mountNav("dashboard");

  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);

  const weekStart = startOfWeekMonday(now);
  const weekEnd = tomorrowStart;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // KPIs
  const [totalR, todayR, weekR, monthR] = await Promise.all([
    sb.from("touchpoints").select("id", { count: "exact", head: true }),
    sb.from("touchpoints").select("id", { count: "exact", head: true }).gte("touch_timestamp", todayStart.toISOString()),
    sb.from("touchpoints").select("id", { count: "exact", head: true }).gte("touch_timestamp", weekStart.toISOString()),
    sb.from("touchpoints").select("id", { count: "exact", head: true }).gte("touch_timestamp", monthStart.toISOString()),
  ]);

  const cards = [
    { value: totalR.count ?? 0, label: "Total Entries" },
    { value: todayR.count ?? 0, label: "Today" },
    { value: weekR.count ?? 0, label: "This Week" },
    { value: monthR.count ?? 0, label: "This Month" },
  ];

  kpisEl.innerHTML = cards.map(c => `
    <div class="pill">
      <b>${c.value}</b>
      <span>${c.label}</span>
    </div>
  `).join("");

  // Recent entries
  const { data: recent, error: recentErr } = await sb
    .from("touchpoints")
    .select("touch_timestamp, owner_name, child_name, medium, objective")
    .order("touch_timestamp", { ascending: false })
    .limit(10);

  if (recentErr) {
    recentRows.innerHTML = `<tr><td colspan="5">${recentErr.message}</td></tr>`;
  } else {
    recentRows.innerHTML = (recent || []).map(r => `
      <tr>
        <td>${r.touch_timestamp ? new Date(r.touch_timestamp).toLocaleString() : ""}</td>
        <td>${r.owner_name ?? ""}</td>
        <td>${r.child_name ?? ""}</td>
        <td>${r.medium ?? ""}</td>
        <td>${r.objective ?? ""}</td>
      </tr>
    `).join("");
  }

  // Coordinator activity
  await loadOwnerCounts(todayByCoord, todayStart, tomorrowStart);
  await loadOwnerCounts(weekByCoord, weekStart, weekEnd);
})();

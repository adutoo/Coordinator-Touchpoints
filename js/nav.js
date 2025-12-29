import { requireAuth, getMe, getMyProfile, signOut } from "./auth.js";

export async function mountNav(activePage) {
  await requireAuth();

  const me = await getMe();
  const profile = me ? await getMyProfile(me.id) : null;

  const holder = document.getElementById("navHolder");

  const adminLink = profile?.role === "admin"
    ? `<a href="admin.html" class="${activePage==='admin'?'active':''}">Admin</a>`
    : "";

  holder.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <div class="logo"></div>
        <div>
          <h1>Coordinator Touchpoints</h1>
          <p>${profile?.display_name ?? "Coordinator"} • ${profile?.email ?? ""}</p>
        </div>
      </div>

      <div class="nav">
        <a href="dashboard.html" class="${activePage==='dashboard'?'active':''}">Dashboard</a>
        <a href="entry.html" class="${activePage==='entry'?'active':''}">New Entry</a>
        <a href="reports.html" class="${activePage==='reports'?'active':''}">Reports</a>
        ${adminLink}
        <button id="logoutBtn" class="btn danger">Logout</button>
      </div>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", signOut);
  return { me, profile };
}

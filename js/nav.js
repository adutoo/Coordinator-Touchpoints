// js/nav.js
import { requireAuth, getMe, signOut } from "./auth.js";
import { sb } from "./supabaseClient.js";

async function getMyProfileSafe(userId) {
  // profiles table: id, email, display_name, created_at, role
  // ✅ Fix: use id = auth.uid() (not user_id)
  const { data, error } = await sb
    .from("profiles")
    .select("id,email,display_name,role,created_at")
    .eq("id", userId)
    .single();

  if (error) {
    console.warn("Profile fetch failed:", error.message);
    return null;
  }
  return data;
}

export async function mountNav(activePage) {
  await requireAuth();

  const me = await getMe();
  const profile = me ? await getMyProfileSafe(me.id) : null;

  const holder = document.getElementById("navHolder");
  if (!holder) return { me, profile };

  const isAdmin = profile?.role === "admin";

  const link = (href, key, label) =>
    `<a href="${href}" class="${activePage === key ? "active" : ""}">${label}</a>`;

  holder.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <div class="logo"></div>
        <div>
          <h1>Coordinator Touchpoints</h1>
          <p>${profile?.display_name ?? "Coordinator"} • ${profile?.email ?? (me?.email ?? "")}</p>
        </div>
      </div>

      <div class="nav">
        ${link("dashboard.html", "dashboard", "Dashboard")}
        ${link("entry.html", "entry", "New Entry")}
        ${link("reports.html", "reports", "Reports")}
        ${link("ticket_entry.html", "ticket_entry", "Ticket Entry")}
        ${link("ticket_reports.html", "ticket_reports", "Ticket Reports")}
        ${isAdmin ? link("admin.html", "admin", "Admin") : ""}
        <button id="logoutBtn" class="btn danger">Logout</button>
      </div>
    </div>
  `;

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", signOut);

  return { me, profile };
}

// js/nav.js
import { requireAuth, getMe, signOut } from "./auth.js";
import { sb } from "./supabaseClient.js";

async function getMyProfileSafe(userId) {
  // profiles table: id, email, display_name, created_at, role
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

      <button class="nav-toggle" id="navToggle" aria-label="Menu"><span></span></button>

      <div class="nav" id="navLinks">
        ${link("dashboard.html", "dashboard", "Dashboard")}
        ${link("entry.html", "entry", "New Entry")}
        ${link("reports.html", "reports", isAdmin ? "All Entries" : "My Entries")}

        ${link("ticket_entry.html", "ticket_entry", "Ticket Entry")}
        ${link("ticket_reports.html", "ticket_reports", "Ticket Reports")}

        ${isAdmin ? link("students_admin.html", "students_admin", "Students") : ""}

        ${isAdmin ? link("admin.html", "admin", "Admin") : ""}
        <button id="logoutBtn" class="btn danger">Logout</button>
      </div>
    </div>
  `;

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", signOut);

  // Hamburger toggle
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      navToggle.classList.toggle("open");
      navLinks.classList.toggle("open");
    });

    // Auto-close menu when a nav link is tapped (mobile)
    navLinks.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        navToggle.classList.remove("open");
        navLinks.classList.remove("open");
      });
    });
  }

  return { me, profile };
}

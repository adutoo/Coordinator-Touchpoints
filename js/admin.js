// js/admin.js
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { requireAdmin } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";

const userMsg = document.getElementById("userMsg");
const userMgmtMsg = document.getElementById("userMgmtMsg");
const stuMsg = document.getElementById("stuMsg");
const stuDelMsg = document.getElementById("stuDelMsg");
const medMsg = document.getElementById("medMsg");
const objMsg = document.getElementById("objMsg");
const ticketMsg = document.getElementById("ticketMsg");

function show(el, text, isErr = false) {
  if (!el) return;
  el.style.display = "block";
  el.style.borderColor = isErr ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  el.style.color = isErr ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  el.textContent = text;
}
function hide(el) {
  if (!el) return;
  el.style.display = "none";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let parsedStudents = [];

// -------------------- Boot --------------------
(async () => {
  await requireAdmin();
  await mountNav("admin");

  // Admin dropdown style
  const roleSel = document.getElementById("newRole");
  if (roleSel) enhanceSelect(roleSel, { placeholder: roleSel.getAttribute("data-placeholder") || "Select role..." });

  wireCreateAccount();
  wireManageUsers();
  wireFilePicker();
  wireStudentSearch();
  wireAddMedium();
  wireAddObjective();
  wireAddTicket();

  await refreshAll();
})();

// -------------------- Create Account --------------------
function wireCreateAccount() {
  const form = document.getElementById("createUserForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(userMsg);

    const email = document.getElementById("newEmail")?.value?.trim() || "";
    const password = document.getElementById("newPassword")?.value || "";
    const display_name = document.getElementById("newName")?.value?.trim() || "";
    const role = document.getElementById("newRole")?.value || "coordinator";

    if (!email || !password || !display_name) {
      return show(userMsg, "Email, Display Name, and Password are required.", true);
    }

    const { data: sessData, error: sessErr } = await sb.auth.getSession();
    if (sessErr) return show(userMsg, sessErr.message, true);

    const token = sessData?.session?.access_token;
    if (!token || token.split(".").length !== 3) {
      return show(userMsg, "Session token missing/invalid. Logout → Login again.", true);
    }

    show(userMsg, "Creating account…");

    const fnUrl = `${SUPABASE_URL}/functions/v1/create-coordinator`;
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email, password, display_name, role }),
    });

    const text = await res.text();
    if (!res.ok) return show(userMsg, `HTTP ${res.status} | ${text}`, true);

    let out;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out?.ok) return show(userMsg, out?.msg || "Create failed.", true);

    show(userMsg, "Account created ✅");

    form.reset();
    const roleSel = document.getElementById("newRole");
    if (roleSel) {
      roleSel.value = "coordinator";
      refreshSelect(roleSel);
    }

    await refreshUsers();
  });
}

// -------------------- Manage Users (Search + Delete via Edge Function) --------------------
function wireManageUsers() {
  const userSearch = document.getElementById("userSearch");
  const userRefreshBtn = document.getElementById("userRefreshBtn");
  const userRows = document.getElementById("userRows");

  if (!userSearch || !userRefreshBtn || !userRows) return;

  let t = null;
  const trigger = () => {
    clearTimeout(t);
    t = setTimeout(refreshUsers, 180);
  };

  userSearch.addEventListener("input", trigger);
  userRefreshBtn.addEventListener("click", refreshUsers);

  userRows.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-del-user]");
    if (!btn) return;

    const userId = btn.getAttribute("data-del-user");
    const name = btn.getAttribute("data-name") || "this user";
    if (!userId) return;

    const ok = confirm(`Delete ${name}? This will remove login access.`);
    if (!ok) return;

    hide(userMgmtMsg);
    show(userMgmtMsg, "Deleting…");

    const { data: sessData } = await sb.auth.getSession();
    const token = sessData?.session?.access_token;
    if (!token) return show(userMgmtMsg, "Session missing. Login again.", true);

    const fnUrl = `${SUPABASE_URL}/functions/v1/delete-user`;
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user_id: userId }),
    });

    const text = await res.text();
    if (!res.ok) return show(userMgmtMsg, `HTTP ${res.status} | ${text}`, true);

    let out;
    try { out = JSON.parse(text); } catch { out = null; }
    if (!out?.ok) return show(userMgmtMsg, out?.msg || "Delete failed.", true);

    show(userMgmtMsg, "User deleted ✅");
    await refreshUsers();
  });
}

async function refreshUsers() {
  const userRows = document.getElementById("userRows");
  const userSearch = document.getElementById("userSearch");
  if (!userRows) return;

  hide(userMgmtMsg);
  userRows.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

  const text = (userSearch?.value || "").trim();
  let query = sb.from("profiles").select("id, display_name, role, email").order("display_name");

  if (text) {
    const esc = text.replace(/,/g, " ");
    query = query.or(`display_name.ilike.%${esc}%,email.ilike.%${esc}%`);
  }

  // keep small for UI
  const { data, error } = await query.limit(50);
  if (error) {
    userRows.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    userRows.innerHTML = `<tr><td colspan="4">No users found.</td></tr>`;
    return;
  }

  userRows.innerHTML = data.map(p => `
    <tr>
      <td>${escapeHtml(p.display_name || "")}</td>
      <td>${escapeHtml(p.email || "")}</td>
      <td>${escapeHtml(p.role || "")}</td>
      <td>
        <button class="btn danger" data-del-user="${p.id}" data-name="${escapeHtml(p.display_name || p.email || "user")}">
          Delete
        </button>
      </td>
    </tr>
  `).join("");
}

// -------------------- Excel Upload (Students) --------------------
function wireFilePicker() {
  const excelFile = document.getElementById("excelFile");
  const chooseFileBtn = document.getElementById("chooseFileBtn");
  const fileNameChip = document.getElementById("fileNameChip");

  const parseBtn = document.getElementById("parseBtn");
  const uploadBtn = document.getElementById("uploadBtn");
  const uploadMeta = document.getElementById("uploadMeta");
  const previewRows = document.getElementById("previewRows");

  if (!excelFile || !parseBtn || !uploadBtn || !previewRows) return;

  chooseFileBtn?.addEventListener("click", () => excelFile.click());

  excelFile.addEventListener("change", () => {
    const f = excelFile.files?.[0];
    if (fileNameChip) fileNameChip.textContent = f ? f.name : "No file chosen";
  });

  parseBtn.addEventListener("click", async () => {
    hide(stuMsg);
    previewRows.innerHTML = "";
    parsedStudents = [];
    uploadBtn.disabled = true;

    const file = excelFile.files?.[0];
    if (!file) return show(stuMsg, "Select an Excel file first.", true);

    try {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { defval: "" });

      const req = ["SR No", "Student Name", "Class", "Section", "Concat"];
      const ok = req.every((h) => Object.prototype.hasOwnProperty.call(rows[0] || {}, h));
      if (!ok) return show(stuMsg, `Missing headers. Required: ${req.join(", ")}`, true);

      parsedStudents = rows
        .map((r) => ({
          child_name: String(r["Concat"]).trim(),
          student_name: String(r["Student Name"]).trim(),
          class_name: String(r["Class"]).trim(),
          section: String(r["Section"]).trim(),
          sr_number: String(r["SR No"]).trim(),
        }))
        .filter((r) => r.child_name && r.student_name);

      if (uploadMeta) {
        uploadMeta.textContent = `Parsed ${parsedStudents.length} students. Showing first 20 below.`;
      }

      previewRows.innerHTML = parsedStudents
        .slice(0, 20)
        .map(
          (s) => `
          <tr>
            <td>${escapeHtml(s.child_name)}</td>
            <td>${escapeHtml(s.student_name)}</td>
            <td>${escapeHtml(s.class_name)}</td>
            <td>${escapeHtml(s.section)}</td>
            <td>${escapeHtml(s.sr_number)}</td>
          </tr>
        `
        )
        .join("");

      uploadBtn.disabled = parsedStudents.length === 0;
      show(stuMsg, "Parsed ✅ Now click Upload to DB");
    } catch (err) {
      console.error(err);
      show(stuMsg, String(err), true);
    }
  });

  uploadBtn.addEventListener("click", async () => {
    hide(stuMsg);
    if (!parsedStudents.length) return show(stuMsg, "Nothing parsed.", true);

    show(stuMsg, "Uploading…");

    const chunk = 500;
    let done = 0;

    while (done < parsedStudents.length) {
      const batch = parsedStudents.slice(done, done + chunk);
      const { error } = await sb.from("students").upsert(batch, { onConflict: "child_name" });
      if (error) return show(stuMsg, error.message, true);

      done += batch.length;
      show(stuMsg, `Uploaded ${done}/${parsedStudents.length}…`);
    }

    show(stuMsg, "Students uploaded ✅");
    await refreshStudentsCount();
  });
}

// -------------------- Remove Students (Search + Delete) --------------------
function wireStudentSearch() {
  const stuSearch = document.getElementById("stuSearch");
  const stuRefreshBtn = document.getElementById("stuRefreshBtn");
  const stuRows = document.getElementById("stuRows");
  const stuSearchMeta = document.getElementById("stuSearchMeta");

  if (!stuSearch || !stuRefreshBtn || !stuRows) return;

  const run = async () => {
    hide(stuDelMsg);
    const text = stuSearch.value.trim();
    if (!text) {
      stuRows.innerHTML = `<tr><td colspan="6">Type something to search…</td></tr>`;
      if (stuSearchMeta) stuSearchMeta.textContent = "";
      return;
    }

    stuRows.innerHTML = `<tr><td colspan="6">Searching…</td></tr>`;

    const esc = text.replace(/,/g, " ");
    const { data, error } = await sb
      .from("students")
      .select("id, child_name, student_name, class_name, section, sr_number")
      .or(`child_name.ilike.%${esc}%,student_name.ilike.%${esc}%,sr_number.ilike.%${esc}%`)
      .order("child_name")
      .limit(50);

    if (error) {
      stuRows.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
      return;
    }

    if (stuSearchMeta) stuSearchMeta.textContent = `Showing ${data?.length || 0} results (max 50).`;

    if (!data?.length) {
      stuRows.innerHTML = `<tr><td colspan="6">No students found.</td></tr>`;
      return;
    }

    stuRows.innerHTML = data.map(s => `
      <tr>
        <td>${escapeHtml(s.child_name)}</td>
        <td>${escapeHtml(s.student_name)}</td>
        <td>${escapeHtml(s.class_name)}</td>
        <td>${escapeHtml(s.section)}</td>
        <td>${escapeHtml(s.sr_number)}</td>
        <td><button class="btn danger" data-del-stu="${s.id}" data-name="${escapeHtml(s.child_name)}">Delete</button></td>
      </tr>
    `).join("");
  };

  let t = null;
  stuSearch.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(run, 200);
  });

  stuRefreshBtn.addEventListener("click", run);

  stuRows.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-del-stu]");
    if (!btn) return;

    const id = btn.getAttribute("data-del-stu");
    const name = btn.getAttribute("data-name") || "this student";
    if (!id) return;

    const ok = confirm(`Delete ${name} from students database?`);
    if (!ok) return;

    hide(stuDelMsg);
    show(stuDelMsg, "Deleting…");

    const { error } = await sb.from("students").delete().eq("id", id);
    if (error) return show(stuDelMsg, error.message, true);

    show(stuDelMsg, "Student deleted ✅");
    await run();
    await refreshStudentsCount();
  });

  // initial hint
  stuRows.innerHTML = `<tr><td colspan="6">Type something to search…</td></tr>`;
}

// -------------------- Mediums --------------------
function wireAddMedium() {
  const form = document.getElementById("addMediumForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(medMsg);

    const label = document.getElementById("medLabel")?.value?.trim() || "";
    const time_min = Math.max(1, Number(document.getElementById("medTimeMin")?.value || 1));

    if (!label) return show(medMsg, "Medium Label is required.", true);

    const { error } = await sb.from("mediums").insert({
      label,
      time_min,
      is_active: true,
      sort_order: 100,
    });

    if (error) return show(medMsg, error.message, true);

    show(medMsg, "Medium added ✅");
    form.reset();
    const t = document.getElementById("medTimeMin");
    if (t) t.value = "1";
    await refreshMediums();
  });
}

async function refreshMediums() {
  hide(medMsg);
  const mediumRows = document.getElementById("mediumRows");
  if (!mediumRows) return;

  mediumRows.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

  const { data, error } = await sb
    .from("mediums")
    .select("id,label,time_min,is_active")
    .order("sort_order")
    .order("label");

  if (error) return show(medMsg, error.message, true);

  mediumRows.innerHTML = (data || [])
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(m.label)}</td>
        <td>
          <input
            type="number"
            min="1"
            value="${Number(m.time_min ?? 1)}"
            data-time-id="${m.id}"
            style="width:90px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.22);color:rgba(255,255,255,0.92);padding:8px 10px;"
          />
        </td>
        <td>${m.is_active ? "Yes" : "No"}</td>
        <td class="row">
          <button class="btn" data-act="saveTime" data-id="${m.id}">Save</button>
          <button class="btn" data-act="toggle" data-id="${m.id}" data-val="${m.is_active ? "0" : "1"}">
            ${m.is_active ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `
    )
    .join("");

  mediumRows.querySelectorAll("button[data-act='saveTime']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const input = mediumRows.querySelector(`input[data-time-id="${id}"]`);
      const time_min = Math.max(1, Number(input?.value || 1));

      const { error } = await sb.from("mediums").update({ time_min }).eq("id", id);
      if (error) return show(medMsg, error.message, true);

      show(medMsg, "Time updated ✅");
    });
  });

  mediumRows.querySelectorAll("button[data-act='toggle']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";

      const { error } = await sb.from("mediums").update({ is_active }).eq("id", id);
      if (error) return show(medMsg, error.message, true);

      await refreshMediums();
    });
  });
}

// -------------------- Objectives --------------------
function wireAddObjective() {
  const form = document.getElementById("addObjForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(objMsg);

    const label = document.getElementById("objLabel")?.value?.trim() || "";
    if (!label) return show(objMsg, "Objective Label is required.", true);

    const { error } = await sb.from("objectives").insert({
      label,
      is_active: true,
      sort_order: 100,
    });

    if (error) return show(objMsg, error.message, true);

    show(objMsg, "Objective added ✅");
    form.reset();
    await refreshObjectives();
  });
}

async function refreshObjectives() {
  hide(objMsg);
  const objectiveRows = document.getElementById("objectiveRows");
  if (!objectiveRows) return;

  objectiveRows.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

  const { data, error } = await sb
    .from("objectives")
    .select("id,label,is_active")
    .order("sort_order")
    .order("label");

  if (error) return show(objMsg, error.message, true);

  objectiveRows.innerHTML = (data || [])
    .map(
      (o) => `
      <tr>
        <td>${escapeHtml(o.label)}</td>
        <td>${o.is_active ? "Yes" : "No"}</td>
        <td>
          <button class="btn" data-act="toggle" data-id="${o.id}" data-val="${o.is_active ? "0" : "1"}">
            ${o.is_active ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `
    )
    .join("");

  objectiveRows.querySelectorAll("button[data-act='toggle']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";

      const { error } = await sb.from("objectives").update({ is_active }).eq("id", id);
      if (error) return show(objMsg, error.message, true);

      await refreshObjectives();
    });
  });
}

// -------------------- Ticket Raised Options --------------------
function wireAddTicket() {
  const form = document.getElementById("addTicketForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(ticketMsg);

    const label = document.getElementById("ticketLabel")?.value?.trim() || "";
    if (!label) return show(ticketMsg, "Option Label is required.", true);

    const { error } = await sb.from("ticket_raised_options").insert({
      label,
      is_active: true,
      sort_order: 100,
    });

    if (error) return show(ticketMsg, error.message, true);

    show(ticketMsg, "Ticket option added ✅");
    form.reset();
    await refreshTicketOptions();
  });
}

async function refreshTicketOptions() {
  hide(ticketMsg);
  const ticketRows = document.getElementById("ticketRows");
  if (!ticketRows) return;

  ticketRows.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

  const { data, error } = await sb
    .from("ticket_raised_options")
    .select("id,label,is_active")
    .order("sort_order")
    .order("label");

  if (error) return show(ticketMsg, error.message, true);

  ticketRows.innerHTML = (data || [])
    .map(
      (t) => `
      <tr>
        <td>${escapeHtml(t.label)}</td>
        <td>${t.is_active ? "Yes" : "No"}</td>
        <td>
          <button class="btn" data-act="toggle" data-id="${t.id}" data-val="${t.is_active ? "0" : "1"}">
            ${t.is_active ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
    `
    )
    .join("");

  ticketRows.querySelectorAll("button[data-act='toggle']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";

      const { error } = await sb.from("ticket_raised_options").update({ is_active }).eq("id", id);
      if (error) return show(ticketMsg, error.message, true);

      await refreshTicketOptions();
    });
  });
}

// -------------------- Refresh helpers --------------------
async function refreshAll() {
  await Promise.all([
    refreshUsers(),
    refreshMediums(),
    refreshObjectives(),
    refreshTicketOptions(),
    refreshStudentsCount(),
  ]);
}

async function refreshStudentsCount() {
  const uploadMeta = document.getElementById("uploadMeta");
  const { count, error } = await sb.from("students").select("id", { count: "exact", head: true });

  if (error) {
    if (uploadMeta) uploadMeta.textContent = "Students in DB: ?";
    return;
  }
  if (uploadMeta) uploadMeta.textContent = `Students in DB: ${count ?? 0}`;
}

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

// ✅ NEW
const statusMsg = document.getElementById("statusMsg");

const irbyMsg = document.getElementById("irbyMsg");
const deptMsg = document.getElementById("deptMsg");
const subjMsg = document.getElementById("subjMsg");
const catMsg = document.getElementById("catMsg");
const pocMsg = document.getElementById("pocMsg");
const porMsg = document.getElementById("porMsg");

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

let ticketIssueRaisedBy = [];
let ticketDepartments = [];

function setSelectOptions(selectEl, items, getValue, getLabel) {
  if (!selectEl) return;
  selectEl.innerHTML =
    `<option value=""></option>` +
    (items || [])
      .map((x) => `<option value="${escapeHtml(getValue(x))}">${escapeHtml(getLabel(x))}</option>`)
      .join("");
  try { refreshSelect(selectEl); } catch {}
}

// -------------------- Boot --------------------
(async () => {
  await requireAdmin();
  await mountNav("admin");

  // Admin dropdown style
  const roleSel = document.getElementById("newRole");
  if (roleSel) enhanceSelect(roleSel, { placeholder: roleSel.getAttribute("data-placeholder") || "Select role..." });

  // Ticket validation selects style
  const deptReqSub = document.getElementById("deptReqSub");
  if (deptReqSub) enhanceSelect(deptReqSub, { placeholder: deptReqSub.getAttribute("data-placeholder") || "Select..." });

  const catIrby = document.getElementById("catIrby");
  const catDept = document.getElementById("catDept");
  const porDept = document.getElementById("porDept");
  if (catIrby) enhanceSelect(catIrby, { placeholder: catIrby.getAttribute("data-placeholder") || "Select...", search: true });
  if (catDept) enhanceSelect(catDept, { placeholder: catDept.getAttribute("data-placeholder") || "Select...", search: true });
  if (porDept) enhanceSelect(porDept, { placeholder: porDept.getAttribute("data-placeholder") || "Select...", search: true });

  wireCreateAccount();
  wireManageUsers();
  wireFilePicker();
  wireStudentSearch();
  wireAddMedium();
  wireAddObjective();
  wireAddTicket();

  // ✅ NEW: Ticket Status
  wireAddTicketStatus();

  // Ticket validation wires
  wireAddIrby();
  wireAddDept();
  wireAddSubject();
  wireAddCategory();
  wireAddPocMap();
  wireAddPorMap();

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
        .map((s) => `
          <tr>
            <td>${escapeHtml(s.child_name)}</td>
            <td>${escapeHtml(s.student_name)}</td>
            <td>${escapeHtml(s.class_name)}</td>
            <td>${escapeHtml(s.section)}</td>
            <td>${escapeHtml(s.sr_number)}</td>
          </tr>
        `)
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

    const { error } = await sb.from("mediums").insert({ label, time_min, is_active: true, sort_order: 100 });
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

  const { data, error } = await sb.from("mediums").select("id,label,time_min,is_active,sort_order").order("sort_order").order("label");
  if (error) return show(medMsg, error.message, true);

  mediumRows.innerHTML = (data || []).map(m => `
    <tr>
      <td>${escapeHtml(m.label)}</td>
      <td>
        <input type="number" min="1" value="${Number(m.time_min ?? 1)}"
          data-time-id="${m.id}"
          style="width:90px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.22);color:rgba(255,255,255,0.92);padding:8px 10px;" />
      </td>
      <td>${m.is_active ? "Yes" : "No"}</td>
      <td class="row">
        <button class="btn" data-act="saveTime" data-id="${m.id}">Save</button>
        <button class="btn" data-act="toggle" data-id="${m.id}" data-val="${m.is_active ? "0" : "1"}">
          ${m.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `).join("");

  mediumRows.querySelectorAll("button[data-act='saveTime']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const input = mediumRows.querySelector(`input[data-time-id="${id}"]`);
      const time_min = Math.max(1, Number(input?.value || 1));
      const { error } = await sb.from("mediums").update({ time_min }).eq("id", id);
      if (error) return show(medMsg, error.message, true);
      show(medMsg, "Time updated ✅");
    });
  });

  mediumRows.querySelectorAll("button[data-act='toggle']").forEach(btn => {
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

    const { error } = await sb.from("objectives").insert({ label, is_active: true, sort_order: 100 });
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

  const { data, error } = await sb.from("objectives").select("id,label,is_active,sort_order").order("sort_order").order("label");
  if (error) return show(objMsg, error.message, true);

  objectiveRows.innerHTML = (data || []).map(o => `
    <tr>
      <td>${escapeHtml(o.label)}</td>
      <td>${o.is_active ? "Yes" : "No"}</td>
      <td>
        <button class="btn" data-act="toggle" data-id="${o.id}" data-val="${o.is_active ? "0" : "1"}">
          ${o.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `).join("");

  objectiveRows.querySelectorAll("button[data-act='toggle']").forEach(btn => {
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

    const { error } = await sb.from("ticket_raised_options").insert({ label, is_active: true, sort_order: 100 });
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

  const { data, error } = await sb.from("ticket_raised_options").select("id,label,is_active,sort_order").order("sort_order").order("label");
  if (error) return show(ticketMsg, error.message, true);

  ticketRows.innerHTML = (data || []).map(t => `
    <tr>
      <td>${escapeHtml(t.label)}</td>
      <td>${t.is_active ? "Yes" : "No"}</td>
      <td>
        <button class="btn" data-act="toggle" data-id="${t.id}" data-val="${t.is_active ? "0" : "1"}">
          ${t.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `).join("");

  ticketRows.querySelectorAll("button[data-act='toggle']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";
      const { error } = await sb.from("ticket_raised_options").update({ is_active }).eq("id", id);
      if (error) return show(ticketMsg, error.message, true);
      await refreshTicketOptions();
    });
  });
}

// ✅ NEW: Ticket Statuses (for Ticket Reports dropdown)
function wireAddTicketStatus() {
  const form = document.getElementById("addStatusForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(statusMsg);

    const label = document.getElementById("statusLabel")?.value?.trim() || "";
    const sort_order = Number(document.getElementById("statusSort")?.value || 100);

    if (!label) return show(statusMsg, "Status Label is required.", true);

    const { error } = await sb.from("ticket_statuses").insert({
      label,
      is_active: true,
      sort_order,
    });

    if (error) return show(statusMsg, error.message, true);

    show(statusMsg, "Status added ✅");
    form.reset();
    document.getElementById("statusSort").value = "100";
    await refreshTicketStatuses();
  });
}

async function refreshTicketStatuses() {
  hide(statusMsg);

  const statusRows = document.getElementById("statusRows");
  if (!statusRows) return;

  statusRows.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

  const { data, error } = await sb
    .from("ticket_statuses")
    .select("id,label,is_active,sort_order")
    .order("sort_order")
    .order("label");

  if (error) {
    statusRows.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  statusRows.innerHTML = (data || []).map(s => `
    <tr>
      <td>${escapeHtml(s.label)}</td>
      <td>
        <input
          type="number"
          data-status-sort="${s.id}"
          value="${Number(s.sort_order ?? 100)}"
          style="width:90px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.22);color:rgba(255,255,255,0.92);padding:8px 10px;"
        />
      </td>
      <td>${s.is_active ? "Yes" : "No"}</td>
      <td class="row">
        <button class="btn" data-act="saveStatus" data-id="${s.id}">Save</button>
        <button class="btn" data-act="toggleStatus" data-id="${s.id}" data-val="${s.is_active ? "0" : "1"}">
          ${s.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `).join("");

  statusRows.querySelectorAll("button[data-act='saveStatus']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const sort_order = Number(statusRows.querySelector(`input[data-status-sort="${id}"]`)?.value || 100);

      const { error } = await sb.from("ticket_statuses").update({ sort_order }).eq("id", id);
      if (error) return show(statusMsg, error.message, true);

      show(statusMsg, "Saved ✅");
      await refreshTicketStatuses();
    });
  });

  statusRows.querySelectorAll("button[data-act='toggleStatus']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";

      const { error } = await sb.from("ticket_statuses").update({ is_active }).eq("id", id);
      if (error) return show(statusMsg, error.message, true);

      await refreshTicketStatuses();
    });
  });
}

// -------------------- Ticket Validation: Issue Raised By --------------------
function wireAddIrby() {
  const form = document.getElementById("addIrbyForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(irbyMsg);

    const label = document.getElementById("irbyLabel")?.value?.trim() || "";
    const sort_order = Number(document.getElementById("irbySort")?.value || 100);

    if (!label) return show(irbyMsg, "Label is required.", true);

    const { error } = await sb.from("ticket_issue_raised_by").insert({ label, is_active: true, sort_order });
    if (error) return show(irbyMsg, error.message, true);

    show(irbyMsg, "Added ✅");
    form.reset();
    document.getElementById("irbySort").value = "100";
    await refreshIrby();
  });
}

async function refreshIrby() {
  hide(irbyMsg);
  const irbyRows = document.getElementById("irbyRows");
  if (!irbyRows) return;

  irbyRows.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

  const { data, error } = await sb.from("ticket_issue_raised_by").select("id,label,is_active,sort_order").order("sort_order").order("label");
  if (error) {
    irbyRows.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  ticketIssueRaisedBy = data || [];

  const catIrby = document.getElementById("catIrby");
  setSelectOptions(catIrby, ticketIssueRaisedBy.filter(x => x.is_active), x => x.label, x => x.label);

  irbyRows.innerHTML = (ticketIssueRaisedBy || []).map(x => `
    <tr>
      <td>${escapeHtml(x.label)}</td>
      <td>${escapeHtml(x.sort_order ?? "")}</td>
      <td>${x.is_active ? "Yes" : "No"}</td>
      <td>
        <button class="btn" data-act="toggleIrby" data-id="${x.id}" data-val="${x.is_active ? "0" : "1"}">
          ${x.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `).join("");

  irbyRows.querySelectorAll("button[data-act='toggleIrby']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";
      const { error } = await sb.from("ticket_issue_raised_by").update({ is_active }).eq("id", id);
      if (error) return show(irbyMsg, error.message, true);
      await refreshIrby();
    });
  });
}

// -------------------- Ticket Validation: Departments --------------------
function wireAddDept() {
  const form = document.getElementById("addDeptForm");
  if (!form) return;

  const deptReqSub = document.getElementById("deptReqSub");
  if (deptReqSub) enhanceSelect(deptReqSub, { placeholder: deptReqSub.getAttribute("data-placeholder") || "Select..." });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(deptMsg);

    const label = document.getElementById("deptLabel")?.value?.trim() || "";
    const requires_subject = (document.getElementById("deptReqSub")?.value || "false") === "true";
    const sort_order = Number(document.getElementById("deptSort")?.value || 100);

    if (!label) return show(deptMsg, "Department label is required.", true);

    const { error } = await sb.from("ticket_departments").insert({ label, requires_subject, is_active: true, sort_order });
    if (error) return show(deptMsg, error.message, true);

    show(deptMsg, "Added ✅");
    form.reset();
    document.getElementById("deptSort").value = "100";
    if (deptReqSub) { deptReqSub.value = "false"; refreshSelect(deptReqSub); }
    await refreshDepts();
  });
}

async function refreshDepts() {
  hide(deptMsg);
  const deptRows = document.getElementById("deptRows");
  if (!deptRows) return;

  deptRows.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;

  const { data, error } = await sb.from("ticket_departments").select("id,label,requires_subject,is_active,sort_order").order("sort_order").order("label");
  if (error) {
    deptRows.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  ticketDepartments = data || [];

  const catDept = document.getElementById("catDept");
  const porDept = document.getElementById("porDept");
  const activeDepts = ticketDepartments.filter(x => x.is_active);

  setSelectOptions(catDept, activeDepts, x => x.label, x => x.label);
  setSelectOptions(porDept, activeDepts, x => x.label, x => x.label);

  deptRows.innerHTML = (ticketDepartments || []).map(d => `
    <tr>
      <td>${escapeHtml(d.label)}</td>
      <td>
        <input type="checkbox" data-dept-req="${d.id}" ${d.requires_subject ? "checked" : ""} />
      </td>
      <td>
        <input type="number" data-dept-sort="${d.id}" value="${Number(d.sort_order ?? 100)}"
          style="width:90px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.22);color:rgba(255,255,255,0.92);padding:8px 10px;" />
      </td>
      <td>${d.is_active ? "Yes" : "No"}</td>
      <td class="row">
        <button class="btn" data-act="saveDept" data-id="${d.id}">Save</button>
        <button class="btn" data-act="toggleDept" data-id="${d.id}" data-val="${d.is_active ? "0" : "1"}">
          ${d.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `).join("");

  deptRows.querySelectorAll("button[data-act='saveDept']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const req = !!deptRows.querySelector(`input[type="checkbox"][data-dept-req="${id}"]`)?.checked;
      const sort = Number(deptRows.querySelector(`input[data-dept-sort="${id}"]`)?.value || 100);

      const { error } = await sb.from("ticket_departments").update({ requires_subject: req, sort_order: sort }).eq("id", id);
      if (error) return show(deptMsg, error.message, true);

      show(deptMsg, "Saved ✅");
      await refreshDepts();
    });
  });

  deptRows.querySelectorAll("button[data-act='toggleDept']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";
      const { error } = await sb.from("ticket_departments").update({ is_active }).eq("id", id);
      if (error) return show(deptMsg, error.message, true);
      await refreshDepts();
    });
  });
}

// -------------------- Ticket Validation: Subjects --------------------
function wireAddSubject() {
  const form = document.getElementById("addSubjForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(subjMsg);

    const label = document.getElementById("subjLabel")?.value?.trim() || "";
    const sort_order = Number(document.getElementById("subjSort")?.value || 100);
    if (!label) return show(subjMsg, "Label is required.", true);

    const { error } = await sb.from("ticket_subjects").insert({ label, is_active: true, sort_order });
    if (error) return show(subjMsg, error.message, true);

    show(subjMsg, "Added ✅");
    form.reset();
    document.getElementById("subjSort").value = "100";
    await refreshSubjects();
  });
}

async function refreshSubjects() {
  hide(subjMsg);
  const subjRows = document.getElementById("subjRows");
  if (!subjRows) return;

  subjRows.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

  const { data, error } = await sb.from("ticket_subjects").select("id,label,is_active,sort_order").order("sort_order").order("label");
  if (error) {
    subjRows.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  subjRows.innerHTML = (data || []).map(s => `
    <tr>
      <td>${escapeHtml(s.label)}</td>
      <td>${escapeHtml(s.sort_order ?? "")}</td>
      <td>${s.is_active ? "Yes" : "No"}</td>
      <td>
        <button class="btn" data-act="toggleSubj" data-id="${s.id}" data-val="${s.is_active ? "0" : "1"}">
          ${s.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `).join("");

  subjRows.querySelectorAll("button[data-act='toggleSubj']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";
      const { error } = await sb.from("ticket_subjects").update({ is_active }).eq("id", id);
      if (error) return show(subjMsg, error.message, true);
      await refreshSubjects();
    });
  });
}

// -------------------- Ticket Validation: Categories --------------------
function wireAddCategory() {
  const form = document.getElementById("addCatForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(catMsg);

    const issue_raised_by = document.getElementById("catIrby")?.value || "";
    const department = document.getElementById("catDept")?.value || "";
    const label = document.getElementById("catLabel")?.value?.trim() || "";
    const sort_order = Number(document.getElementById("catSort")?.value || 100);

    if (!issue_raised_by) return show(catMsg, "Select Issue Raised By.", true);
    if (!department) return show(catMsg, "Select Department.", true);
    if (!label) return show(catMsg, "Category label is required.", true);

    const { error } = await sb.from("ticket_categories").insert({
      issue_raised_by,
      department,
      label,
      is_active: true,
      sort_order
    });

    if (error) return show(catMsg, error.message, true);

    show(catMsg, "Added ✅");
    document.getElementById("catLabel").value = "";
    document.getElementById("catSort").value = "100";
    await refreshCategories();
  });
}

async function refreshCategories() {
  hide(catMsg);
  const catRows = document.getElementById("catRows");
  if (!catRows) return;

  catRows.innerHTML = `<tr><td colspan="6">Loading…</td></tr>`;

  const { data, error } = await sb
    .from("ticket_categories")
    .select("id,issue_raised_by,department,label,is_active,sort_order")
    .order("issue_raised_by")
    .order("department")
    .order("sort_order")
    .order("label");

  if (error) {
    catRows.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  catRows.innerHTML = (data || []).map(c => `
    <tr>
      <td>${escapeHtml(c.issue_raised_by)}</td>
      <td>${escapeHtml(c.department)}</td>
      <td>${escapeHtml(c.label)}</td>
      <td>${escapeHtml(c.sort_order ?? "")}</td>
      <td>${c.is_active ? "Yes" : "No"}</td>
      <td>
        <button class="btn" data-act="toggleCat" data-id="${c.id}" data-val="${c.is_active ? "0" : "1"}">
          ${c.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `).join("");

  catRows.querySelectorAll("button[data-act='toggleCat']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const is_active = btn.dataset.val === "1";
      const { error } = await sb.from("ticket_categories").update({ is_active }).eq("id", id);
      if (error) return show(catMsg, error.message, true);
      await refreshCategories();
    });
  });
}

// -------------------- Ticket Validation: POC Map --------------------
function wireAddPocMap() {
  const form = document.getElementById("addPocForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(pocMsg);

    const reporter_email = document.getElementById("pocReporter")?.value?.trim() || "";
    const poc_email = document.getElementById("pocEmail")?.value?.trim() || "";

    if (!reporter_email || !poc_email) return show(pocMsg, "Both emails are required.", true);

    const { error } = await sb
      .from("ticket_poc_map")
      .upsert({ reporter_email, poc_email }, { onConflict: "reporter_email" });

    if (error) return show(pocMsg, error.message, true);

    show(pocMsg, "Saved ✅");
    form.reset();
    await refreshPocMap();
  });
}

async function refreshPocMap() {
  hide(pocMsg);
  const pocRows = document.getElementById("pocRows");
  if (!pocRows) return;

  pocRows.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

  const { data, error } = await sb.from("ticket_poc_map").select("reporter_email,poc_email").order("reporter_email");
  if (error) {
    pocRows.innerHTML = `<tr><td colspan="3">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  pocRows.innerHTML = (data || []).map(r => `
    <tr>
      <td>${escapeHtml(r.reporter_email)}</td>
      <td>${escapeHtml(r.poc_email)}</td>
      <td>
        <button class="btn danger" data-act="delPoc" data-reporter="${escapeHtml(r.reporter_email)}">Delete</button>
      </td>
    </tr>
  `).join("");

  pocRows.querySelectorAll("button[data-act='delPoc']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const reporter = btn.getAttribute("data-reporter");
      if (!reporter) return;
      const ok = confirm(`Delete mapping for ${reporter}?`);
      if (!ok) return;

      const { error } = await sb.from("ticket_poc_map").delete().eq("reporter_email", reporter);
      if (error) return show(pocMsg, error.message, true);

      show(pocMsg, "Deleted ✅");
      await refreshPocMap();
    });
  });
}

// -------------------- Ticket Validation: POR Map --------------------
function wireAddPorMap() {
  const form = document.getElementById("addPorForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(porMsg);

    const department = document.getElementById("porDept")?.value || "";
    const por_email = document.getElementById("porEmail")?.value?.trim() || "";

    if (!department) return show(porMsg, "Select department.", true);
    if (!por_email) return show(porMsg, "POR email is required.", true);

    const { error } = await sb
      .from("ticket_por_map")
      .upsert({ department, por_email }, { onConflict: "department" });

    if (error) return show(porMsg, error.message, true);

    show(porMsg, "Saved ✅");
    document.getElementById("porEmail").value = "";
    await refreshPorMap();
  });
}

async function refreshPorMap() {
  hide(porMsg);
  const porRows = document.getElementById("porRows");
  if (!porRows) return;

  porRows.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

  const { data, error } = await sb.from("ticket_por_map").select("department,por_email").order("department");
  if (error) {
    porRows.innerHTML = `<tr><td colspan="3">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  porRows.innerHTML = (data || []).map(r => `
    <tr>
      <td>${escapeHtml(r.department)}</td>
      <td>${escapeHtml(r.por_email)}</td>
      <td>
        <button class="btn danger" data-act="delPor" data-dept="${escapeHtml(r.department)}">Delete</button>
      </td>
    </tr>
  `).join("");

  porRows.querySelectorAll("button[data-act='delPor']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const dept = btn.getAttribute("data-dept");
      if (!dept) return;
      const ok = confirm(`Delete POR mapping for ${dept}?`);
      if (!ok) return;

      const { error } = await sb.from("ticket_por_map").delete().eq("department", dept);
      if (error) return show(porMsg, error.message, true);

      show(porMsg, "Deleted ✅");
      await refreshPorMap();
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
    refreshTicketStatuses(), // ✅ NEW
    refreshStudentsCount(),

    // ticket validation
    refreshIrby(),
    refreshDepts(),
    refreshSubjects(),
    refreshCategories(),
    refreshPocMap(),
    refreshPorMap(),
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

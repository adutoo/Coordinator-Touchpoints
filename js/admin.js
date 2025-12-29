// js/admin.js
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { requireAdmin } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";

const userMsg = document.getElementById("userMsg");
const stuMsg = document.getElementById("stuMsg");
const medMsg = document.getElementById("medMsg");
const objMsg = document.getElementById("objMsg");
const ticketMsg = document.getElementById("ticketMsg");

function show(el, text, isErr = false) {
  if (!el) return;
  el.style.display = "block";
  el.style.borderColor = isErr
    ? "rgba(255,77,109,0.55)"
    : "rgba(124,92,255,0.55)";
  el.style.color = isErr
    ? "rgba(255,200,210,0.95)"
    : "rgba(255,255,255,0.72)";
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

  // Make Admin dropdowns match Entry page style
  const roleSel = document.getElementById("newRole");
  if (roleSel) enhanceSelect(roleSel, { placeholder: roleSel.getAttribute("data-placeholder") || "Select role..." });

  wireCreateAccount();
  wireFilePicker();
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

    // ✅ Recommended function endpoint
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
    if (!res.ok) {
      console.error("Create account failed:", res.status, text);
      return show(userMsg, `HTTP ${res.status} | ${text}`, true);
    }

    let out;
    try {
      out = JSON.parse(text);
    } catch {
      return show(userMsg, "Unexpected response from server.", true);
    }

    if (!out?.ok) return show(userMsg, out?.msg || "Create failed.", true);

    show(userMsg, "Account created ✅");

    // Reset form + keep role sane + refresh custom dropdown UI
    form.reset();
    const roleSel = document.getElementById("newRole");
    if (roleSel) {
      roleSel.value = "coordinator";
      refreshSelect(roleSel);
    }
  });
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

  // Save time_min
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

  // Toggle active
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
    refreshMediums(),
    refreshObjectives(),
    refreshTicketOptions(),
    refreshStudentsCount(),
  ]);
}

async function refreshStudentsCount() {
  const uploadMeta = document.getElementById("uploadMeta");
  const { count, error } = await sb
    .from("students")
    .select("id", { count: "exact", head: true });

  if (error) {
    if (uploadMeta) uploadMeta.textContent = "Students in DB: ?";
    return;
  }
  if (uploadMeta) uploadMeta.textContent = `Students in DB: ${count ?? 0}`;
}

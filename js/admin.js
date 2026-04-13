// js/admin.js
import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { requireAdmin } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy, setBusyProgress } from "./busy.js";
import { mountSessionAdminUI } from "./adminSessions.js";

const userMsg = document.getElementById("userMsg");
const userMgmtMsg = document.getElementById("userMgmtMsg");
const stuMsg = document.getElementById("stuMsg");
const stuDelMsg = document.getElementById("stuDelMsg");
const medMsg = document.getElementById("medMsg");
const objMsg = document.getElementById("objMsg");
const ticketMsg = document.getElementById("ticketMsg");
// ✅ Referral Status
const referralMsg = document.getElementById("referralMsg");

// Ticket Status
const statusMsg = document.getElementById("statusMsg");

// Session msg (only used for error display here)
const sessMsg = document.getElementById("sessMsg");

const irbyMsg = document.getElementById("irbyMsg");
const deptMsg = document.getElementById("deptMsg");
const subjMsg = document.getElementById("subjMsg");
const catMsg = document.getElementById("catMsg");
const pocMsg = document.getElementById("pocMsg");
const classPorMsg = document.getElementById("classPorMsg");

// ✅ Call settings msgs
const callPromptMsg = document.getElementById("callPromptMsg");
const coordMsg = document.getElementById("coordMsg");

// ✅ Ticket email webhook msg
const ticketEmailMsg = document.getElementById("ticketEmailMsg");

// -------------------- Busy helpers (prevent nested popups) --------------------
let __busyDepth = 0;
async function runBusy(title, fn) {
  if (__busyDepth > 0) return await fn(); // already showing a popup
  __busyDepth++;
  try {
    return await withBusy(title, fn);
  } finally {
    __busyDepth--;
  }
}

// -------------------- UI helpers --------------------
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

// ✅ app_settings keys for call feature
const CALL_PROMPT_KEY = "call_summary_prompt";
const COORD_CFG_KEY = "coordinators_config";
const REFERRAL_OPTIONS_TABLE = "referral_status_options";

// -------------------- settings helpers --------------------
async function readAppSetting(key) {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function upsertAppSetting(key, value) {
  const { error } = await sb.from("app_settings").upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}

function setSelectOptions(selectEl, items, getValue, getLabel) {
  if (!selectEl) return;
  selectEl.innerHTML =
    `<option value=""></option>` +
    (items || [])
      .map((x) => `<option value="${escapeHtml(getValue(x))}">${escapeHtml(getLabel(x))}</option>`)
      .join("");
  try {
    refreshSelect(selectEl);
  } catch {}
}

// -------------------- Boot --------------------
(async () => {
  await runBusy("Loading admin…", async () => {
    setBusyProgress(null, "Checking admin access…");
    await requireAdmin();

    setBusyProgress(null, "Loading UI…");
    await mountNav("admin");

    // Admin dropdown style
    const roleSel = document.getElementById("newRole");
    if (roleSel) enhanceSelect(roleSel, { placeholder: roleSel.getAttribute("data-placeholder") || "Select role..." });

    // Sessions dropdown style (important: enhance before mountSessionAdminUI)
    const sessDefault = document.getElementById("sessDefault");
    if (sessDefault) enhanceSelect(sessDefault, { placeholder: sessDefault.getAttribute("data-placeholder") || "Select default..." });

    // Ticket validation selects style
    const deptReqSub = document.getElementById("deptReqSub");
    if (deptReqSub) enhanceSelect(deptReqSub, { placeholder: deptReqSub.getAttribute("data-placeholder") || "Select..." });

    const catIrby = document.getElementById("catIrby");
    const catDept = document.getElementById("catDept");
    if (catIrby) enhanceSelect(catIrby, { placeholder: catIrby.getAttribute("data-placeholder") || "Select...", search: true });
    if (catDept) enhanceSelect(catDept, { placeholder: catDept.getAttribute("data-placeholder") || "Select...", search: true });

    // Mount Sessions admin UI (safe)
    setBusyProgress(null, "Loading sessions…");
    try {
      await mountSessionAdminUI();
    } catch (e) {
      console.error("mountSessionAdminUI failed:", e);
      show(sessMsg, `Sessions UI failed to load: ${String(e?.message || e)}`, true);
      // Don't throw: admin must still load
    }

    wireCreateAccount();
    wireManageUsers();
    wireFilePicker();
    wireStudentSearch();
    wireAddMedium();
    wireAddObjective();
    wireAddTicket();

    // Ticket Status
    wireAddTicketStatus();

    // ✅ Referral Status
    wireAddReferralStatus();

    // Ticket validation wires
    wireAddIrby();
    wireAddDept();
    wireAddSubject();
    wireAddCategory();
    wireAddPocMap();
    wireClassPorMap();

    // ✅ Call feature admin wires
    wireCallPrompt();
    wireCoordinatorDirectory();
    wireTicketEmailWebhook();

    setBusyProgress(null, "Loading data…");
    await refreshAll(); // popup stays until done
  });
})();

// -------------------- Create Account --------------------
function wireCreateAccount() {
  const form = document.getElementById("createUserForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(userMsg);

    await runBusy("Creating account…", async () => {
      const email = document.getElementById("newEmail")?.value?.trim() || "";
      const password = document.getElementById("newPassword")?.value || "";
      const display_name = document.getElementById("newName")?.value?.trim() || "";
      const role = document.getElementById("newRole")?.value || "coordinator";

      if (!email || !password || !display_name) {
        return show(userMsg, "Email, Display Name, and Password are required.", true);
      }

      setBusyProgress(null, "Reading session…");
      const { data: sessData, error: sessErr } = await sb.auth.getSession();
      if (sessErr) return show(userMsg, sessErr.message, true);

      const token = sessData?.session?.access_token;
      if (!token || token.split(".").length !== 3) {
        return show(userMsg, "Session token missing/invalid. Logout → Login again.", true);
      }

      setBusyProgress(null, "Calling create function…");
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
      try {
        out = JSON.parse(text);
      } catch {
        out = null;
      }
      if (!out?.ok) return show(userMsg, out?.msg || "Create failed.", true);

      show(userMsg, "Account created ✅");

      form.reset();
      const roleSel = document.getElementById("newRole");
      if (roleSel) {
        roleSel.value = "coordinator";
        refreshSelect(roleSel);
      }

      setBusyProgress(null, "Refreshing users…");
      await refreshUsers();
    });
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
    t = setTimeout(refreshUsers, 180); // keep light (no popup spam)
  };

  userSearch.addEventListener("input", trigger);

  userRefreshBtn.addEventListener("click", async () => {
    hide(userMgmtMsg);
    await runBusy("Loading users…", async () => {
      setBusyProgress(null, "Fetching…");
      await refreshUsers();
    });
  });

  userRows.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-del-user]");
    if (!btn) return;

    const userId = btn.getAttribute("data-del-user");
    const name = btn.getAttribute("data-name") || "this user";
    if (!userId) return;

    const ok = confirm(`Delete ${name}? This will remove login access.`);
    if (!ok) return;

    hide(userMgmtMsg);

    await runBusy("Deleting user…", async () => {
      setBusyProgress(null, "Reading session…");
      const { data: sessData } = await sb.auth.getSession();
      const token = sessData?.session?.access_token;
      if (!token) return show(userMgmtMsg, "Session missing. Login again.", true);

      setBusyProgress(null, "Calling delete function…");
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
      try {
        out = JSON.parse(text);
      } catch {
        out = null;
      }
      if (!out?.ok) return show(userMgmtMsg, out?.msg || "Delete failed.", true);

      show(userMgmtMsg, "User deleted ✅");

      setBusyProgress(null, "Refreshing list…");
      await refreshUsers();
    });
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

  userRows.innerHTML = data
    .map(
      (p) => `
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
  `
    )
    .join("");
}

// -------------------- ✅ Call Summary Prompt --------------------
function defaultCallPrompt() {
  return [
    "You are an assistant that summarizes a coordinator-parent call transcript.",
    "Return ONLY in this exact format:",
    "",
    "POSITIVES:",
    "- ...",
    "",
    "SUGGESTIONS:",
    "- ...",
    "",
    "Rules:",
    "1) Include a point only if it is clearly present in the transcript.",
    "2) Keep bullets short, actionable, and school-context.",
    "3) If nothing found in a section, write: - (None mentioned)",
  ].join("\n");
}

function parsePromptValue(v) {
  // supports stored as {prompt: "..."} OR raw string
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.prompt === "string") return v.prompt;
  return "";
}

async function refreshCallPrompt() {
  hide(callPromptMsg);
  const box = document.getElementById("callPromptText");
  if (!box) return;

  try {
    const v = await readAppSetting(CALL_PROMPT_KEY);
    const prompt = parsePromptValue(v) || defaultCallPrompt();
    box.value = prompt;
  } catch (e) {
    console.error(e);
    // still show default so UI works
    box.value = defaultCallPrompt();
    show(callPromptMsg, `Failed to load prompt: ${String(e?.message || e)}`, true);
  }
}

function wireCallPrompt() {
  const saveBtn = document.getElementById("callPromptSave");
  const box = document.getElementById("callPromptText");
  if (!saveBtn || !box) return;

  saveBtn.addEventListener("click", async () => {
    hide(callPromptMsg);
    try {
      await runBusy("Saving prompt…", async () => {
        const prompt = String(box.value || "").trim();
        if (!prompt) return show(callPromptMsg, "Prompt cannot be empty.", true);

        await upsertAppSetting(CALL_PROMPT_KEY, { prompt });
        show(callPromptMsg, "Prompt saved globally ✅");
      });
    } catch (e) {
      show(callPromptMsg, String(e?.message || e), true);
    }
  });
}

// -------------------- ✅ Coordinator Directory (Number -> Email) --------------------
function normalizeNumber(n) {
  let s = String(n ?? "").trim();
  s = s.replace(/[()\-\s]/g, "");
  if (s.startsWith("+")) s = "+" + s.slice(1).replace(/[^\d]/g, "");
  else s = s.replace(/[^\d]/g, "");
  return s;
}

function normalizeEmail(e) {
  return String(e ?? "").trim().toLowerCase();
}

function parseCoordValue(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object" && Array.isArray(v.coordinators)) return v.coordinators;
  if (typeof v === "object" && Array.isArray(v.list)) return v.list;
  return [];
}

function normalizeCoordinatorList(list) {
  const arr = Array.isArray(list) ? list : [];
  const cleaned = arr
    .map((x) => ({
      number: normalizeNumber(x?.number),
      email: normalizeEmail(x?.email),
    }))
    .filter((x) => x.number && x.email && x.email.includes("@"));

  const map = new Map();
  for (const c of cleaned) map.set(c.number, c.email); // last wins

  const out = Array.from(map.entries()).map(([number, email]) => ({ number, email }));
  out.sort((a, b) => a.email.localeCompare(b.email) || a.number.localeCompare(b.number));
  return out;
}

function renderCoordinatorRows(list) {
  const tbody = document.getElementById("coordRows");
  if (!tbody) return;

  if (!list?.length) {
    tbody.innerHTML = `<tr><td colspan="3">No coordinators added yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.email)}</td>
        <td>${escapeHtml(c.number)}</td>
        <td>
          <button class="btn danger" data-del-coord="${escapeHtml(c.number)}">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");
}

async function refreshCoordinatorDirectory() {
  hide(coordMsg);
  try {
    const v = await readAppSetting(COORD_CFG_KEY);
    const list = normalizeCoordinatorList(parseCoordValue(v));
    renderCoordinatorRows(list);
  } catch (e) {
    console.error(e);
    renderCoordinatorRows([]);
    show(coordMsg, `Failed to load coordinators: ${String(e?.message || e)}`, true);
  }
}

function wireCoordinatorDirectory() {
  const form = document.getElementById("coordForm");
  const tbody = document.getElementById("coordRows");
  if (!form || !tbody) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(coordMsg);

    try {
      await runBusy("Saving coordinator…", async () => {
        const numberRaw = document.getElementById("coordNumber")?.value || "";
        const emailRaw = document.getElementById("coordEmail")?.value || "";

        const number = normalizeNumber(numberRaw);
        const email = normalizeEmail(emailRaw);

        if (!number) return show(coordMsg, "Coordinator number is required.", true);
        if (!email || !email.includes("@")) return show(coordMsg, "Valid coordinator email is required.", true);

        const current = await readAppSetting(COORD_CFG_KEY).catch(() => null);
        const list = normalizeCoordinatorList(parseCoordValue(current));

        const map = new Map(list.map((x) => [x.number, x.email]));
        map.set(number, email);

        const next = normalizeCoordinatorList(Array.from(map.entries()).map(([n, em]) => ({ number: n, email: em })));

        await upsertAppSetting(COORD_CFG_KEY, { coordinators: next });

        renderCoordinatorRows(next);
        show(coordMsg, "Saved ✅");
        form.reset();
      });
    } catch (e2) {
      show(coordMsg, String(e2?.message || e2), true);
    }
  });

  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-del-coord]");
    if (!btn) return;

    const num = btn.getAttribute("data-del-coord");
    if (!num) return;

    const ok = confirm(`Delete coordinator mapping for ${num}?`);
    if (!ok) return;

    hide(coordMsg);

    try {
      await runBusy("Deleting coordinator…", async () => {
        const current = await readAppSetting(COORD_CFG_KEY).catch(() => null);
        const list = normalizeCoordinatorList(parseCoordValue(current));

        const next = list.filter((x) => x.number !== num);

        await upsertAppSetting(COORD_CFG_KEY, { coordinators: next });
        renderCoordinatorRows(next);
        show(coordMsg, "Deleted ✅");
      });
    } catch (e2) {
      show(coordMsg, String(e2?.message || e2), true);
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

    await runBusy("Uploading students…", async () => {
      const chunk = 500;
      let done = 0;

      while (done < parsedStudents.length) {
        const batch = parsedStudents.slice(done, done + chunk);
        const pct = Math.round((done / parsedStudents.length) * 100);
        setBusyProgress(pct, `Uploading ${done}/${parsedStudents.length}…`);

        const { error } = await sb.from("students").upsert(batch, { onConflict: "child_name" });
        if (error) return show(stuMsg, error.message, true);

        done += batch.length;
        show(stuMsg, `Uploaded ${done}/${parsedStudents.length}…`);
      }

      setBusyProgress(100, "Finalizing…");
      show(stuMsg, "Students uploaded ✅");

      await refreshStudentsCount();
    });
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

    stuRows.innerHTML = data
      .map(
        (s) => `
      <tr>
        <td>${escapeHtml(s.child_name)}</td>
        <td>${escapeHtml(s.student_name)}</td>
        <td>${escapeHtml(s.class_name)}</td>
        <td>${escapeHtml(s.section)}</td>
        <td>${escapeHtml(s.sr_number)}</td>
        <td><button class="btn danger" data-del-stu="${s.id}" data-name="${escapeHtml(s.child_name)}">Delete</button></td>
      </tr>
    `
      )
      .join("");
  };

  let t = null;
  stuSearch.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(run, 200);
  });

  stuRefreshBtn.addEventListener("click", async () => {
    await runBusy("Searching students…", async () => {
      setBusyProgress(null, "Searching…");
      await run();
    });
  });

  stuRows.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-del-stu]");
    if (!btn) return;

    const id = btn.getAttribute("data-del-stu");
    const name = btn.getAttribute("data-name") || "this student";
    if (!id) return;

    const ok = confirm(`Delete ${name} from students database?`);
    if (!ok) return;

    hide(stuDelMsg);

    await runBusy("Deleting student…", async () => {
      setBusyProgress(null, "Deleting from DB…");
      const { error } = await sb.from("students").delete().eq("id", id);
      if (error) return show(stuDelMsg, error.message, true);

      show(stuDelMsg, "Student deleted ✅");

      setBusyProgress(null, "Refreshing…");
      await run();
      await refreshStudentsCount();
    });
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

    await runBusy("Saving medium…", async () => {
      const label = document.getElementById("medLabel")?.value?.trim() || "";
      const time_min = Math.max(1, Number(document.getElementById("medTimeMin")?.value || 1));
      if (!label) return show(medMsg, "Medium Label is required.", true);

      const { error } = await sb.from("mediums").insert({ label, time_min, is_active: true, sort_order: 100 });
      if (error) return show(medMsg, error.message, true);

      show(medMsg, "Medium added ✅");
      form.reset();
      const t = document.getElementById("medTimeMin");
      if (t) t.value = "1";

      setBusyProgress(null, "Refreshing…");
      await refreshMediums();
    });
  });
}

async function refreshMediums() {
  hide(medMsg);
  const mediumRows = document.getElementById("mediumRows");
  if (!mediumRows) return;

  mediumRows.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

  const { data, error } = await sb.from("mediums").select("id,label,time_min,is_active,sort_order").order("sort_order").order("label");
  if (error) return show(medMsg, error.message, true);

  mediumRows.innerHTML = (data || [])
    .map(
      (m) => `
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
  `
    )
    .join("");

  mediumRows.querySelectorAll("button[data-act='saveTime']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Saving…", async () => {
        const id = Number(btn.dataset.id);
        const input = mediumRows.querySelector(`input[data-time-id="${id}"]`);
        const time_min = Math.max(1, Number(input?.value || 1));
        const { error } = await sb.from("mediums").update({ time_min }).eq("id", id);
        if (error) return show(medMsg, error.message, true);
        show(medMsg, "Time updated ✅");
      });
    });
  });

  mediumRows.querySelectorAll("button[data-act='toggle']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";
        const { error } = await sb.from("mediums").update({ is_active }).eq("id", id);
        if (error) return show(medMsg, error.message, true);
        await refreshMediums();
      });
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

    await runBusy("Saving objective…", async () => {
      const label = document.getElementById("objLabel")?.value?.trim() || "";
      if (!label) return show(objMsg, "Objective Label is required.", true);

      const { error } = await sb.from("objectives").insert({ label, is_active: true, sort_order: 100 });
      if (error) return show(objMsg, error.message, true);

      show(objMsg, "Objective added ✅");
      form.reset();
      await refreshObjectives();
    });
  });
}

async function refreshObjectives() {
  hide(objMsg);
  const objectiveRows = document.getElementById("objectiveRows");
  if (!objectiveRows) return;

  objectiveRows.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

  const { data, error } = await sb.from("objectives").select("id,label,is_active,sort_order").order("sort_order").order("label");
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
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";
        const { error } = await sb.from("objectives").update({ is_active }).eq("id", id);
        if (error) return show(objMsg, error.message, true);
        await refreshObjectives();
      });
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

    await runBusy("Saving option…", async () => {
      const label = document.getElementById("ticketLabel")?.value?.trim() || "";
      if (!label) return show(ticketMsg, "Option Label is required.", true);

      const { error } = await sb.from("ticket_raised_options").insert({ label, is_active: true, sort_order: 100 });
      if (error) return show(ticketMsg, error.message, true);

      show(ticketMsg, "Ticket option added ✅");
      form.reset();
      await refreshTicketOptions();
    });
  });
}

async function refreshTicketOptions() {
  hide(ticketMsg);
  const ticketRows = document.getElementById("ticketRows");
  if (!ticketRows) return;

  ticketRows.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

  const { data, error } = await sb.from("ticket_raised_options").select("id,label,is_active,sort_order").order("sort_order").order("label");
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
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";
        const { error } = await sb.from("ticket_raised_options").update({ is_active }).eq("id", id);
        if (error) return show(ticketMsg, error.message, true);
        await refreshTicketOptions();
      });
    });
  });
}

// -------------------- Ticket Statuses --------------------
function wireAddTicketStatus() {
  const form = document.getElementById("addStatusForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(statusMsg);

    await runBusy("Saving status…", async () => {
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
      const s = document.getElementById("statusSort");
      if (s) s.value = "100";

      await refreshTicketStatuses();
    });
  });
}

async function refreshTicketStatuses() {
  hide(statusMsg);

  const statusRows = document.getElementById("statusRows");
  if (!statusRows) return;

  statusRows.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

  const { data, error } = await sb.from("ticket_statuses").select("id,label,is_active,sort_order").order("sort_order").order("label");

  if (error) {
    statusRows.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  statusRows.innerHTML = (data || [])
    .map(
      (s) => `
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
  `
    )
    .join("");

  statusRows.querySelectorAll("button[data-act='saveStatus']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Saving…", async () => {
        const id = Number(btn.dataset.id);
        const sort_order = Number(statusRows.querySelector(`input[data-status-sort="${id}"]`)?.value || 100);

        const { error } = await sb.from("ticket_statuses").update({ sort_order }).eq("id", id);
        if (error) return show(statusMsg, error.message, true);

        show(statusMsg, "Saved ✅");
        await refreshTicketStatuses();
      });
    });
  });

  statusRows.querySelectorAll("button[data-act='toggleStatus']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";

        const { error } = await sb.from("ticket_statuses").update({ is_active }).eq("id", id);
        if (error) return show(statusMsg, error.message, true);

        await refreshTicketStatuses();
      });
    });
  });
}

// -------------------- ✅ Referral Status Options --------------------
function wireAddReferralStatus() {
  const form = document.getElementById("addReferralForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(referralMsg);

    await runBusy("Saving referral status…", async () => {
      const label = document.getElementById("refLabel")?.value?.trim() || "";
      const sort_order = Number(document.getElementById("refSort")?.value || 100);

      if (!label) return show(referralMsg, "Referral Status Label is required.", true);

      const { error } = await sb.from(REFERRAL_OPTIONS_TABLE).insert({
        label,
        is_active: true,
        sort_order,
      });

      if (error) return show(referralMsg, error.message, true);

      show(referralMsg, "Referral status added ✅");
      form.reset();
      const s = document.getElementById("refSort");
      if (s) s.value = "100";

      await refreshReferralStatuses();
    });
  });
}

async function refreshReferralStatuses() {
  hide(referralMsg);

  const rows = document.getElementById("referralRows");
  if (!rows) return;

  rows.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

  const { data, error } = await sb
    .from(REFERRAL_OPTIONS_TABLE)
    .select("id,label,is_active,sort_order")
    .order("sort_order")
    .order("label");

  if (error) {
    rows.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  rows.innerHTML = (data || [])
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td>
        <input
          type="number"
          data-ref-sort="${r.id}"
          value="${Number(r.sort_order ?? 100)}"
          style="width:90px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.22);color:rgba(255,255,255,0.92);padding:8px 10px;"
        />
      </td>
      <td>${r.is_active ? "Yes" : "No"}</td>
      <td class="row">
        <button class="btn" data-act="saveRef" data-id="${r.id}">Save</button>
        <button class="btn" data-act="toggleRef" data-id="${r.id}" data-val="${r.is_active ? "0" : "1"}">
          ${r.is_active ? "Deactivate" : "Activate"}
        </button>
      </td>
    </tr>
  `
    )
    .join("");

  rows.querySelectorAll("button[data-act='saveRef']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Saving…", async () => {
        const id = Number(btn.dataset.id);
        const sort_order = Number(rows.querySelector(`input[data-ref-sort="${id}"]`)?.value || 100);

        const { error } = await sb.from(REFERRAL_OPTIONS_TABLE).update({ sort_order }).eq("id", id);
        if (error) return show(referralMsg, error.message, true);

        show(referralMsg, "Saved ✅");
        await refreshReferralStatuses();
      });
    });
  });

  rows.querySelectorAll("button[data-act='toggleRef']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";

        const { error } = await sb.from(REFERRAL_OPTIONS_TABLE).update({ is_active }).eq("id", id);
        if (error) return show(referralMsg, error.message, true);

        await refreshReferralStatuses();
      });
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

    await runBusy("Saving…", async () => {
      const label = document.getElementById("irbyLabel")?.value?.trim() || "";
      const sort_order = Number(document.getElementById("irbySort")?.value || 100);

      if (!label) return show(irbyMsg, "Label is required.", true);

      const { error } = await sb.from("ticket_issue_raised_by").insert({ label, is_active: true, sort_order });
      if (error) return show(irbyMsg, error.message, true);

      show(irbyMsg, "Added ✅");
      form.reset();
      const x = document.getElementById("irbySort");
      if (x) x.value = "100";

      await refreshIrby();
    });
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
  setSelectOptions(catIrby, ticketIssueRaisedBy.filter((x) => x.is_active), (x) => x.label, (x) => x.label);

  irbyRows.innerHTML = (ticketIssueRaisedBy || [])
    .map(
      (x) => `
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
  `
    )
    .join("");

  irbyRows.querySelectorAll("button[data-act='toggleIrby']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";
        const { error } = await sb.from("ticket_issue_raised_by").update({ is_active }).eq("id", id);
        if (error) return show(irbyMsg, error.message, true);
        await refreshIrby();
      });
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

    await runBusy("Saving…", async () => {
      const label = document.getElementById("deptLabel")?.value?.trim() || "";
      const requires_subject = (document.getElementById("deptReqSub")?.value || "false") === "true";
      const sort_order = Number(document.getElementById("deptSort")?.value || 100);

      if (!label) return show(deptMsg, "Department label is required.", true);

      const { error } = await sb.from("ticket_departments").insert({ label, requires_subject, is_active: true, sort_order });
      if (error) return show(deptMsg, error.message, true);

      show(deptMsg, "Added ✅");
      form.reset();
      const ds = document.getElementById("deptSort");
      if (ds) ds.value = "100";
      if (deptReqSub) {
        deptReqSub.value = "false";
        refreshSelect(deptReqSub);
      }

      await refreshDepts();
    });
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
  const activeDepts = ticketDepartments.filter((x) => x.is_active);

  setSelectOptions(catDept, activeDepts, (x) => x.label, (x) => x.label);

  deptRows.innerHTML = (ticketDepartments || [])
    .map(
      (d) => `
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
  `
    )
    .join("");

  deptRows.querySelectorAll("button[data-act='saveDept']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Saving…", async () => {
        const id = Number(btn.dataset.id);
        const req = !!deptRows.querySelector(`input[type="checkbox"][data-dept-req="${id}"]`)?.checked;
        const sort = Number(deptRows.querySelector(`input[data-dept-sort="${id}"]`)?.value || 100);

        const { error } = await sb.from("ticket_departments").update({ requires_subject: req, sort_order: sort }).eq("id", id);
        if (error) return show(deptMsg, error.message, true);

        show(deptMsg, "Saved ✅");
        await refreshDepts();
      });
    });
  });

  deptRows.querySelectorAll("button[data-act='toggleDept']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";
        const { error } = await sb.from("ticket_departments").update({ is_active }).eq("id", id);
        if (error) return show(deptMsg, error.message, true);
        await refreshDepts();
      });
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

    await runBusy("Saving…", async () => {
      const label = document.getElementById("subjLabel")?.value?.trim() || "";
      const sort_order = Number(document.getElementById("subjSort")?.value || 100);
      if (!label) return show(subjMsg, "Label is required.", true);

      const { error } = await sb.from("ticket_subjects").insert({ label, is_active: true, sort_order });
      if (error) return show(subjMsg, error.message, true);

      show(subjMsg, "Added ✅");
      form.reset();
      const ss = document.getElementById("subjSort");
      if (ss) ss.value = "100";

      await refreshSubjects();
    });
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

  subjRows.innerHTML = (data || [])
    .map(
      (s) => `
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
  `
    )
    .join("");

  subjRows.querySelectorAll("button[data-act='toggleSubj']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";
        const { error } = await sb.from("ticket_subjects").update({ is_active }).eq("id", id);
        if (error) return show(subjMsg, error.message, true);
        await refreshSubjects();
      });
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

    await runBusy("Saving…", async () => {
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
        sort_order,
      });

      if (error) return show(catMsg, error.message, true);

      show(catMsg, "Added ✅");
      document.getElementById("catLabel").value = "";
      document.getElementById("catSort").value = "100";
      await refreshCategories();
    });
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

  catRows.innerHTML = (data || [])
    .map(
      (c) => `
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
  `
    )
    .join("");

  catRows.querySelectorAll("button[data-act='toggleCat']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runBusy("Updating…", async () => {
        const id = Number(btn.dataset.id);
        const is_active = btn.dataset.val === "1";
        const { error } = await sb.from("ticket_categories").update({ is_active }).eq("id", id);
        if (error) return show(catMsg, error.message, true);
        await refreshCategories();
      });
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

    await runBusy("Saving…", async () => {
      const reporter_email = document.getElementById("pocReporter")?.value?.trim() || "";
      const poc_email = document.getElementById("pocEmail")?.value?.trim() || "";

      if (!reporter_email || !poc_email) return show(pocMsg, "Both emails are required.", true);

      const { error } = await sb.from("ticket_poc_map").upsert({ reporter_email, poc_email }, { onConflict: "reporter_email" });

      if (error) return show(pocMsg, error.message, true);

      show(pocMsg, "Saved ✅");
      form.reset();
      await refreshPocMap();
    });
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

  pocRows.innerHTML = (data || [])
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.reporter_email)}</td>
      <td>${escapeHtml(r.poc_email)}</td>
      <td>
        <button class="btn danger" data-act="delPoc" data-reporter="${escapeHtml(r.reporter_email)}">Delete</button>
      </td>
    </tr>
  `
    )
    .join("");

  pocRows.querySelectorAll("button[data-act='delPoc']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reporter = btn.getAttribute("data-reporter");
      if (!reporter) return;
      const ok = confirm(`Delete mapping for ${reporter}?`);
      if (!ok) return;

      await runBusy("Deleting…", async () => {
        const { error } = await sb.from("ticket_poc_map").delete().eq("reporter_email", reporter);
        if (error) return show(pocMsg, error.message, true);

        show(pocMsg, "Deleted ✅");
        await refreshPocMap();
      });
    });
  });
}

// -------------------- ✅ Ticket Email Webhook (Apps Script URL) --------------------
function wireTicketEmailWebhook() {
  const saveBtn  = document.getElementById("ticketEmailSaveBtn");
  const clearBtn = document.getElementById("ticketEmailClearBtn");
  const urlInput = document.getElementById("ticketEmailWebhookUrl");
  if (!saveBtn || !clearBtn || !urlInput) return;

  saveBtn.addEventListener("click", async () => {
    hide(ticketEmailMsg);
    try {
      await runBusy("Saving webhook URL…", async () => {
        const url = (urlInput.value || "").trim();
        if (!url) return show(ticketEmailMsg, "URL cannot be empty. Use Clear to disable.", true);
        if (!url.startsWith("https://script.google.com")) {
          return show(ticketEmailMsg, "URL must start with https://script.google.com", true);
        }
        await upsertAppSetting("ticket_email_webhook_url", url);
        show(ticketEmailMsg, "Webhook URL saved ✅ Emails will now auto-send on ticket creation.");
      });
    } catch (e) {
      show(ticketEmailMsg, String(e?.message || e), true);
    }
  });

  clearBtn.addEventListener("click", async () => {
    hide(ticketEmailMsg);
    try {
      await runBusy("Clearing webhook URL…", async () => {
        await upsertAppSetting("ticket_email_webhook_url", "");
        urlInput.value = "";
        show(ticketEmailMsg, "Webhook URL cleared. Email notifications disabled.");
      });
    } catch (e) {
      show(ticketEmailMsg, String(e?.message || e), true);
    }
  });
}

async function refreshTicketEmailWebhook() {
  hide(ticketEmailMsg);
  const urlInput = document.getElementById("ticketEmailWebhookUrl");
  if (!urlInput) return;
  try {
    const v = await readAppSetting("ticket_email_webhook_url");
    urlInput.value = (v || "").trim();
  } catch (e) {
    console.warn("Could not load ticket email webhook URL:", e);
  }
}

// -------------------- Class POR Map (Class → POR Email) --------------------
function wireClassPorMap() {
  const form = document.getElementById("addClassPorForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hide(classPorMsg);

    await runBusy("Saving class POR mapping…", async () => {
      const por_email = (document.getElementById("classPorEmail")?.value || "").trim();
      const por_name  = (document.getElementById("classPorName")?.value  || "").trim();

      // Collect all checked classes
      const checkboxes = document.querySelectorAll(".classPorCheck:checked");
      const selectedClasses = Array.from(checkboxes).map(c => c.value).filter(Boolean);

      if (!por_email || !por_email.includes("@")) return show(classPorMsg, "Valid POR Email is required.", true);
      if (!selectedClasses.length) return show(classPorMsg, "Select at least one class.", true);

      // Upsert each class mapping
      const rows = selectedClasses.map(class_name => ({ class_name, por_email, por_name: por_name || null }));
      const { error } = await sb.from("class_por_map").upsert(rows, { onConflict: "class_name" });

      if (error) return show(classPorMsg, error.message, true);

      show(classPorMsg, `Saved ${selectedClasses.length} class(es) ✅`);
      document.getElementById("classPorEmail").value = "";
      document.getElementById("classPorName").value = "";

      // Uncheck all
      document.querySelectorAll(".classPorCheck").forEach(c => { c.checked = false; });

      await refreshClassPorMap();
    });
  });
}

async function refreshClassPorMap() {
  hide(classPorMsg);
  const tbody = document.getElementById("classPorRows");
  const classList = document.getElementById("classPorClassList");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

  // Load distinct classes from students table
  if (classList) {
    const { data: stuData } = await sb
      .from("students")
      .select("class_name")
      .order("class_name");

    const classes = [...new Set((stuData || []).map(s => s.class_name).filter(Boolean))].sort();

    classList.innerHTML = classes.map(c => `
      <label style="display:inline-flex;align-items:center;gap:6px;margin:4px 8px 4px 0;cursor:pointer;">
        <input type="checkbox" class="classPorCheck" value="${escapeHtml(c)}" />
        <span>${escapeHtml(c)}</span>
      </label>
    `).join("");

    if (!classes.length) {
      classList.innerHTML = `<span style="opacity:.6;">No classes found in students table.</span>`;
    }
  }

  // Load current mappings
  const { data, error } = await sb
    .from("class_por_map")
    .select("id,class_name,por_email,por_name")
    .order("class_name");

  if (error) {
    tbody.innerHTML = `<tr><td colspan="3">${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="3">No mappings yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = (data || []).map(r => `
    <tr>
      <td>${escapeHtml(r.class_name)}</td>
      <td>${escapeHtml(r.por_email)}${r.por_name ? ` <span style="opacity:.6;font-size:12px;">(${escapeHtml(r.por_name)})</span>` : ""}</td>
      <td>
        <button class="btn danger" data-act="delClassPor" data-id="${r.id}" data-class="${escapeHtml(r.class_name)}">Delete</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("button[data-act='delClassPor']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const cls = btn.getAttribute("data-class");
      if (!confirm(`Remove POR mapping for class "${cls}"?`)) return;

      await runBusy("Deleting…", async () => {
        const { error } = await sb.from("class_por_map").delete().eq("id", id);
        if (error) return show(classPorMsg, error.message, true);
        show(classPorMsg, "Deleted ✅");
        await refreshClassPorMap();
      });
    });
  });
}

// -------------------- Refresh helpers --------------------
async function refreshAll() {
  setBusyProgress(5, "Loading users…");
  await refreshUsers();

  setBusyProgress(15, "Loading mediums…");
  await refreshMediums();

  setBusyProgress(25, "Loading objectives…");
  await refreshObjectives();

  setBusyProgress(35, "Loading ticket options…");
  await refreshTicketOptions();

  setBusyProgress(45, "Loading ticket statuses…");
  await refreshTicketStatuses();

  setBusyProgress(50, "Loading referral statuses…");
  await refreshReferralStatuses();

  setBusyProgress(55, "Counting students…");
  await refreshStudentsCount();

  setBusyProgress(65, "Loading ticket validations…");
  await refreshIrby();
  await refreshDepts();
  await refreshSubjects();
  await refreshCategories();
  await refreshPocMap();
  await refreshClassPorMap();

  // ✅ Call feature settings
  setBusyProgress(90, "Loading call settings…");
  await refreshCallPrompt();
  await refreshCoordinatorDirectory();
  await refreshTicketEmailWebhook();

  setBusyProgress(100, "Done");
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

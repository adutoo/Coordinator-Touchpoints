// js/ticketEntry.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe, getMyProfile } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy, setBusyProgress } from "./busy.js";

const tStudent = document.getElementById("tStudent");
const tIssue = document.getElementById("tIssue");
const tDept = document.getElementById("tDept");
const tSubject = document.getElementById("tSubject");
const tCategory = document.getElementById("tCategory");

const subjectWrap = document.getElementById("subjectWrap");
const incidentWrap = document.getElementById("incidentWrap");
const counselWrap = document.getElementById("counselWrap");

const tIncDate = document.getElementById("tIncDate");
const tIncTime = document.getElementById("tIncTime");
const tIncBy = document.getElementById("tIncBy");
const tIncLoc = document.getElementById("tIncLoc");

const tDesc = document.getElementById("tDesc");
const tMobile = document.getElementById("tMobile");
const tReset = document.getElementById("tReset");
const tMsg = document.getElementById("tMsg");
const form = document.getElementById("ticketForm");

let students = [];
let deptMeta = new Map(); // label -> requires_subject

function show(text, isError = false) {
  tMsg.style.display = "block";
  tMsg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  tMsg.style.color = isError ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  tMsg.textContent = text;
}
function hideMsg() { tMsg.style.display = "none"; }

function pad(n){ return String(n).padStart(2,"0"); }
function genTicketNumber() {
  const d = new Date();
  const date = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3,"0")}`;
  const rand = Math.random().toString(36).substring(2,6).toUpperCase();
  return `TICKET-${date}-${time}-${rand}`;
}

async function fetchAllStudents() {
  const all = [];
  let offset = 0;
  const chunk = 1000;
  while (true) {
    const { data, error } = await sb
      .from("students")
      .select("child_name,student_name,class_name,section,sr_number")
      .order("child_name")
      .range(offset, offset + chunk - 1);

    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    offset += data.length;
    if (data.length < chunk) break;
  }
  return all;
}

function applyConditionals() {
  const dept = tDept.value || "";
  const issue = tIssue.value || "";

  const requiresSubject = deptMeta.get(dept) === true;
  subjectWrap.style.display = requiresSubject ? "block" : "none";
  if (!requiresSubject) tSubject.value = "";

  // Discipline incident fields when dept is Discipline and Behaviour AND issueRaisedBy is not Parent
  const showIncident = (dept === "Discipline and Behaviour" && issue.toLowerCase() !== "parent");
  incidentWrap.style.display = showIncident ? "block" : "none";
  if (!showIncident) {
    tIncDate.value = "";
    tIncTime.value = "";
    tIncBy.value = "";
    tIncLoc.value = "";
  }

  // Counseling link
  counselWrap.style.display = (dept === "Counseling Psychologist") ? "block" : "none";

  refreshSelect(tSubject);
}

async function loadCategories() {
  // Reset category UI always (no DB)
  tCategory.innerHTML = `<option value=""></option>`;
  refreshSelect(tCategory);

  const issue = tIssue.value;
  const dept = tDept.value;
  if (!issue || !dept) return;

  // DB task => show popup progress
  await withBusy("Loading categories…", async () => {
    const { data, error } = await sb
      .from("ticket_categories")
      .select("label")
      .eq("is_active", true)
      .eq("issue_raised_by", issue)
      .eq("department", dept)
      .order("sort_order")
      .order("label");

    if (error) {
      show(error.message, true);
      return;
    }

    tCategory.innerHTML =
      `<option value=""></option>` +
      (data || []).map(x => `<option value="${x.label}">${x.label}</option>`).join("");

    refreshSelect(tCategory);
  });
}

(async () => {
  await mountNav("ticket-entry");

  try {
    await withBusy("Loading Ticket Entry…", async () => {
      setBusyProgress(null, "Checking login…");

      // Require login
      const me = await getMe();
      if (!me) {
        show("Not logged in.", true);
        return;
      }

      setBusyProgress(null, "Loading dropdown data…");

      // Load validations + students
      const [issueR, deptR, subjR] = await Promise.all([
        sb.from("ticket_issue_raised_by").select("label,is_active").eq("is_active", true).order("sort_order").order("label"),
        sb.from("ticket_departments").select("label,requires_subject,is_active").eq("is_active", true).order("sort_order").order("label"),
        sb.from("ticket_subjects").select("label,is_active").eq("is_active", true).order("sort_order").order("label"),
      ]);

      if (issueR.error) { show(issueR.error.message, true); return; }
      if (deptR.error)  { show(deptR.error.message, true);  return; }
      if (subjR.error)  { show(subjR.error.message, true);  return; }

      setBusyProgress(null, "Loading students…");
      students = await fetchAllStudents();

      // Build selects
      tStudent.innerHTML =
        `<option value=""></option>` +
        students.map(s => `<option value="${s.child_name}">${s.child_name}</option>`).join("");

      tIssue.innerHTML =
        `<option value=""></option>` +
        (issueR.data || []).map(x => `<option value="${x.label}">${x.label}</option>`).join("");

      deptMeta = new Map((deptR.data || []).map(d => [d.label, !!d.requires_subject]));
      tDept.innerHTML =
        `<option value=""></option>` +
        (deptR.data || []).map(x => `<option value="${x.label}">${x.label}</option>`).join("");

      tSubject.innerHTML =
        `<option value=""></option>` +
        (subjR.data || []).map(x => `<option value="${x.label}">${x.label}</option>`).join("");

      tCategory.innerHTML = `<option value=""></option>`;

      // Custom selects (search everywhere, especially student)
      enhanceSelect(tStudent, { placeholder: "Select student...", search: true, searchThreshold: 0 });
      enhanceSelect(tIssue, { placeholder: "Select...", search: true });
      enhanceSelect(tDept, { placeholder: "Select...", search: true });
      enhanceSelect(tSubject, { placeholder: "Select subject...", search: true });
      enhanceSelect(tCategory, { placeholder: "Select category...", search: true });

      applyConditionals();

      // DB task (if issue+dept selected)
      await loadCategories();

      hideMsg();
    });
  } catch (e) {
    console.error(e);
    show(e?.message || String(e), true);
  }
})();

tDept.addEventListener("change", async () => {
  applyConditionals();
  await loadCategories();
});

tIssue.addEventListener("change", async () => {
  applyConditionals();
  await loadCategories();
});

tReset.addEventListener("click", async () => {
  form.reset();
  applyConditionals();
  await loadCategories(); // includes busy only if it hits DB
  hideMsg();

  refreshSelect(tStudent);
  refreshSelect(tIssue);
  refreshSelect(tDept);
  refreshSelect(tSubject);
  refreshSelect(tCategory);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMsg();

  await withBusy("Creating ticket…", async () => {
    setBusyProgress(null, "Checking login…");

    const me = await getMe();
    if (!me) { show("Not logged in.", true); return; }

    setBusyProgress(null, "Loading your profile…");
    await getMyProfile(me.id); // keep if you need later (even if unused now)

    const child = tStudent.value;
    const issue = tIssue.value;
    const dept = tDept.value;
    const category = tCategory.value;
    const desc = (tDesc.value || "").trim();

    if (!child || !issue || !dept || !category || !desc) {
      show("Please fill Student, Issue Raised By, Department, Category and Description.", true);
      return;
    }

    const requiresSubject = deptMeta.get(dept) === true;
    const subject = (tSubject.value || "");
    if (requiresSubject && !subject) {
      show("Please select Subject.", true);
      return;
    }

    const s = students.find(x => x.child_name === child);

    // Auto POC + POR
    let poc = me.email;
    let por = "";

    setBusyProgress(null, "Resolving POC / POR…");
    const pocR = await sb
      .from("ticket_poc_map")
      .select("poc_email")
      .eq("reporter_email", me.email)
      .maybeSingle();

    if (!pocR.error && pocR.data?.poc_email) poc = pocR.data.poc_email;

    const porR = await sb
      .from("ticket_por_map")
      .select("por_email")
      .eq("department", dept)
      .maybeSingle();

    if (!porR.error && porR.data?.por_email) por = porR.data.por_email;

    // ✅ NEW: If POR not set for this department, use POC
    if (!por) por = poc;

    const ticket_number = genTicketNumber();

    const payload = {
      ticket_number,

      student_child_name: child,
      student_name: s?.student_name ?? "",
      class_name: s?.class_name ?? "",
      section: s?.section ?? "",
      scholar_number: s?.sr_number ?? "",

      issue_raised_by: issue,
      department: dept,
      subject: subject || null,
      category,
      description: desc,

      reporter_user_id: me.id,
      reporter_email: me.email,
      reporter_mobile: (tMobile.value || "").trim() || null,

      date_of_incident: tIncDate.value || null,
      time_of_incident: tIncTime.value || null,
      incident_reported_by: (tIncBy.value || "").trim() || null,
      location_of_incident: (tIncLoc.value || "").trim() || null,

      point_of_contact: poc || null,
      point_of_resolution: por || null,

      ticket_status: null,
    };

    setBusyProgress(null, "Saving ticket to DB…");
    const { error } = await sb.from("tickets").insert(payload);
    if (error) {
      show(error.message, true);
      return;
    }

    show(`Ticket created ✅ ${ticket_number}`);

    // Reset UI (no DB)
    form.reset();
    applyConditionals();
    await loadCategories(); // busy only if it hits DB

    refreshSelect(tStudent);
    refreshSelect(tIssue);
    refreshSelect(tDept);
    refreshSelect(tSubject);
    refreshSelect(tCategory);
  }).catch((err) => {
    console.error(err);
    show(err?.message || String(err), true);
  });
});

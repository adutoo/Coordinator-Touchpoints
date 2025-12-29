// js/entry.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe, getMyProfile } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";

const childSelect = document.getElementById("childSelect");
const mediumSelect = document.getElementById("mediumSelect");
const objectiveSelect = document.getElementById("objectiveSelect");

const positives = document.getElementById("positives");
const suggestion = document.getElementById("suggestion");
const ticketRaised = document.getElementById("ticketRaised"); // required
const ticketNumber = document.getElementById("ticketNumber"); // optional
const timeAuto = document.getElementById("timeAuto");

const studentName = document.getElementById("studentName");
const className = document.getElementById("className");
const section = document.getElementById("section");
const srNumber = document.getElementById("srNumber");

const form = document.getElementById("tpForm");
const resetBtn = document.getElementById("resetBtn");
const msg = document.getElementById("msg");

let students = [];
let mediums = [];

function show(text, isError = false) {
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.style.color = isError ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  msg.textContent = text;
}
function hideMsg() { msg.style.display = "none"; }

function fillStudentAuto(childName) {
  const s = students.find((x) => x.child_name === childName);
  studentName.value = s?.student_name ?? "";
  className.value = s?.class_name ?? "";
  section.value = s?.section ?? "";
  srNumber.value = s?.sr_number ?? "";
}

function getMediumTimeMin(label) {
  const m = mediums.find((x) => x.label === label);
  return Math.max(1, Number(m?.time_min ?? 1));
}

function fillTimeFromMedium(mediumLabel) {
  const minutes = getMediumTimeMin(mediumLabel);
  timeAuto.value = `${minutes} min`;
  return minutes;
}

function isoWeekNumber(dateObj) {
  const now = new Date(dateObj);
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function refreshAllCustomSelects() {
  refreshSelect(childSelect);
  refreshSelect(mediumSelect);
  refreshSelect(objectiveSelect);
  refreshSelect(ticketRaised);
}

(async () => {
  await mountNav("entry");

  const [stuR, medR, objR, tickR] = await Promise.all([
    sb.from("students")
      .select("child_name,student_name,class_name,section,sr_number")
      .order("child_name"),

    sb.from("mediums")
      .select("label,time_min,is_active")
      .eq("is_active", true)
      .order("sort_order")
      .order("label"),

    sb.from("objectives")
      .select("label,is_active")
      .eq("is_active", true)
      .order("sort_order")
      .order("label"),

    sb.from("ticket_raised_options")
      .select("label,is_active")
      .eq("is_active", true)
      .order("sort_order")
      .order("label"),
  ]);

  if (stuR.error) return show(stuR.error.message, true);
  if (medR.error) return show(medR.error.message, true);
  if (objR.error) return show(objR.error.message, true);
  if (tickR.error) return show(tickR.error.message, true);

  students = stuR.data || [];
  mediums = medR.data || [];

  childSelect.innerHTML =
    `<option value=""></option>` +
    students.map((s) => `<option value="${s.child_name}">${s.child_name}</option>`).join("");

  mediumSelect.innerHTML =
    `<option value=""></option>` +
    mediums.map((m) => `<option value="${m.label}">${m.label}</option>`).join("");

  objectiveSelect.innerHTML =
    `<option value=""></option>` +
    (objR.data || []).map((o) => `<option value="${o.label}">${o.label}</option>`).join("");

  ticketRaised.innerHTML =
    `<option value=""></option>` +
    (tickR.data || []).map((t) => `<option value="${t.label}">${t.label}</option>`).join("");

  // Custom dropdowns (+ search for big child list)
  enhanceSelect(childSelect, { placeholder: "Select child...", search: true, searchThreshold: 0 });
  enhanceSelect(mediumSelect, { placeholder: "Select medium..." });
  enhanceSelect(objectiveSelect, { placeholder: "Select objective..." });
  enhanceSelect(ticketRaised, { placeholder: "Ticket raised?" });

  fillStudentAuto("");
  timeAuto.value = "1 min";
  refreshAllCustomSelects();
  hideMsg();
})();

childSelect.addEventListener("change", () => fillStudentAuto(childSelect.value));
mediumSelect.addEventListener("change", () => fillTimeFromMedium(mediumSelect.value));

resetBtn.addEventListener("click", () => {
  form.reset();

  childSelect.value = "";
  mediumSelect.value = "";
  objectiveSelect.value = "";
  ticketRaised.value = "";

  fillStudentAuto("");
  timeAuto.value = "1 min";
  refreshAllCustomSelects();
  hideMsg();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMsg();

  if (!childSelect.value || !mediumSelect.value || !objectiveSelect.value) {
    return show("Please select Child Name, Medium, and Objective.", true);
  }
  if (!ticketRaised.value) {
    return show("Please select Ticket raised?", true);
  }

  const me = await getMe();
  if (!me) return show("Not logged in.", true);

  const profile = await getMyProfile(me.id);

  const now = new Date();
  const week = isoWeekNumber(now);

  const s = students.find((x) => x.child_name === childSelect.value);

  const time_min = fillTimeFromMedium(mediumSelect.value);
  const timeText = `${time_min} min`;

  const payload = {
    child_name: childSelect.value,
    medium: mediumSelect.value,
    objective: objectiveSelect.value,

    positives: positives.value.trim(),
    suggestion: suggestion.value.trim(),

    ticket_raised: ticketRaised.value,
    ticket_number: (ticketNumber.value || "").trim(), // optional

    owner_user_id: me.id,
    owner_email: me.email,
    correct_owner: profile.display_name,
    owner_name: profile.display_name,

    touch_timestamp: now.toISOString(),

    student_name: s?.student_name ?? "",
    class_name: s?.class_name ?? "",
    section: s?.section ?? "",
    sr_number: s?.sr_number ?? "",

    week,
    month: now.getMonth() + 1,
    year: now.getFullYear(),

    comments_concat: positives.value.trim(),
    time: timeText,
    time_min,
  };

  const { error } = await sb.from("touchpoints").insert(payload);
  if (error) return show(error.message, true);

  show("Saved! ✅");

  form.reset();
  childSelect.value = "";
  mediumSelect.value = "";
  objectiveSelect.value = "";
  ticketRaised.value = "";

  fillStudentAuto("");
  timeAuto.value = "1 min";
  refreshAllCustomSelects();
});

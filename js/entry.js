// js/entry.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe, getMyProfile } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";

const entriesEl = document.getElementById("entries");
const tpl = document.getElementById("entryTpl");
const addEntryBtn = document.getElementById("addEntryBtn");
const form = document.getElementById("tpForm");
const resetBtn = document.getElementById("resetBtn");
const msg = document.getElementById("msg");

let students = [];
let studentsByChild = new Map();
let mediums = [];
let objectives = [];
let ticketOptions = [];

function show(text, isError = false) {
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.style.color = isError ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  msg.textContent = text;
}
function hideMsg() { msg.style.display = "none"; }

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtLocalTS(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function escText(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function escAttr(s) {
  return escText(s).replaceAll('"', "&quot;");
}

// ✅ fetch ALL rows (Supabase often returns only ~1000 if not paged)
async function fetchAll(table, selectCols, orderCol) {
  const out = [];
  const chunk = 1000;
  let offset = 0;

  while (true) {
    let q = sb.from(table).select(selectCols).range(offset, offset + chunk - 1);
    if (orderCol) q = q.order(orderCol);

    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;

    out.push(...data);
    offset += data.length;
    if (data.length < chunk) break;
  }
  return out;
}

function isoWeekNumber(dateObj) {
  const now = new Date(dateObj);
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getMediumTimeMin(label) {
  const m = mediums.find(x => x.label === label);
  return Math.max(1, Number(m?.time_min ?? 1));
}

function buildOptions(list, valueKey = "label", labelKey = "label") {
  return `<option value=""></option>` + list.map(x => {
    const v = escAttr(x[valueKey]);
    const t = escText(x[labelKey]);
    return `<option value="${v}">${t}</option>`;
  }).join("");
}

function blockRefs(block) {
  const q = (sel) => block.querySelector(sel);
  return {
    child: q('select[data-field="child"]'),
    medium: q('select[data-field="medium"]'),
    objective: q('select[data-field="objective"]'),
    positives: q('textarea[data-field="positives"]'),
    suggestion: q('textarea[data-field="suggestion"]'),
    ticketRaised: q('select[data-field="ticketRaised"]'),
    ticketNumber: q('input[data-field="ticketNumber"]'),
    timeAuto: q('input[data-field="timeAuto"]'),
    tsAuto: q('input[data-field="tsAuto"]'),
    studentName: q('input[data-field="studentName"]'),
    className: q('input[data-field="className"]'),
    section: q('input[data-field="section"]'),
    srNumber: q('input[data-field="srNumber"]'),
    removeBtn: q(".tp-remove"),
    nEl: q(".tp-entry-n"),
  };
}

function fillStudentAuto(refs) {
  const s = studentsByChild.get(refs.child.value);
  refs.studentName.value = s?.student_name ?? "";
  refs.className.value = s?.class_name ?? "";
  refs.section.value = s?.section ?? "";
  refs.srNumber.value = s?.sr_number ?? "";
}

function fillTimeAuto(refs) {
  const minutes = getMediumTimeMin(refs.medium.value);
  refs.timeAuto.value = `${minutes} min`;
  return minutes;
}

function refreshNumbers() {
  const blocks = Array.from(entriesEl.querySelectorAll(".tp-entry"));
  blocks.forEach((b, i) => {
    const refs = blockRefs(b);
    refs.nEl.textContent = `#${i + 1}`;
    refs.removeBtn.style.display = blocks.length > 1 ? "inline-flex" : "none";
  });
}

function enhanceBlockSelects(refs) {
  // child: search enabled (big list)
  enhanceSelect(refs.child, { placeholder: "Select child...", search: true, searchThreshold: 0 });

  enhanceSelect(refs.medium, { placeholder: "Select medium..." });
  enhanceSelect(refs.objective, { placeholder: "Select objective..." });

  // ticket optional
  enhanceSelect(refs.ticketRaised, { placeholder: "Ticket raised? (Optional)" });

  refreshSelect(refs.child);
  refreshSelect(refs.medium);
  refreshSelect(refs.objective);
  refreshSelect(refs.ticketRaised);
}

function createBlock(cloneFrom = null) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const refs = blockRefs(node);

  // inject options
  refs.child.innerHTML = `<option value=""></option>` + students.map(s =>
    `<option value="${escAttr(s.child_name)}">${escText(s.child_name)}</option>`
  ).join("");

  refs.medium.innerHTML = buildOptions(mediums, "label", "label");
  refs.objective.innerHTML = buildOptions(objectives, "label", "label");
  refs.ticketRaised.innerHTML = buildOptions(ticketOptions, "label", "label");

  // default
  refs.timeAuto.value = "1 min";
  refs.tsAuto.value = "";

  // events
  refs.child.addEventListener("change", () => {
    fillStudentAuto(refs);
    refreshSelect(refs.child);
  });
  refs.medium.addEventListener("change", () => {
    fillTimeAuto(refs);
    refreshSelect(refs.medium);
  });

  refs.removeBtn.addEventListener("click", () => {
    node.remove();
    refreshNumbers();
  });

  // clone values if needed
  if (cloneFrom) {
    const src = blockRefs(cloneFrom);

    refs.child.value = src.child.value;
    refs.medium.value = src.medium.value;
    refs.objective.value = src.objective.value;
    refs.ticketRaised.value = src.ticketRaised.value;
    refs.ticketNumber.value = src.ticketNumber.value;

    refs.positives.value = src.positives.value;
    refs.suggestion.value = src.suggestion.value;

    fillStudentAuto(refs);
    fillTimeAuto(refs);
  } else {
    fillStudentAuto(refs);
    fillTimeAuto(refs);
  }

  entriesEl.appendChild(node);
  enhanceBlockSelects(refs);
  refreshNumbers();
}

(async () => {
  await mountNav("entry");
  hideMsg();

  try {
    const [stu, med, obj, tick] = await Promise.all([
      fetchAll("students", "child_name,student_name,class_name,section,sr_number", "child_name"),
      sb.from("mediums").select("label,time_min,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
      sb.from("objectives").select("label,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
      sb.from("ticket_raised_options").select("label,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
    ]);

    students = stu || [];
    studentsByChild = new Map(students.map(s => [s.child_name, s]));

    mediums = med.data || [];
    objectives = obj.data || [];
    ticketOptions = tick.data || [];

    // first block
    createBlock(null);
    show(`Loaded ${students.length} students ✅`);
    setTimeout(hideMsg, 1200);
  } catch (e) {
    console.error(e);
    show(e?.message || String(e), true);
  }
})();

addEntryBtn.addEventListener("click", () => {
  const blocks = Array.from(entriesEl.querySelectorAll(".tp-entry"));
  const last = blocks[blocks.length - 1] || null;
  createBlock(last);
});

resetBtn.addEventListener("click", () => {
  hideMsg();
  entriesEl.innerHTML = "";
  createBlock(null);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMsg();

  const me = await getMe();
  if (!me) return show("Not logged in.", true);

  const profile = await getMyProfile(me.id);

  const blocks = Array.from(entriesEl.querySelectorAll(".tp-entry"));
  if (!blocks.length) return show("Add at least one entry.", true);

  const now = new Date();
  const week = isoWeekNumber(now);

  const payloads = [];

  for (let i = 0; i < blocks.length; i++) {
    const refs = blockRefs(blocks[i]);

    const child_name = refs.child.value;
    const medium = refs.medium.value;
    const objective = refs.objective.value;

    if (!child_name || !medium || !objective) {
      return show(`Entry #${i + 1}: Please select Child Name, Medium, and Objective.`, true);
    }

    const s = studentsByChild.get(child_name);
    const positives = refs.positives.value.trim();
    const suggestion = refs.suggestion.value.trim();

    // ✅ Ticket raised OPTIONAL now
    const ticket_raised = refs.ticketRaised.value ? refs.ticketRaised.value : null;

    const time_min = fillTimeAuto(refs);
    const timeText = `${time_min} min`;

    // ✅ Comments Concat = positives + "\n" + suggestion (only add \n when both exist)
    const comments_concat =
      positives && suggestion ? `${positives}\n${suggestion}` :
      positives ? positives :
      suggestion ? suggestion : "";

    payloads.push({
      child_name,
      medium,
      objective,
      positives,
      suggestion,

      ticket_raised,
      ticket_number: (refs.ticketNumber.value || "").trim(),

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

      comments_concat,
      time: timeText,
      time_min,
    });

    refs.tsAuto.value = fmtLocalTS(now);
  }

  show(`Saving ${payloads.length} entries…`);

  const { error } = await sb.from("touchpoints").insert(payloads);
  if (error) return show(error.message, true);

  show(`Saved ${payloads.length} entries ✅`);

  entriesEl.innerHTML = "";
  createBlock(null);
});

// js/entry.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe, getMyProfile } from "./auth.js";
import { enhanceSelect, refreshSelect } from "./customSelect.js";
import { withBusy, setBusyProgress } from "./busy.js";

const entriesEl = document.getElementById("entries");
const tpl = document.getElementById("entryTpl");
const addEntryBtn = document.getElementById("addEntryBtn");
const form = document.getElementById("tpForm");
const resetBtn = document.getElementById("resetBtn");
const msg = document.getElementById("msg");

const TICKETS_TABLE = "tickets";
const TICKET_SELECT = "ticket_number,student_name,department,category";
const TICKET_MATCH_FIELD = "student_name";

let students = [];
let studentsByChild = new Map();
let mediums = [];
let objectives = [];
let ticketOptions = [];

const ticketsCache = new Map(); // student_name -> list

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
    ticketNumberSelect: q('select[data-field="ticketNumber"]'), // hidden; combobox used
    ticketDept: q('input[data-field="ticketDept"]'),
    ticketCategory: q('input[data-field="ticketCategory"]'),

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

// ---- Ticket Combobox UI ----
function installTicketCombo(refs) {
  if (!refs.ticketNumberSelect) return;
  if (refs.ticketCombo) return;

  const sel = refs.ticketNumberSelect;
  sel.style.display = "none";

  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.width = "100%";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type ticket number (Optional)";
  input.autocomplete = "off";
  input.className = "cellEdit";
  input.style.minWidth = "0";

  const list = document.createElement("div");
  list.style.position = "absolute";
  list.style.left = "0";
  list.style.right = "0";
  list.style.top = "calc(100% + 6px)";
  list.style.zIndex = "50";
  list.style.display = "none";
  list.style.maxHeight = "260px";
  list.style.overflow = "auto";
  list.style.borderRadius = "14px";
  list.style.border = "1px solid rgba(255,255,255,0.14)";
  list.style.background = "rgba(10,10,18,0.98)";
  list.style.boxShadow = "0 16px 40px rgba(0,0,0,0.45)";
  list.style.padding = "6px";

  sel.insertAdjacentElement("afterend", wrap);
  wrap.appendChild(input);
  wrap.appendChild(list);

  refs.ticketCombo = { input, list, tickets: [] };

  function closeList() { list.style.display = "none"; }
  function openList() { list.style.display = "block"; }

  function render(filterText) {
    const f = (filterText || "").trim().toLowerCase();
    const items = refs.ticketCombo.tickets || [];

    const filtered = !f
      ? items
      : items.filter(t =>
          String(t.ticket_number || "").toLowerCase().includes(f) ||
          String(t.department || "").toLowerCase().includes(f) ||
          String(t.category || "").toLowerCase().includes(f)
        );

    if (!filtered.length) {
      list.innerHTML = `<div style="padding:10px 12px;opacity:.7;">No matches (you can still type any ticket number)</div>`;
      return;
    }

    list.innerHTML = filtered.map(t => {
      const meta = [t.department, t.category].filter(Boolean).join(" / ");
      return `
        <div data-ticket="${escAttr(t.ticket_number)}"
             style="padding:10px 12px;border-radius:12px;cursor:pointer;border:1px solid rgba(255,255,255,0.06);margin:6px 0;">
          <div style="font-weight:700;opacity:.95;">${escText(t.ticket_number)}</div>
          <div style="font-size:12px;opacity:.72;white-space:normal;">${escText(meta)}</div>
        </div>
      `;
    }).join("");
  }

  function fillMetaFromInput() {
    const val = (input.value || "").trim();
    const hit = (refs.ticketCombo.tickets || []).find(t => String(t.ticket_number) === val);
    refs.ticketDept.value = hit?.department ?? "";
    refs.ticketCategory.value = hit?.category ?? "";
  }

  input.addEventListener("focus", () => {
    render("");
    openList();
  });

  input.addEventListener("input", () => {
    render(input.value);
    openList();
  });

  list.addEventListener("mousedown", (e) => e.preventDefault());

  list.addEventListener("click", (e) => {
    const item = e.target.closest("[data-ticket]");
    if (!item) return;
    const ticket = item.getAttribute("data-ticket");
    input.value = ticket || "";
    closeList();
    fillMetaFromInput();
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeList();
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      closeList();
      fillMetaFromInput();
    }, 120);
  });
}

async function getTicketsForStudent(studentName) {
  if (!studentName) return [];
  if (ticketsCache.has(studentName)) return ticketsCache.get(studentName);

  // SHOW BUSY only when we actually hit DB (not cache)
  return await withBusy("Loading tickets…", async () => {
    const { data, error } = await sb
      .from(TICKETS_TABLE)
      .select(TICKET_SELECT)
      .eq(TICKET_MATCH_FIELD, studentName)
      .order("ticket_number", { ascending: false });

    if (error) {
      console.error("Tickets fetch error:", error);
      ticketsCache.set(studentName, []);
      return [];
    }

    const list = (data || []).filter(r => r?.ticket_number);
    ticketsCache.set(studentName, list);
    return list;
  });
}

async function updateTicketsForChild(refs, keepTyped = "") {
  const s = studentsByChild.get(refs.child.value);
  const studentName = s?.student_name ?? "";

  refs.ticketDept.value = "";
  refs.ticketCategory.value = "";

  installTicketCombo(refs);

  refs.ticketCombo.input.value = keepTyped || "";
  refs.ticketCombo.tickets = [];

  if (!studentName) return;

  const tickets = await getTicketsForStudent(studentName);
  refs.ticketCombo.tickets = tickets;

  if (keepTyped) {
    const hit = tickets.find(t => String(t.ticket_number) === keepTyped);
    refs.ticketDept.value = hit?.department ?? "";
    refs.ticketCategory.value = hit?.category ?? "";
  }
}

function enhanceBlockSelects(refs) {
  enhanceSelect(refs.child, { placeholder: "Select child...", search: true, searchThreshold: 0 });
  enhanceSelect(refs.medium, { placeholder: "Select medium..." });
  enhanceSelect(refs.objective, { placeholder: "Select objective..." });
  enhanceSelect(refs.ticketRaised, { placeholder: "Ticket raised? (Optional)" });

  refreshSelect(refs.child);
  refreshSelect(refs.medium);
  refreshSelect(refs.objective);
  refreshSelect(refs.ticketRaised);
}

function createBlock(cloneFrom = null) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const refs = blockRefs(node);

  refs.child.innerHTML = `<option value=""></option>` + students.map(s =>
    `<option value="${escAttr(s.child_name)}">${escText(s.child_name)}</option>`
  ).join("");

  refs.medium.innerHTML = buildOptions(mediums, "label", "label");
  refs.objective.innerHTML = buildOptions(objectives, "label", "label");
  refs.ticketRaised.innerHTML = buildOptions(ticketOptions, "label", "label");

  refs.timeAuto.value = "1 min";
  refs.tsAuto.value = "";

  installTicketCombo(refs);

  refs.child.addEventListener("change", async () => {
    fillStudentAuto(refs);
    await updateTicketsForChild(refs, "");
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

  let clonedTicket = "";
  if (cloneFrom) {
    const src = blockRefs(cloneFrom);

    refs.child.value = src.child.value;
    refs.medium.value = src.medium.value;
    refs.objective.value = src.objective.value;
    refs.ticketRaised.value = src.ticketRaised.value;

    refs.positives.value = src.positives.value;
    refs.suggestion.value = src.suggestion.value;

    clonedTicket = src.ticketCombo?.input?.value || "";
  }

  fillStudentAuto(refs);
  fillTimeAuto(refs);

  entriesEl.appendChild(node);
  enhanceBlockSelects(refs);
  refreshNumbers();

  if (refs.child.value) {
    updateTicketsForChild(refs, clonedTicket).catch(console.error);
  }
}

(async () => {
  await mountNav("entry");
  hideMsg();

  try {
    await withBusy("Loading master data…", async () => {
      setBusyProgress(null, "Fetching students, mediums, objectives…");

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
    });

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

    const ticket_raised = refs.ticketRaised.value ? refs.ticketRaised.value : null;
    const ticket_number = refs.ticketCombo?.input?.value?.trim() || "";

    const time_min = fillTimeAuto(refs);
    const timeText = `${time_min} min`;

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
      ticket_number,

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

  await withBusy(`Saving ${payloads.length} entries…`, async () => {
    const { error } = await sb.from("touchpoints").insert(payloads);
    if (error) throw error;
  }).catch(err => {
    show(err?.message || String(err), true);
    throw err;
  });

  show(`Saved ${payloads.length} entries ✅`);
  entriesEl.innerHTML = "";
  createBlock(null);
});

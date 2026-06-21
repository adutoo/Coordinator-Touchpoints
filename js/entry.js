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
const TICKET_SELECT_SAFE = "ticket_number,department,category,subject,student_name,student_child_name,raised_at";

// ✅ Referral status options table
const REFERRAL_OPTIONS_TABLE = "referral_status_options";
// ✅ students column name (snake_case)
const STUDENT_REFERRAL_COL = "referral_status";

let students = [];
let studentsBySR = new Map();
let mediums = [];
let objectives = [];
let ticketOptions = [];
let referralOptions = []; // ✅ NEW

const ticketsCache = new Map();

// -------------------- Call Prefill (from Call Reports) --------------------
const __URL = new URL(window.location.href);
const __FROM_CALL = __URL.searchParams.get("fromCall") === "1";

function readCallPrefill() {
  try {
    const raw = sessionStorage.getItem("callPrefill");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function clearCallPrefill() {
  try {
    sessionStorage.removeItem("callPrefill");
  } catch {}
}

function splitSummary(summary) {
  const s = String(summary || "");
  const up = s.toUpperCase();
  const pIdx = up.indexOf("POSITIVES");
  const sIdx = up.indexOf("SUGGESTIONS");
  let positives = "";
  let suggestions = "";

  if (pIdx >= 0 && sIdx >= 0) {
    positives = s.slice(pIdx, sIdx).trim();
    suggestions = s.slice(sIdx).trim();
  } else {
    suggestions = s.trim();
  }

  positives = positives.replace(/^POSITIVES\s*:?\s*/i, "").trim();
  suggestions = suggestions.replace(/^SUGGESTIONS\s*:?\s*/i, "").trim();
  return { positives, suggestions };
}

function normalizeCallType(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return "";
  if (s.includes("OUT")) return "OUTGOING";
  if (s.includes("IN")) return "INCOMING";
  return s;
}

function desiredMediumFromCallType(callType) {
  const ct = normalizeCallType(callType);
  if (ct === "INCOMING") return "Inbound Call";
  if (ct === "OUTGOING") return "Outbound Call";
  return "";
}

function findMediumLabelCaseInsensitive(label) {
  const want = String(label || "").trim().toLowerCase();
  if (!want) return "";
  const hit = (mediums || []).find((m) => String(m?.label || "").trim().toLowerCase() === want);
  return hit?.label || "";
}

let __callPrefill = __FROM_CALL ? readCallPrefill() : null;

// Apply prefill AFTER first block exists
function tryApplyPrefillToFirstBlock() {
  if (!__FROM_CALL) return false;
  if (!__callPrefill) return false;

  const block = entriesEl?.querySelector(".tp-entry");
  if (!block) return false;

  const refs = blockRefs(block);

  let summaryText = "";
  const pos = String(__callPrefill.positives ?? "").trim();
  const sug = String(__callPrefill.suggestions ?? "").trim();

  if (__callPrefill.summary) {
    summaryText = __callPrefill.summary.trim();
  } else if (pos || sug) {
    summaryText = [pos, sug].filter(Boolean).join("\n");
  }

  if (refs.summary && summaryText) refs.summary.value = summaryText;

  const desired = desiredMediumFromCallType(__callPrefill.call_type);
  const mediumLabel = findMediumLabelCaseInsensitive(desired);
  if (refs.medium && mediumLabel) {
    refs.medium.value = mediumLabel;
    refs.medium.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      refreshSelect(refs.medium);
    } catch {}
  }

  if (__callPrefill.child_name && refs.child) {
    // Find SR number from child_name for backward compat with call prefill
    const prefillStu = students.find(s => s.child_name === __callPrefill.child_name);
    if (prefillStu) refs.child.value = prefillStu.sr_number;
    else refs.child.value = __callPrefill.child_name;
    refs.child.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      refreshSelect(refs.child);
    } catch {}
  }

  if (refs.summary) refs.summary.dispatchEvent(new Event("input", { bubbles: true }));

  console.log("[callPrefill] applied into first entry block:", __callPrefill);

  __callPrefill = null;
  clearCallPrefill();
  return true;
}

// -------------------- UI Msg helpers --------------------
function show(text, isError = false) {
  if (!msg) return;
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(239,68,68,0.55)" : "rgba(37,99,235,0.55)";
  msg.style.color = isError ? "#ef4444" : "var(--muted)";
  msg.textContent = text;
}
function hideMsg() {
  if (msg) msg.style.display = "none";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function fmtLocalTS(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}:${pad2(d.getSeconds())}`;
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
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function getMediumTimeMin(label) {
  const m = mediums.find((x) => x.label === label);
  return Math.max(1, Number(m?.time_min ?? 1));
}

function buildOptions(list, valueKey = "label", labelKey = "label") {
  return (
    `<option value=""></option>` +
    (list || [])
      .map((x) => {
        const v = escAttr(x[valueKey]);
        const t = escText(x[labelKey]);
        return `<option value="${v}">${t}</option>`;
      })
      .join("")
  );
}

function blockRefs(block) {
  const q = (sel) => block.querySelector(sel);
  return {
    child: q('select[data-field="child"]'),
    medium: q('select[data-field="medium"]'),
    objective: q('select[data-field="objective"]'),

    // ✅ Referral status dropdown
    referralStatus: q('select[data-field="referralStatus"]'),

    summary: q('textarea[data-field="summary"]'),

    ticketRaised: q('select[data-field="ticketRaised"]'),
    ticketNumberHost: q('select[data-field="ticketNumber"]') || q('input[data-field="ticketNumber"]') || null,

    ticketDept: q('input[data-field="ticketDept"]'),
    ticketSubject: q('input[data-field="ticketSubject"]') || null,
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

function ensureOptionExists(selectEl, value) {
  if (!selectEl) return;
  const v = String(value ?? "").trim();
  if (!v) return;

  const exists = Array.from(selectEl.options || []).some((o) => o.value === v);
  if (exists) return;

  // Add a hidden option so it can display even if admin removed option later
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = v;
  selectEl.appendChild(opt);
}

function fillStudentAuto(refs) {
  const s = studentsBySR.get(refs.child.value);
  refs.studentName.value = s?.student_name ?? "";
  refs.className.value = s?.class_name ?? "";
  refs.section.value = s?.section ?? "";
  refs.srNumber.value = s?.sr_number ?? "";

  // ✅ Prefill referral status from students table (if present)
  if (refs.referralStatus) {
    const current = s?.[STUDENT_REFERRAL_COL] ?? "";
    ensureOptionExists(refs.referralStatus, current);
    refs.referralStatus.value = current || "";
    try {
      refreshSelect(refs.referralStatus);
    } catch {}
  }
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

// -------------------- Ticket Combobox --------------------
function installTicketCombo(refs) {
  const host = refs.ticketNumberHost;
  if (!host) return null;

  if (host._ticketCombo) {
    refs.ticketCombo = host._ticketCombo;
    return refs.ticketCombo;
  }

  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.width = "100%";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type ticket number (Optional)";
  input.autocomplete = "off";
  input.style.width = "100%";
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
  list.style.border = "1px solid var(--border)";
  list.style.background = "#fff";
  list.style.boxShadow = "0 10px 40px rgba(0,0,0,0.08)";
  list.style.padding = "6px";

  if (host.tagName === "SELECT") {
    host.style.display = "none";
    host.insertAdjacentElement("afterend", wrap);
    wrap.appendChild(input);
    wrap.appendChild(list);
  } else {
    const parent = host.parentElement;
    if (parent) {
      parent.insertBefore(wrap, host);
      wrap.appendChild(host);
      wrap.appendChild(list);
      input.remove();
    }
  }

  const realInput = host.tagName === "INPUT" ? host : input;

  const combo = { wrap, input: realInput, list, tickets: [] };
  host._ticketCombo = combo;
  refs.ticketCombo = combo;

  function closeList() {
    list.style.display = "none";
  }
  function openList() {
    list.style.display = "block";
  }

  function metaLine(t) {
    const dept = (t.department || "").trim() || "—";
    const subj = (t.subject || "").trim() || "—";
    const cat = (t.category || "").trim() || "—";
    const stu = (t.student_child_name || t.student_name || "").trim() || "—";
    return `${dept} / ${subj} / ${cat} — ${stu}`;
  }

  function render(filterText) {
    const f = (filterText || "").trim().toLowerCase();
    const items = combo.tickets || [];

    const filtered = !f
      ? items
      : items.filter((t) => {
          const a = String(t.ticket_number || "").toLowerCase();
          const b = String(t.department || "").toLowerCase();
          const c = String(t.subject || "").toLowerCase();
          const d = String(t.category || "").toLowerCase();
          const e = String(t.student_child_name || t.student_name || "").toLowerCase();
          return a.includes(f) || b.includes(f) || c.includes(f) || d.includes(f) || e.includes(f);
        });

    if (!filtered.length) {
      list.innerHTML = `<div style="padding:10px 12px;color:var(--muted);">No tickets found for this student (or access denied).</div>`;
      return;
    }

    list.innerHTML = filtered
      .map(
        (t) => `
      <div data-ticket="${escAttr(t.ticket_number)}"
           style="padding:10px 12px;border-radius:8px;cursor:pointer;border:1px solid var(--border-light);margin:6px 0;">
        <div style="font-weight:600;color:var(--text);">${escText(t.ticket_number)}</div>
        <div style="font-size:12px;color:var(--muted);white-space:normal;">${escText(metaLine(t))}</div>
      </div>
    `
      )
      .join("");
  }

  function fillMetaFromInput() {
    const val = (combo.input.value || "").trim();
    const hit = (combo.tickets || []).find((t) => String(t.ticket_number) === val);

    if (refs.ticketDept) refs.ticketDept.value = hit?.department ?? "";
    if (refs.ticketSubject) refs.ticketSubject.value = hit?.subject ?? "";
    if (refs.ticketCategory) refs.ticketCategory.value = hit?.category ?? "";
  }

  combo.input.addEventListener("focus", () => {
    render("");
    openList();
  });

  combo.input.addEventListener("input", () => {
    render(combo.input.value);
    openList();
  });

  list.addEventListener("mousedown", (e) => e.preventDefault());

  list.addEventListener("click", (e) => {
    const item = e.target.closest("[data-ticket]");
    if (!item) return;
    const ticket = item.getAttribute("data-ticket");
    combo.input.value = ticket || "";
    closeList();
    fillMetaFromInput();
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeList();
  });

  combo.input.addEventListener("blur", () => {
    setTimeout(() => {
      closeList();
      fillMetaFromInput();
    }, 120);
  });

  return combo;
}

// -------------------- Ticket Fetch --------------------
function cacheKeyFor(srNumber, childName) {
  return (srNumber || "").trim() || (childName || "").trim() || "";
}

async function queryTicketsAttempt({ field, op, value }) {
  let q = sb.from(TICKETS_TABLE).select(TICKET_SELECT_SAFE);
  if (op === "eq") q = q.eq(field, value);
  if (op === "ilike") q = q.ilike(field, value);

  q = q.order("raised_at", { ascending: false }).order("ticket_number", { ascending: false }).limit(200);

  const { data, error } = await q;
  return { data, error };
}

async function getTicketsForStudent({ srNumber, childName, studentName }) {
  const key = cacheKeyFor(srNumber, childName);
  if (!key) return [];
  if (ticketsCache.has(key)) return ticketsCache.get(key);

  return await withBusy("Loading tickets…", async () => {
    const attempts = [];

    // Primary lookup: by SR number (scholar_number on tickets table)
    if (srNumber) {
      attempts.push({ field: "scholar_number", op: "eq", value: srNumber });
    }
    // Fallback: by child_name
    if (childName) {
      attempts.push({ field: "student_child_name", op: "eq", value: childName });
      attempts.push({ field: "student_child_name", op: "ilike", value: `%${childName}%` });
    }
    if (studentName) {
      attempts.push({ field: "student_name", op: "eq", value: studentName });
    }

    for (const a of attempts) {
      const { data, error } = await queryTicketsAttempt(a);

      if (error) {
        console.error("Tickets fetch error:", error);
        show(`Tickets not loading: ${error.message}`, true);
        ticketsCache.set(key, []);
        return [];
      }

      if (data?.length) {
        const list = data.filter((r) => r?.ticket_number);
        ticketsCache.set(key, list);
        return list;
      }
    }

    ticketsCache.set(key, []);
    return [];
  });
}

async function updateTicketsForChild(refs, keepTyped = "") {
  const srNumber = refs.child.value || "";
  const s = studentsBySR.get(srNumber);
  const childName = s?.child_name ?? "";
  const studentName = s?.student_name ?? "";

  if (refs.ticketDept) refs.ticketDept.value = "";
  if (refs.ticketSubject) refs.ticketSubject.value = "";
  if (refs.ticketCategory) refs.ticketCategory.value = "";

  const combo = installTicketCombo(refs);
  if (!combo) return;

  combo.input.value = keepTyped || "";
  combo.tickets = [];

  if (!srNumber && !childName && !studentName) return;

  hideMsg();
  const tickets = await getTicketsForStudent({ srNumber, childName, studentName });
  combo.tickets = tickets;
}

function enhanceBlockSelects(refs) {
  if (refs.child) enhanceSelect(refs.child, { placeholder: "Search by SR# or name...", search: true, searchThreshold: 0 });
  if (refs.medium) enhanceSelect(refs.medium, { placeholder: "Select medium..." });
  if (refs.objective) enhanceSelect(refs.objective, { placeholder: "Select objective..." });

  // ✅ Referral dropdown (safe)
  if (refs.referralStatus) enhanceSelect(refs.referralStatus, { placeholder: "Referral Status (Optional)" });

  if (refs.ticketRaised) enhanceSelect(refs.ticketRaised, { placeholder: "Ticket raised? (Optional)" });

  try { if (refs.child) refreshSelect(refs.child); } catch {}
  try { if (refs.medium) refreshSelect(refs.medium); } catch {}
  try { if (refs.objective) refreshSelect(refs.objective); } catch {}
  try { if (refs.referralStatus) refreshSelect(refs.referralStatus); } catch {}
  try { if (refs.ticketRaised) refreshSelect(refs.ticketRaised); } catch {}
}

function createBlock(cloneFrom = null) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const refs = blockRefs(node);

  if (refs.child) {
    refs.child.innerHTML =
      `<option value=""></option>` +
      students.map((s) => `<option value="${escAttr(s.sr_number)}">${escText(s.sr_number)} — ${escText(s.child_name)}</option>`).join("");
  }

  if (refs.medium) refs.medium.innerHTML = buildOptions(mediums, "label", "label");
  if (refs.objective) refs.objective.innerHTML = buildOptions(objectives, "label", "label");
  if (refs.ticketRaised) refs.ticketRaised.innerHTML = buildOptions(ticketOptions, "label", "label");

  // ✅ Referral options
  if (refs.referralStatus) refs.referralStatus.innerHTML = buildOptions(referralOptions, "label", "label");

  if (refs.timeAuto) refs.timeAuto.value = "1 min";
  if (refs.tsAuto) refs.tsAuto.value = "";

  installTicketCombo(refs);

  refs.child?.addEventListener("change", async () => {
    fillStudentAuto(refs); // also fills referralStatus from student record
    await updateTicketsForChild(refs, "");
    try { refreshSelect(refs.child); } catch {}
  });

  refs.medium?.addEventListener("change", () => {
    fillTimeAuto(refs);
    try { refreshSelect(refs.medium); } catch {}
  });

  refs.referralStatus?.addEventListener("change", () => {
    try { refreshSelect(refs.referralStatus); } catch {}
  });

  refs.removeBtn?.addEventListener("click", () => {
    node.remove();
    refreshNumbers();
  });

  let clonedTicket = "";
  if (cloneFrom) {
    const src = blockRefs(cloneFrom);
    const srcCombo = src.ticketNumberHost?._ticketCombo;
    clonedTicket = srcCombo?.input?.value || "";

    if (refs.child) refs.child.value = src.child?.value || "";
    if (refs.medium) refs.medium.value = src.medium?.value || "";
    if (refs.objective) refs.objective.value = src.objective?.value || "";
    if (refs.ticketRaised) refs.ticketRaised.value = src.ticketRaised?.value || "";

    if (refs.referralStatus) {
      const v = src.referralStatus?.value || "";
      ensureOptionExists(refs.referralStatus, v);
      refs.referralStatus.value = v;
    }

    if (refs.summary) refs.summary.value = src.summary?.value || "";
    // Note: child dropdown value is sr_number, so cloneFrom works automatically
  }

  fillStudentAuto(refs);
  fillTimeAuto(refs);

  entriesEl.appendChild(node);
  enhanceBlockSelects(refs);
  refreshNumbers();

  if (refs.child?.value) {
    updateTicketsForChild(refs, clonedTicket).catch(console.error);
  }

  return node;
}

// -------------------- Boot --------------------
(async () => {
  await mountNav("entry");
  hideMsg();

  try {
    await withBusy("Loading master data…", async () => {
      setBusyProgress(null, "Fetching students, mediums, objectives…");

      const [stu, med, obj, tick, refOpt] = await Promise.all([
        fetchAll("students", `child_name,student_name,class_name,section,sr_number,${STUDENT_REFERRAL_COL}`, "sr_number"),
        sb.from("mediums").select("label,time_min,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
        sb.from("objectives").select("label,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
        sb.from("ticket_raised_options").select("label,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
        sb.from(REFERRAL_OPTIONS_TABLE).select("label,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
      ]);

      students = stu || [];
      studentsBySR = new Map(students.map((s) => [s.sr_number, s]));

      mediums = med.data || [];
      objectives = obj.data || [];
      ticketOptions = tick.data || [];

      if (refOpt?.error) {
        console.warn("Referral options fetch failed:", refOpt.error);
        referralOptions = [];
      } else {
        referralOptions = refOpt.data || [];
      }
    });

    createBlock(null);

    if (__FROM_CALL && __callPrefill) {
      let applied = tryApplyPrefillToFirstBlock();
      if (!applied) {
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 100));
          applied = tryApplyPrefillToFirstBlock();
          if (applied) break;
        }
      }
    }

    show(`Loaded ${students.length} students ✅`);
    setTimeout(hideMsg, 1200);
  } catch (e) {
    console.error(e);
    show(e?.message || String(e), true);
  }
})();

// -------------------- UI actions --------------------
addEntryBtn?.addEventListener("click", () => {
  const blocks = Array.from(entriesEl.querySelectorAll(".tp-entry"));
  const last = blocks[blocks.length - 1] || null;
  createBlock(last);
});

resetBtn?.addEventListener("click", () => {
  hideMsg();
  entriesEl.innerHTML = "";
  createBlock(null);

  if (__FROM_CALL && __callPrefill) {
    tryApplyPrefillToFirstBlock();
  }
});

// -------------------- Save --------------------
form?.addEventListener("submit", async (e) => {
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

  // ✅ Collect referral updates per child (only if filled)
  const referralUpdates = new Map(); // sr_number -> referral_status

  for (let i = 0; i < blocks.length; i++) {
    const refs = blockRefs(blocks[i]);

    const sr_value = refs.child?.value || "";
    const s_lookup = studentsBySR.get(sr_value);
    const child_name = s_lookup?.child_name ?? "";
    const medium = refs.medium?.value || "";
    const objective = refs.objective?.value || "";

    if (!child_name || !medium || !objective) {
      return show(`Entry #${i + 1}: Please select Child Name, Medium, and Objective.`, true);
    }

    const s = s_lookup;
    const summaryText = refs.summary?.value?.trim() || "";
    const positives = summaryText;
    const suggestion = "";

    const ticket_raised = refs.ticketRaised?.value ? refs.ticketRaised.value : null;
    const combo = refs.ticketNumberHost?._ticketCombo;
    const ticket_number = combo?.input?.value?.trim() || "";

    const time_min = fillTimeAuto(refs);
    const timeText = `${time_min} min`;

    const comments_concat = summaryText;

    // ✅ Referral status capture (optional)
    const referral_status = (refs.referralStatus?.value || "").trim();
    if (referral_status) referralUpdates.set(sr_value, referral_status);

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

    if (refs.tsAuto) refs.tsAuto.value = fmtLocalTS(now);
  }

  // Save
  await withBusy(`Saving ${payloads.length} entries…`, async () => {
    // 1) Save touchpoints
    const { error } = await sb.from("touchpoints").insert(payloads);
    if (error) throw error;

    // 2) Update students referral_status
    if (referralUpdates.size) {
      setBusyProgress(null, "Updating Referral Status…");

      const updates = Array.from(referralUpdates.entries()).map(([sr_number, referral_status]) => ({
        sr_number,
        referral_status,
      }));

      const results = await Promise.all(
        updates.map((u) =>
          sb
            .from("students")
            .update({ [STUDENT_REFERRAL_COL]: u.referral_status })
            .eq("sr_number", u.sr_number)
        )
      );

      const failed = results
        .map((r, idx) => ({ r, idx }))
        .filter(({ r }) => r?.error);

      if (failed.length) {
        const failedNames = failed
          .map(({ idx }) => updates[idx]?.sr_number)
          .filter(Boolean)
          .slice(0, 8);

        console.warn("Referral status update failures:", failed.map((x) => x.r.error));

        // 🔥 Make it very obvious
        show(
          `Touchpoints saved ✅ but Referral Status was NOT saved for ${failed.length} student(s): ${failedNames.join(
            ", "
          )}${failed.length > failedNames.length ? "…" : ""}. This is a permissions (RLS) issue — ask admin to allow coordinators to UPDATE students.`,
          true
        );
      } else {
        // update local cache
        for (const [sr_number, referral_status] of referralUpdates.entries()) {
          const obj = studentsBySR.get(sr_number);
          if (obj) obj[STUDENT_REFERRAL_COL] = referral_status;
        }
      }
    }
  }).catch((err) => {
    show(err?.message || String(err), true);
    throw err;
  });

  // If msg already showing error (referral failed), don't overwrite it
  if (!msg || msg.style.display === "none" || !String(msg.textContent || "").includes("Referral Status was NOT saved")) {
    show(`Saved ${payloads.length} entries ✅`);
    setTimeout(hideMsg, 1400);
  }

  entriesEl.innerHTML = "";
  createBlock(null);
});

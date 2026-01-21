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

// ✅ NEW: Referral status options table
const REFERRAL_OPTIONS_TABLE = "referral_status_options";
// ✅ NEW: students column name (snake_case)
const STUDENT_REFERRAL_COL = "referral_status";

let students = [];
let studentsByChild = new Map();
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

  let pos = String(__callPrefill.positives ?? "").trim();
  let sug = String(__callPrefill.suggestions ?? "").trim();

  if ((!pos && !sug) && __callPrefill.summary) {
    const out = splitSummary(__callPrefill.summary);
    pos = out.positives;
    sug = out.suggestions;
  }

  if (refs.positives && pos) refs.positives.value = pos;
  if (refs.suggestion && sug) refs.suggestion.value = sug;

  const desired = desiredMediumFromCallType(__callPrefill.call_type);
  const mediumLabel = findMediumLabelCaseInsensitive(desired);
  if (refs.medium && mediumLabel) {
    refs.medium.value = mediumLabel;
    refs.medium.dispatchEvent(new Event("change", { bubbles: true }));
    try { refreshSelect(refs.medium); } catch {}
  }

  if (__callPrefill.child_name && refs.child) {
    refs.child.value = __callPrefill.child_name;
    refs.child.dispatchEvent(new Event("change", { bubbles: true }));
    try { refreshSelect(refs.child); } catch {}
  }

  if (refs.positives) refs.positives.dispatchEvent(new Event("input", { bubbles: true }));
  if (refs.suggestion) refs.suggestion.dispatchEvent(new Event("input", { bubbles: true }));

  console.log("[callPrefill] applied into first entry block:", __callPrefill);

  __callPrefill = null;
  clearCallPrefill();
  return true;
}

// -------------------- UI Msg helpers --------------------
function show(text, isError = false) {
  if (!msg) return;
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.style.color = isError ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
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

    // ✅ NEW
    referralStatus: q('select[data-field="referralStatus"]'),

    positives: q('textarea[data-field="positives"]'),
    suggestion: q('textarea[data-field="suggestion"]'),

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

function fillStudentAuto(refs) {
  const s = studentsByChild.get(refs.child.value);
  refs.studentName.value = s?.student_name ?? "";
  refs.className.value = s?.class_name ?? "";
  refs.section.value = s?.section ?? "";
  refs.srNumber.value = s?.sr_number ?? "";

  // ✅ NEW: prefill referral status from students table (if present)
  if (refs.referralStatus) {
    refs.referralStatus.value = s?.[STUDENT_REFERRAL_COL] ?? "";
    try { refreshSelect(refs.referralStatus); } catch {}
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
  list.style.border = "1px solid rgba(255,255,255,0.14)";
  list.style.background = "rgba(10,10,18,0.98)";
  list.style.boxShadow = "0 16px 40px rgba(0,0,0,0.45)";
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
      list.innerHTML = `<div style="padding:10px 12px;opacity:.7;">No tickets found for this student (or access denied).</div>`;
      return;
    }

    list.innerHTML = filtered
      .map(
        (t) => `
      <div data-ticket="${escAttr(t.ticket_number)}"
           style="padding:10px 12px;border-radius:12px;cursor:pointer;border:1px solid rgba(255,255,255,0.06);margin:6px 0;">
        <div style="font-weight:700;opacity:.95;">${escText(t.ticket_number)}</div>
        <div style="font-size:12px;opacity:.72;white-space:normal;">${escText(metaLine(t))}</div>
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
function cacheKeyFor(childName, studentName) {
  return (childName || "").trim() || (studentName || "").trim() || "";
}

async function queryTicketsAttempt({ field, op, value }) {
  let q = sb.from(TICKETS_TABLE).select(TICKET_SELECT_SAFE);
  if (op === "eq") q = q.eq(field, value);
  if (op === "ilike") q = q.ilike(field, value);

  q = q.order("raised_at", { ascending: false }).order("ticket_number", { ascending: false }).limit(200);

  const { data, error } = await q;
  return { data, error };
}

async function getTicketsForStudent({ childName, studentName }) {
  const key = cacheKeyFor(childName, studentName);
  if (!key) return [];
  if (ticketsCache.has(key)) return ticketsCache.get(key);

  return await withBusy("Loading tickets…", async () => {
    const attempts = [];

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
  const s = studentsByChild.get(refs.child.value);
  const childName = refs.child.value || "";
  const studentName = s?.student_name ?? "";

  if (refs.ticketDept) refs.ticketDept.value = "";
  if (refs.ticketSubject) refs.ticketSubject.value = "";
  if (refs.ticketCategory) refs.ticketCategory.value = "";

  const combo = installTicketCombo(refs);
  if (!combo) return;

  combo.input.value = keepTyped || "";
  combo.tickets = [];

  if (!childName && !studentName) return;

  hideMsg();
  const tickets = await getTicketsForStudent({ childName, studentName });
  combo.tickets = tickets;
}

function enhanceBlockSelects(refs) {
  enhanceSelect(refs.child, { placeholder: "Select child...", search: true, searchThreshold: 0 });
  enhanceSelect(refs.medium, { placeholder: "Select medium..." });
  enhanceSelect(refs.objective, { placeholder: "Select objective..." });

  // ✅ NEW
  enhanceSelect(refs.referralStatus, { placeholder: "Referral Status (Optional)" });

  enhanceSelect(refs.ticketRaised, { placeholder: "Ticket raised? (Optional)" });

  refreshSelect(refs.child);
  refreshSelect(refs.medium);
  refreshSelect(refs.objective);

  // ✅ NEW
  refreshSelect(refs.referralStatus);

  refreshSelect(refs.ticketRaised);
}

function createBlock(cloneFrom = null) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const refs = blockRefs(node);

  refs.child.innerHTML =
    `<option value=""></option>` +
    students.map((s) => `<option value="${escAttr(s.child_name)}">${escText(s.child_name)}</option>`).join("");

  refs.medium.innerHTML = buildOptions(mediums, "label", "label");
  refs.objective.innerHTML = buildOptions(objectives, "label", "label");

  // ✅ NEW
  refs.referralStatus.innerHTML = buildOptions(referralOptions, "label", "label");

  refs.ticketRaised.innerHTML = buildOptions(ticketOptions, "label", "label");

  refs.timeAuto.value = "1 min";
  refs.tsAuto.value = "";

  installTicketCombo(refs);

  refs.child.addEventListener("change", async () => {
    fillStudentAuto(refs); // also fills referralStatus from student record
    await updateTicketsForChild(refs, "");
    refreshSelect(refs.child);
  });

  refs.medium.addEventListener("change", () => {
    fillTimeAuto(refs);
    refreshSelect(refs.medium);
  });

  // ✅ NEW
  refs.referralStatus.addEventListener("change", () => {
    try { refreshSelect(refs.referralStatus); } catch {}
  });

  refs.removeBtn.addEventListener("click", () => {
    node.remove();
    refreshNumbers();
  });

  let clonedTicket = "";
  if (cloneFrom) {
    const src = blockRefs(cloneFrom);
    const srcCombo = src.ticketNumberHost?._ticketCombo;
    clonedTicket = srcCombo?.input?.value || "";

    refs.child.value = src.child.value;
    refs.medium.value = src.medium.value;
    refs.objective.value = src.objective.value;

    // ✅ NEW
    refs.referralStatus.value = src.referralStatus?.value || "";

    refs.ticketRaised.value = src.ticketRaised.value;

    refs.positives.value = src.positives.value;
    refs.suggestion.value = src.suggestion.value;
  }

  fillStudentAuto(refs);
  fillTimeAuto(refs);

  entriesEl.appendChild(node);
  enhanceBlockSelects(refs);
  refreshNumbers();

  if (refs.child.value) {
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
        // ✅ NEW: also fetch referral_status from students
        fetchAll("students", `child_name,student_name,class_name,section,sr_number,${STUDENT_REFERRAL_COL}`, "child_name"),

        sb.from("mediums").select("label,time_min,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
        sb.from("objectives").select("label,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
        sb.from("ticket_raised_options").select("label,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),

        // ✅ NEW: referral status options (admin controlled)
        sb.from(REFERRAL_OPTIONS_TABLE).select("label,is_active,sort_order").eq("is_active", true).order("sort_order").order("label"),
      ]);

      students = stu || [];
      studentsByChild = new Map(students.map((s) => [s.child_name, s]));

      mediums = med.data || [];
      objectives = obj.data || [];
      ticketOptions = tick.data || [];

      // ✅ NEW
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
addEntryBtn.addEventListener("click", () => {
  const blocks = Array.from(entriesEl.querySelectorAll(".tp-entry"));
  const last = blocks[blocks.length - 1] || null;
  createBlock(last);
});

resetBtn.addEventListener("click", () => {
  hideMsg();
  entriesEl.innerHTML = "";
  createBlock(null);

  if (__FROM_CALL && __callPrefill) {
    tryApplyPrefillToFirstBlock();
  }
});

// -------------------- Save --------------------
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

  // ✅ NEW: collect referral updates per child (only if filled)
  const referralUpdates = new Map(); // child_name -> referral_status

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
    const combo = refs.ticketNumberHost?._ticketCombo;
    const ticket_number = combo?.input?.value?.trim() || "";

    const time_min = fillTimeAuto(refs);
    const timeText = `${time_min} min`;

    const comments_concat =
      positives && suggestion ? `${positives}\n${suggestion}` : positives ? positives : suggestion ? suggestion : "";

    // ✅ NEW: referral status capture (optional)
    const referral_status = (refs.referralStatus?.value || "").trim();
    if (referral_status) {
      referralUpdates.set(child_name, referral_status);
    }

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
    // 1) Save touchpoints first (main action)
    const { error } = await sb.from("touchpoints").insert(payloads);
    if (error) throw error;

    // 2) ✅ Update students referral_status (secondary action)
    if (referralUpdates.size) {
      setBusyProgress(null, "Updating Referral Status…");

      const updates = Array.from(referralUpdates.entries()).map(([child_name, referral_status]) => ({
        child_name,
        referral_status,
      }));

      // Run updates in parallel (small count normally)
      const results = await Promise.all(
        updates.map((u) =>
          sb
            .from("students")
            .update({ [STUDENT_REFERRAL_COL]: u.referral_status })
            .eq("child_name", u.child_name)
        )
      );

      const failed = results
        .map((r, idx) => ({ r, idx }))
        .filter(({ r }) => r?.error);

      if (failed.length) {
        console.warn("Referral status update failures:", failed.map((x) => x.r.error));
        show(
          `Saved entries ✅ but Referral Status update failed for ${failed.length} student(s). Check permissions/RLS.`,
          true
        );
      } else {
        // also update local cache so future blocks auto-fill correctly without reload
        for (const [child_name, referral_status] of referralUpdates.entries()) {
          const obj = studentsByChild.get(child_name);
          if (obj) obj[STUDENT_REFERRAL_COL] = referral_status;
        }
      }
    }
  }).catch((err) => {
    show(err?.message || String(err), true);
    throw err;
  });

  show(`Saved ${payloads.length} entries ✅`);
  entriesEl.innerHTML = "";
  createBlock(null);
});

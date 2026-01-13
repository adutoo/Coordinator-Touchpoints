// js/session.js
import { sb } from "./supabaseClient.js";

const SETTINGS_KEY = "sessions_config";
const LS_KEY = "ct_session_label";

let __cfg = null;
let __loaded = false;
let __loadingPromise = null;

// -------------------- Small utils --------------------
function pad2(n) { return String(n).padStart(2, "0"); }

function fmtISODate(d) {
  // YYYY-MM-DD (local date)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtDDMMYYYY(d) {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function currentAcademicSessionLabel() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0=Jan
  const startY = (m >= 3) ? y : (y - 1); // Apr or later => same year
  const endY = startY + 1;
  return `${startY}-${String(endY).slice(-2)}`; // like 2025-26
}

function normalizeConfig(v) {
  const sessions = Array.isArray(v?.sessions)
    ? v.sessions.map(String).map(s => s.trim()).filter(Boolean)
    : [];
  const uniq = Array.from(new Set(sessions)).sort((a, b) => a.localeCompare(b));
  const def = String(v?.default || "").trim();
  const defaultLabel = uniq.includes(def) ? def : (uniq[uniq.length - 1] || "");
  return { sessions: uniq, default: defaultLabel };
}

// -------------------- DB load/save --------------------
export async function ensureSessionConfigLoaded() {
  if (__loaded) return __cfg;
  if (__loadingPromise) return __loadingPromise;

  __loadingPromise = (async () => {
    __loaded = true;
    try {
      const { data, error } = await sb
        .from("app_settings")
        .select("value")
        .eq("key", SETTINGS_KEY)
        .maybeSingle();

      if (!error && data?.value) __cfg = normalizeConfig(data.value);
    } catch (_) {}

    return __cfg;
  })();

  return __loadingPromise;
}

export function getSessionConfigSync() {
  return __cfg;
}

export async function saveSessionConfig({ sessions, default: defLabel }) {
  const payload = normalizeConfig({ sessions, default: defLabel });

  const { error } = await sb
    .from("app_settings")
    .upsert({ key: SETTINGS_KEY, value: payload }, { onConflict: "key" });

  if (error) throw error;

  __cfg = payload;
  __loaded = true;
  return payload;
}

// -------------------- Sessions list --------------------
export function listSessionsFallback({ past = 6, future = 1 } = {}) {
  const cur = currentAcademicSessionLabel();
  const startY = Number(cur.split("-")[0]);
  const out = [];

  for (let i = past; i >= 1; i--) {
    const y = startY - i;
    out.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  out.push(cur);

  for (let i = 1; i <= future; i++) {
    const y = startY + i;
    out.push(`${y}-${String(y + 1).slice(-2)}`);
  }
  return out;
}

export function listSessions({ past = 6, future = 1 } = {}) {
  // Always return an ARRAY
  if (__cfg?.sessions?.length) return __cfg.sessions;
  return listSessionsFallback({ past, future });
}

export function getSessionLabel() {
  const saved = localStorage.getItem(LS_KEY);

  const sessions = (__cfg?.sessions?.length ? __cfg.sessions : listSessionsFallback());
  if (saved && sessions.includes(saved)) return saved;

  if (__cfg?.default && sessions.includes(__cfg.default)) return __cfg.default;

  return currentAcademicSessionLabel();
}

export function setSessionLabel(label) {
  localStorage.setItem(LS_KEY, String(label || ""));
}

// -------------------- Session range --------------------
export function getSessionRange(label) {
  const s = String(label || "").trim();
  const m1 = s.match(/^(\d{4})-(\d{2})$/);   // 2025-26
  const m2 = s.match(/^(\d{4})-(\d{4})$/);   // 2025-2026

  let startY, endY;

  if (m1) {
    startY = Number(m1[1]);
    const yy = Number(m1[2]);
    endY = Math.floor(startY / 100) * 100 + yy;
    if (endY <= startY) endY = startY + 1;
  } else if (m2) {
    startY = Number(m2[1]);
    endY = Number(m2[2]);
  } else {
    return getSessionRange(currentAcademicSessionLabel());
  }

  const start = new Date(startY, 3, 1, 0, 0, 0, 0); // 01-04-startY (local)
  const end = new Date(endY, 3, 1, 0, 0, 0, 0);     // 01-04-endY   (local) end-exclusive
  return { start, end, startY, endY };
}

// -------------------- Date parsing (supports YYYY-MM-DD + DD-MM-YYYY) --------------------
function parseInputDateToLocalDate(val) {
  const s = String(val || "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    const dt = new Date(y, mo, d, 0, 0, 0, 0);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  m = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
  if (m) {
    const d = +m[1], mo = +m[2] - 1, y = +m[3];
    const dt = new Date(y, mo, d, 0, 0, 0, 0);
    return isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

function setInputDateValue(el, dateObj) {
  if (!el || !(dateObj instanceof Date)) return;

  // If it's an actual <input type="date"> it must be YYYY-MM-DD
  const isDateType = (el.tagName === "INPUT" && (el.type || "").toLowerCase() === "date");
  el.value = isDateType ? fmtISODate(dateObj) : fmtDDMMYYYY(dateObj);
}

// -------------------- Exported helpers used by TicketReports.js --------------------
export function applySessionToDateInputs(fromEl, toEl, sessionLabel, { force = false } = {}) {
  const r = getSessionRange(sessionLabel || getSessionLabel());

  if (fromEl && (force || !String(fromEl.value || "").trim())) {
    setInputDateValue(fromEl, r.start);
  }
  if (toEl && (force || !String(toEl.value || "").trim())) {
    setInputDateValue(toEl, r.end);
  }
}

/**
 * clampRangeToSession supports BOTH call styles:
 * 1) clampRangeToSession(fromDateOrEl, toDateOrEl, sessionLabel)
 * 2) clampRangeToSession({ from, to, sessionLabel })
 *
 * Returns:
 * { from: Date, to: Date, fromISO: string, toISO: string, sessionLabel: string }
 */
export function clampRangeToSession(a, b, c) {
  let fromArg, toArg, label;

  if (a && typeof a === "object" && ("from" in a || "to" in a || "sessionLabel" in a)) {
    fromArg = a.from;
    toArg = a.to;
    label = a.sessionLabel || "";
  } else {
    fromArg = a;
    toArg = b;
    label = c || "";
  }

  const sessLabel = String(label || getSessionLabel());
  const sess = getSessionRange(sessLabel);

  const asDate = (x) => {
    if (!x) return null;
    if (x instanceof Date) return isNaN(x.getTime()) ? null : x;

    // HTML input element
    if (typeof x === "object" && "value" in x) {
      return parseInputDateToLocalDate(x.value);
    }

    // string
    if (typeof x === "string") {
      return parseInputDateToLocalDate(x);
    }

    return null;
  };

  let from = asDate(fromArg) || new Date(sess.start);
  let to = asDate(toArg) || new Date(sess.end);

  const min = sess.start.getTime();
  const max = sess.end.getTime();

  const clamp = (dt) => {
    const t = dt.getTime();
    if (t < min) return new Date(min);
    if (t > max) return new Date(max);
    return dt;
  };

  from = clamp(from);
  to = clamp(to);

  // Ensure valid ordering
  if (from.getTime() >= to.getTime()) {
    from = new Date(sess.start);
    to = new Date(sess.end);
  }

  return {
    from,
    to,
    fromISO: from.toISOString(),
    toISO: to.toISOString(),
    sessionLabel: sessLabel
  };
}

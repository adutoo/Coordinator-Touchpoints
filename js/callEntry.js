// js/callEntry.js
import { sb } from "./supabaseClient.js";
import { mountNav } from "./nav.js";
import { getMe } from "./auth.js";

const metaEl = document.getElementById("meta");
const msgEl = document.getElementById("msg");

const parentNumberEl = document.getElementById("parentNumber");
const coordinatorNameEl = document.getElementById("coordinatorName");
const callStartEl = document.getElementById("callStart");
const callEndEl = document.getElementById("callEnd");

const positivesEl = document.getElementById("positives");
const suggestionsEl = document.getElementById("suggestions");
const fullSummaryEl = document.getElementById("fullSummary");

document.getElementById("backBtn")?.addEventListener("click", () => {
  window.location.href = "callReports.html";
});

function show(text, isErr = false) {
  msgEl.style.display = "block";
  msgEl.style.borderColor = isErr ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msgEl.style.color = isErr ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  msgEl.textContent = text;
}
function hideMsg() { msgEl.style.display = "none"; }

function pad(n) { return String(n).padStart(2, "0"); }
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function norm10(n) {
  return String(n || "").replace(/\D/g, "").slice(-10);
}

function extractSection(text, startTag, endTag) {
  const s = String(text || "");
  const i = s.indexOf(startTag);
  const j = s.indexOf(endTag);
  if (i === -1 || j === -1 || j <= i) return "";
  return s.slice(i + startTag.length, j).trim();
}

function parseSummary(summary) {
  const s = String(summary || "");

  // Primary: strict tags
  const pos = extractSection(s, "[POSITIVES]", "[/POSITIVES]");
  const sug = extractSection(s, "[SUGGESTIONS]", "[/SUGGESTIONS]");
  if (pos || sug) return { positives: pos, suggestions: sug };

  // Fallback (in case older summaries exist)
  const parts = s.split(/SUGGESTIONS?:/i);
  if (parts.length >= 2) {
    const p = parts[0].replace(/POSITIVES?:/i, "").trim();
    const q = parts.slice(1).join("SUGGESTIONS:").trim();
    return { positives: p, suggestions: q };
  }

  return { positives: "", suggestions: "" };
}

async function loadCoordinatorMap() {
  const map = {};
  const { data, error } = await sb
    .from("coordinator_phone_map")
    .select("coordinator_number_norm, coordinator_name");

  if (error) return map;

  for (const r of (data || [])) {
    if (r.coordinator_number_norm) map[String(r.coordinator_number_norm)] = r.coordinator_name || "";
  }
  return map;
}

(async () => {
  await mountNav("call-entry");
  await getMe();

  hideMsg();

  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    show("Missing call log id.", true);
    return;
  }

  metaEl.textContent = `Call Log ID: ${id}`;

  const coordMap = await loadCoordinatorMap();

  const { data, error } = await sb
    .from("call_logs")
    .select("id, timestamp, parent_number, coordinator_number, call_start, call_end, call_summary")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    show(error?.message || "Call log not found.", true);
    return;
  }

  parentNumberEl.value = data.parent_number || "";
  callStartEl.value = fmtDateTime(data.call_start);
  callEndEl.value = fmtDateTime(data.call_end);

  const coordName = coordMap[norm10(data.coordinator_number)] || "";
  coordinatorNameEl.value = coordName;

  const summary = String(data.call_summary || "").trim();
  if (!summary) {
    show("Call Summary not generated yet. Go back and click Generate.", true);
    return;
  }

  fullSummaryEl.value = summary;

  const parsed = parseSummary(summary);
  positivesEl.value = parsed.positives || "";
  suggestionsEl.value = parsed.suggestions || "";
})();

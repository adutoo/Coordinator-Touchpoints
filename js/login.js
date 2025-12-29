import { sb } from "./supabaseClient.js";

const form = document.getElementById("loginForm");
const msg = document.getElementById("msg");

function show(text, isError = false) {
  msg.style.display = "block";
  msg.style.borderColor = isError ? "rgba(255,77,109,0.55)" : "rgba(124,92,255,0.55)";
  msg.style.color = isError ? "rgba(255,200,210,0.95)" : "rgba(255,255,255,0.72)";
  msg.textContent = text;
}

(async () => {
  const { data } = await sb.auth.getSession();
  if (data?.session) window.location.href = "dashboard.html";
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.style.display = "none";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { error } = await sb.auth.signInWithPassword({ email, password }); // :contentReference[oaicite:3]{index=3}
  if (error) return show(error.message, true);

  window.location.href = "dashboard.html";
});

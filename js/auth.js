import { sb } from "./supabaseClient.js";

export async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data?.session) {
    window.location.href = "index.html";
    return null;
  }
  return data.session;
}

export async function getMe() {
  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}

export async function getMyProfile(userId) {
  const { data, error } = await sb
    .from("profiles")
    .select("display_name,email,role")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data;
}

export async function requireAdmin() {
  await requireAuth();
  const me = await getMe();
  if (!me) {
    window.location.href = "index.html";
    return null;
  }

  const profile = await getMyProfile(me.id);
  if (profile.role !== "admin") {
    window.location.href = "dashboard.html";
    return null;
  }
  return { me, profile };
}

export async function signOut() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}

// js/supabaseClient.js
export const SUPABASE_URL = "https://uyhzjnxoaawrrapnqocl.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5aHpqbnhvYWF3cnJhcG5xb2NsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5ODIxMDgsImV4cCI6MjA4MjU1ODEwOH0.V3TUuIp0VWQbPdktmZbiVEeVKKCPwc4gtufuLqb891w";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Debug helpers (so you can type sb in console)
window.sb = sb;
window.SUPABASE_URL = SUPABASE_URL;

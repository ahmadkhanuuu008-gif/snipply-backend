import { supabaseAnon } from "../lib/supabase.js";

// Verifies the Supabase access token from the Authorization header.
// Attaches req.user (the Supabase user) on success.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing Authorization: Bearer <token>" });
  }
  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.user = data.user;
  req.accessToken = token;
  next();
}
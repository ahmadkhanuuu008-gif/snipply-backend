import { supabaseAdmin } from "../lib/supabase.js";

export function videosRouter(express) {
  const router = express.Router();

  // List videos for the authenticated user.
  router.get("/", async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("videos")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ videos: data });
  });

  // Create a video record.
  router.post("/", async (req, res) => {
    const { original_url, status } = req.body || {};
    if (!original_url) return res.status(400).json({ error: "original_url is required" });
    const { data, error } = await supabaseAdmin
      .from("videos")
      .insert({ user_id: req.user.id, original_url, status: status || "pending" })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ video: data });
  });

  // Get a single video (must belong to the user).
  router.get("/:id", async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("videos")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();
    if (error) return res.status(404).json({ error: "Video not found" });
    res.json({ video: data });
  });

  // Update status.
  router.patch("/:id", async (req, res) => {
    const { status } = req.body || {};
    const { data, error } = await supabaseAdmin
      .from("videos")
      .update({ status })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ video: data });
  });

  return router;
}
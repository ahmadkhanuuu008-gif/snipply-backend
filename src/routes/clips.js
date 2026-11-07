import { supabaseAdmin } from "../lib/supabase.js";

export function clipsRouter(express) {
  const router = express.Router();

  // List clips, optionally filtered by video_id.
  router.get("/", async (req, res) => {
    let query = supabaseAdmin.from("clips").select("*").eq("user_id", req.user.id);
    if (req.query.video_id) query = query.eq("video_id", req.query.video_id);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ clips: data });
  });

  // Create a clip record.
  router.post("/", async (req, res) => {
    const { video_id, download_url } = req.body || {};
    if (!video_id) return res.status(400).json({ error: "video_id is required" });
    const { data, error } = await supabaseAdmin
      .from("clips")
      .insert({ user_id: req.user.id, video_id, download_url })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ clip: data });
  });

  // Get a single clip.
  router.get("/:id", async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("clips")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();
    if (error) return res.status(404).json({ error: "Clip not found" });
    res.json({ clip: data });
  });

  return router;
}
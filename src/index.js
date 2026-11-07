import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { requireAuth } from "./middleware/auth.js";
import { healthRouter } from "./routes/health.js";
import { videosRouter } from "./routes/videos.js";
import { clipsRouter } from "./routes/clips.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Allowed origins (comma-separated in CORS_ORIGIN).
const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(morgan("combined"));

// Health check (no auth).
app.use("/health", healthRouter(express));

// Protected API routes.
app.use("/api/videos", requireAuth, videosRouter(express));
app.use("/api/clips", requireAuth, clipsRouter(express));

// 404 handler.
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

// Error handler.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Snipply backend listening on port ${PORT}`);
});
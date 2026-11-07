export function healthRouter(express) {
  const router = express.Router();
  router.get("/", (_req, res) => {
    res.json({ status: "ok", service: "snipply-backend", time: new Date().toISOString() });
  });
  return router;
}
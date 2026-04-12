const express = require("express");
const path    = require("path");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── CORS ──────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://meetbot-check-in-system.onrender.com,http://localhost:3000,http://localhost:3001")
  .split(",").map(s => s.trim());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── Rate Limiting ────────────────────────────
const rateLimit = require("express-rate-limit");

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "請求過於頻繁，請稍後再試" }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "登入嘗試過於頻繁，請稍後再試" }
});
app.use("/login", authLimiter);
app.use("/register", authLimiter);

// ── Routes ────────────────────────────────────
const { sendLine } = require("./src/line");

app.use(require("./src/routes/webhook"));
app.use(require("./src/routes/attendance"));
app.use(require("./src/routes/export"));
app.use(require("./src/routes/meetbot"));

// ── 測試 ──────────────────────────────────────
app.get("/test-me", async (req, res) => {
  try {
    await sendLine("Uece4baaf97cfab39ad79c6ed0ee55d03", "📋 MeetBot 測試成功！LINE Bot 已正常連線 🎉");
    res.send("訊息已發送 ✅");
  } catch (e) {
    res.status(500).send("發送失敗：" + e.message);
  }
});

// ── Health check（防止 Render 冷啟動）────────
app.get("/health", (req, res) => res.send("OK"));

app.get("/", (req, res) => res.redirect("/checkin.html"));

// ── 排程器 ────────────────────────────────────
const { startScheduler } = require("./src/scheduler");
startScheduler();

// ── DocStore 過期清理 ─────────────────────────
const { cleanupExpiredDocs } = require("./src/utils");
cleanupExpiredDocs();
setInterval(cleanupExpiredDocs, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MeetBot + 出缺勤系統啟動，port ${PORT}`);

  // ── 自我 ping（每 14 分鐘，防止 Render 免費方案休眠）──
  const BASE = process.env.BASE_URL || "https://meetbot-check-in-system.onrender.com";
  setInterval(() => {
    require("https").get(`${BASE}/health`, () => {}).on("error", () => {});
  }, 14 * 60 * 1000);
});

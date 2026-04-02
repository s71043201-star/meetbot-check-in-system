const express = require("express");
const path    = require("path");
const { PORT } = require("./src/config");
const { sendLine } = require("./src/line");
const { startScheduler } = require("./src/scheduler");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── CORS ──
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── 路由 ──
app.use(require("./src/routes/attendance"));
app.use(require("./src/routes/webhook"));
app.use(require("./src/routes/export"));
app.use(require("./src/routes/meetbot"));

// ── 測試 ──
app.get("/test-me", async (req, res) => {
  try {
    await sendLine("Uece4baaf97cfab39ad79c6ed0ee55d03", "📋 MeetBot 測試成功！LINE Bot 已正常連線 🎉");
    res.send("訊息已發送 ✅");
  } catch (e) {
    res.status(500).send("發送失敗：" + e.message);
  }
});

app.get("/", (req, res) => res.redirect("/checkin.html"));

// ── 啟動 ──
app.listen(PORT, "0.0.0.0", () => {
  console.log(`MeetBot + 出缺勤系統啟動，port ${PORT}`);
  startScheduler();
});

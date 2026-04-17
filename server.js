const express = require("express");
const path    = require("path");
const axios   = require("axios");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// -- CORS --
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://meetbot-check-in-system.onrender.com,https://s71043201-star.github.io,http://localhost:3000,http://localhost:3001")
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

// -- Rate Limiting --
const rateLimit = require("express-rate-limit");

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "\u8ACB\u6C42\u904E\u65BC\u983B\u7E41\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66" }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "\u767B\u5165\u5617\u8A66\u904E\u65BC\u983B\u7E41\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66" }
});
app.use("/login", authLimiter);
app.use("/register", authLimiter);

// -- Routes --
const { sendLine } = require("./src/line");
const { MEMBERS } = require("./src/config");

app.use(require("./src/routes/webhook"));
app.use(require("./src/routes/attendance"));
app.use(require("./src/routes/export"));
app.use(require("./src/routes/meetbot"));
app.use(require("./src/routes/questions"));
app.use(require("./src/routes/richmenu"));

// -- Test --
app.get("/test-me", async (req, res) => {
  try {
    const targetName = req.query.name;
    const targetId = targetName ? MEMBERS[targetName] : "Uece4baaf97cfab39ad79c6ed0ee55d03";
    if (!targetId) return res.status(400).send("\u627E\u4E0D\u5230\u6210\u54E1\uFF1A" + targetName);
    await sendLine(targetId, "\u{1F4CB} MeetBot \u6E2C\u8A66\u6210\u529F\uFF01LINE Bot \u5DF2\u6B63\u5E38\u9023\u7DDA \u{1F389}");
    res.send("\u8A0A\u606F\u5DF2\u767C\u9001\u7D66 " + (targetName || "\u6234\u8C50\u9038") + " \u2705");
  } catch (e) {
    res.status(500).send("\u767C\u9001\u5931\u6557\uFF1A" + e.message);
  }
});

// -- Health check --
app.get("/health", (req, res) => res.send("OK"));
app.get("/ping", (req, res) => res.send("pong"));

app.get("/", (req, res) => res.redirect("/checkin.html"));

// Old link compat
app.get("/export-word", (req, res) => res.redirect("/export-pdf"));

// -- Scheduler --
const { startScheduler } = require("./src/scheduler");
startScheduler();

// -- DocStore cleanup --
const { cleanupExpiredDocs } = require("./src/utils");
cleanupExpiredDocs();
setInterval(cleanupExpiredDocs, 24 * 60 * 60 * 1000);

// -- Self-ping (prevent Render free tier sleep) --
const SELF_URL = process.env.RENDER_EXTERNAL_URL || ("http://localhost:" + (process.env.PORT || 3000));
setInterval(() => {
  axios.get(SELF_URL + "/ping").catch(() => {});
}, 14 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("MeetBot + \u51FA\u7F3A\u52E4 + QA \u7CFB\u7D71\u555F\u52D5\uFF0Cport " + PORT);
});

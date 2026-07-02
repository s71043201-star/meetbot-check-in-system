// src/schedule.js — 跟課班表系統（由 Python/FastAPI main.py 移植為 Express Router）
// 掛載於 /schedule，資料存 Firebase RTDB 命名空間 /schedule/*（與簽到系統資料隔離）
const express = require("express");
const crypto  = require("crypto");
const axios   = require("axios");
const multer  = require("multer");
const ExcelJS = require("exceljs");
const webpush = require("web-push");
const { buildExportFullHtml } = require("./templates/export-full-html"); // 領據 Word 樣板

// ── Web Push（VAPID）──
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || "BLXwereOaBVzDS65jgXecF2X30L9pYk7hBjr55pKC_SxARzmetWjyqAOsGjWXu08BjoHYSCTzekwVTaXa0Ke4zI";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || "FHw1cTg2BwBF7u1-jo2tC-Q-cF26Z9ExvYagGy72E2k";
try { webpush.setVapidDetails("mailto:s71043201@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE); }
catch (e) { console.error("[schedule] VAPID 設定失敗:", e.message); }

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// 表單解析（HTML form POST）；multipart 交給 multer，urlencoded 會自動略過
router.use(express.urlencoded({ extended: true }));

// ── 設定 ──────────────────────────────────────
const PREFIX  = "/schedule";
// 放在已開放的 meetbot 命名空間底下，免改 Firebase 安全規則即可運作
const SCHED_FB = process.env.SCHED_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/schedule";

const sessions  = new Map();   // token -> session
const loginLog  = new Map();   // key(姓名) -> [失敗時間戳]
const MAX_FAILS    = 8;             // 每個帳號在時間窗內允許的失敗次數
const RATE_WINDOW  = 300 * 1000;    // ms（5 分鐘）
const SESSION_TTL  = 8 * 3600 * 1000; // ms

const WEEKDAY_ZH = ["一", "二", "三", "四", "五", "六", "日"]; // 週一起
const PRESC_CLASS = {
  "運動處方":     ["sport",   "🏃"],
  "情緒調適處方": ["emotion", "🧘"],
  "社會處方":     ["social",  "🤝"],
};
const MSG_MAP = {
  imported:        "✓ 課程已成功匯入",
  course_added:    "✓ 已新增課程",
  course_deleted:  "✓ 已刪除課程",
  added:           "✓ 已新增工讀生帳號",
  dup:             "已有相同姓名＋後4碼的帳號",
  bad_input:       "請完整填寫姓名與身分證後 4 碼",
  deleted:         "✓ 已刪除帳號",
  pw_reset:        "✓ 密碼已重設為 worker123",
  avail_on:        "✓ 已登記可跟課",
  avail_off:       "✓ 已取消登記",
  assigned:        "✓ 已確認指派",
  unassigned:      "✓ 已取消指派",
  bad_cred:        "帳號或密碼錯誤",
  rate_limit:      "登入嘗試次數過多，請稍後再試",
  courses_cleared: "✓ 已清除所有課程",
  courses_refreshed: "✓ 已重新整理課程（已抓取週報系統最新資料）",
  nofollow_set:    "✓ 已將此堂設為不跟課",
  follow_set:      "✓ 已將此堂設為開放跟課",
  nofollow_name:   "✓ 已將所有同名課程設為不跟課",
  follow_name:     "✓ 已將所有同名課程恢復開放跟課",
  follow_saved:    "✓ 已儲存跟課設定",
  worker_updated:  "✓ 已更新工讀生資料",
  user_deleted:    "✓ 已刪除使用者報名資料",
  notify_sent:     "✓ 已發送通知",
  notify_need:     "請填寫內容並至少勾選一位",
  csrf_err:        "請求驗證失敗，請重試",
  pw_changed:      "✓ 密碼已成功變更",
  pw_wrong:        "目前密碼輸入錯誤",
  pw_short:        "新密碼至少需要 6 個字元",
  pw_short4:       "新密碼至少需要 4 個字元",
  pw_changed_home: "✓ 密碼已成功變更",
  pw_mismatch:     "兩次輸入的新密碼不一致",
  pw_set:          "✓ 已設定工讀生新密碼",
};

// ── Firebase RTDB 小工具 ──────────────────────
async function rget(sub = "") {
  try {
    const { data } = await axios.get(`${SCHED_FB}${sub}.json`);
    return data;
  } catch (e) {
    console.error(`[schedule] rget(${sub}) failed:`, e.message);
    return null;
  }
}
async function rput(sub, val) {
  const { data } = await axios.put(`${SCHED_FB}${sub}.json`, val);
  return data;
}
async function rpost(sub, val) {
  const { data } = await axios.post(`${SCHED_FB}${sub}.json`, val);
  return data; // { name: pushId }
}
async function rpatch(sub, val) {
  const { data } = await axios.patch(`${SCHED_FB}${sub}.json`, val);
  return data;
}
async function rdel(sub) {
  await axios.delete(`${SCHED_FB}${sub}.json`);
}

// ── 週報系統 Supabase（課程唯一來源，即時讀取）──
// course_slots 由週報系統的 n8n 同步；此處即時讀取，週報一按同步這裡就同步。
const SUPA_URL = process.env.SUPA_URL || "https://ilcnqpywxaseeyasiwws.supabase.co";
const SUPA_KEY = process.env.SUPA_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsY25xcHl3eGFzZWV5YXNpd3dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIzODgsImV4cCI6MjA4OTQwODM4OH0.TrjIr4IMdvpstkN8tNBQtAEvvNDTLg3XcXXIpptJIs0";
// course_type → 處方類型（只保留需跟課的三種團體處方課；nutrition/營養諮詢排除）
const COURSE_TYPE_MAP = { exercise: "運動處方", mental: "情緒調適處方", social: "社會處方" };
const COURSE_TTL = 10 * 60 * 1000; // 快取 10 分鐘
let courseCache = { at: 0, data: [] };

// ── 分區（北投／士林／中山）──
const REGIONS = ["北投", "士林", "中山"];
const REGION_KW = {
  "北投": ["北投", "石牌", "關渡", "唭哩岸", "一德"],
  "士林": ["士林", "天母", "芝山", "社子"],
  "中山": ["中山", "大直", "圓山"],
};
function resolveRegion(name, location, clinicMap) {
  const t = `${name || ""} ${location || ""}`;
  for (const region of REGIONS) if (REGION_KW[region].some(k => t.includes(k))) return region;
  if (clinicMap) {
    for (const [clinic, reg] of Object.entries(clinicMap)) {
      if (clinic && t.includes(clinic)) {
        const r = String(reg || "").replace("區", "");
        if (REGIONS.includes(r)) return r;
      }
    }
  }
  return "其他";
}

function todayTaipei() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10);
}
async function fetchSupabaseCourses(force = false) {
  if (!force && Date.now() - courseCache.at < COURSE_TTL) return courseCache.data;
  try {
    const { data } = await axios.get(`${SUPA_URL}/rest/v1/prescription_data`, {
      params: { select: "course_slots,clinic_region_map", order: "uploaded_at.desc", limit: 1 },
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
      timeout: 15000,
    });
    const slots = (data[0] && data[0].course_slots) || [];
    const clinicMap = (data[0] && data[0].clinic_region_map) || {};
    const today = todayTaipei();
    const courses = slots
      .filter(s => s && s.slot_date >= today && s.status !== "cancelled" && COURSE_TYPE_MAP[s.course_type])
      .map(s => ({
        id: s.slot_id,
        course_name: s.course_name || "",
        prescription_type: COURSE_TYPE_MAP[s.course_type],
        date: s.slot_date,
        time_slot: `${String(s.start_time || "").slice(0, 5)} - ${String(s.end_time || "").slice(0, 5)}`,
        location: s.course_location || "",
        enrolled: Number(s.booked_count) || 0,
        capacity: Number(s.max_capacity) || Number(s.capacity) || 0,
        status: s.status,
        region: resolveRegion(s.course_name, s.course_location, clinicMap),
      }))
      .sort((a, b) => (a.date + a.time_slot).localeCompare(b.date + b.time_slot));
    courseCache = { at: Date.now(), data: courses };
    return courses;
  } catch (e) {
    console.error("[schedule] Supabase 讀取失敗:", e.message);
    return courseCache.data; // 失敗時沿用舊快取
  }
}
async function coursesMap() {
  const list = await fetchSupabaseCourses();
  return Object.fromEntries(list.map(c => [c.id, c]));
}

// ── 簽到系統 attendance（沿用現有出勤資料庫，供簽到退整合）──
const ATT_FB = process.env.ATT_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/attendance";
async function rgetAtt(sub = "") {
  try {
    const { data } = await axios.get(`${ATT_FB}${sub}.json`);
    return data;
  } catch (e) {
    console.error(`[schedule] attendance 讀取失敗:`, e.message);
    return null;
  }
}
async function rpatchAtt(sub, val) {
  const { data } = await axios.patch(`${ATT_FB}${sub}.json`, val);
  return data;
}

// ── Web Push 訂閱存取（存於 schedule /push_subs/{workerId}/{key}）──
async function savePushSub(wid, sub) {
  const key = crypto.createHash("sha1").update(String(sub.endpoint)).digest("hex");
  await rput(`/push_subs/${wid}/${key}`, sub);
}
async function sendPushToWorker(wid, payload) {
  const subs = await rget(`/push_subs/${wid}`) || {};
  for (const [key, sub] of Object.entries(subs)) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await rdel(`/push_subs/${wid}/${key}`); // 失效訂閱清除
      else console.error("[schedule] push 發送失敗:", e.statusCode, e.message);
    }
  }
}
async function sendPushToUsers(ids, payload) {
  for (const id of ids) await sendPushToWorker(id, payload);
}
async function getUserIdsByRole(role) {
  const us = await getUsers();
  return us.filter(u => u.role === role).map(u => u.id);
}

// ── 使用者報名資料（沿用現有 users 資料庫；含個資，僅管理員後台顯示）──
const USERS_REG_FB = process.env.USERS_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/users";
async function regUsersGet() {
  try {
    const { data } = await axios.get(`${USERS_REG_FB}.json`);
    return data ? Object.entries(data).map(([id, u]) => ({ id, ...u })) : [];
  } catch (e) {
    console.error(`[schedule] users 讀取失敗:`, e.message);
    return [];
  }
}
async function regUsersDelete(id) {
  await axios.delete(`${USERS_REG_FB}/${id}.json`);
}

// ── 開放跟課 / 不跟課 清單（存 Firebase；以 slot_id 為準，預設全部開放）──
function nameKey(name) {
  return crypto.createHash("sha1").update(String(name || ""), "utf8").digest("hex");
}
async function nofollowSets() {
  const slots = await rget("/nofollow_slots") || {}; // { slotId: true }
  return { slots };
}
function isFollow(course, nf) {
  return !nf.slots[course.id];
}
// 依課名分組：{ name: {slots:[ids], open:openCount, total} }
function groupByName(courses, nf) {
  const g = {};
  for (const c of courses) {
    if (!g[c.course_name]) g[c.course_name] = { name: c.course_name, slots: [], dates: new Set(), open: 0, total: 0, type: c.prescription_type, region: c.region };
    g[c.course_name].slots.push(c.id);
    g[c.course_name].dates.add(c.date);
    g[c.course_name].total++;
    if (isFollow(c, nf)) g[c.course_name].open++;
  }
  return g;
}

// ── 一般工具 ──────────────────────────────────
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function hp(pw) {
  return crypto.createHash("sha256").update(String(pw), "utf8").digest("hex");
}
function nowTaipei() {
  // 'YYYY-MM-DD HH:MM:SS'（Asia/Taipei）
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" });
}
function weekdayStr(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  if (!m) return "";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(dt)) return "";
  return WEEKDAY_ZH[(dt.getDay() + 6) % 7]; // JS: 0=Sun → 週一起算
}
function canOpenBadge(enrolled) {
  const n = Number(enrolled) || 0;
  if (n >= 4) return "<span class='badge b-open'>✅ 可開課</span>";
  if (n > 0)  return `<span class='badge b-warn'>${esc(n)} 人</span>`;
  return "<span class='badge b-gray'>—</span>";
}
function prescTag(pt) {
  if (!pt) return "";
  const pair = PRESC_CLASS[pt];
  if (pair) return `<span class='tag t-${pair[0]}'>${pair[1]} ${esc(pt)}</span>`;
  return `<span class='tag t-other'>${esc(pt)}</span>`;
}

// ── Cookie / Session ──────────────────────────
function getCookie(req, name) {
  const h = req.headers.cookie || "";
  for (const part of h.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return "";
}
function isHttps(req) {
  return (req.headers["x-forwarded-proto"] || req.protocol) === "https";
}
function setSessionCookie(res, req, token, maxAgeSec) {
  const secure = isHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie",
    `sched_session=${token}; HttpOnly; Path=${PREFIX}; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`);
}
function getSess(req) {
  const token = getCookie(req, "sched_session");
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - (s.ts || 0) > SESSION_TTL) { sessions.delete(token); return null; }
  return s;
}
function newSession(id, user) {
  const token = crypto.randomBytes(32).toString("hex");
  const sess = {
    id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    csrf: crypto.randomBytes(16).toString("hex"),
    ts: Date.now(),
  };
  sessions.set(token, sess);
  return { token, sess };
}
function csrfOk(req, token) {
  const s = getSess(req);
  return !!(s && token && s.csrf === token);
}
// 依帳號（姓名）計算「失敗」次數；成功登入會清零，避免同 IP 多人互相影響
function loginBlocked(key) {
  const now = Date.now();
  const arr = (loginLog.get(key) || []).filter(t => now - t < RATE_WINDOW);
  loginLog.set(key, arr);
  return arr.length >= MAX_FAILS;
}
function recordFail(key) {
  const now = Date.now();
  const arr = (loginLog.get(key) || []).filter(t => now - t < RATE_WINDOW);
  arr.push(now);
  loginLog.set(key, arr);
}
function clearFails(key) { loginLog.delete(key); }

// ── 使用者資料存取 ────────────────────────────
async function getUsers() {
  const obj = await rget("/users") || {};
  return Object.entries(obj).map(([id, u]) => ({ id, ...u }));
}
async function getUser(id) {
  const u = await rget(`/users/${id}`);
  return u ? { id, ...u } : null;
}
async function ensureAdmin() {
  try {
    const users = await getUsers();
    if (!users.some(u => u.username === "admin")) {
      await rpost("/users", {
        username: "admin",
        password_hash: hp("admin123"),
        display_name: "管理員",
        role: "admin",
      });
      console.log("[schedule] 已建立預設管理員 admin / admin123");
    }
  } catch (e) {
    console.error("[schedule] ensureAdmin failed:", e.message);
  }
}
ensureAdmin();

// ══════════════════════════════════════════════
//  設計系統 — Japanese Minimalist（沿用原版）
// ══════════════════════════════════════════════
const CSS = `
<style>
:root{
  --bg:#F5F5F3;--card:#FFFFFF;--nav:#2B4462;
  --text:#1A1A1A;--muted:#6B6B6B;--light:#9A9A9A;
  --accent:#2B4462;--accent-h:#3A5C84;--accent-l:#EBF0F7;
  --border:#E4E4E0;--border-l:#F0F0EC;
  --ok:#3A6B4A;--ok-bg:#EBF5EF;--ok-b:#B2D8BF;
  --warn:#7A5C14;--warn-bg:#FBF6EC;--warn-b:#DFC98A;
  --err:#7A2E2E;--err-bg:#F7EDED;--err-b:#D8AAAA;
  --open:#1A5C32;--open-bg:#D5F5E3;--open-b:#82C9A2;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans TC',sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.65}
a{color:var(--accent);text-decoration:none}
.nav{background:var(--nav);height:52px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.nav-brand{color:#fff;font-size:15px;font-weight:600;letter-spacing:.03em}
.nav-brand span{opacity:.6;font-weight:400;font-size:13px;margin-left:8px}
.nav-right{display:flex;align-items:center;gap:20px}
.nav-right .user{color:#B8CCE4;font-size:13px}
.nav-right a{color:#D6E4F7;font-size:13px;padding:4px 10px;border:1px solid rgba(255,255,255,.25);border-radius:3px;transition:.15s}
.nav-right a:hover{background:rgba(255,255,255,.12)}
.wrap{max-width:1080px;margin:32px auto;padding:0 24px}
.card{background:var(--card);border:1px solid var(--border);border-radius:4px;padding:28px;margin-bottom:20px}
.card-title{font-size:13px;font-weight:600;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:18px;padding-bottom:10px;border-bottom:1px solid var(--border-l)}
.tabs{display:flex;gap:1px;border-bottom:2px solid var(--accent);margin-bottom:0}
.tab-btn{padding:9px 24px;background:#E8EDF5;color:var(--accent);border:none;border-radius:4px 4px 0 0;cursor:pointer;font-size:13px;font-weight:500;transition:.15s;letter-spacing:.02em}
.tab-btn:hover{background:#D8E4F2}
.tab-btn.active{background:var(--accent);color:#fff}
.tab-panel{display:none;padding-top:20px}
.tab-panel.active{display:block}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;padding:10px 14px;border-bottom:2px solid var(--border);text-align:left;background:transparent}
tbody td{padding:11px 14px;border-bottom:1px solid var(--border-l);vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover td{background:var(--accent-l)}
.row-assigned td{background:#F0FBF4}
.row-assigned:hover td{background:#E5F7EC}
.btn{display:inline-flex;align-items:center;gap:5px;padding:7px 16px;border-radius:3px;border:1px solid transparent;font-size:13px;cursor:pointer;transition:all .15s;letter-spacing:.02em;line-height:1;text-decoration:none;font-family:inherit}
.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn-primary:hover{background:var(--accent-h)}
.btn-success{background:var(--ok);color:#fff;border-color:var(--ok)}
.btn-success:hover{opacity:.88}
.btn-danger{background:var(--err);color:#fff;border-color:var(--err)}
.btn-danger:hover{opacity:.88}
.btn-warn{background:var(--warn);color:#fff;border-color:var(--warn)}
.btn-warn:hover{opacity:.88}
.btn-ghost{background:transparent;color:var(--accent);border-color:var(--accent)}
.btn-ghost:hover{background:var(--accent-l)}
.btn-sm{padding:4px 11px;font-size:12px}
.btn:disabled,.btn[disabled]{opacity:.45;cursor:not-allowed}
.badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.03em}
.b-open{background:var(--open-bg);color:var(--open);border:1px solid var(--open-b)}
.b-warn{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn-b)}
.b-gray{color:var(--light);font-size:13px}
.b-blue{background:var(--accent-l);color:var(--accent);border:1px solid #B8CCE4}
.b-green{background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-b)}
.tag{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:500}
.t-sport{background:#EBF5EF;color:#2E6B3E}
.t-emotion{background:#FBF3E8;color:#7A4F1A}
.t-social{background:#EBF0F7;color:#2B4462}
.t-other{background:#F0F0EC;color:#555}
.form-row{display:grid;gap:14px;margin-bottom:14px}
.form-row.cols-2{grid-template-columns:1fr 1fr}
.form-row.cols-3{grid-template-columns:1fr 1fr 1fr}
.form-row.cols-4{grid-template-columns:1fr 1fr 1fr 1fr}
@media(max-width:640px){.form-row.cols-2,.form-row.cols-3,.form-row.cols-4{grid-template-columns:1fr}}
.form-group{display:flex;flex-direction:column;gap:5px}
.form-label{font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.05em;text-transform:uppercase}
input[type=text],input[type=password],input[type=number],input[type=date],select,textarea,input[type=file]{
  width:100%;padding:8px 11px;border:1px solid var(--border);border-radius:3px;font-size:13px;
  background:#fff;color:var(--text);transition:border .15s;font-family:inherit;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(43,68,98,.1)}
input[type=file]{padding:6px 10px;background:var(--bg)}
.alert{padding:11px 16px;border-radius:3px;border:1px solid transparent;font-size:13px;margin-bottom:16px}
.alert-ok{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-b)}
.alert-err{background:var(--err-bg);color:var(--err);border-color:var(--err-b)}
.divider{border:none;border-top:1px solid var(--border-l);margin:22px 0}
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg)}
.login-card{width:360px;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:40px 36px;box-shadow:0 4px 24px rgba(0,0,0,.07)}
.login-logo{text-align:center;margin-bottom:28px}
.login-logo h1{font-size:18px;color:var(--accent);font-weight:600;letter-spacing:.04em}
.login-logo p{font-size:12px;color:var(--light);margin-top:4px;letter-spacing:.06em}
.stats{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.stat{background:var(--accent-l);border:1px solid #C8D8ED;border-radius:3px;padding:8px 16px;font-size:12px;color:var(--accent)}
.stat strong{font-size:18px;display:block;line-height:1.2}
/* 跟課設定：每列獨佔一行（不可用 !important，否則 JS 無法隱藏過濾） */
.fs-row{display:flex;width:100%;box-sizing:border-box}
.region-bar button{cursor:pointer}
/* 月曆 */
.cal{width:100%;border-collapse:collapse;table-layout:fixed}
.cal th{font-size:11px;color:var(--muted);font-weight:600;padding:6px 2px;text-align:center;border:1px solid var(--border-l)}
.cal td{border:1px solid var(--border-l);vertical-align:top;height:66px;padding:0;font-size:11px}
.cal td.today{background:var(--accent-l)}
.cal td.sel{outline:2px solid var(--accent);outline-offset:-2px}
.cal a.dcell{display:block;text-decoration:none;color:inherit;height:100%;padding:3px 4px}
.cal a.dcell:hover{background:var(--border-l)}
.dnum{font-weight:600;font-size:12px;color:var(--muted)}
.cband{display:block;border-radius:3px;padding:1px 4px;margin-top:2px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cband.has{background:var(--ok-bg);color:var(--ok)}
.cband.full{background:var(--warn-bg);color:var(--warn)}
</style>`;

const JS = `<script>
function showTab(id){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  var p=document.getElementById('panel-'+id);
  var b=document.querySelector('[data-tab="'+id+'"]');
  if(p)p.classList.add('active');
  if(b)b.classList.add('active');
  try{localStorage.setItem('activeTab_'+location.pathname,id);}catch(e){}
}
window.addEventListener('DOMContentLoaded',function(){
  var k='activeTab_'+location.pathname;
  var saved;try{saved=localStorage.getItem(k);}catch(e){}
  var first=document.querySelector('.tab-btn');
  if(saved&&document.getElementById('panel-'+saved))showTab(saved);
  else if(first)showTab(first.dataset.tab);
});
</script>`;

function hiddenCsrf(sess) {
  return `<input type='hidden' name='csrf_token' value='${esc(sess.csrf || "")}'>`;
}
function navBar(sess) {
  const home  = sess.role === "admin" ? `${PREFIX}/admin` : `${PREFIX}/home`;
  const label = sess.role === "admin" ? "管理員" : "工讀生";
  return `<nav class='nav'>` +
    `<a class='nav-brand' href='${home}'>📋 跟課班表系統 <span>${label}後台</span></a>` +
    `<div class='nav-right'>` +
    `<span class='user'>${esc(sess.display_name)}</span>` +
    `<a href='${PREFIX}/logout'>登出</a>` +
    `</div></nav>`;
}
function layout(title, body, sess) {
  return `<!DOCTYPE html><html lang='zh-TW'>` +
    `<head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>` +
    `<title>${esc(title)} — 跟課班表系統</title>` +
    `<link rel='manifest' href='/manifest.json'>` +
    `<meta name='theme-color' content='#2B4462'>` +
    `<meta name='apple-mobile-web-app-capable' content='yes'>` +
    `<meta name='apple-mobile-web-app-title' content='跟課班表'>` +
    `<link rel='apple-touch-icon' href='/schedule-icon.png'>` +
    `<link rel='preconnect' href='https://fonts.googleapis.com'>` +
    `<link href='https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&display=swap' rel='stylesheet'>` +
    `${CSS}${JS}</head><body>` +
    `${navBar(sess)}` +
    `<div class='wrap'>${body}</div>` +
    `</body></html>`;
}
function alertHtml(msg, kind = "ok") {
  if (!msg) return "";
  const text = esc(MSG_MAP[msg] || msg);
  return `<div class='alert alert-${kind}'>${text}</div>`;
}
function tabsHtml(items) {
  const btns = items.map(([tid, label]) =>
    `<button class='tab-btn' data-tab='${tid}' onclick='showTab("${tid}")'>${esc(label)}</button>`
  ).join("");
  return `<div class='tabs'>${btns}</div>`;
}

// 分區篩選列（客戶端）：依 rowSelector 選到的元素 data-region 顯示/隱藏
function regionFilterBar(uid, rowSelector) {
  const btns = ["全部", ...REGIONS, "其他"].map((r, i) =>
    `<button type='button' class='btn btn-sm ${i === 0 ? "btn-primary" : "btn-ghost"}' data-reg='${r === "全部" ? "" : r}'>${r}</button>`
  ).join("");
  return `<div id='${uid}' class='region-bar' style='display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center'>` +
    `<span style='font-size:12px;color:var(--muted);margin-right:4px'>地區</span>${btns}</div>` +
    `<script>(function(){var bar=document.getElementById(${JSON.stringify(uid)});var sel=${JSON.stringify(rowSelector)};` +
    `bar.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){` +
    `bar.querySelectorAll('button').forEach(function(x){x.className='btn btn-sm btn-ghost';});b.className='btn btn-sm btn-primary';` +
    `var reg=b.getAttribute('data-reg');document.querySelectorAll(sel).forEach(function(r){r.style.display=(!reg||r.getAttribute('data-region')===reg)?'':'none';});});});})();</script>`;
}
function regionTag(region) {
  if (!region || region === "其他") return "<span class='badge b-gray' style='font-size:10px'>其他</span>";
  return `<span class='badge b-blue' style='font-size:10px'>${esc(region)}</span>`;
}

// ── 月曆 ──
const BANDS = [["早", "早上 08–12"], ["午", "下午 12–18"], ["晚", "晚上 18–22"]];
function bandOf(timeSlot) {
  const m = /^(\d{1,2}):/.exec(timeSlot || "");
  if (!m) return null;
  const h = Number(m[1]);
  if (h < 12) return "早";
  if (h < 18) return "午";
  return "晚";
}
function ymShift(month, delta) {
  let [y, m] = String(month).split("-").map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
// courses 需含 _x（是否計入 x，例如可預約）；x/y = _x數/總數
function calendarGrid(courses, month, linkBase, selectedDay) {
  const [Y, M] = String(month).split("-").map(Number);
  const startWeekday = (new Date(Y, M - 1, 1).getDay() + 6) % 7; // 週一起
  const days = new Date(Y, M, 0).getDate();
  const today = todayTaipei();
  const map = {};
  for (const c of courses) {
    if (!String(c.date).startsWith(month)) continue;
    const b = bandOf(c.time_slot);
    if (!b) continue;
    (map[c.date] = map[c.date] || {});
    (map[c.date][b] = map[c.date][b] || { x: 0, t: 0 });
    map[c.date][b].t++;
    if (c._x) map[c.date][b].x++;
  }
  let cells = "<tr>";
  for (let i = 0; i < startWeekday; i++) cells += "<td></td>";
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const dm = map[date] || {};
    let bands = "";
    for (const [key] of BANDS) {
      const info = dm[key];
      if (info) bands += `<span class='cband ${info.x > 0 ? "has" : "full"}'>${key} ${info.x}/${info.t}</span>`;
    }
    const cls = [date === today ? "today" : "", date === selectedDay ? "sel" : ""].filter(Boolean).join(" ");
    cells += `<td class='${cls}'><a class='dcell' href='${linkBase}?month=${month}&day=${date}'><span class='dnum'>${d}</span>${bands}</a></td>`;
    if ((startWeekday + d) % 7 === 0) cells += "</tr><tr>";
  }
  cells += "</tr>";
  const head = ["一", "二", "三", "四", "五", "六", "日"].map(w => `<th>${w}</th>`).join("");
  const nav = `<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px'>` +
    `<a class='btn btn-sm btn-ghost' href='${linkBase}?month=${ymShift(month, -1)}'>← 上個月</a>` +
    `<strong>${Y} 年 ${M} 月</strong>` +
    `<a class='btn btn-sm btn-ghost' href='${linkBase}?month=${ymShift(month, 1)}'>下個月 →</a></div>`;
  return nav +
    `<p style='font-size:11px;color:var(--light);margin-bottom:8px'>每格 x/y：x＝可預約（開放跟課）堂數，y＝總堂數。點日期看當天課程。</p>` +
    `<table class='cal'><thead><tr>${head}</tr></thead><tbody>${cells}</tbody></table>`;
}

// 內嵌互動月曆（讀 window.__CAL；月份/地區即時切換、點日期就地展開）
const CAL_CLIENT_JS = `<script>
(function(){
  var D=window.__CAL; if(!D) return;
  var app=document.getElementById('cal-app'); if(!app) return;
  var all=D.courses||[];
  var WD=['一','二','三','四','五','六','日'];
  var REGIONS=['北投','士林','中山'];
  var BANDS=['早','午','晚'];
  function bandOf(t){var m=/^(\\d{1,2}):/.exec(t||'');if(!m)return null;var h=+m[1];return h<12?'早':h<18?'午':'晚';}
  var months=Array.from(new Set(all.map(function(c){return c.date.slice(0,7);}))).sort();
  var cur=months.length?months[0]:'';
  var sel=null, reg='';
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function shift(m,d){var p=m.split('-').map(Number);var y=p[0],mo=p[1]+d;if(mo<1){mo=12;y--;}if(mo>12){mo=1;y++;}return y+'-'+String(mo).padStart(2,'0');}
  function cs(){return reg?all.filter(function(c){return c.region===reg;}):all;}
  function regTag(r){if(!r||r==='其他')return "<span class='badge b-gray' style='font-size:10px'>其他</span>";return "<span class='badge b-blue' style='font-size:10px'>"+esc(r)+"</span>";}
  function pTag(t){var M={'運動處方':['t-sport','🏃'],'情緒調適處方':['t-emotion','🧘'],'社會處方':['t-social','🤝']};var p=M[t];if(!p)return t?"<span class='tag t-other'>"+esc(t)+"</span>":'';return "<span class='tag "+p[0]+"'>"+p[1]+' '+esc(t)+"</span>";}
  function render(){
    if(!cur){app.innerHTML="<p style='color:var(--light)'>目前無課程</p>";return;}
    var list=cs();
    var Y=+cur.split('-')[0],M=+cur.split('-')[1];
    var start=(new Date(Y,M-1,1).getDay()+6)%7, days=new Date(Y,M,0).getDate();
    var map={};
    list.forEach(function(c){if(c.date.slice(0,7)!==cur)return;var b=bandOf(c.time);if(!b)return;map[c.date]=map[c.date]||{};map[c.date][b]=map[c.date][b]||{x:0,t:0};map[c.date][b].t++;if(c.x)map[c.date][b].x++;});
    var rbtn=['全部'].concat(REGIONS,['其他']).map(function(r){var rv=r==='全部'?'':r;return "<button type='button' class='btn btn-sm "+((reg===rv)?'btn-primary':'btn-ghost')+"' data-reg='"+rv+"'>"+r+"</button>";}).join('');
    var h="<div style='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px'><span style='font-size:12px;color:var(--muted)'>地區</span>"+rbtn+"</div>";
    h+="<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px'><button type='button' class='btn btn-sm btn-ghost' id='cp'>← 上個月</button><strong>"+Y+" 年 "+M+" 月</strong><button type='button' class='btn btn-sm btn-ghost' id='cn'>下個月 →</button></div>";
    h+="<p style='font-size:11px;color:var(--light);margin-bottom:8px'>每格 x/y：x＝"+(D.role==='admin'?'開放跟課':'尚可報名')+"堂數，y＝總堂數。點日期看當天課程。</p>";
    h+="<table class='cal'><thead><tr>"+WD.map(function(w){return "<th>"+w+"</th>";}).join('')+"</tr></thead><tbody><tr>";
    for(var i=0;i<start;i++)h+="<td></td>";
    for(var d=1;d<=days;d++){var date=cur+'-'+String(d).padStart(2,'0');var dm=map[date]||{};var bands='';BANDS.forEach(function(k){var info=dm[k];if(info)bands+="<span class='cband "+(info.x>0?'has':'full')+"'>"+k+' '+info.x+'/'+info.t+"</span>";});h+="<td class='"+(date===sel?'sel':'')+"'><a class='dcell' href='#' data-date='"+date+"'><span class='dnum'>"+d+"</span>"+bands+"</a></td>";if((start+d)%7===0)h+="</tr><tr>";}
    h+="</tr></tbody></table><div id='cal-day'></div>";
    app.innerHTML=h;
    document.getElementById('cp').onclick=function(){cur=shift(cur,-1);sel=null;render();};
    document.getElementById('cn').onclick=function(){cur=shift(cur,1);sel=null;render();};
    app.querySelectorAll('[data-reg]').forEach(function(b){b.onclick=function(){reg=b.getAttribute('data-reg');render();};});
    app.querySelectorAll('a.dcell').forEach(function(a){a.onclick=function(e){e.preventDefault();sel=a.getAttribute('data-date');render();};});
    if(sel)showDay();
  }
  function showDay(){
    var box=document.getElementById('cal-day');if(!box)return;
    var p=sel.split('-');var wd=WD[(new Date(+p[0],+p[1]-1,+p[2]).getDay()+6)%7];
    var list=cs().filter(function(c){return c.date===sel;}).sort(function(a,b){return a.time.localeCompare(b.time);});
    if(!list.length){box.innerHTML="<div class='card' style='margin-top:14px'><p style='color:var(--light);text-align:center;padding:16px'>當天無課程</p></div>";return;}
    var rows=list.map(function(c){var right;
      if(D.role==='admin'){right="<a href='"+D.prefix+"/admin/course/"+c.id+"' class='btn btn-sm btn-ghost'>查看</a>";}
      else{if(c.assigned)right="<span class='badge b-green'>✓ 已指派</span>";else if(c.avail)right="<form method='post' action='"+D.prefix+"/unavail/"+c.id+"' style='display:inline'>"+D.csrf+"<button class='btn btn-sm btn-warn'>取消登記</button></form>";else right="<form method='post' action='"+D.prefix+"/avail/"+c.id+"' style='display:inline'>"+D.csrf+"<button class='btn btn-sm btn-success'>我可以跟課</button></form>";}
      var fol=D.role==='admin'?"<td>"+(c.follow?"<span class='badge b-green'>開放</span>":"<span class='badge b-gray'>不跟課</span>")+"</td>":'';
      return "<tr><td style='white-space:nowrap;color:var(--muted)'>"+esc(c.time)+"</td><td>"+esc(c.name)+"</td><td>"+regTag(c.region)+"</td><td>"+pTag(c.type)+"</td>"+fol+"<td>"+right+"</td></tr>";
    }).join('');
    var head="<th>時段</th><th>課程</th><th>地區</th><th>類型</th>"+(D.role==='admin'?"<th>跟課</th>":"")+"<th></th>";
    box.innerHTML="<div class='card' style='margin-top:14px'><div class='card-title'>"+sel+"（週"+wd+"）課程</div><table><thead><tr>"+head+"</tr></thead><tbody>"+rows+"</tbody></table></div>";
  }
  render();
})();
</script>`;
function calData(obj) { return JSON.stringify(obj).replace(/</g, "\\u003c"); }

// 文件匯出（簽到單 / 申請單）：依課程（帶入已指派工讀生）或獨立製作；前端產生 Word
const DOCS_CLIENT_JS = `<script>
(function(){
  var D=window.__DOCS; if(!D) return;
  var courses=D.courses||[], regNames=D.regNames||[];
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function pad(n){return String(n).padStart(2,'0');}
  function dl(html,fn){var b=new Blob(["\\uFEFF"+html],{type:"application/msword;charset=utf-8"});var u=URL.createObjectURL(b);var a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);}

  function genApply(items, reason, ry, m, d){
    items=items.filter(function(p){return p.name && p.amount>0;});
    if(!items.length){alert('請選擇人員並填寫金額（需大於 0）');return;}
    var dateStr=ry+'年'+pad(m)+'月'+pad(d)+'日';var total=items.reduce(function(s,p){return s+p.amount;},0);
    var F='font-family:DFKai-SB,標楷體;';var B1='border:1px solid #000;';var P1='padding:4px 6px;font-size:11pt;'+F;var TC=B1+P1+'text-align:center;vertical-align:middle;';var TL=B1+P1+'vertical-align:middle;';
    var rows=items.map(function(p,idx){var rc=idx===0?'<td style="'+TL+'font-size:11pt;" rowspan="'+items.length+'">'+esc(reason)+'</td>':'';return '<tr style="height:60pt;"><td style="'+TC+'">臨時人員</td><td style="'+TC+'">'+esc(p.name)+'</td>'+rc+'<td style="'+TC+'">'+p.amount.toLocaleString()+' 元</td><td style="'+TC+'"> </td></tr>';}).join('');
    var html='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>@page Section1{size:A4;margin:0.5cm 2cm 1cm 2cm;}body{'+F+'font-size:12pt;margin:0;}div.Section1{page:Section1;}table{border-collapse:collapse;}</style></head><body><div class="Section1">'+
      '<p align="center" style="'+F+'font-size:18pt;font-weight:bold;margin:0 0 4pt 0;">台北市醫師公會</p>'+
      '<p align="center" style="'+F+'font-size:13pt;font-weight:bold;margin:0 0 4pt 0;">健康台灣深耕計畫 臺北市慢性病防治全人健康智慧整合照護計畫</p>'+
      '<p align="center" style="'+F+'font-size:16pt;font-weight:bold;margin:0 0 8pt 0;">臨時人員費申請單</p>'+
      '<p align="right" style="'+F+'font-size:12pt;margin:0 0 4pt 0;">'+dateStr+'</p>'+
      '<table border="1" cellpadding="4" cellspacing="0" width="100%" style="border-collapse:collapse;'+F+'font-size:11pt;">'+
      '<tr><td style="'+TC+'font-weight:bold;" width="10%">職　務</td><td style="'+TC+'font-weight:bold;" width="8%">姓名</td><td style="'+TC+'font-weight:bold;">事　由</td><td style="'+TC+'font-weight:bold;" width="10%">金　額</td><td style="'+TC+'font-weight:bold;" width="8%">簽　章</td></tr>'+rows+
      '<tr style="height:24pt;"><td style="'+TC+'font-weight:bold;" colspan="3">合　計</td><td style="'+TC+'">'+total.toLocaleString()+' 元</td><td style="'+TC+'"> </td></tr></table><br/>'+
      '<table border="1" cellpadding="4" cellspacing="0" width="100%" style="border-collapse:collapse;'+F+'font-size:11pt;"><tr><td style="'+TL+'" colspan="7">決行</td></tr>'+
      '<tr><td style="'+TC+'">理事長－計畫主持人</td><td style="'+TC+'">公會執行長</td><td style="'+TC+'">總幹事</td><td style="'+TC+'">計畫執行長</td><td style="'+TC+'">組長</td><td style="'+TC+'">出納</td><td style="'+TC+'">承辦人</td></tr>'+
      '<tr style="height:50pt;"><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td></tr></table></div></body></html>';
    dl(html,'臨時人員費申請單_'+ry+pad(m)+pad(d)+'.doc');
  }

  function genSignin(names, reason, ry, m, d){
    names=names.filter(Boolean);
    if(!names.length){alert('請選擇人員');return;}
    fetch('/records').then(function(r){return r.json();}).then(function(all){
      all=(all||[]).filter(function(r){return !r.attendanceDeleted && r.status==='checked-out';});
      var dateStr=ry+'年'+pad(m)+'月'+pad(d)+'日';var shortDate=pad(m)+'/'+pad(d);var iY=ry,iM=+m,iD=+d;
      var F='font-family:DFKai-SB,標楷體;';var B1='border:1px solid #000;';var P1='padding:4px 6px;font-size:12pt;'+F;var TC=B1+P1+'text-align:center;vertical-align:middle;';var TL=B1+P1+'vertical-align:middle;';var TH=B1+P1+'text-align:center;vertical-align:middle;font-weight:bold;';
      var pages=names.map(function(name){
        var pr=all.filter(function(r){return r.name===name&&r.year===iY&&r.month===iM&&r.day===iD;}).sort(function(a,b){return new Date(a.checkinTime)-new Date(b.checkinTime);});
        var tr='';
        if(pr.length){pr.forEach(function(rec){var ci=rec.checkinTime?new Date(rec.checkinTime).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}):'';var co=rec.checkoutTime?new Date(rec.checkoutTime).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}):'';var hrs=rec.hours!=null?rec.hours+' 時':'';tr+='<tr style="height:30pt;"><td style="'+TC+'">'+shortDate+'</td><td style="'+TC+'">'+ci+'</td><td style="'+TC+'">'+esc(name)+'</td><td style="'+TC+'">'+co+'</td><td style="'+TC+'">'+esc(name)+'</td><td style="'+TC+'">'+hrs+'</td></tr>';});}
        else{tr='<tr style="height:30pt;"><td style="'+TC+'">'+shortDate+'</td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td></tr>';}
        return '<p align="center" style="'+F+'font-size:16pt;font-weight:bold;margin:0 0 6pt 0;">台北市醫師公會 健康台灣深耕計畫</p>'+
          '<p align="center" style="'+F+'font-size:14pt;font-weight:bold;margin:0 0 6pt 0;">臺北市慢性病防治全人健康智慧整合照護計畫</p>'+
          '<p align="center" style="'+F+'font-size:18pt;font-weight:bold;margin:0 0 10pt 0;">臨時人員出勤記錄與工作內容說明</p>'+
          '<table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse:collapse;'+F+'font-size:12pt;">'+
          '<tr><td style="'+TH+'" width="20%">姓　名</td><td style="'+TH+'" colspan="5">活動名稱 / 工作內容</td></tr>'+
          '<tr style="height:30pt;"><td style="'+TC+'">'+esc(name)+'</td><td style="'+TL+'" colspan="5">'+dateStr+' '+esc(reason)+'</td></tr>'+
          '<tr><td style="'+TH+'" rowspan="2">日期</td><td style="'+TH+'" colspan="2">上班簽到</td><td style="'+TH+'" colspan="2">下班簽退</td><td style="'+TH+'" rowspan="2">工作時數</td></tr>'+
          '<tr><td style="'+TH+'">時間</td><td style="'+TH+'">姓名</td><td style="'+TH+'">時間</td><td style="'+TH+'">姓名</td></tr>'+tr+'</table>';
      });
      var body=pages.join('\\n<br clear="all" style="page-break-before:always;" />\\n');
      var html='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>@page Section1{size:A4;margin:2cm 2cm 2cm 2cm;}body{'+F+'font-size:12pt;margin:0;}div.Section1{page:Section1;}table{border-collapse:collapse;}</style></head><body><div class="Section1">'+body+'</div></body></html>';
      dl(html,'工作說明及簽到簿_'+ry+pad(m)+pad(d)+'.doc');
    });
  }

  function shift(m,dl2){var p=m.split('-').map(Number);var y=p[0],mo=p[1]+dl2;if(mo<1){mo=12;y--;}if(mo>12){mo=1;y++;}return y+'-'+String(mo).padStart(2,'0');}
  var months=Array.from(new Set(courses.map(function(c){return c.date.slice(0,7);}))).sort();
  var cur=months.length?months[0]:'', sel=null;
  function calRender(){
    var box=document.getElementById('docs-cal'); if(!box) return;
    if(!cur){box.innerHTML="<p style='color:var(--light)'>目前無課程</p>";return;}
    var Y=+cur.split('-')[0],M=+cur.split('-')[1];var start=(new Date(Y,M-1,1).getDay()+6)%7,days=new Date(Y,M,0).getDate();
    var map={};courses.forEach(function(c){if(c.date.slice(0,7)!==cur)return;(map[c.date]=map[c.date]||[]).push(c);});
    var h="<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px'><button type='button' class='btn btn-sm btn-ghost' id='dcp'>← 上個月</button><strong>"+Y+" 年 "+M+" 月</strong><button type='button' class='btn btn-sm btn-ghost' id='dcn'>下個月 →</button></div>";
    h+="<table class='cal'><thead><tr>"+['一','二','三','四','五','六','日'].map(function(w){return "<th>"+w+"</th>";}).join('')+"</tr></thead><tbody><tr>";
    for(var i=0;i<start;i++)h+="<td></td>";
    for(var dd=1;dd<=days;dd++){var date=cur+'-'+pad(dd);var n=(map[date]||[]).length;var bd=n?"<span class='cband has'>"+n+" 堂</span>":"";h+="<td class='"+(date===sel?'sel':'')+"'><a class='dcell' href='#' data-date='"+date+"'><span class='dnum'>"+dd+"</span>"+bd+"</a></td>";if((start+dd)%7===0)h+="</tr><tr>";}
    h+="</tr></tbody></table><div id='docs-day'></div>";box.innerHTML=h;
    document.getElementById('dcp').onclick=function(){cur=shift(cur,-1);sel=null;calRender();};
    document.getElementById('dcn').onclick=function(){cur=shift(cur,1);sel=null;calRender();};
    box.querySelectorAll('a.dcell').forEach(function(a){a.onclick=function(e){e.preventDefault();sel=a.getAttribute('data-date');calRender();};});
    if(sel)showDay();
  }
  function showDay(){
    var box=document.getElementById('docs-day');if(!box)return;
    var list=courses.filter(function(c){return c.date===sel;}).sort(function(a,b){return a.time.localeCompare(b.time);});
    var p=sel.split('-');var ry=+p[0]-1911,m=+p[1],d=+p[2];
    if(!list.length){box.innerHTML="<div class='card' style='margin-top:14px'><p style='color:var(--light);text-align:center;padding:16px'>當天無課程</p></div>";return;}
    var rows=list.map(function(c,i){var wk=c.workers||[];var ws=wk.length?esc(wk.join('、')):"<span style='color:var(--light)'>尚無指派</span>";return "<tr><td style='white-space:nowrap;color:var(--muted)'>"+esc(c.time)+"</td><td>"+esc(c.name)+"</td><td style='font-size:12px'>"+ws+"</td><td style='white-space:nowrap'><button class='btn btn-sm btn-primary' data-si='"+i+"'>簽到單</button> <button class='btn btn-sm btn-success' data-ap='"+i+"'>申請單</button></td></tr>";}).join('');
    box.innerHTML="<div class='card' style='margin-top:14px'><div class='card-title'>"+sel+"（民國 "+ry+"/"+m+"/"+d+"）課程</div><p style='font-size:12px;color:var(--muted);margin-bottom:8px'>簽到單／申請單會帶入該課「已指派」的工讀生。</p><table><thead><tr><th>時段</th><th>課程</th><th>已指派</th><th></th></tr></thead><tbody>"+rows+"</tbody></table></div>";
    box.querySelectorAll('[data-si]').forEach(function(b){b.onclick=function(){var c=list[+b.getAttribute('data-si')];if(!(c.workers||[]).length){alert('此課程尚無指派工讀生');return;}genSignin(c.workers,c.name,ry,m,d);};});
    box.querySelectorAll('[data-ap]').forEach(function(b){b.onclick=function(){var c=list[+b.getAttribute('data-ap')];if(!(c.workers||[]).length){alert('此課程尚無指派工讀生');return;}applyOverlay(c.workers,c.name,ry,m,d);};});
  }
  function applyOverlay(workers, reason, ry, m, d){
    var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999';
    var rh=workers.map(function(n){return "<div style='display:flex;gap:8px;align-items:center;margin-bottom:6px'><span style='flex:1'>"+esc(n)+"</span><input type='number' class='ao-amt' data-name=\\""+esc(n)+"\\" placeholder='金額' style='width:120px'></div>";}).join('');
    ov.innerHTML="<div style='background:#fff;border-radius:6px;padding:20px;width:400px;max-width:92vw;max-height:88vh;overflow:auto'><div style='font-weight:600;margin-bottom:6px'>申請單金額</div><div style='font-size:12px;color:#6b6b6b;margin-bottom:10px'>"+esc(reason)+"</div><div style='display:flex;gap:8px;margin-bottom:10px'><input type='number' id='ao-uni' placeholder='統一金額' style='flex:1'><button type='button' class='btn btn-sm btn-ghost' id='ao-apply'>套用全部</button></div>"+rh+"<div style='display:flex;gap:8px;justify-content:flex-end;margin-top:12px'><button type='button' class='btn btn-sm btn-ghost' id='ao-cancel'>取消</button><button type='button' class='btn btn-sm btn-success' id='ao-ok'>匯出申請單</button></div></div>";
    document.body.appendChild(ov);var close=function(){document.body.removeChild(ov);};
    ov.addEventListener('click',function(e){if(e.target===ov)close();});
    ov.querySelector('#ao-cancel').onclick=close;
    ov.querySelector('#ao-apply').onclick=function(){var v=ov.querySelector('#ao-uni').value;ov.querySelectorAll('.ao-amt').forEach(function(x){x.value=v;});};
    ov.querySelector('#ao-ok').onclick=function(){var items=[];ov.querySelectorAll('.ao-amt').forEach(function(x){items.push({name:x.getAttribute('data-name'),amount:parseInt(x.value)||0});});genApply(items,reason,ry,m,d);close();};
  }

  var saWrap=document.getElementById('sa-people');
  if(saWrap){saWrap.innerHTML=(regNames.length?regNames.map(function(n){return "<label class='fs-row' style='gap:10px;padding:8px'><input type='checkbox' class='sa-chk' value=\\""+esc(n)+"\\" style='width:auto;flex:none'><span style='flex:1'>"+esc(n)+"</span><input type='number' class='sa-amt' data-name=\\""+esc(n)+"\\" placeholder='金額' style='width:110px'></label>";}).join(''):"<p style='color:var(--light);padding:10px'>尚無報名資料，可用下方手動新增</p>");}
  var addBtn=document.getElementById('sa-add'),manual=document.getElementById('sa-manual');
  if(addBtn)addBtn.onclick=function(){var div=document.createElement('div');div.style.cssText='display:flex;gap:8px;margin-top:6px';div.innerHTML="<input class='sa-mname' placeholder='姓名' style='flex:1'><input type='number' class='sa-mamt' placeholder='金額' style='width:110px'><button type='button' class='btn btn-sm btn-danger sa-mdel'>×</button>";manual.appendChild(div);div.querySelector('.sa-mdel').onclick=function(){manual.removeChild(div);};};
  var uApply=document.getElementById('sa-apply');
  if(uApply)uApply.onclick=function(){var v=document.getElementById('sa-amount').value;document.querySelectorAll('.sa-chk:checked').forEach(function(cb){var a=cb.closest('label').querySelector('.sa-amt');if(a)a.value=v;});document.querySelectorAll('#sa-manual .sa-mamt').forEach(function(a){a.value=v;});};
  function saMeta(){return {reason:(document.getElementById('sa-reason').value||'').trim(),ry:parseInt(document.getElementById('sa-year').value)||0,m:parseInt(document.getElementById('sa-month').value)||0,d:parseInt(document.getElementById('sa-day').value)||0};}
  function saCollect(withAmt){var ppl=[];document.querySelectorAll('.sa-chk:checked').forEach(function(cb){var amt=withAmt?(parseInt(cb.closest('label').querySelector('.sa-amt').value)||0):0;ppl.push({name:cb.value,amount:amt});});document.querySelectorAll('#sa-manual > div').forEach(function(div){var nm=(div.querySelector('.sa-mname').value||'').trim();if(nm){var amt=withAmt?(parseInt(div.querySelector('.sa-mamt').value)||0):0;ppl.push({name:nm,amount:amt});}});return ppl;}
  var siBtn=document.getElementById('sa-signin');if(siBtn)siBtn.onclick=function(){var mt=saMeta();if(!mt.reason||!mt.ry||!mt.m||!mt.d){alert('請填事由與日期（民國年/月/日）');return;}var ppl=saCollect(false);if(!ppl.length){alert('請勾選或新增人員');return;}genSignin(ppl.map(function(p){return p.name;}),mt.reason,mt.ry,mt.m,mt.d);};
  var apBtn=document.getElementById('sa-applyform');if(apBtn)apBtn.onclick=function(){var mt=saMeta();if(!mt.reason||!mt.ry||!mt.m||!mt.d){alert('請填事由與日期（民國年/月/日）');return;}var ppl=saCollect(true);if(!ppl.length){alert('請勾選或新增人員');return;}genApply(ppl,mt.reason,mt.ry,mt.m,mt.d);};

  calRender();
})();
</script>`;

// 出勤與工時後台（沿用 /records /export DELETE /records/:id）
const ATT_CLIENT_JS = `<script>
(function(){
  var app=document.getElementById('att-app'); if(!app) return;
  var all=[];
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmtT(iso){try{return new Date(iso).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false});}catch(e){return '';}}
  var fY=document.getElementById('f-year'),fM=document.getElementById('f-month'),fN=document.getElementById('f-name');
  function filtered(){var y=fY.value.trim(),m=fM.value,n=fN.value.trim();return all.filter(function(r){if(y&&String(r.year)!==y)return false;if(m&&String(r.month)!==m)return false;if(n&&String(r.name||'').indexOf(n)<0)return false;return true;});}
  function render(){
    var list=filtered().sort(function(a,b){return new Date(b.checkinTime)-new Date(a.checkinTime);});
    var hours=list.reduce(function(s,r){return s+(Number(r.hours)||0);},0);
    var ppl={};list.forEach(function(r){ppl[r.name]=1;});
    document.getElementById('st-count').textContent=list.length;
    document.getElementById('st-hours').textContent=Math.round(hours*10)/10;
    document.getElementById('st-ppl').textContent=Object.keys(ppl).length;
    var rows=list.map(function(r){
      return "<tr><td style='font-weight:500'>"+esc(r.name)+"</td><td>"+esc(r.courseType||'')+"</td><td>"+esc(r.course||'')+"</td>"+
        "<td style='white-space:nowrap'>"+esc(r.year)+"/"+esc(r.month)+"/"+esc(r.day)+"</td>"+
        "<td style='white-space:nowrap;color:var(--muted)'>"+fmtT(r.checkinTime)+" - "+fmtT(r.checkoutTime)+"</td>"+
        "<td><span class='badge b-blue'>"+esc(r.hours)+" 時</span></td>"+
        "<td style='font-size:12px;color:var(--muted);max-width:240px'>"+esc(r.summary||r.workContent||'')+"</td>"+
        "<td style='white-space:nowrap'><button class='btn btn-sm btn-ghost' data-edit='"+esc(r.id)+"'>編輯</button> <button class='btn btn-sm btn-danger' data-del='"+esc(r.id)+"'>刪除</button></td></tr>";
    }).join('');
    document.getElementById('att-tbody').innerHTML=rows||"<tr><td colspan='8' style='text-align:center;color:var(--light);padding:24px'>無出勤資料</td></tr>";
    app.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){if(!confirm('確定刪除此筆出勤記錄？'))return;fetch('/records/'+b.getAttribute('data-del'),{method:'DELETE'}).then(function(r){return r.json();}).then(function(){load();});};});
    app.querySelectorAll('[data-edit]').forEach(function(b){b.onclick=function(){openEdit(b.getAttribute('data-edit'));};});
  }
  function toLocalInput(iso){var d=new Date(iso);if(isNaN(d))return '';var p=function(n){return String(n).padStart(2,'0');};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());}
  function openEdit(id){
    var r=all.filter(function(x){return String(x.id)===String(id);})[0]; if(!r)return;
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999';
    ov.innerHTML="<div style='background:#fff;border-radius:6px;padding:24px;width:360px;max-width:92vw'>"+
      "<div style='font-weight:600;margin-bottom:4px'>編輯出勤時間</div>"+
      "<div style='font-size:12px;color:#6b6b6b;margin-bottom:14px'>"+esc(r.name)+"｜"+esc(r.course||'')+"</div>"+
      "<label style='font-size:12px;color:#6b6b6b'>簽到時間</label>"+
      "<input id='ed-ci' type='datetime-local' value='"+toLocalInput(r.checkinTime)+"' style='width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin:4px 0 12px'>"+
      "<label style='font-size:12px;color:#6b6b6b'>簽退時間</label>"+
      "<input id='ed-co' type='datetime-local' value='"+toLocalInput(r.checkoutTime)+"' style='width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin:4px 0 6px'>"+
      "<div id='ed-msg' style='font-size:12px;color:#7A2E2E;min-height:16px'></div>"+
      "<div style='display:flex;gap:8px;justify-content:flex-end;margin-top:8px'>"+
      "<button id='ed-cancel' class='btn btn-sm btn-ghost'>取消</button>"+
      "<button id='ed-save' class='btn btn-sm btn-primary'>儲存</button></div></div>";
    document.body.appendChild(ov);
    var close=function(){document.body.removeChild(ov);};
    ov.addEventListener('click',function(e){if(e.target===ov)close();});
    ov.querySelector('#ed-cancel').onclick=close;
    ov.querySelector('#ed-save').onclick=function(){
      var ci=ov.querySelector('#ed-ci').value, co=ov.querySelector('#ed-co').value;
      if(!ci||!co){ov.querySelector('#ed-msg').textContent='請填寫簽到與簽退時間';return;}
      var ciISO=new Date(ci).toISOString(), coISO=new Date(co).toISOString();
      if(new Date(coISO)<new Date(ciISO)){ov.querySelector('#ed-msg').textContent='簽退不能早於簽到';return;}
      var btn=ov.querySelector('#ed-save');btn.disabled=true;btn.textContent='儲存中…';
      fetch('/schedule/admin/attendance/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkinTime:ciISO,checkoutTime:coISO})})
        .then(function(r){return r.json();}).then(function(d){if(d.ok){close();load();}else{ov.querySelector('#ed-msg').textContent='儲存失敗：'+(d.error||'');btn.disabled=false;btn.textContent='儲存';}})
        .catch(function(e){ov.querySelector('#ed-msg').textContent='儲存失敗';btn.disabled=false;btn.textContent='儲存';});
    };
  }
  function load(){app.querySelectorAll('#att-tbody')[0].innerHTML="<tr><td colspan='8' style='text-align:center;color:var(--light);padding:24px'>載入中…</td></tr>";fetch('/records').then(function(r){return r.json();}).then(function(data){all=(data||[]).filter(function(r){return r.status==='checked-out';});render();}).catch(function(){app.querySelectorAll('#att-tbody')[0].innerHTML="<tr><td colspan='8' style='text-align:center;color:var(--err)'>讀取失敗</td></tr>";});}
  function exportExcel(){var p=new URLSearchParams();if(fY.value.trim())p.set('year',fY.value.trim());if(fM.value)p.set('month',fM.value);if(fN.value.trim())p.set('name',fN.value.trim());window.location.href='/export?'+p.toString();}
  document.getElementById('btn-search').onclick=render;
  document.getElementById('btn-export').onclick=exportExcel;
  fN.addEventListener('input',render);fY.addEventListener('input',render);fM.addEventListener('change',render);
  load();
})();
</script>`;

// ══════════════════════════════════════════════
//  登入
// ══════════════════════════════════════════════
router.get("/login", (req, res) => {
  const msg = req.query.msg || "";
  const okMsgs = new Set(["pw_changed"]);
  let err = "";
  if (okMsgs.has(msg)) err = `<div class='alert alert-ok'>${esc(MSG_MAP[msg] || msg)}</div>`;
  else if (msg) err = alertHtml(msg, "err");
  res.send(
    `<!DOCTYPE html><html lang='zh-TW'>` +
    `<head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>` +
    `<title>登入 — 跟課班表系統</title>` +
    `<link href='https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;600&display=swap' rel='stylesheet'>` +
    `${CSS}</head><body>` +
    `<div class='login-wrap'><div class='login-card'>` +
    `<div class='login-logo'><h1>📋 跟課班表系統</h1><p>SCHEDULE MANAGEMENT</p></div>` +
    `${err}` +
    `<form method='post' action='${PREFIX}/login'>` +
    `<div class='form-group' style='margin-bottom:14px'>` +
    `<label class='form-label'>姓名</label>` +
    `<input name='name' autocomplete='name' required placeholder='請輸入姓名'></div>` +
    `<div class='form-group' style='margin-bottom:20px'>` +
    `<label class='form-label'>身分證後 4 碼</label>` +
    `<input name='code' type='password' inputmode='numeric' maxlength='4' autocomplete='current-password' required placeholder='••••'></div>` +
    `<button class='btn btn-primary' style='width:100%;justify-content:center;padding:10px'>登入</button>` +
    `</form></div></div></body></html>`
  );
});

router.post("/login", async (req, res) => {
  const name = (req.body.name || "").trim();
  const code = (req.body.code || "").trim();
  const key = (name || "?").toLowerCase();
  if (loginBlocked(key)) return res.redirect(`${PREFIX}/login?msg=rate_limit`);
  const users = await getUsers();
  const u = users.find(x => x.display_name === name && x.password_hash === hp(code));
  if (!u) { recordFail(key); return res.redirect(`${PREFIX}/login?msg=bad_cred`); }
  clearFails(key);
  const { token } = newSession(u.id, u);
  setSessionCookie(res, req, token, Math.floor(SESSION_TTL / 1000));
  res.redirect(u.role === "admin" ? `${PREFIX}/admin` : `${PREFIX}/home`);
});

router.get("/logout", (req, res) => {
  sessions.delete(getCookie(req, "sched_session"));
  setSessionCookie(res, req, "", 0);
  res.redirect(`${PREFIX}/login`);
});

router.get("/", (req, res) => {
  const sess = getSess(req);
  if (!sess) return res.redirect(`${PREFIX}/login`);
  res.redirect(sess.role === "admin" ? `${PREFIX}/admin` : `${PREFIX}/home`);
});

// 推播訂閱前端
const PUSH_CLIENT_JS = `<script>
(function(){
  var card=document.getElementById('push-card'); if(!card) return;
  var btn=document.getElementById('push-btn'), st=document.getElementById('push-status');
  function setStatus(t,ok){st.innerHTML="<span class='badge "+(ok?'b-green':'b-warn')+"'>"+t+"</span>";}
  var isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  var standalone=(window.navigator.standalone===true)||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){
    if(isIOS&&!standalone){setStatus('iOS 請先「加到主畫面」再開啟',false);}
    else{setStatus('此瀏覽器不支援推播通知',false);}
    btn.style.display='none';return;
  }
  function urlB64(b){var pad='='.repeat((4-b.length%4)%4);var base=(b+pad).replace(/-/g,'+').replace(/_/g,'/');var raw=atob(base);var arr=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i);return arr;}
  async function refresh(){try{var reg=await navigator.serviceWorker.getRegistration();var sub=reg?await reg.pushManager.getSubscription():null;if(sub&&Notification.permission==='granted'){setStatus('通知已開啟',true);btn.textContent='重新開啟通知';}else setStatus('通知未開啟',false);}catch(e){setStatus('通知未開啟',false);}}
  btn.onclick=async function(){
    btn.disabled=true;var ot=btn.textContent;btn.textContent='設定中…';
    try{
      var reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
      var perm=await Notification.requestPermission();
      if(perm!=='granted'){setStatus('尚未允許通知（請到瀏覽器/系統設定開啟）',false);btn.disabled=false;btn.textContent=ot;return;}
      var sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64(window.__VAPID)});
      var r=await fetch('/schedule/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
      if(r.ok){setStatus('通知已開啟',true);btn.textContent='重新開啟通知';}else{setStatus('訂閱失敗，請重試',false);btn.textContent=ot;}
    }catch(e){setStatus('開啟失敗：'+e.message,false);btn.textContent=ot;}
    btn.disabled=false;
  };
  refresh();
})();
</script>`;

// ══════════════════════════════════════════════
//  工讀生首頁 Portal（簽到退 / 班表）
// ══════════════════════════════════════════════
router.get("/home", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);

  // 是否有進行中的簽到（顯示在卡片上提醒）
  let activeHint = "";
  try {
    const att = await rgetAtt();
    const active = Object.values(att || {}).find(r => r && r.name === sess.display_name && r.status === "checked-in");
    if (active) activeHint = `<div style='margin-top:8px'><span class='badge b-warn'>● 目前有一筆未簽退</span></div>`;
  } catch (_) {}

  const card = (href, icon, title, desc, extra = "") =>
    `<a href='${href}' class='card' style='display:block;text-decoration:none;color:inherit;transition:.15s'>` +
    `<div style='font-size:32px;margin-bottom:10px'>${icon}</div>` +
    `<div style='font-size:16px;font-weight:600;color:var(--text);margin-bottom:4px'>${esc(title)}</div>` +
    `<div style='font-size:13px;color:var(--muted)'>${esc(desc)}</div>${extra}</a>`;

  const homeMsg = req.query.msg ? alertHtml(req.query.msg, "ok") : "";
  const body =
    `${homeMsg}` +
    `<div style='margin:8px 0 20px'>` +
    `<h2 style='font-size:18px;font-weight:600'>嗨，${esc(sess.display_name)} 👋</h2>` +
    `<p style='font-size:13px;color:var(--muted);margin-top:4px'>請選擇要使用的功能</p></div>` +
    `<div style='display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px'>` +
    `${card(`${PREFIX}/checkin`, "⏱", "簽到 / 簽退", "上課現場簽到、下課回報時數與內容", activeHint)}` +
    `${card(`${PREFIX}/dashboard`, "📋", "我的班表", "查看可跟課的課程、登記與已被指派的班")}` +
    `${card(`${PREFIX}/timesheet`, "🧾", "我的工時", "查看已完成的課程與累計工作時數")}` +
    `${card(`${PREFIX}/change-password`, "🔑", "修改密碼", "更改自己的登入密碼")}` +
    `</div>` +
    `<div class='card' id='push-card' style='margin-top:20px'>` +
    `<div class='card-title'>🔔 指派通知</div>` +
    `<p style='font-size:13px;color:var(--muted);margin-bottom:10px'>開啟後，管理員指派課程給你時，手機／電腦會跳出通知。</p>` +
    `<div id='push-status' style='margin-bottom:10px'></div>` +
    `<button class='btn btn-primary' id='push-btn'>開啟通知</button>` +
    `<details style='margin-top:14px;font-size:13px;color:var(--muted)'>` +
    `<summary style='cursor:pointer'>手機收不到？iOS / Android 開啟步驟</summary>` +
    `<div style='margin-top:8px;line-height:1.8'>` +
    `<strong>iPhone / iPad（iOS 16.4 以上）</strong><br>` +
    `1. 用 <strong>Safari</strong> 開啟本系統 → 點下方「分享」<br>` +
    `2. 選「<strong>加入主畫面</strong>」<br>` +
    `3. 從主畫面的 App 圖示重新開啟 → 登入 → 按「開啟通知」→ 允許<br><br>` +
    `<strong>Android（Chrome）</strong><br>` +
    `1. 直接按「開啟通知」→ 允許<br>` +
    `2. 若沒反應，可先從選單「安裝應用程式／加到主畫面」再開啟通知` +
    `</div></details>` +
    `</div>` +
    `<script>window.__VAPID=${JSON.stringify(VAPID_PUBLIC)}</script>` +
    PUSH_CLIENT_JS;
  res.send(layout("工讀生首頁", body, sess));
});

// ══════════════════════════════════════════════
//  我的工時（讀簽到系統 attendance）
// ══════════════════════════════════════════════
router.get("/timesheet", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  const att = await rgetAtt() || {};
  const recs = Object.values(att)
    .filter(r => r && r.name === sess.display_name && r.status === "checked-out")
    .sort((a, b) => new Date(b.checkinTime) - new Date(a.checkinTime));
  const totalHours = Math.round(recs.reduce((s, r) => s + (Number(r.hours) || 0), 0) * 10) / 10;
  const fmtTime = iso => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }); }
    catch (_) { return ""; }
  };

  let table;
  if (recs.length) {
    const rows = recs.map(r =>
      `<tr>` +
      `<td style='white-space:nowrap'>${esc(r.year)}/${esc(r.month)}/${esc(r.day)}</td>` +
      `<td>${esc(r.course)}</td>` +
      `<td style='white-space:nowrap;color:var(--muted)'>${esc(fmtTime(r.checkinTime))} - ${esc(fmtTime(r.checkoutTime))}</td>` +
      `<td style='white-space:nowrap'><span class='badge b-blue'>${esc(r.hours)} 時</span></td>` +
      `</tr>`
    ).join("");
    table = `<table><thead><tr><th>日期</th><th>課程</th><th>時段</th><th>時數</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  } else {
    table = "<p style='text-align:center;color:var(--light);padding:32px 0;font-size:13px'>目前尚無已完成的簽到退記錄</p>";
  }

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a></div>` +
    `<div class='stats'>` +
    `<div class='stat'><strong>${recs.length}</strong>已完成堂數</div>` +
    `<div class='stat'><strong>${totalHours}</strong>累計時數（時）</div>` +
    `</div>` +
    `<div class='card'><div class='card-title'>我的出勤記錄</div>${table}</div>`;
  res.send(layout("我的工時", body, sess));
});

// ══════════════════════════════════════════════
//  工讀生修改自己的密碼
// ══════════════════════════════════════════════
router.get("/change-password", (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  const msg = req.query.msg || "";
  const kind = (msg === "pw_changed") ? "ok" : "err";
  const notice = msg ? alertHtml(msg, kind) : "";
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a></div>` +
    `${notice}` +
    `<div class='card' style='max-width:460px'>` +
    `<div class='card-title'>修改密碼</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:14px'>預設密碼為身分證後 4 碼；可改成你自己的密碼（至少 4 字元）。</p>` +
    `<form method='post' action='${PREFIX}/change-password'>${hiddenCsrf(sess)}` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>目前密碼</label>` +
    `<input name='current_password' type='password' required></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>新密碼（至少 4 字元）</label>` +
    `<input name='new_password' type='password' required minlength='4'></div>` +
    `<div class='form-group' style='margin-bottom:16px'><label class='form-label'>確認新密碼</label>` +
    `<input name='confirm_password' type='password' required></div>` +
    `<button class='btn btn-primary'>變更密碼</button>` +
    `</form></div>`;
  res.send(layout("修改密碼", body, sess));
});
router.post("/change-password", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/change-password?msg=csrf_err`);
  const { current_password, new_password, confirm_password } = req.body;
  const me = await getUser(sess.id);
  if (!me || me.password_hash !== hp(current_password || "")) return res.redirect(`${PREFIX}/change-password?msg=pw_wrong`);
  if (!new_password || new_password.length < 4) return res.redirect(`${PREFIX}/change-password?msg=pw_short4`);
  if (new_password !== confirm_password) return res.redirect(`${PREFIX}/change-password?msg=pw_mismatch`);
  await rpatch(`/users/${sess.id}`, { password_hash: hp(new_password) });
  res.redirect(`${PREFIX}/home?msg=pw_changed_home`);
});

// ══════════════════════════════════════════════
//  簽到 / 簽退（沿用現有 /checkin /checkout /active-session 端點）
// ══════════════════════════════════════════════
const CHECKIN_CLIENT_JS = `<script>
(function(){
  var ME = window.__ME || {name:'',courses:[]};
  var app = document.getElementById('ck-app');
  function h(html){ app.innerHTML = html; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function val(id){ var e=document.getElementById(id); return e?e.value:''; }
  function api(url,opts){ return fetch(url,opts).then(function(r){ return r.json().catch(function(){return {};}); }); }

  function showCheckin(){
    if(!ME.courses.length){
      h("<div class='card'><div class='alert alert-err'>你目前沒有被指派的課程，無法簽到。請先在「我的班表」由專案人員指派。</div>"+
        "<a class='btn btn-ghost' href='/schedule/home'>返回首頁</a></div>");
      return;
    }
    var opts = ME.courses.map(function(c){ return "<option value='"+esc(c.name)+"'>"+esc(c.name)+"（"+esc(c.date)+" "+esc(c.time)+"）</option>"; }).join('');
    h(
      "<div class='card'><div class='card-title'>簽到</div>"+
      "<div class='form-group' style='margin-bottom:14px'><label class='form-label'>姓名</label>"+
      "<input value='"+esc(ME.name)+"' disabled></div>"+
      "<div class='form-group' style='margin-bottom:16px'><label class='form-label'>課程（僅能選被指派的課）</label>"+
      "<select id='ck-course'>"+opts+"</select></div>"+
      "<button class='btn btn-success' id='ck-btn'>簽到</button>"+
      "<div id='ck-msg' style='margin-top:12px'></div></div>"
    );
    document.getElementById('ck-btn').onclick=function(){
      var btn=this; btn.disabled=true; btn.textContent='簽到中...';
      api('/checkin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ME.name,course:val('ck-course')})})
      .then(function(res){ if(res.ok){ load(); } else { document.getElementById('ck-msg').innerHTML="<div class='alert alert-err'>簽到失敗："+esc(res.error||'')+"</div>"; btn.disabled=false; btn.textContent='簽到'; } });
    };
  }

  function showCheckout(sid, rec){
    var t = rec.checkinTime ? new Date(rec.checkinTime).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}) : '';
    var matched = (ME.courses||[]).filter(function(c){return c.name===rec.course;})[0];
    var defType = matched ? matched.type : '';
    h(
      "<div class='card'><div class='card-title'>簽退回報</div>"+
      "<div class='alert alert-ok'>已於 "+esc(t)+" 簽到　課程：<strong>"+esc(rec.course||'')+"</strong></div>"+
      "<div class='form-row cols-2'>"+
      "<div class='form-group'><label class='form-label'>課程屬性</label><input id='f-courseType' value='"+esc(defType)+"'></div>"+
      "<div class='form-group'><label class='form-label'>課程老師</label><input id='f-teacher'></div>"+
      "</div>"+
      "<div class='form-row cols-4'>"+
      "<div class='form-group'><label class='form-label'>課程預計時數</label><input id='f-plannedHours' placeholder='例：1'></div>"+
      "<div class='form-group'><label class='form-label'>系統報名人數</label><input id='f-registeredCount' type='number' min='0'></div>"+
      "<div class='form-group'><label class='form-label'>線上報名實到</label><input id='f-actualCount' type='number' min='0'></div>"+
      "<div class='form-group'><label class='form-label'>現場候補人數</label><input id='f-walkInCount' type='number' min='0'></div>"+
      "</div>"+
      "<div class='form-group' style='margin-bottom:16px'><label class='form-label'>簡述上課內容 / 回報狀況</label><textarea id='f-summary' rows='4'></textarea></div>"+
      "<button class='btn btn-danger' id='co-btn'>簽退</button>"+
      "<div id='co-msg' style='margin-top:12px'></div></div>"
    );
    document.getElementById('co-btn').onclick=function(){
      var btn=this; btn.disabled=true; btn.textContent='簽退中...';
      var payload={ sessionId:sid, courseType:val('f-courseType'), teacher:val('f-teacher'), plannedHours:val('f-plannedHours'),
        registeredCount:val('f-registeredCount'), actualCount:val('f-actualCount'), walkInCount:val('f-walkInCount'), summary:val('f-summary') };
      api('/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(res){
        if(res.ok){
          var link = res.downloadUrl ? "<a class='btn btn-primary btn-sm' href='"+esc(res.downloadUrl)+"' target='_blank'>📄 開啟課程記錄（可列印 / 存 PDF）</a>" : "";
          h("<div class='card'><div class='card-title'>完成</div>"+
            "<div class='alert alert-ok'>✓ 已簽退，本次工作時數 <strong>"+esc(res.hours)+"</strong> 小時</div>"+
            link+"<div style='margin-top:16px'><a class='btn btn-ghost' href='/schedule/home'>返回首頁</a></div></div>");
        } else { document.getElementById('co-msg').innerHTML="<div class='alert alert-err'>簽退失敗："+esc(res.error||'')+"</div>"; btn.disabled=false; btn.textContent='簽退'; }
      });
    };
  }

  function load(){
    h("<div class='card'><p style='color:var(--light)'>載入中...</p></div>");
    api('/active-session?name='+encodeURIComponent(ME.name))
    .then(function(res){ if(res && res.found){ showCheckout(res.sessionId, res.record||{}); } else { showCheckin(); } });
  }
  load();
})();
</script>`;

router.get("/checkin", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);

  // 我被指派、且仍在（未來）課程清單中的課
  const assignAll = await rget("/assignments") || {};
  const cmap = await coursesMap();
  const myCourses = [];
  for (const [slotId, workers] of Object.entries(assignAll)) {
    if (workers && workers[sess.id] && cmap[slotId]) myCourses.push(cmap[slotId]);
  }
  myCourses.sort((a, b) => (a.date + a.time_slot).localeCompare(b.date + b.time_slot));

  const meJson = JSON.stringify({
    name: sess.display_name,
    courses: myCourses.map(c => ({ name: c.course_name, date: c.date, time: c.time_slot, type: c.prescription_type, loc: c.location })),
  });

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a></div>` +
    `<div id='ck-app'></div>` +
    `<script>window.__ME=${meJson};</script>` +
    CHECKIN_CLIENT_JS;
  res.send(layout("簽到 / 簽退", body, sess));
});

// ══════════════════════════════════════════════
//  工讀生 Dashboard
// ══════════════════════════════════════════════
router.get("/dashboard", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  const wid = sess.id;

  const nf         = await nofollowSets();
  const courses    = (await fetchSupabaseCourses()).filter(c => isFollow(c, nf)); // 只顯示開放跟課
  const availAll   = await rget("/availability") || {};
  const assignAll  = await rget("/assignments") || {};

  const iAvail    = c => !!(availAll[c.id]  && availAll[c.id][wid]);
  const iAssigned = c => !!(assignAll[c.id] && assignAll[c.id][wid]);
  const assigned  = courses.filter(iAssigned);

  const csrf = hiddenCsrf(sess);

  // 我的班表
  let assignedHtml;
  if (assigned.length) {
    const rows = assigned.map(c => {
      const wd = weekdayStr(c.date);
      return `<tr class='row-assigned'>` +
        `<td><span style='font-weight:500'>${esc(c.date)}</span>` +
        `<span style='color:var(--light);font-size:12px;margin-left:6px'>週${wd}</span></td>` +
        `<td>${esc(c.time_slot)}</td>` +
        `<td>${esc(c.course_name)}</td>` +
        `<td>${prescTag(c.prescription_type)}</td>` +
        `<td>${canOpenBadge(c.enrolled)}</td>` +
        `<td style='color:var(--muted);font-size:12px'>${esc(c.location)}</td>` +
        `</tr>`;
    }).join("");
    assignedHtml = `<table><thead><tr><th>日期</th><th>時段</th><th>課程</th>` +
      `<th>類型</th><th>報名狀況</th><th>地點</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  } else {
    assignedHtml = "<p style='text-align:center;color:var(--light);padding:32px 0;font-size:13px'>目前尚未被指派課程</p>";
  }

  // 所有課程（月曆）
  const calCoursesWorker = courses.map(c => ({
    id: c.id, name: c.course_name, date: c.date, time: c.time_slot,
    region: c.region, type: c.prescription_type, avail: iAvail(c), assigned: iAssigned(c),
    x: (!iAvail(c) && !iAssigned(c)),
  }));
  const coursesHtml =
    `<div id='cal-app'><p style='color:var(--light)'>載入中…</p></div>` +
    `<script>window.__CAL=${calData({ role: "worker", prefix: PREFIX, csrf: hiddenCsrf(sess), courses: calCoursesWorker })}</script>` +
    CAL_CLIENT_JS;

  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, "ok") : "";

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a></div>` +
    `${notice}` +
    `${tabsHtml([["my", `我的班表 (${assigned.length})`], ["all", `所有課程 (${courses.length})`]])}` +
    `<div id='panel-my' class='tab-panel'>` +
    `<div class='card'><div class='card-title'>已指派課程</div>${assignedHtml}</div></div>` +
    `<div id='panel-all' class='tab-panel'>` +
    `<div class='card'><div class='card-title'>所有課程</div>` +
    `<p style='font-size:12px;color:var(--light);margin-bottom:14px'>` +
    `綠色列 = 已確認指派｜✅ 可開課 = 報名達 4 人</p>` +
    `${coursesHtml}</div></div>`;
  res.send(layout("工讀生班表", body, sess));
});

router.post("/avail/:cid", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/dashboard?msg=csrf_err`);
  await rput(`/availability/${req.params.cid}/${sess.id}`, { signed_at: nowTaipei() });
  // 通知管理員：有人報名跟課
  try {
    const c = (await coursesMap())[req.params.cid];
    const adminIds = await getUserIdsByRole("admin");
    await sendPushToUsers(adminIds, {
      title: "工讀生報名跟課",
      body: `${sess.display_name} 報名：${c ? c.course_name : ""}（${c ? c.date : ""}）`,
      url: `${PREFIX}/admin/course/${req.params.cid}`,
    });
  } catch (e) { console.error("[schedule] 報名通知失敗:", e.message); }
  res.redirect(`${PREFIX}/dashboard?msg=avail_on`);
});

router.post("/unavail/:cid", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/dashboard?msg=csrf_err`);
  await rdel(`/availability/${req.params.cid}/${sess.id}`);
  res.redirect(`${PREFIX}/dashboard?msg=avail_off`);
});

// ── Web Push：工讀生訂閱通知 ──
router.post("/push/subscribe", express.json(), async (req, res) => {
  const sess = getSess(req);
  if (!sess) return res.status(403).json({ error: "unauthorized" });
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "bad subscription" });
  try {
    await savePushSub(sess.id, sub);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════
//  管理員後台
// ══════════════════════════════════════════════
router.get("/admin", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);

  const srcCourses = await fetchSupabaseCourses();          // 課程來源：週報系統
  const availAll   = await rget("/availability") || {};
  const assignAll  = await rget("/assignments") || {};
  const users      = await getUsers();
  const nf         = await nofollowSets();

  const courses = srcCourses.map(c => ({
    ...c,
    avail_count:  Object.keys(availAll[c.id]  || {}).length,
    assign_count: Object.keys(assignAll[c.id] || {}).length,
    follow: isFollow(c, nf),
  }));

  const workers = users
    .filter(u => u.role === "worker")
    .map(u => ({ ...u, assign_count: Object.values(assignAll).filter(m => m && m[u.id]).length }))
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "zh-Hant"));

  const csrf = hiddenCsrf(sess);
  const msg = req.query.msg || "";
  const tab = req.query.tab || "";
  const notice = msg ? alertHtml(msg, "ok") : "";
  const tabJs = tab ? `<script>window.addEventListener('DOMContentLoaded',function(){showTab('${esc(tab)}');});</script>` : "";

  const canOpen = courses.filter(c => (Number(c.enrolled) || 0) >= 4).length;

  const statsHtml = `<div class='stats'>` +
    `<div class='stat'><strong>${courses.length}</strong>堂課程</div>` +
    `<div class='stat'><strong>${canOpen}</strong>可開課</div>` +
    `<div class='stat'><strong>${workers.length}</strong>位工讀生</div>` +
    `</div>`;

  // Tab 1：課程來源（週報系統，即時同步）
  const cacheAgeMin = courseCache.at ? Math.round((Date.now() - courseCache.at) / 60000) : null;
  const importTab =
    `<div class='card'>` +
    `<div class='card-title'>課程來源</div>` +
    `<p style='font-size:13px;margin-bottom:6px'>` +
    `課程資料<strong>自動來自週報系統</strong>（處方課程時段），你在週報系統按同步、n8n 更新後，這裡就會跟著更新。</p>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:16px'>` +
    `目前顯示：未來、未取消的<strong>運動 / 情緒調適 / 社會</strong>三類團體處方課，共 ` +
    `<strong style='color:var(--text)'>${courses.length}</strong> 堂` +
    (cacheAgeMin !== null ? `　·　資料快取於 ${cacheAgeMin} 分鐘前` : "") + `。</p>` +
    `<form method='post' action='${PREFIX}/admin/refresh-courses' style='display:inline'>` +
    `${csrf}` +
    `<button class='btn btn-primary'>🔄 立即重新整理</button></form>` +
    `<span style='font-size:12px;color:var(--light);margin-left:12px'>（平常會自動更新，這顆是需要立刻抓最新時用）</span>` +
    `</div>`;

  // Tab 2：報名狀況（月曆）
  const calCoursesAdmin = courses.map(c => ({
    id: c.id, name: c.course_name, date: c.date, time: c.time_slot,
    region: c.region, type: c.prescription_type, follow: c.follow, x: c.follow,
  }));
  const availTab =
    `<div style='margin-bottom:14px'>` +
    `<a href='${PREFIX}/admin/follow-settings' class='btn btn-primary'>🔧 跟課設定（勾選要開放跟課的課程）</a>` +
    `</div>` +
    `<div class='card'>` +
    `<div class='card-title'>課程月曆</div>` +
    `<div id='cal-app'><p style='color:var(--light)'>載入中…</p></div>` +
    `</div>` +
    `<script>window.__CAL=${calData({ role: "admin", prefix: PREFIX, courses: calCoursesAdmin })}</script>` +
    CAL_CLIENT_JS;

  // Tab 3：工讀生
  let workerRows = workers.map(w =>
    `<tr>` +
    `<td><span style='font-weight:500'>${esc(w.display_name)}</span></td>` +
    `<td style='color:var(--muted)'>${esc(w.username)}</td>` +
    `<td><span class='badge b-blue'>${w.assign_count} 堂</span></td>` +
    `<td style='white-space:nowrap'>` +
    `<a href='${PREFIX}/admin/workers/${w.id}/edit' class='btn btn-sm btn-ghost'>編輯</a> ` +
    `<form method='post' action='${PREFIX}/admin/workers/${w.id}/delete' style='display:inline'>` +
    `${csrf}` +
    `<button class='btn btn-sm btn-danger' onclick="return confirm('確定刪除帳號？')">刪除</button></form>` +
    `</td></tr>`
  ).join("");
  if (!workerRows) workerRows = "<tr><td colspan='4' style='text-align:center;color:var(--light);padding:24px'>尚無工讀生帳號</td></tr>";

  // Tab 4：密碼管理
  let pwTab =
    `<div class='card'>` +
    `<div class='card-title'>變更管理員密碼</div>` +
    `<form method='post' action='${PREFIX}/admin/change-password'>${csrf}` +
    `<div class='form-row cols-3'>` +
    `<div class='form-group'><label class='form-label'>目前密碼</label>` +
    `<input name='current_password' type='password' required autocomplete='current-password'></div>` +
    `<div class='form-group'><label class='form-label'>新密碼（至少 4 字元）</label>` +
    `<input name='new_password' type='password' required minlength='4' autocomplete='new-password'></div>` +
    `<div class='form-group'><label class='form-label'>確認新密碼</label>` +
    `<input name='confirm_password' type='password' required autocomplete='new-password'></div>` +
    `</div>` +
    `<button class='btn btn-primary'>變更密碼</button>` +
    `</form>` +
    `<hr class='divider'>` +
    `<p style='font-size:12px;color:var(--muted)'>要修改工讀生的姓名或密碼，請到「👤 工讀生管理」分頁，點該工讀生的「編輯」。</p>` +
    `</div>`;

  const workersTab =
    `<div class='card'>` +
    `<div class='card-title'>新增工讀生帳號</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:12px'>工讀生用「姓名 + 身分證後 4 碼」登入。</p>` +
    `<form method='post' action='${PREFIX}/admin/workers'>${csrf}` +
    `<div class='form-row cols-3'>` +
    `<div class='form-group'><label class='form-label'>姓名 *</label>` +
    `<input name='display_name' placeholder='王小明' required></div>` +
    `<div class='form-group'><label class='form-label'>身分證後 4 碼 *</label>` +
    `<input name='id4' inputmode='numeric' maxlength='4' placeholder='1234' required></div>` +
    `<div class='form-group'><label class='form-label'>&nbsp;</label>` +
    `<button class='btn btn-primary'>新增帳號</button></div>` +
    `</div></form>` +
    `<hr class='divider'>` +
    `<div class='card-title'>工讀生列表</div>` +
    `<table><thead><tr><th>姓名</th><th>帳號</th><th>指派堂數</th><th></th></tr></thead>` +
    `<tbody>${workerRows}</tbody></table></div>`;

  const body =
    `${notice}${tabJs}` +
    `${statsHtml}` +
    `<div style='margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap'>` +
    `<a href='${PREFIX}/admin/attendance' class='btn btn-success'>🧾 出勤與工時（查看、下載時數 Excel）</a>` +
    `<a href='${PREFIX}/admin/users' class='btn btn-ghost'>👥 使用者報名資料</a>` +
    `<a href='${PREFIX}/admin/notify' class='btn btn-ghost'>🔔 發送通知</a>` +
    `</div>` +
    `${tabsHtml([["import", "📋 課程來源"], ["avail", "📊 報名狀況"], ["workers", "👤 工讀生管理"], ["password", "🔑 密碼管理"], ["docs", "📄 文件匯出"]])}` +
    `<div id='panel-import' class='tab-panel'>${importTab}</div>` +
    `<div id='panel-avail' class='tab-panel'>${availTab}</div>` +
    `<div id='panel-workers' class='tab-panel'>${workersTab}</div>` +
    `<div id='panel-password' class='tab-panel'>${pwTab}</div>` +
    `<div id='panel-docs' class='tab-panel'><div class='card'>` +
    `<div class='card-title'>文件匯出</div>` +
    `<p style='font-size:13px;color:var(--muted);margin-bottom:14px'>領據、簽到單、申請單的匯出工具。簽到單／申請單可「依課程」點月曆選課（帶入已指派工讀生），或「獨立製作」自行選人（處方日臨時人員）。</p>` +
    `<a href='${PREFIX}/admin/docs' class='btn btn-primary'>開啟文件匯出工具 →</a>` +
    `</div></div>` +
    `<div class='card' id='push-card' style='margin-top:8px'>` +
    `<div class='card-title'>🔔 我的通知</div>` +
    `<p style='font-size:13px;color:var(--muted);margin-bottom:10px'>開啟後，工讀生報名跟課時你會收到推播。</p>` +
    `<div id='push-status' style='margin-bottom:10px'></div>` +
    `<button class='btn btn-primary' id='push-btn'>開啟通知</button></div>` +
    `<script>window.__VAPID=${JSON.stringify(VAPID_PUBLIC)}</script>` +
    PUSH_CLIENT_JS;
  res.send(layout("管理員後台", body, sess));
});

// ── 跟課設定（獨立頁：依課名勾選是否開放跟課，可搜尋）──
router.get("/admin/follow-settings", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const courses = await fetchSupabaseCourses();
  const nf = await nofollowSets();
  const groups = Object.values(groupByName(courses, nf))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant"));

  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, "ok") : "";

  const rows = groups.map(g => {
    const fullyOpen = g.open === g.total;
    const partial = g.open > 0 && g.open < g.total;
    const stateTxt = fullyOpen ? `${g.total} 堂` : (partial ? `${g.open}/${g.total} 開放` : `全部不跟課`);
    return `<label class='fs-row' data-name="${esc(String(g.name).toLowerCase())}" data-region="${esc(g.region)}" data-dates="${esc([...g.dates].join(" "))}" ` +
      `style='display:flex;align-items:center;gap:12px;padding:10px 8px;border-bottom:1px solid var(--border-l);cursor:pointer'>` +
      `<input type='checkbox' name='open' value='${nameKey(g.name)}' ${fullyOpen ? "checked" : ""} style='width:auto;flex:none'>` +
      `<span style='flex:1'>${regionTag(g.region)} ${esc(g.name)} ${prescTag(g.type)}</span>` +
      `<span style='font-size:12px;color:var(--muted);white-space:nowrap'>${stateTxt}</span>` +
      `</label>`;
  }).join("");

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin?tab=avail' class='btn btn-sm btn-ghost'>← 返回報名狀況</a></div>` +
    `${notice}` +
    `<div class='card'>` +
    `<div class='card-title'>跟課設定</div>` +
    `<p style='font-size:13px;color:var(--muted);margin-bottom:14px'>勾選＝開放跟課（工讀生看得到、可報名）；取消勾選＝不跟課。以「課程名稱」為單位，同名的所有時段會一起套用。</p>` +
    `<form method='post' action='${PREFIX}/admin/follow-settings'>${hiddenCsrf(sess)}` +
    `<div id='fs-region' style='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px'>` +
    `<span style='font-size:12px;color:var(--muted);margin-right:4px'>地區</span>` +
    ["全部", ...REGIONS, "其他"].map((r, i) =>
      `<button type='button' class='btn btn-sm ${i === 0 ? "btn-primary" : "btn-ghost"}' data-reg='${r === "全部" ? "" : r}'>${r}</button>`).join("") +
    `</div>` +
    `<div style='display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap'>` +
    `<input type='text' id='fs-search' placeholder='🔍 搜尋課名...' style='flex:1;min-width:180px'>` +
    `<label style='font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px'>日期<input type='date' id='fs-date' style='width:auto'></label>` +
    `<a href='#' id='fs-date-clear' class='btn btn-sm btn-ghost'>清除日期</a>` +
    `<a href='#' id='fs-all' class='btn btn-sm btn-ghost'>全選（目前顯示）</a>` +
    `<a href='#' id='fs-none' class='btn btn-sm btn-ghost'>全不選（目前顯示）</a>` +
    `</div>` +
    `<div style='border:1px solid var(--border);border-radius:4px;max-height:60vh;overflow:auto'>${rows || "<p style='padding:20px;text-align:center;color:var(--light)'>目前無課程</p>"}</div>` +
    `<div style='margin-top:16px'><button class='btn btn-primary'>💾 儲存跟課設定</button>` +
    `<span style='font-size:12px;color:var(--light);margin-left:10px'>共 ${groups.length} 種課程</span></div>` +
    `</form></div>` +
    `<script>(function(){` +
    `var s=document.getElementById('fs-search');var rbar=document.getElementById('fs-region');var reg='';` +
    `var dEl=document.getElementById('fs-date');` +
    `function vis(r){return r.style.display!=='none';}` +
    `function apply(){var q=s.value.trim().toLowerCase();var dv=dEl.value;document.querySelectorAll('.fs-row').forEach(function(r){` +
    `var okName=(!q||r.getAttribute('data-name').indexOf(q)>=0);var okReg=(!reg||r.getAttribute('data-region')===reg);` +
    `var okDate=(!dv||(' '+r.getAttribute('data-dates')+' ').indexOf(' '+dv+' ')>=0);` +
    `r.style.display=(okName&&okReg&&okDate)?'':'none';});}` +
    `s.addEventListener('input',apply);dEl.addEventListener('change',apply);` +
    `document.getElementById('fs-date-clear').addEventListener('click',function(e){e.preventDefault();dEl.value='';apply();});` +
    `rbar.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){` +
    `rbar.querySelectorAll('button').forEach(function(x){x.className='btn btn-sm btn-ghost';});b.className='btn btn-sm btn-primary';` +
    `reg=b.getAttribute('data-reg');apply();});});` +
    `document.getElementById('fs-all').addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.fs-row').forEach(function(r){if(vis(r))r.querySelector('input').checked=true;});});` +
    `document.getElementById('fs-none').addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.fs-row').forEach(function(r){if(vis(r))r.querySelector('input').checked=false;});});` +
    `})();</script>`;
  res.send(layout("跟課設定", body, sess));
});

router.post("/admin/follow-settings", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/follow-settings?msg=csrf_err`);
  const openSet = new Set([].concat(req.body.open || []));
  const courses = await fetchSupabaseCourses();
  const groups = groupByName(courses, { slots: {} });
  const patch = {};
  for (const g of Object.values(groups)) {
    const open = openSet.has(nameKey(g.name));
    for (const slotId of g.slots) patch[slotId] = open ? null : true;
  }
  if (Object.keys(patch).length) await rpatch(`/nofollow_slots`, patch);
  res.redirect(`${PREFIX}/admin/follow-settings?msg=follow_saved`);
});

// ── 管理員：課程月曆 ──
router.get("/admin/calendar", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const month = req.query.month || todayTaipei().slice(0, 7);
  const day = req.query.day || "";
  const nf = await nofollowSets();
  const availAll = await rget("/availability") || {};
  const assignAll = await rget("/assignments") || {};
  const courses = (await fetchSupabaseCourses()).map(c => {
    const f = isFollow(c, nf);
    return { ...c, follow: f, _x: f, avail_count: Object.keys(availAll[c.id] || {}).length, assign_count: Object.keys(assignAll[c.id] || {}).length };
  });
  const grid = calendarGrid(courses, month, `${PREFIX}/admin/calendar`, day);
  let dayHtml = "";
  if (day) {
    const list = courses.filter(c => c.date === day).sort((a, b) => a.time_slot.localeCompare(b.time_slot));
    if (list.length) {
      const rows = list.map(c =>
        `<tr${c.follow ? "" : " style='opacity:.55'"}>` +
        `<td style='white-space:nowrap;color:var(--muted)'>${esc(c.time_slot)}</td>` +
        `<td>${esc(c.course_name)}</td>` +
        `<td>${regionTag(c.region)}</td>` +
        `<td>${prescTag(c.prescription_type)}</td>` +
        `<td>${c.follow ? "<span class='badge b-green'>開放</span>" : "<span class='badge b-gray'>不跟課</span>"}</td>` +
        `<td>${c.avail_count ? `<span class='badge b-blue'>${c.avail_count}</span>` : "—"} ${c.assign_count ? `<span class='badge b-green'>✓ ${c.assign_count}</span>` : ""}</td>` +
        `<td><a href='${PREFIX}/admin/course/${c.id}' class='btn btn-sm btn-ghost'>查看</a></td></tr>`
      ).join("");
      dayHtml = `<div class='card'><div class='card-title'>${esc(day)}（週${weekdayStr(day)}）課程</div>` +
        `<table><thead><tr><th>時段</th><th>課程</th><th>地區</th><th>類型</th><th>跟課</th><th>報名/指派</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else {
      dayHtml = `<div class='card'><p style='color:var(--light);text-align:center;padding:20px'>${esc(day)} 無課程</p></div>`;
    }
  }
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin?tab=avail' class='btn btn-sm btn-ghost'>← 清單檢視</a></div>` +
    `<div class='card'><div class='card-title'>課程月曆</div>${grid}</div>` + dayHtml;
  res.send(layout("課程月曆", body, sess));
});

// ── 工讀生：課程月曆 ──
router.get("/calendar", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  const wid = sess.id;
  const month = req.query.month || todayTaipei().slice(0, 7);
  const day = req.query.day || "";
  const nf = await nofollowSets();
  const availAll = await rget("/availability") || {};
  const assignAll = await rget("/assignments") || {};
  const iAvail = c => !!(availAll[c.id] && availAll[c.id][wid]);
  const iAssigned = c => !!(assignAll[c.id] && assignAll[c.id][wid]);
  const courses = (await fetchSupabaseCourses()).filter(c => isFollow(c, nf))
    .map(c => ({ ...c, _x: !iAvail(c) && !iAssigned(c) })); // x = 尚可報名（未報名且未指派）
  const grid = calendarGrid(courses, month, `${PREFIX}/calendar`, day);
  const csrf = hiddenCsrf(sess);
  let dayHtml = "";
  if (day) {
    const list = courses.filter(c => c.date === day).sort((a, b) => a.time_slot.localeCompare(b.time_slot));
    if (list.length) {
      const rows = list.map(c => {
        let action;
        if (iAssigned(c)) action = "<span class='badge b-green'>✓ 已指派</span>";
        else if (iAvail(c)) action = `<form method='post' action='${PREFIX}/unavail/${c.id}' style='display:inline'>${csrf}<button class='btn btn-sm btn-warn'>取消登記</button></form>`;
        else action = `<form method='post' action='${PREFIX}/avail/${c.id}' style='display:inline'>${csrf}<button class='btn btn-sm btn-success'>我可以跟課</button></form>`;
        return `<tr${iAssigned(c) ? " class='row-assigned'" : ""}>` +
          `<td style='white-space:nowrap;color:var(--muted)'>${esc(c.time_slot)}</td>` +
          `<td>${esc(c.course_name)}</td>` +
          `<td>${regionTag(c.region)}</td>` +
          `<td>${prescTag(c.prescription_type)}</td>` +
          `<td style='color:var(--muted);font-size:12px'>${esc(c.location)}</td>` +
          `<td>${action}</td></tr>`;
      }).join("");
      dayHtml = `<div class='card'><div class='card-title'>${esc(day)}（週${weekdayStr(day)}）可跟課課程</div>` +
        `<table><thead><tr><th>時段</th><th>課程</th><th>地區</th><th>類型</th><th>地點</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else {
      dayHtml = `<div class='card'><p style='color:var(--light);text-align:center;padding:20px'>${esc(day)} 無可跟課課程</p></div>`;
    }
  }
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a> ` +
    `<a href='${PREFIX}/dashboard' class='btn btn-sm btn-ghost'>清單檢視</a></div>` +
    `<div class='card'><div class='card-title'>課程月曆</div>${grid}</div>` + dayHtml;
  res.send(layout("課程月曆", body, sess));
});

// ── 管理員：出勤與工時後台（沿用 /records /export DELETE /records/:id）──
router.get("/admin/attendance", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const monthOpts = "<option value=''>全部</option>" +
    Array.from({ length: 12 }, (_, i) => `<option value='${i + 1}'>${i + 1}月</option>`).join("");
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin' class='btn btn-sm btn-ghost'>← 返回後台</a></div>` +
    `<div id='att-app'>` +
    `<div class='card'>` +
    `<div class='card-title'>出勤與工時</div>` +
    `<div class='form-row cols-4' style='align-items:end'>` +
    `<div class='form-group'><label class='form-label'>年份（民國）</label><input id='f-year' type='number' placeholder='115'></div>` +
    `<div class='form-group'><label class='form-label'>月份</label><select id='f-month'>${monthOpts}</select></div>` +
    `<div class='form-group'><label class='form-label'>姓名</label><input id='f-name' placeholder='搜尋姓名'></div>` +
    `<div class='form-group' style='flex-direction:row;gap:8px'>` +
    `<button class='btn btn-primary' id='btn-search'>搜尋</button>` +
    `<button class='btn btn-success' id='btn-export'>📥 匯出出勤 Excel</button></div>` +
    `</div>` +
    `<div class='stats' style='margin-top:14px'>` +
    `<div class='stat'><strong id='st-count'>-</strong>出勤總筆數</div>` +
    `<div class='stat'><strong id='st-hours'>-</strong>總工作時數（時）</div>` +
    `<div class='stat'><strong id='st-ppl'>-</strong>臨時人員人數</div>` +
    `</div></div>` +
    `<div class='card'>` +
    `<table><thead><tr><th>姓名</th><th>類型</th><th>課程</th><th>日期</th><th>簽到-簽退</th><th>時數</th><th>工作內容/概況</th><th></th></tr></thead>` +
    `<tbody id='att-tbody'><tr><td colspan='8' style='text-align:center;color:var(--light);padding:24px'>載入中…</td></tr></tbody></table>` +
    `</div></div>` +
    ATT_CLIENT_JS;
  res.send(layout("出勤與工時", body, sess));
});

// ── 管理員：編輯出勤記錄的簽到/簽退時間（重算時數與民國日期）──
router.post("/admin/attendance/:id/edit", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.status(403).json({ error: "unauthorized" });
  try {
    const rec = await rgetAtt(`/${req.params.id}`);
    if (!rec) return res.status(404).json({ error: "not found" });
    const ci = new Date(req.body.checkinTime);
    const co = new Date(req.body.checkoutTime);
    if (isNaN(ci) || isNaN(co)) return res.status(400).json({ error: "invalid time" });
    const hours = Math.round((co - ci) / 3600000 * 10) / 10;
    // 依簽到時間（台北）重算民國年月日
    const t = new Date(ci.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const patch = {
      checkinTime: ci.toISOString(),
      checkoutTime: co.toISOString(),
      hours,
      year: t.getFullYear() - 1911,
      month: t.getMonth() + 1,
      day: t.getDate(),
    };
    await rpatchAtt(`/${req.params.id}`, patch);
    res.json({ ok: true, hours });
  } catch (e) {
    console.error("[schedule] attendance edit:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 管理員：文件匯出（簽到單 / 申請單）──
router.get("/admin/docs", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const courses = await fetchSupabaseCourses();
  const assignAll = await rget("/assignments") || {};
  const users = await getUsers();
  const nameById = Object.fromEntries(users.map(u => [u.id, u.display_name]));
  const calCourses = courses.map(c => ({
    id: c.id, name: c.course_name, date: c.date, time: c.time_slot, region: c.region, type: c.prescription_type,
    workers: Object.keys(assignAll[c.id] || {}).map(w => nameById[w]).filter(Boolean),
  }));
  const regNames = (await regUsersGet()).map(u => u.name).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), "zh-Hant"));

  // 領據候選人：報名資料 ∪ 出勤名單
  const attObj = await rgetAtt() || {};
  const attNames = [...new Set(Object.values(attObj).map(r => r && r.name).filter(Boolean))];
  const receiptNames = [...new Set([...regNames, ...attNames])].sort((a, b) => String(a).localeCompare(String(b), "zh-Hant"));
  const receiptRows = receiptNames.map(n =>
    `<label class='rc-row fs-row' data-name='${esc(String(n).toLowerCase())}' style='gap:10px;padding:8px'>` +
    `<input type='checkbox' name='names' value='${esc(n)}' style='width:auto;flex:none'><span style='flex:1'>${esc(n)}</span></label>`
  ).join("");
  const receiptCard =
    `<div class='card'><div class='card-title'>領據</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:10px'>勾選要匯出領據的人員（依「使用者報名資料」的身分證/匯款/地址產生；每人一頁）。</p>` +
    `<form method='post' action='${PREFIX}/admin/export-receipts' onsubmit="if(!this.querySelectorAll('input[name=names]:checked').length){alert('請至少勾選一位人員');return false;}">` +
    `<div style='display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap'>` +
    `<input type='text' id='rc-search' placeholder='🔍 搜尋姓名...' style='min-width:180px'>` +
    `<a href='#' id='rc-all' class='btn btn-sm btn-ghost'>全選</a>` +
    `<a href='#' id='rc-none' class='btn btn-sm btn-ghost'>全不選</a></div>` +
    `<div style='border:1px solid var(--border);border-radius:4px;max-height:40vh;overflow:auto;margin-bottom:12px'>` +
    `${receiptRows || "<p style='padding:12px;color:var(--light)'>尚無人員資料</p>"}</div>` +
    `<button class='btn btn-success'>📄 匯出勾選領據 Word</button></form></div>` +
    `<script>(function(){var s=document.getElementById('rc-search');if(!s)return;` +
    `s.addEventListener('input',function(){var q=s.value.trim().toLowerCase();document.querySelectorAll('.rc-row').forEach(function(r){r.style.display=(!q||r.getAttribute('data-name').indexOf(q)>=0)?'':'none';});});` +
    `document.getElementById('rc-all').addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.rc-row').forEach(function(r){if(r.style.display!=='none')r.querySelector('input').checked=true;});});` +
    `document.getElementById('rc-none').addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.rc-row').forEach(function(r){if(r.style.display!=='none')r.querySelector('input').checked=false;});});})();</script>`;

  const standalone =
    `<div class='card'>` +
    `<div class='card-title'>獨立製作（處方日臨時人員等）</div>` +
    `<div class='form-row cols-2'>` +
    `<div class='form-group'><label class='form-label'>事由</label><input id='sa-reason' placeholder='例：協助處方兌換日活動跟課及場佈支援'></div>` +
    `<div class='form-group'><label class='form-label'>日期（民國年 / 月 / 日）</label>` +
    `<div style='display:flex;gap:6px;align-items:center'><input id='sa-year' type='number' placeholder='115' style='width:80px'> 年 <input id='sa-month' type='number' min='1' max='12' placeholder='7' style='width:60px'> 月 <input id='sa-day' type='number' min='1' max='31' placeholder='6' style='width:60px'> 日</div></div>` +
    `</div>` +
    `<div style='display:flex;gap:8px;align-items:center;margin:6px 0 14px'>` +
    `<input id='sa-amount' type='number' placeholder='統一金額' style='width:160px'>` +
    `<button type='button' class='btn btn-sm btn-ghost' id='sa-apply'>套用金額到勾選/手動列</button></div>` +
    `<div class='card-title'>選擇人員（使用者報名資料）</div>` +
    `<div id='sa-people' style='border:1px solid var(--border);border-radius:4px;max-height:40vh;overflow:auto;margin-bottom:10px'></div>` +
    `<div style='margin-bottom:6px'><button type='button' class='btn btn-sm btn-ghost' id='sa-add'>＋ 手動新增其他姓名</button></div>` +
    `<div id='sa-manual' style='margin-bottom:14px'></div>` +
    `<div style='display:flex;gap:8px;flex-wrap:wrap'>` +
    `<button type='button' class='btn btn-primary' id='sa-signin'>📝 產生簽到單 Word</button>` +
    `<button type='button' class='btn btn-success' id='sa-applyform'>💵 產生申請單 Word</button></div>` +
    `</div>`;

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin' class='btn btn-sm btn-ghost'>← 返回後台</a></div>` +
    `${receiptCard}` +
    `${tabsHtml([["bycourse", "📅 依課程（簽到單／申請單）"], ["standalone", "✍ 獨立製作"]])}` +
    `<div id='panel-bycourse' class='tab-panel'><div class='card'><div class='card-title'>點日期選課程 → 產生該課簽到單／申請單</div><div id='docs-cal'>載入中…</div></div></div>` +
    `<div id='panel-standalone' class='tab-panel'>${standalone}</div>` +
    `<script>window.__DOCS=${calData({ courses: calCourses, regNames })}</script>` +
    DOCS_CLIENT_JS;
  res.send(layout("文件匯出", body, sess));
});

// ── 管理員：手動廣播通知 ──
router.get("/admin/notify", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const workers = (await getUsers()).filter(u => u.role === "worker")
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "zh-Hant"));
  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, msg === "notify_need" ? "err" : "ok") : "";
  const csrf = hiddenCsrf(sess);
  const rows = workers.map(w =>
    `<label class='nt-row fs-row' style='gap:10px;padding:8px'><input type='checkbox' name='ids' value='${esc(w.id)}' style='width:auto;flex:none'><span style='flex:1'>${esc(w.display_name)}</span></label>`
  ).join("");
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin' class='btn btn-sm btn-ghost'>← 返回後台</a></div>` +
    `${notice}` +
    `<div class='card'><div class='card-title'>發送通知</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:10px'>訊息會以推播送到已開啟通知的工讀生手機／電腦。</p>` +
    `<form method='post' action='${PREFIX}/admin/notify' onsubmit="if(!this.querySelectorAll('input[name=ids]:checked').length){alert('請至少勾選一位');return false;}">${csrf}` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>通知內容</label>` +
    `<textarea name='message' rows='3' required placeholder='例：本週六處方日 09:00 於北投社大集合'></textarea></div>` +
    `<div style='display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap'>` +
    `<input type='text' id='nt-search' placeholder='🔍 搜尋姓名...' style='min-width:180px'>` +
    `<a href='#' id='nt-all' class='btn btn-sm btn-ghost'>全選</a><a href='#' id='nt-none' class='btn btn-sm btn-ghost'>全不選</a></div>` +
    `<div style='border:1px solid var(--border);border-radius:4px;max-height:40vh;overflow:auto;margin-bottom:12px'>${rows || "<p style='padding:12px;color:var(--light)'>尚無工讀生</p>"}</div>` +
    `<button class='btn btn-primary'>🔔 發送通知</button></form></div>` +
    `<script>(function(){var s=document.getElementById('nt-search');if(!s)return;s.addEventListener('input',function(){var q=s.value.trim().toLowerCase();document.querySelectorAll('.nt-row').forEach(function(r){r.style.display=(!q||r.querySelector('span').textContent.toLowerCase().indexOf(q)>=0)?'':'none';});});document.getElementById('nt-all').addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.nt-row').forEach(function(r){if(r.style.display!=='none')r.querySelector('input').checked=true;});});document.getElementById('nt-none').addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.nt-row').forEach(function(r){if(r.style.display!=='none')r.querySelector('input').checked=false;});});})();</script>`;
  res.send(layout("發送通知", body, sess));
});
router.post("/admin/notify", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/notify?msg=csrf_err`);
  const message = (req.body.message || "").trim();
  const ids = [].concat(req.body.ids || []);
  if (!message || !ids.length) return res.redirect(`${PREFIX}/admin/notify?msg=notify_need`);
  try {
    await sendPushToUsers(ids, { title: "系統通知", body: message, url: `${PREFIX}/home` });
  } catch (e) { console.error("[schedule] 廣播失敗:", e.message); }
  res.redirect(`${PREFIX}/admin/notify?msg=notify_sent`);
});

// ── 管理員：使用者報名資料管理 ──
router.get("/admin/users", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const users = (await regUsersGet())
    .sort((a, b) => new Date(b.registeredAt || 0) - new Date(a.registeredAt || 0));
  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, "ok") : "";
  const csrf = hiddenCsrf(sess);
  const bankStr = u => {
    if (u.payMethod === "匯款" && u.bankInfo) {
      return [u.bankInfo.bankName, u.bankInfo.accountName, u.bankInfo.account].filter(Boolean).join(" / ");
    }
    return "-";
  };
  const rows = users.map((u, i) => {
    const fee = Array.isArray(u.feeTypes) ? u.feeTypes.join("、") : "-";
    const reg = u.registeredAt ? new Date(u.registeredAt).toLocaleDateString("zh-TW") : "-";
    return `<tr class='ureg' data-name='${esc(String(u.name || "").toLowerCase())}'>` +
      `<td>${i + 1}</td>` +
      `<td style='font-weight:500;white-space:nowrap'>${esc(u.name || "-")}</td>` +
      `<td style='white-space:nowrap'>${esc(u.idNumber || "-")}</td>` +
      `<td style='white-space:nowrap'>${esc(u.phone || "-")}</td>` +
      `<td style='max-width:160px'>${esc(u.eventName || "-")}</td>` +
      `<td style='max-width:160px'>${esc(u.workDescription || "-")}</td>` +
      `<td>${esc(fee)}</td>` +
      `<td style='white-space:nowrap'>${esc(u.payMethod || "-")}</td>` +
      `<td style='font-size:12px;max-width:220px'>${esc(bankStr(u))}</td>` +
      `<td style='font-size:12px;max-width:200px'>${esc(u.address || "-")}</td>` +
      `<td style='font-size:12px;max-width:200px'>${esc(u.liveAddress || "-")}</td>` +
      `<td style='white-space:nowrap;color:var(--muted)'>${esc(reg)}</td>` +
      `<td><form method='post' action='${PREFIX}/admin/users/${u.id}/delete' style='display:inline' onsubmit="return confirm('確定刪除此使用者報名資料？')">${csrf}<button class='btn btn-sm btn-danger'>刪除</button></form></td>` +
      `</tr>`;
  }).join("");
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin' class='btn btn-sm btn-ghost'>← 返回後台</a></div>` +
    `${notice}` +
    `<div class='card'>` +
    `<div class='card-title'>使用者報名資料（${users.length} 人）</div>` +
    `<div style='display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap'>` +
    `<input type='text' id='u-search' placeholder='🔍 搜尋姓名...' style='min-width:200px'>` +
    `<a href='${PREFIX}/admin/export-receipts' class='btn btn-sm btn-success'>📄 匯出全部領據 Word</a>` +
    `<span style='font-size:12px;color:var(--light)'>含身分證、匯款等個資，僅管理員可見</span>` +
    `</div>` +
    `<div style='overflow-x:auto'>` +
    `<table style='min-width:1100px'><thead><tr>` +
    `<th>#</th><th>姓名</th><th>身分證</th><th>電話</th><th>事由名稱</th><th>工作內容</th><th>費用別</th><th>領款方式</th><th>匯款資訊</th><th>戶籍地址</th><th>居住地址</th><th>註冊時間</th><th></th>` +
    `</tr></thead><tbody>${rows || "<tr><td colspan='13' style='text-align:center;color:var(--light);padding:24px'>尚無註冊使用者</td></tr>"}</tbody></table>` +
    `</div></div>` +
    `<script>(function(){var s=document.getElementById('u-search');s.addEventListener('input',function(){var q=s.value.trim().toLowerCase();document.querySelectorAll('.ureg').forEach(function(r){r.style.display=(!q||r.getAttribute('data-name').indexOf(q)>=0)?'':'none';});});})();</script>`;
  res.send(layout("使用者管理", body, sess));
});
router.post("/admin/users/:id/delete", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/users?msg=csrf_err`);
  await regUsersDelete(req.params.id);
  res.redirect(`${PREFIX}/admin/users?msg=user_deleted`);
});

// ── 管理員：匯出領據 Word（用 users＋attendance）──
async function exportReceiptsHandler(req, res) {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  // 勾選的姓名：POST body.names（陣列）或 GET ?name=（單一）；皆空＝全部
  let names = [];
  if (req.body && req.body.names) names = [].concat(req.body.names);
  else if (req.query.name) names = [req.query.name];
  const nameSet = new Set(names.map(n => String(n)));
  const only = nameSet.size > 0;
  if (!only && req.method === "POST") return res.status(400).send("請至少勾選一位人員再匯出");
  try {
    const attObj = await rgetAtt() || {};
    const records = Object.entries(attObj).map(([id, r]) => ({ id, ...r }));
    const users = await regUsersGet();
    const userByName = {};
    users.forEach(u => { if (u.name) userByName[u.name] = u; });
    const grouped = {};
    records.forEach(r => { if (!r.name) return; if (only && !nameSet.has(r.name)) return; (grouped[r.name] = grouped[r.name] || []).push(r); });
    users.forEach(u => { if (!u.name) return; if (only && !nameSet.has(u.name)) return; if (!grouped[u.name]) grouped[u.name] = []; });
    for (const [pname, recs] of Object.entries(grouped)) {
      const ru = userByName[pname];
      if (ru && recs.length > 0) {
        const first = recs.find(r => r.idNumber) || recs[0];
        ["idNumber", "eventName", "feeTypes", "payMethod", "bankInfo", "address", "liveAddress", "phone"].forEach(k => { if (!first[k] && ru[k]) first[k] = ru[k]; });
      } else if (ru && recs.length === 0) {
        grouped[pname] = [{ name: pname, ...ru, status: "registered-only" }];
      }
    }
    if (!Object.keys(grouped).length) return res.status(400).send("沒有可匯出的領據（請至少勾選一人）");
    const html = buildExportFullHtml(grouped);
    const fnPart = only ? (names.length === 1 ? names[0] : `${names.length}人`) : "全部人員";
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent("領據_" + fnPart + ".doc")}`);
    res.send("﻿" + html);
  } catch (e) {
    console.error("[schedule] export-receipts:", e.message);
    res.status(500).send("匯出失敗：" + e.message);
  }
}
router.get("/admin/export-receipts", exportReceiptsHandler);
router.post("/admin/export-receipts", exportReceiptsHandler);

// ── 模板下載 ──────────────────────────────────
router.get("/admin/courses/template", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("課程模板");
  const headers = ["課程名稱", "處方類型", "日期", "時段", "上課地點", "已報名", "人數上限"];
  ws.addRow(headers);
  ws.addRow(["(士林區)簡易氣功保健", "運動處方", "2026-07-05", "19:00 - 20:00", "士林社大（承德路四段177號）", 0, 15]);
  ws.getRow(1).eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2B4462" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { horizontal: "center" };
  });
  [30, 16, 14, 18, 30, 10, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''%E8%AA%B2%E7%A8%8B%E6%A8%A1%E6%9D%BF.xlsx");
  await wb.xlsx.write(res);
  res.end();
});

// ── 解析上傳檔（xlsx / csv）──────────────────
function parseCsv(text) {
  // 簡易 CSV 解析（支援雙引號欄位）
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch === "\r") { /* skip */ }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
async function parseUploadRows(buffer, filename) {
  const mapping = {
    "課程名稱": "course_name", "處方類型": "prescription_type",
    "日期": "date", "時段": "time_slot", "上課地點": "location",
    "人數上限": "capacity", "已報名": "enrolled",
  };
  const results = [];
  const lower = (filename || "").toLowerCase();

  if (lower.endsWith(".csv")) {
    let text = buffer.toString("utf8");
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
    const rows = parseCsv(text).filter(r => r.some(c => c && c.trim()));
    if (!rows.length) return results;
    const header = rows[0].map(h => (h || "").trim());
    const colIdx = {};
    header.forEach((h, i) => {
      for (const [key, field] of Object.entries(mapping)) if (h.includes(key)) colIdx[field] = i;
    });
    for (const r of rows.slice(1)) {
      const cell = (field, def = "") => {
        const idx = colIdx[field];
        if (idx === undefined || r[idx] === undefined) return def;
        return String(r[idx]).trim();
      };
      const d = cell("date");
      if (!d) continue;
      results.push({
        course_name: cell("course_name"), prescription_type: cell("prescription_type"),
        date: d, time_slot: cell("time_slot"), location: cell("location"),
        enrolled: cell("enrolled", "0"), capacity: cell("capacity", "15"),
      });
    }
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return results;
    const header = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { header[col - 1] = String(cell.value ?? "").trim(); });
    const colIdx = {};
    header.forEach((h, i) => {
      for (const [key, field] of Object.entries(mapping)) if (h && h.includes(key)) colIdx[field] = i;
    });
    const fmtDate = (v) => {
      if (v === null || v === undefined) return "";
      if (v instanceof Date) {
        const s = v.toLocaleString("sv-SE", { timeZone: "UTC" }); // Excel 日期為 UTC 午夜
        return s.slice(0, 10);
      }
      return String(v).trim();
    };
    ws.eachRow((rowObj, rowNum) => {
      if (rowNum === 1) return;
      const getVal = (field) => {
        const idx = colIdx[field];
        if (idx === undefined) return "";
        const c = rowObj.getCell(idx + 1).value;
        return c === null || c === undefined ? "" : (c instanceof Object && c.text ? c.text : c);
      };
      const d = fmtDate(getVal("date"));
      if (!d) return;
      const str = (field, def = "") => {
        const v = getVal(field);
        return v === "" ? def : String(v).trim();
      };
      results.push({
        course_name: str("course_name"), prescription_type: str("prescription_type"),
        date: d, time_slot: str("time_slot"), location: str("location"),
        enrolled: str("enrolled", "0"), capacity: str("capacity", "15"),
      });
    });
  }
  return results;
}

router.post("/admin/upload", upload.single("file"), async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  try {
    if (req.file) {
      const rows = await parseUploadRows(req.file.buffer, req.file.originalname || "");
      for (const rec of rows) {
        const enrolled = parseInt(rec.enrolled, 10); const capacity = parseInt(rec.capacity, 10);
        await rpost("/courses", {
          course_name: rec.course_name || "", prescription_type: rec.prescription_type || "",
          date: rec.date || "", time_slot: rec.time_slot || "", location: rec.location || "",
          capacity: Number.isFinite(capacity) ? capacity : 15,
          enrolled: Number.isFinite(enrolled) ? enrolled : 0,
          imported_at: nowTaipei(),
        });
      }
    }
  } catch (e) {
    console.error("[schedule] upload failed:", e.message);
  }
  res.redirect(`${PREFIX}/admin?msg=imported`);
});

// ── 手動新增課程 ──────────────────────────────
router.post("/admin/courses/add", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  const b = req.body;
  await rpost("/courses", {
    course_name: (b.course_name || "").trim(),
    prescription_type: b.prescription_type || "",
    date: b.date || "",
    time_slot: (b.time_slot || "").trim(),
    location: (b.location || "").trim(),
    capacity: parseInt(b.capacity, 10) || 15,
    enrolled: parseInt(b.enrolled, 10) || 0,
    imported_at: nowTaipei(),
  });
  res.redirect(`${PREFIX}/admin?msg=course_added`);
});

// ── 刪除課程 ──────────────────────────────────
router.post("/admin/courses/:cid/delete", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  const cid = req.params.cid;
  await rdel(`/availability/${cid}`);
  await rdel(`/assignments/${cid}`);
  await rdel(`/courses/${cid}`);
  res.redirect(`${PREFIX}/admin?msg=course_deleted&tab=avail`);
});

router.post("/admin/clear-courses", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  await rdel("/assignments");
  await rdel("/availability");
  await rdel("/courses");
  res.redirect(`${PREFIX}/admin?msg=courses_cleared`);
});

// ── 立即重新整理課程（清快取、強制重抓 Supabase）──
router.post("/admin/refresh-courses", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  await fetchSupabaseCourses(true);
  res.redirect(`${PREFIX}/admin?msg=courses_refreshed`);
});

// ── 課程詳情 ──────────────────────────────────
router.get("/admin/course/:cid", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  const course = (await coursesMap())[cid];
  if (!course) return res.redirect(`${PREFIX}/admin`);

  const availMap  = await rget(`/availability/${cid}`) || {};
  const assignMap = await rget(`/assignments/${cid}`) || {};
  const users     = await getUsers();
  const userById  = Object.fromEntries(users.map(u => [u.id, u]));

  const avail = Object.entries(availMap)
    .map(([wid, v]) => ({ id: wid, ...(userById[wid] || {}), signed_at: v && v.signed_at, is_assigned: !!assignMap[wid] }))
    .filter(w => w.display_name)
    .sort((a, b) => String(a.signed_at).localeCompare(String(b.signed_at)));

  const nf = await nofollowSets();
  const follows = isFollow(course, nf);

  const csrf = hiddenCsrf(sess);
  const wd = weekdayStr(course.date);
  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, "ok") : "";

  let availTable;
  if (avail.length) {
    const rows = avail.map(w => {
      let act;
      if (w.is_assigned) {
        act = `<span class='badge b-green'>✓ 已指派</span> ` +
          `<form method='post' action='${PREFIX}/admin/unassign/${cid}/${w.id}' style='display:inline'>` +
          `${csrf}<button class='btn btn-sm btn-danger'>取消</button></form>`;
      } else {
        act = `<form method='post' action='${PREFIX}/admin/assign/${cid}/${w.id}' style='display:inline'>` +
          `${csrf}<button class='btn btn-sm btn-success'>確認指派</button></form>`;
      }
      return `<tr><td><span style='font-weight:500'>${esc(w.display_name)}</span></td>` +
        `<td style='color:var(--muted)'>${esc(w.username)}</td>` +
        `<td style='color:var(--muted);font-size:12px'>${esc(w.signed_at)}</td>` +
        `<td>${act}</td></tr>`;
    }).join("");
    availTable = `<table><thead><tr><th>姓名</th><th>帳號</th><th>登記時間</th><th></th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  } else {
    availTable = "<p style='text-align:center;color:var(--light);padding:24px 0'>尚無工讀生報名此課程</p>";
  }

  // 從「有報名、且尚未指派」的工讀生中挑選指派
  const assignable = avail.filter(w => !w.is_assigned);
  let manual =
    `<hr class='divider'>` +
    `<div class='card-title'>從報名者指派</div>`;
  if (assignable.length) {
    const opts = assignable.map(w => `<option value='${esc(w.id)}'>${esc(w.display_name)}</option>`).join("");
    manual +=
      `<form method='post' action='${PREFIX}/admin/assign/${cid}/0' style='display:flex;gap:10px;align-items:flex-end'>` +
      `${csrf}` +
      `<div class='form-group' style='flex:1'><label class='form-label'>選擇工讀生（僅列出已報名者）</label>` +
      `<select name='worker_id'>${opts}</select></div>` +
      `<button class='btn btn-primary' style='align-self:flex-end'>指派</button></form>`;
  } else {
    manual += "<p style='color:var(--light);font-size:13px'>目前沒有可指派的報名者（尚無人報名，或報名者皆已指派）。</p>";
  }

  // 跟課設定卡
  let followCard;
  if (follows) {
    followCard =
      `<div class='card'>` +
      `<div class='card-title'>跟課設定</div>` +
      `<p style='font-size:13px;margin-bottom:12px'>此課程狀態：<span class='badge b-green'>開放跟課</span></p>` +
      `<form method='post' action='${PREFIX}/admin/course/${cid}/nofollow' style='display:inline'>` +
      `${csrf}<button class='btn btn-sm btn-warn'>設為不跟課（此堂）</button></form> ` +
      `<form method='post' action='${PREFIX}/admin/course/${cid}/nofollow-name' style='display:inline' ` +
      `onsubmit="return confirm('將所有名為「${esc(course.course_name)}」的課程都設為不跟課？')">` +
      `${csrf}<button class='btn btn-sm btn-danger'>同名課程全部設為不跟課</button></form>` +
      `</div>`;
  } else {
    followCard =
      `<div class='card'>` +
      `<div class='card-title'>跟課設定</div>` +
      `<p style='font-size:13px;margin-bottom:12px'>此課程狀態：<span class='badge b-gray'>不跟課</span>（不會出現在工讀生班表）</p>` +
      `<form method='post' action='${PREFIX}/admin/course/${cid}/follow' style='display:inline'>` +
      `${csrf}<button class='btn btn-sm btn-success'>設為開放跟課</button></form> ` +
      `<form method='post' action='${PREFIX}/admin/course/${cid}/follow-name' style='display:inline'>` +
      `${csrf}<button class='btn btn-sm btn-ghost'>同名課程全部恢復開放</button></form>` +
      `</div>`;
  }

  const body =
    `<div style='margin-bottom:16px'>` +
    `<a href='${PREFIX}/admin?tab=avail' class='btn btn-sm btn-ghost'>← 返回報名狀況</a>` +
    `</div>` +
    `${notice}` +
    `<div class='card'>` +
    `<h3 style='font-size:16px;font-weight:600;margin-bottom:6px'>${esc(course.course_name)}</h3>` +
    `<p style='font-size:13px;color:var(--muted);margin-bottom:4px'>` +
    `${esc(course.date)} 週${wd} &nbsp;·&nbsp; ${esc(course.time_slot)} &nbsp;·&nbsp; ` +
    `${prescTag(course.prescription_type)} &nbsp;·&nbsp; ${canOpenBadge(course.enrolled)}</p>` +
    `<p style='font-size:12px;color:var(--light);margin-bottom:0'>${esc(course.location)}</p>` +
    `</div>` +
    `${followCard}` +
    `<div class='card'>` +
    `<div class='card-title'>已報名工讀生（${avail.length} 人）</div>` +
    `${availTable}${manual}</div>`;
  res.send(layout("課程詳情", body, sess));
});

// ── 跟課設定：單堂 / 同名批次 ──
router.post("/admin/course/:cid/nofollow", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=csrf_err`);
  await rpatch(`/nofollow_slots`, { [cid]: true });
  res.redirect(`${PREFIX}/admin/course/${cid}?msg=nofollow_set`);
});
router.post("/admin/course/:cid/follow", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=csrf_err`);
  await rdel(`/nofollow_slots/${cid}`);
  res.redirect(`${PREFIX}/admin/course/${cid}?msg=follow_set`);
});
router.post("/admin/course/:cid/nofollow-name", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=csrf_err`);
  const cmap = await coursesMap();
  const target = cmap[cid];
  if (target) {
    const same = Object.values(cmap).filter(c => c.course_name === target.course_name);
    const patch = {};
    for (const c of same) patch[c.id] = true;
    if (Object.keys(patch).length) await rpatch(`/nofollow_slots`, patch);
  }
  res.redirect(`${PREFIX}/admin/course/${cid}?msg=nofollow_name`);
});
router.post("/admin/course/:cid/follow-name", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=csrf_err`);
  const cmap = await coursesMap();
  const target = cmap[cid];
  if (target) {
    const same = Object.values(cmap).filter(c => c.course_name === target.course_name);
    const patch = {};
    for (const c of same) patch[c.id] = null; // null = 刪除
    if (Object.keys(patch).length) await rpatch(`/nofollow_slots`, patch);
  }
  res.redirect(`${PREFIX}/admin/course/${cid}?msg=follow_name`);
});

router.post("/admin/assign/:cid/:wid", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=csrf_err`);
  const actual = req.params.wid !== "0" ? req.params.wid : req.body.worker_id;
  if (!actual) return res.redirect(`${PREFIX}/admin/course/${cid}`);
  await rput(`/assignments/${cid}/${actual}`, { assigned_at: nowTaipei() });
  // 指派後推播通知工讀生（失敗不影響指派）
  try {
    const course = (await coursesMap())[cid];
    await sendPushToWorker(actual, {
      title: "新的跟課指派",
      body: course ? `${course.course_name}（${course.date} ${course.time_slot}）` : "你有一筆新的跟課指派",
      url: `${PREFIX}/home`,
    });
  } catch (e) { console.error("[schedule] 指派推播失敗:", e.message); }
  res.redirect(`${PREFIX}/admin/course/${cid}?msg=assigned`);
});

router.post("/admin/unassign/:cid/:wid", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=csrf_err`);
  await rdel(`/assignments/${cid}/${req.params.wid}`);
  // 通知工讀生：指派已取消
  try {
    const c = (await coursesMap())[cid];
    await sendPushToWorker(req.params.wid, {
      title: "跟課指派已取消",
      body: c ? `${c.course_name}（${c.date} ${c.time_slot}）已取消指派` : "你的一筆跟課指派已被取消",
      url: `${PREFIX}/home`,
    });
  } catch (e) { console.error("[schedule] 取消指派通知失敗:", e.message); }
  res.redirect(`${PREFIX}/admin/course/${cid}?msg=unassigned`);
});

// ── 工讀生帳號管理 ────────────────────────────
router.post("/admin/workers", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  const displayName = (req.body.display_name || "").trim();
  const id4 = (req.body.id4 || "").trim();
  if (!displayName || !id4) return res.redirect(`${PREFIX}/admin?msg=bad_input&tab=workers`);
  const users = await getUsers();
  // 同名同後4碼視為重複
  if (users.some(u => u.display_name === displayName && u.password_hash === hp(id4)))
    return res.redirect(`${PREFIX}/admin?msg=dup&tab=workers`);
  await rpost("/users", {
    username: displayName, password_hash: hp(id4),
    display_name: displayName, role: "worker",
  });
  res.redirect(`${PREFIX}/admin?msg=added&tab=workers`);
});

router.post("/admin/workers/:wid/delete", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  const wid = req.params.wid;
  await rdel(`/users/${wid}`);
  // 清掉該工讀生的報名/指派
  const availAll  = await rget("/availability") || {};
  const assignAll = await rget("/assignments") || {};
  for (const cid of Object.keys(availAll))  if (availAll[cid][wid])  await rdel(`/availability/${cid}/${wid}`);
  for (const cid of Object.keys(assignAll)) if (assignAll[cid][wid]) await rdel(`/assignments/${cid}/${wid}`);
  res.redirect(`${PREFIX}/admin?msg=deleted&tab=workers`);
});

// ── 管理員：編輯工讀生（姓名 / 密碼）──
router.get("/admin/workers/:wid/edit", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const w = await getUser(req.params.wid);
  if (!w || w.role !== "worker") return res.redirect(`${PREFIX}/admin?tab=workers`);
  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, "err") : "";
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin?tab=workers' class='btn btn-sm btn-ghost'>← 返回工讀生管理</a></div>` +
    `${notice}` +
    `<div class='card' style='max-width:520px'>` +
    `<div class='card-title'>編輯工讀生</div>` +
    `<form method='post' action='${PREFIX}/admin/workers/${w.id}/edit'>${hiddenCsrf(sess)}` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>姓名</label>` +
    `<input name='display_name' value='${esc(w.display_name)}' required></div>` +
    `<div class='form-group' style='margin-bottom:16px'><label class='form-label'>重設密碼（身分證後 4 碼；留空＝不變更）</label>` +
    `<input name='id4' inputmode='numeric' maxlength='4' placeholder='留空則不改密碼'></div>` +
    `<button class='btn btn-primary'>儲存</button>` +
    `</form></div>`;
  res.send(layout("編輯工讀生", body, sess));
});
router.post("/admin/workers/:wid/edit", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const wid = req.params.wid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/workers/${wid}/edit?msg=csrf_err`);
  const name = (req.body.display_name || "").trim();
  const id4 = (req.body.id4 || "").trim();
  if (!name) return res.redirect(`${PREFIX}/admin/workers/${wid}/edit?msg=bad_input`);
  const patch = { display_name: name, username: name };
  if (id4) patch.password_hash = hp(id4);
  await rpatch(`/users/${wid}`, patch);
  res.redirect(`${PREFIX}/admin?msg=worker_updated&tab=workers`);
});

router.post("/admin/change-password", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  const { current_password, new_password, confirm_password } = req.body;
  const me = await getUser(sess.id);
  if (!me || me.password_hash !== hp(current_password || "")) return res.redirect(`${PREFIX}/admin?msg=pw_wrong&tab=password`);
  if (!new_password || new_password.length < 4) return res.redirect(`${PREFIX}/admin?msg=pw_short4&tab=password`);
  if (new_password !== confirm_password)         return res.redirect(`${PREFIX}/admin?msg=pw_mismatch&tab=password`);
  await rpatch(`/users/${sess.id}`, { password_hash: hp(new_password) });
  res.redirect(`${PREFIX}/login?msg=pw_changed`);
});

// ── 課前提醒排程：每天 20:00（台北）提醒隔天被指派的工讀生 ──
let _lastRemind = "";
async function remindTomorrow() {
  try {
    const tp = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    tp.setDate(tp.getDate() + 1);
    const pz = n => String(n).padStart(2, "0");
    const tomorrow = `${tp.getFullYear()}-${pz(tp.getMonth() + 1)}-${pz(tp.getDate())}`;
    const courses = (await fetchSupabaseCourses()).filter(c => c.date === tomorrow);
    if (!courses.length) return;
    const assignAll = await rget("/assignments") || {};
    const byWorker = {};
    for (const c of courses) {
      const m = assignAll[c.id] || {};
      for (const wid of Object.keys(m)) (byWorker[wid] = byWorker[wid] || []).push(c);
    }
    for (const [wid, cs] of Object.entries(byWorker)) {
      const lines = cs.sort((a, b) => a.time_slot.localeCompare(b.time_slot)).map(c => `${c.time_slot} ${c.course_name}`).join("；");
      await sendPushToWorker(wid, { title: "明天有跟課提醒", body: `${tomorrow}　${lines}`, url: `${PREFIX}/home` });
    }
    console.log(`[schedule] 已發送 ${Object.keys(byWorker).length} 位工讀生的課前提醒（${tomorrow}）`);
  } catch (e) { console.error("[schedule] 課前提醒失敗:", e.message); }
}
setInterval(() => {
  const tp = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const key = `${tp.getFullYear()}-${tp.getMonth() + 1}-${tp.getDate()}`;
  if (tp.getHours() === 20 && tp.getMinutes() === 0 && _lastRemind !== key) {
    _lastRemind = key;
    remindTomorrow();
  }
}, 60000);

module.exports = router;

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
  fixed_saved:     "✓ 已儲存固定跟課人員，並自動指派未來場次",
  worker_updated:  "✓ 已更新工讀生資料",
  user_deleted:    "✓ 已刪除使用者報名資料",
  notify_sent:     "✓ 已發送通知",
  info_saved:      "✓ 資料已儲存",
  adj_saved:       "✓ 已新增時數調整",
  adj_deleted:     "✓ 已刪除時數調整",
  adj_need:        "請填寫年、月與時數（時數不可為 0）",
  notify_need:     "請填寫內容並至少勾選一位",
  csrf_err:        "請求驗證失敗，請重試",
  pw_changed:      "✓ 密碼已成功變更",
  pw_wrong:        "目前密碼輸入錯誤",
  pw_short:        "新密碼至少需要 6 個字元",
  pw_short4:       "新密碼至少需要 4 個字元",
  pw_need4:        "密碼需為 4 位數字",
  registered:      "✓ 註冊成功！請用「姓名＋身分證後4碼」登入",
  reg_badid:       "請填寫姓名，身分證字號需 10 碼",
  reg_dup:         "此姓名與身分證後4碼已註冊過，請直接登入",
  reg_fail:        "註冊失敗，請稍後再試",
  pw_changed_home: "✓ 密碼已成功變更",
  pw_mismatch:     "兩次輸入的新密碼不一致",
  pw_set:          "✓ 已設定工讀生新密碼",
  time_saved:      "✓ 已更新課程時間",
  time_reset:      "✓ 已還原為原始時間",
  presc_saved:     "✓ 已儲存處方日工作項目",
  presc_courses_saved: "✓ 已將勾選課程設為處方日",
  presc_signup:    "✓ 已報名此處方日",
  presc_cancel:    "✓ 已取消報名",
  presc_full:      "此處方日已額滿",
  presc_assigned:  "✓ 已加入工讀生",
  presc_unassigned:"✓ 已移除工讀生",
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
    // 保留過去 180 天～未來的課程（讓管理端可補登過去的工讀生；工讀生端另行過濾只顯示未來）
    const cutoff = new Date(Date.now() - 180 * 86400000).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10);
    const courses = slots
      .filter(s => s && s.slot_date >= cutoff && s.status !== "cancelled" && COURSE_TYPE_MAP[s.course_type])
      .map(s => ({
        id: s.slot_id,
        course_name: s.course_name || "",
        prescription_type: COURSE_TYPE_MAP[s.course_type],
        date: s.slot_date,
        time_slot: (String(s.start_time || "").trim() || String(s.end_time || "").trim())
          ? `${String(s.start_time || "").slice(0, 5)} - ${String(s.end_time || "").slice(0, 5)}` : "",
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
// ── 自訂臨時活動（存 Firebase /courses；不在 Supabase/n8n 來源中）──
async function customCourses() {
  const obj = await rget("/courses") || {};
  return Object.entries(obj).map(([id, c]) => ({
    id,
    course_name: c.course_name || "",
    prescription_type: c.prescription_type || "",
    date: c.date || "",
    time_slot: c.time_slot || "",
    location: c.location || "",
    enrolled: Number(c.enrolled) || 0,
    capacity: Number(c.capacity) || 0,
    status: "custom",
    region: c.region || resolveRegion(c.course_name, c.location, null),
    custom: true,
  }));
}
// ── 課程時間疊加（老師拖堂／臨時改；存 /time_overrides/{slotId} = {start,end}）──
function applyTimeOverride(c, ov) {
  const o = ov && ov[c.id];
  if (o && o.start && o.end) return { ...c, time_slot: `${o.start} - ${o.end}`, time_overridden: true };
  return c;
}
// ── 統一課表：Supabase 來源 ＋ 自訂活動，套用時間疊加 ──
async function allCourses(force = false) {
  const [supa, custom, ov] = await Promise.all([
    fetchSupabaseCourses(force), customCourses(), rget("/time_overrides"),
  ]);
  return supa.concat(custom)
    .map(c => applyTimeOverride(c, ov || {}))
    .sort((a, b) => (a.date + a.time_slot).localeCompare(b.date + b.time_slot));
}
async function coursesMap() {
  const list = await allCourses();
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
async function rpostAtt(val) {
  const { data } = await axios.post(`${ATT_FB}.json`, val); // { name: pushId }
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

// ── 廣播紀錄（存 Firebase /broadcasts，供管理員與工讀生日後查閱）──
async function getBroadcasts() {
  const data = await rget("/broadcasts") || {};
  return Object.entries(data)
    .map(([id, b]) => ({ id, ...b }))
    .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
}
function fmtDateTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch (_) { return ""; }
}
function msgToHtml(s) { return esc(String(s || "")).replace(/\n/g, "<br>"); }

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
async function regUsersPost(user) {
  const { data } = await axios.post(`${USERS_REG_FB}.json`, user);
  return data;
}
async function regUsersPatch(id, obj) {
  const { data } = await axios.patch(`${USERS_REG_FB}/${id}.json`, obj);
  return data;
}
const FEE_TYPES = ["稿費", "審查費", "講座鐘點費", "臨時人員費", "出席費", "交通差旅費", "其他"];

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

// ── 固定跟課人員（依課名設定；自動指派到該課所有未來場次）──
// 結構：/fixed_followers/{nameKey(課名)} = { workerId: true, ... }
// 對照 /assignments，補齊缺少的指派（標記 fixed:true），並回收「已從規則移除」的自動指派。
async function applyFixedFollowers() {
  const fixed = await rget("/fixed_followers") || {};
  const today = todayTaipei();
  const courses = (await allCourses()).filter(c => c.date >= today);
  const assignAll = await rget("/assignments") || {};
  const patch = {};
  const added = [];   // {cid, wid} 供推播
  let removed = 0;
  for (const c of courses) {
    const rule = fixed[nameKey(c.course_name)] || {};
    const cur = assignAll[c.id] || {};
    // 補上規則內、但尚未指派者
    for (const wid of Object.keys(rule)) {
      if (!rule[wid]) continue;
      if (cur[wid]) continue;
      patch[`${c.id}/${wid}`] = { assigned_at: nowTaipei(), fixed: true };
      added.push({ cid: c.id, wid });
    }
    // 回收：自動加入(fixed:true)但已不在規則內者
    for (const wid of Object.keys(cur)) {
      if (cur[wid] && cur[wid].fixed && !rule[wid]) {
        patch[`${c.id}/${wid}`] = null;
        removed++;
      }
    }
  }
  if (added.length || removed) await rpatch("/assignments", patch);
  return { added, removed };
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
        password_hash: hp("0000"),
        display_name: "管理員",
        role: "admin",
      });
      console.log("[schedule] 已建立預設管理員 管理員 / 0000（請盡快變更）");
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
/* eCover design system 對齊：薄荷綠主色、深藍、暖白底、圓角卡片＋柔和陰影、Noto Sans TC */
:root{
  --bg:#FAF9F5;--card:#FFFFFF;--nav:#1E3A6E;
  --text:#3D3D3D;--muted:#828282;--light:#A8A8A8;
  --heading:#333333;--subheading:#322728;
  --accent:#1A9E7A;--accent-h:#148265;--accent-l:#E7F4EF;
  --border:#E5E5E5;--border-l:#EDEDED;
  --ok:#1F8A5B;--ok-bg:#E7F4EF;--ok-b:#A9DCC6;
  --warn:#C7740C;--warn-bg:#FDF3E3;--warn-b:#F0D19B;
  --err:#D64545;--err-bg:#FBEAE8;--err-b:#EABAB4;
  --open:#1F8A5B;--open-bg:#DFF3E9;--open-b:#93D3B4;
  --shadow-card:0 2px 8px rgba(0,0,0,.06);--shadow-raised:0 4px 16px rgba(0,0,0,.10);
  --radius-card:8px;--radius-btn:6px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans TC',Arial,'Microsoft JhengHei',sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.65}
a{color:var(--accent);text-decoration:none}
.nav{background:linear-gradient(115deg,#A5C56A 0%,#55B07E 55%,#2F8A5F 100%);height:56px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 6px rgba(0,0,0,.08)}
.nav-brand{color:#fff;font-size:15px;font-weight:700;letter-spacing:.02em}
.nav-brand span{opacity:.7;font-weight:400;font-size:13px;margin-left:8px}
.nav-right{display:flex;align-items:center;gap:18px}
.nav-right .user{color:#C6D4EA;font-size:13px}
.nav-right a{color:#E4ECF7;font-size:13px;padding:5px 12px;border:1px solid rgba(255,255,255,.28);border-radius:999px;transition:.15s}
.nav-right a:hover{background:rgba(255,255,255,.14)}
.wrap{max-width:1080px;margin:32px auto;padding:0 24px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);padding:26px;margin-bottom:20px;box-shadow:var(--shadow-card)}
.card-title{font-size:14px;font-weight:700;color:var(--muted);letter-spacing:.05em;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border-l)}
.tabs{display:inline-flex;gap:8px;flex-wrap:wrap;padding:6px;background:#fff;border-radius:999px;box-shadow:var(--shadow-card);margin-bottom:4px}
.tab-btn{padding:10px 24px;background:transparent;color:var(--text);border:none;border-radius:999px;cursor:pointer;font-size:16px;font-weight:700;transition:.15s;line-height:1}
.tab-btn:hover{background:var(--bg)}
.tab-btn.active{background:#1E3A6E;color:#fff}
.tab-panel{display:none;padding-top:20px}
.tab-panel.active{display:block}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{color:var(--muted);font-size:12px;font-weight:600;padding:10px 14px;border-bottom:1px solid var(--border);text-align:left;background:transparent}
tbody td{padding:11px 14px;border-bottom:1px solid var(--border-l);vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover td{background:var(--accent-l)}
.row-assigned td{background:#EAF7F0}
.row-assigned:hover td{background:#DEF2E8}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 24px;height:44px;border-radius:var(--radius-btn);border:1px solid transparent;font-size:16px;font-weight:700;cursor:pointer;transition:all .15s;line-height:1;text-decoration:none;font-family:inherit;white-space:nowrap}
.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn-primary:hover{background:var(--accent-h)}
.btn-success{background:var(--ok);color:#fff;border-color:var(--ok)}
.btn-success:hover{opacity:.88}
.btn-danger{background:var(--err);color:#fff;border-color:var(--err)}
.btn-danger:hover{opacity:.88}
.btn-warn{background:var(--warn);color:#fff;border-color:var(--warn)}
.btn-warn:hover{opacity:.88}
.btn-navy{background:#1E3A6E;color:#fff;border-color:#1E3A6E}
.btn-navy:hover{background:#162C54}
.btn-ghost{background:#fff;color:var(--text);border-color:#CFCFCF}
.btn-ghost:hover{background:#F4F4F4}
.btn-sm{padding:8px 16px;height:38px;font-size:14px}
.btn:disabled,.btn[disabled]{opacity:.45;cursor:not-allowed}
.badge{display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:700;line-height:1;white-space:nowrap}
.b-open{background:#E2F1EA;color:#1F8A5B}
.b-warn{background:#FDF3E3;color:#C7740C}
.b-gray{background:#EFEFEF;color:#5A5A5A}
.b-blue{background:#E3F5EF;color:#1A9E7A}
.b-green{background:#E2F1EA;color:#1F8A5B}
.tag{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:500;white-space:nowrap}
.t-sport{background:#E7F4EF;color:#1F8A5B}
.t-emotion{background:#FDF3E3;color:#C7740C}
.t-social{background:#EAEFF7;color:#1E3A6E}
.t-other{background:#F0F0EC;color:#666}
.form-row{display:grid;gap:14px;margin-bottom:14px}
.form-row.cols-2{grid-template-columns:1fr 1fr}
.form-row.cols-3{grid-template-columns:1fr 1fr 1fr}
.form-row.cols-4{grid-template-columns:1fr 1fr 1fr 1fr}
@media(max-width:640px){.form-row.cols-2,.form-row.cols-3,.form-row.cols-4{grid-template-columns:1fr}}
.form-group{display:flex;flex-direction:column;gap:6px}
.form-label{font-size:15px;font-weight:700;color:var(--heading)}
/* 文字類控件（含沒寫 type 的 input）統一樣式 */
input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=reset]),select,textarea{
  width:100%;padding:11px 14px;border:1px solid #CFCFCF;border-radius:var(--radius-btn);font-size:16px;
  background:#fff;color:var(--text);transition:border .15s,box-shadow .15s;font-family:inherit;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(26,158,122,.15)}
/* 單行控件統一高度 44px，與按鈕、彼此對齊（含沒寫 type 的 input）*/
input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=reset]),select{height:44px}
textarea{min-height:88px;resize:vertical}
input[type=file]{padding:7px 11px;background:var(--bg);height:44px}
/* 核取方塊／選取列：等高置中 */
.chk-row{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 10px;cursor:pointer}
input[type=checkbox],input[type=radio]{width:18px;height:18px;flex:none;margin:0}
.alert{padding:11px 16px;border-radius:var(--radius-btn);border:1px solid transparent;font-size:13px;margin-bottom:16px}
.alert-ok{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-b)}
.alert-err{background:var(--err-bg);color:var(--err);border-color:var(--err-b)}
.divider{border:none;border-top:1px solid var(--border-l);margin:22px 0}
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:60px 24px}
.login-card{width:420px;max-width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:44px 40px 32px;box-shadow:var(--shadow-card)}
.login-logo{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;margin-bottom:30px}
.login-badge{width:56px;height:56px;border-radius:14px;background:rgba(26,158,122,.12);color:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:6px}
.login-logo h1{font-size:24px;color:var(--subheading);font-weight:700;letter-spacing:0;margin:0}
.login-logo p{font-size:12px;color:var(--muted);margin:0;letter-spacing:.24em;font-weight:500}
.login-card .form-group{margin-bottom:20px}
.login-card .form-label{font-size:13px;color:var(--subheading);font-weight:700}
.login-card input{padding:12px 14px;font-size:15px}
.login-card .btn-primary{width:100%;justify-content:center;height:48px;font-size:15px}
.login-foot{display:flex;justify-content:center;align-items:baseline;gap:6px;margin-top:20px;padding-top:18px;border-top:1px solid var(--border);font-size:15px}
.login-foot a{color:var(--accent);font-weight:700}
.stats{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.stat{background:#fff;border:1px solid var(--border);border-radius:var(--radius-card);padding:14px 22px;font-size:13px;color:var(--muted);text-align:center;min-width:84px;box-shadow:var(--shadow-card)}
.stat strong{font-size:26px;display:block;line-height:1.2;color:#1E3A6E;font-weight:700}
.stat.hl strong{color:var(--accent)}
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
.dnum{font-weight:700;font-size:12px;color:var(--subheading)}
.cband{display:block;border-radius:4px;padding:1px 4px;margin-top:2px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cband.has{background:var(--ok-bg);color:var(--ok)}
.cband.full{background:var(--warn-bg);color:var(--warn)}
.cband.todo{background:#FDECEA;color:#c0392b;font-weight:700}
.cband.done{background:var(--ok-bg);color:var(--ok);font-weight:600}
/* ── 手機 RWD ── */
@media(max-width:640px){
  .wrap{padding:0 12px;margin:18px auto}
  .nav{padding:0 14px}
  .nav-brand{font-size:14px}
  .nav-brand span{display:none}
  .nav-right{gap:10px}
  .nav-right .user{display:none}
  .card{padding:18px 14px;overflow-x:auto}
  .tabs{display:flex;flex-wrap:nowrap;overflow-x:auto;max-width:100%;justify-content:flex-start;-webkit-overflow-scrolling:touch}
  .tab-btn{padding:9px 18px;font-size:15px;white-space:nowrap}
  .stats{gap:10px}
  .stat{flex:1;min-width:0;padding:12px 10px}
  /* 月曆：手機自適應塞進 7 欄，不再橫向捲動 */
  .cal{min-width:0}
  .cal th{padding:5px 0;font-size:10px}
  .cal td{height:auto;min-height:58px}
  .cal a.dcell{padding:3px 2px}
  .dnum{font-size:11px}
  .cband{font-size:9px;padding:1px 3px;margin-top:2px}
  .btn{padding:10px 16px}
  h2{font-size:20px}
  /* 管理員動作按鈕：手機改整齊全寬堆疊，避免大小不一顯得雜亂 */
  .btn-row{flex-direction:column;gap:8px}
  .btn-row .btn{width:100%}
  /* 日課表：手機改直式卡片，避免欄位擠壓（類型標籤被折成直排、課名破碎） */
  .card{overflow-x:visible}
  table.ctbl thead{display:none}
  table.ctbl,table.ctbl tbody{display:block;width:100%}
  table.ctbl tr{display:block;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fff;box-shadow:var(--shadow-card)}
  table.ctbl tr:hover td{background:transparent}
  table.ctbl td{display:block;border:none;padding:2px 0;font-size:14px}
  table.ctbl td:nth-child(1){color:var(--muted);font-size:12px}
  table.ctbl td:nth-child(2){font-size:15px;font-weight:700;color:var(--subheading);padding-bottom:4px}
  table.ctbl td:nth-child(n+3):not(:last-child){display:inline-block;margin-right:6px}
  table.ctbl td:last-child{padding-top:10px}
  table.ctbl td:last-child form{display:block}
  table.ctbl td:last-child .btn{width:100%}
  /* 名冊型表格（姓名為主）：手機改直式卡片 */
  table.ntbl thead{display:none}
  table.ntbl,table.ntbl tbody{display:block;width:100%}
  table.ntbl tr{display:block;border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fff;box-shadow:var(--shadow-card)}
  table.ntbl tr:hover td{background:transparent}
  table.ntbl td{display:block;border:none;padding:2px 0;font-size:14px}
  table.ntbl td:nth-child(1){font-size:15px;font-weight:700;color:var(--subheading)}
  table.ntbl td:nth-child(2){color:var(--muted);font-size:12px}
  table.ntbl td:last-child{padding-top:10px}
}
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
// opts.assign=true：改為「待排工讀生」模式—需含 _need（該課需排工讀生＝開放跟課）與 _done（已排＝已指派）
function calendarGrid(courses, month, linkBase, selectedDay, opts) {
  const assignMode = !!(opts && opts.assign);
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
    const e = (map[c.date][b] = map[c.date][b] || { x: 0, t: 0 });
    if (assignMode) { if (c._need) { e.t++; if (c._done) e.x++; } }
    else { e.t++; if (c._x) e.x++; }
  }
  let cells = "<tr>";
  for (let i = 0; i < startWeekday; i++) cells += "<td></td>";
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const dm = map[date] || {};
    let bands = "";
    let dNeed = 0, dTodo = 0;
    for (const [key] of BANDS) {
      const info = dm[key];
      if (!info) continue;
      if (assignMode) {
        const todo = info.t - info.x; dNeed += info.t; dTodo += todo;
        if (todo > 0) bands += `<span class='cband todo'>${key} 待排 ${todo}</span>`;
      } else {
        bands += `<span class='cband ${info.x > 0 ? "has" : "full"}'>${key} ${info.x}/${info.t}</span>`;
      }
    }
    if (assignMode && dNeed > 0 && dTodo === 0) bands = `<span class='cband done'>✓ 已排滿</span>`;
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
  const legend = assignMode
    ? `每格顯示<b style='color:#c0392b'>還沒排工讀生</b>的堂數（依早／午／晚）；該日都排好顯示綠色「✓ 已排滿」。點日期看當天課程。`
    : `每格 x/y：x＝可預約（開放跟課）堂數，y＝總堂數。點日期看當天課程。`;
  return nav +
    `<p style='font-size:11px;color:var(--light);margin-bottom:8px'>${legend}</p>` +
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
  var _now=new Date();var cur=_now.getFullYear()+'-'+String(_now.getMonth()+1).padStart(2,'0');
  var sel=null, reg='';
  try{var _q=new URLSearchParams(location.search);var _qm=_q.get('month');if(_qm)cur=_qm;var _qd=_q.get('day');if(_qd){cur=_qd.slice(0,7);sel=_qd;}}catch(e){}
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
    var map={};var ADM=(D.role==='admin');
    list.forEach(function(c){if(c.date.slice(0,7)!==cur)return;var b=bandOf(c.time);if(!b)return;map[c.date]=map[c.date]||{};var e=map[c.date][b]=map[c.date][b]||{x:0,t:0};
      if(ADM){if(c.follow){e.t++;if(c.assigned&&c.assigned.length)e.x++;}}
      else{e.t++;if(c.x)e.x++;}});
    var rbtn=['全部'].concat(REGIONS).map(function(r){var rv=r==='全部'?'':r;return "<button type='button' class='btn btn-sm "+((reg===rv)?'btn-primary':'btn-ghost')+"' data-reg='"+rv+"'>"+r+"</button>";}).join('');
    var h="<div style='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px'><span style='font-size:12px;color:var(--muted)'>地區</span>"+rbtn+"</div>";
    h+="<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px'><button type='button' class='btn btn-sm btn-ghost' id='cp'>← 上個月</button><strong>"+Y+" 年 "+M+" 月</strong><button type='button' class='btn btn-sm btn-ghost' id='cn'>下個月 →</button></div>";
    h+="<p style='font-size:11px;color:var(--light);margin-bottom:8px'>"+(ADM?"每格顯示<b style='color:#c0392b'>還沒排工讀生</b>的堂數（依早／午／晚）；該時段都排好顯示綠色。":"每格 x/y：x＝尚可報名堂數，y＝總堂數。")+"點日期看當天課程。</p>";
    h+="<table class='cal'><thead><tr>"+WD.map(function(w){return "<th>"+w+"</th>";}).join('')+"</tr></thead><tbody><tr>";
    for(var i=0;i<start;i++)h+="<td></td>";
    for(var d=1;d<=days;d++){var date=cur+'-'+String(d).padStart(2,'0');var dm=map[date]||{};var bands='';var dNeed=0,dTodo=0;BANDS.forEach(function(k){var info=dm[k];if(!info)return;
        if(ADM){var todo=info.t-info.x;dNeed+=info.t;dTodo+=todo;if(todo>0)bands+="<span class='cband todo'>"+k+' 待排 '+todo+"</span>";}
        else{bands+="<span class='cband "+(info.x>0?'has':'full')+"'>"+k+' '+info.x+'/'+info.t+"</span>";}});
      if(ADM&&dNeed>0&&dTodo===0)bands="<span class='cband done'>✓ 已排滿</span>";
      var pb='';var pd=D.prescByDate&&D.prescByDate[date];if(pd){var na=0,nn=0;Object.keys(pd).forEach(function(rg){if(reg&&rg!==reg)return;na+=pd[rg].assigned||0;nn+=pd[rg].needed||0;});if(nn>0||na>0)pb="<span class='cband' style='background:#7c3aed;color:#fff'>處 "+na+'/'+nn+"</span>";}
      h+="<td class='"+(date===sel?'sel':'')+"'><a class='dcell' href='#' data-date='"+date+"'><span class='dnum'>"+d+"</span>"+bands+pb+"</a></td>";if((start+d)%7===0)h+="</tr><tr>";}
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
    var html="<div class='card' style='margin-top:14px'><div class='card-title'>"+sel+"（週"+wd+"）</div>";

    // 收合：被選入處方日的課，不在主月曆單列
    var pd=(D.prescByDate&&D.prescByDate[sel])||{};
    var collapsed={};
    Object.keys(pd).forEach(function(rg){(pd[rg].courseIds||[]).forEach(function(id){collapsed[id]=rg;});});
    list=list.filter(function(c){return !collapsed[c.id];});
    // admin：不跟課的課程隱藏（不需排工讀生），但「已有指派」的課即使不跟課也保留（才能管理／移除該指派）
    var hiddenNF=0;
    if(D.role==='admin'){var _b=list.length;list=list.filter(function(c){return c.follow||(c.assigned&&c.assigned.length);});hiddenNF=_b-list.length;}

    // 處方日面板
    if(D.role==='admin'){
      var pregs=Object.keys(pd).filter(function(rg){return (pd[rg].courseIds&&pd[rg].courseIds.length)||pd[rg].needed||pd[rg].assigned;});
      html+="<div style='margin-bottom:12px'><div style='font-weight:600;font-size:13px;margin-bottom:6px'>處方日</div>";
      if(pregs.length){
        html+="<div style='display:flex;gap:8px;flex-wrap:wrap'>";
        pregs.forEach(function(rg){var info=pd[rg];var nc=(info.courseIds||[]).length;
          html+="<a class='btn btn-sm btn-primary' href='"+D.prefix+"/admin/presc/"+sel+"/"+encodeURIComponent(rg)+"'>"+esc(rg)+"處方日　"+nc+" 堂 · "+(info.assigned||0)+"/"+(info.needed||0)+" 人</a>";});
        html+="</div>";
      } else { html+="<p style='font-size:12px;color:var(--light);margin:0'>當天尚未設定處方日。</p>"; }
      html+="<div style='margin-top:8px'><a class='btn btn-sm btn-ghost' href='"+D.prefix+"/admin/presc-setup?month="+sel.slice(0,7)+"&day="+sel+"'>＋ 設定／編輯處方日（勾選課程）</a></div></div>";
    } else if(D.prescWork&&D.prescWork[sel]){
      html+="<div style='margin-bottom:12px'>"+D.prescWork[sel]+"</div>";
    }

    // 課程表
    if(!list.length){
      html+=(D.role==='admin'&&hiddenNF>0)
        ?"<p style='color:var(--light);text-align:center;padding:16px'>當天課程皆設為「不跟課」（"+hiddenNF+" 堂），已隱藏。<a href='"+D.prefix+"/admin/follow-settings'>跟課設定</a></p>"
        :"<p style='color:var(--light);text-align:center;padding:16px'>當天無課程</p>";
    } else {
      if(D.role==='admin'&&hiddenNF>0)html+="<p style='font-size:11px;color:var(--light);margin:0 0 6px'>已隱藏 "+hiddenNF+" 堂「不跟課」的課程。需要的話可到 <a href='"+D.prefix+"/admin/follow-settings'>跟課設定</a> 開放。</p>";
      var rows=list.map(function(c){
        var right, extra='';
        if(c.custom) extra+=" <span class='badge b-gray' style='font-size:10px'>臨時</span>";
        if(c.over) extra+=" <span style='font-size:10px;background:#f59e0b;color:#fff;padding:1px 5px;border-radius:4px'>改時</span>";
        if(D.role==='admin'){
          var names=(c.assigned&&c.assigned.length)?c.assigned.map(esc).join('、'):"<span style='color:var(--light)'>未指派</span>";
          var ac=c.avail_count||0;
          var reg=c.follow?("<div style='font-size:11px;margin-bottom:4px'>"+(ac?"<span class='badge b-blue'>報名 "+ac+" 人可跟課</span>":"<span style='color:var(--light)'>尚無人報名</span>")+"</div>"):"";
          right="<div style='font-size:12px;margin-bottom:4px'>"+names+"</div>"+reg+"<a href='"+D.prefix+"/admin/course/"+c.id+"' class='btn btn-sm btn-primary'>指派／編輯</a>";
        } else {
          if(c.assigned)right="<span class='badge b-green'>✓ 已指派</span>";
          else if(c.avail)right="<form method='post' action='"+D.prefix+"/unavail/"+c.id+"' style='display:inline'>"+D.csrf+"<button class='btn btn-sm btn-warn'>取消登記</button></form>";
          else right="<form method='post' action='"+D.prefix+"/avail/"+c.id+"' style='display:inline'>"+D.csrf+"<button class='btn btn-sm btn-success'>我可以跟課</button></form>";
        }
        var fol=D.role==='admin'?"<td>"+(c.follow?"<span class='badge b-green'>開放</span>":"<span class='badge b-gray'>不跟課</span>")+"</td>":'';
        var enr='';
        if(D.role==='admin'){
          var en=c.enrolled||0, cap=c.capacity||0;
          var openBadge=en>=4?"<span class='badge b-open'>✅ 可開課</span>":(en>0?"<span class='badge b-warn'>未達 4 人</span>":"<span class='badge b-gray'>—</span>");
          enr="<td style='white-space:nowrap'><div style='font-size:12px;margin-bottom:3px'>民眾 <strong>"+en+"</strong>"+(cap?" / 上限 "+cap:"")+" 人</div>"+openBadge+"</td>";
        }
        var tcell=c.time?esc(c.time):"<span style='color:var(--light)'>未排定</span>";
        return "<tr><td style='white-space:nowrap;color:var(--muted)'>"+tcell+"</td><td>"+esc(c.name)+extra+"</td><td>"+regTag(c.region)+"</td><td>"+pTag(c.type)+"</td>"+enr+fol+"<td>"+right+"</td></tr>";
      }).join('');
      var head="<th>時段</th><th>課程</th><th>地區</th><th>類型</th>"+(D.role==='admin'?"<th>民眾報名／開課</th><th>跟課</th>":"")+"<th></th>";
      html+="<table class='ctbl'><thead><tr>"+head+"</tr></thead><tbody>"+rows+"</tbody></table>";
    }
    html+="</div>";
    box.innerHTML=html;
  }
  // 工讀生：就地登記/取消跟課，不換頁（可連續點同一天下一堂）
  app.addEventListener('submit',function(e){
    var f=e.target; if(!f||f.tagName!=='FORM')return;
    var act=f.getAttribute('action')||'';
    var m=/\\/(avail|unavail)\\/([^\\/?]+)/.exec(act);
    if(!m)return;
    e.preventDefault();
    var kind=m[1],cid=m[2];
    var btn=f.querySelector('button'); if(btn)btn.disabled=true;
    var body=new URLSearchParams(new FormData(f)).toString();
    fetch(act,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'fetch'},body:body,credentials:'same-origin'})
      .then(function(r){if(!r.ok)throw 0;})
      .then(function(){
        var co=all.filter(function(x){return x.id===cid;})[0]; if(co)co.avail=(kind==='avail');
        if(kind==='avail')f.outerHTML="<form method='post' action='"+D.prefix+"/unavail/"+cid+"' style='display:inline'>"+D.csrf+"<button class='btn btn-sm btn-warn'>取消登記</button></form>";
        else f.outerHTML="<form method='post' action='"+D.prefix+"/avail/"+cid+"' style='display:inline'>"+D.csrf+"<button class='btn btn-sm btn-success'>我可以跟課</button></form>";
      })
      .catch(function(){if(btn)btn.disabled=false;alert('操作失敗，請重試');});
  });
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

  function genSignin(names, reason, ry, m, d, opts){
    names=names.filter(Boolean);
    if(!names.length){alert('請選擇人員');return;}
    opts=opts||{};
    var manual=!!opts.manual; // 獨立製作：用填入的日期＋時間，不撈出勤
    var mkHrs=function(st,et){var toM=function(t){var x=/^(\\d{1,2}):(\\d{2})$/.exec(t||'');return x?(+x[1])*60+(+x[2]):null;};var s=toM(st),e=toM(et);return (s!=null&&e!=null&&e>s)?(Math.round((e-s)/60*10)/10+' 時'):'';};
    var build=function(all){
      all=(all||[]).filter(function(r){return !r.attendanceDeleted && r.status==='checked-out';});
      var dateStr=ry+'年'+pad(m)+'月'+pad(d)+'日';var shortDate=pad(m)+'/'+pad(d);var iY=ry,iM=+m,iD=+d;
      var F='font-family:DFKai-SB,標楷體;';var B1='border:1px solid #000;';var P1='padding:3px 5px;font-size:11pt;'+F;var TC=B1+P1+'text-align:center;vertical-align:middle;';var TL=B1+P1+'vertical-align:middle;';var TH=B1+P1+'text-align:center;vertical-align:middle;font-weight:bold;';
      var pages=names.map(function(name){
        var tr='';
        if(manual){
          var st=opts.start||'',et=opts.end||'';
          tr='<tr style="height:30pt;"><td style="'+TC+'">'+shortDate+'</td><td style="'+TC+'">'+esc(st)+'</td><td style="'+TC+'">&nbsp;</td><td style="'+TC+'">'+esc(et)+'</td><td style="'+TC+'">&nbsp;</td><td style="'+TC+'">'+mkHrs(st,et)+'</td></tr>';
        } else {
          var pr=all.filter(function(r){return r.name===name&&r.year===iY&&r.month===iM&&r.day===iD;}).sort(function(a,b){return new Date(a.checkinTime)-new Date(b.checkinTime);});
          if(pr.length){pr.forEach(function(rec){var ci=rec.checkinTime?new Date(rec.checkinTime).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}):'';var co=rec.checkoutTime?new Date(rec.checkoutTime).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}):'';var hrs=rec.hours!=null?rec.hours+' 時':'';tr+='<tr style="height:30pt;"><td style="'+TC+'">'+shortDate+'</td><td style="'+TC+'">'+ci+'</td><td style="'+TC+'">&nbsp;</td><td style="'+TC+'">'+co+'</td><td style="'+TC+'">&nbsp;</td><td style="'+TC+'">'+hrs+'</td></tr>';});}
          else{tr='<tr style="height:30pt;"><td style="'+TC+'">'+shortDate+'</td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td><td style="'+TC+'"> </td></tr>';}
        }
        return '<p align="center" style="'+F+'font-size:13pt;font-weight:bold;margin:0 0 4pt 0;">台北市醫師公會 健康台灣深耕計畫</p>'+
          '<p align="center" style="'+F+'font-size:12pt;font-weight:bold;margin:0 0 4pt 0;">臺北市慢性病防治全人健康智慧整合照護計畫</p>'+
          '<p align="center" style="'+F+'font-size:15pt;font-weight:bold;margin:0 0 8pt 0;">臨時人員出勤記錄與工作內容說明</p>'+
          '<table border="1" cellpadding="4" cellspacing="0" width="100%" style="border-collapse:collapse;'+F+'font-size:11pt;">'+
          '<tr><td style="'+TH+'" width="20%">姓　名</td><td style="'+TH+'" colspan="5">活動名稱 / 工作內容</td></tr>'+
          '<tr style="height:30pt;"><td style="'+TC+'">'+esc(name)+'</td><td style="'+TL+'" colspan="5">'+dateStr+' '+esc(reason)+'</td></tr>'+
          '<tr><td style="'+TH+'" rowspan="2">日期</td><td style="'+TH+'" colspan="2">上班簽到</td><td style="'+TH+'" colspan="2">下班簽退</td><td style="'+TH+'" rowspan="2">工作時數</td></tr>'+
          '<tr><td style="'+TH+'">時間</td><td style="'+TH+'">姓名</td><td style="'+TH+'">時間</td><td style="'+TH+'">姓名</td></tr>'+tr+'</table>';
      });
      var body=pages.join('\\n<br clear="all" style="page-break-before:always;" />\\n');
      var html='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>@page Section1{size:14.8cm 21.0cm;mso-page-orientation:portrait;margin:1cm 1cm 1cm 1cm;}body{'+F+'font-size:11pt;margin:0;}div.Section1{page:Section1;}table{border-collapse:collapse;}</style></head><body><div class="Section1">'+body+'</div></body></html>';
      dl(html,'工作說明及簽到簿_'+ry+pad(m)+pad(d)+'.doc');
    };
    if(manual){ build(null); }
    else { fetch('/schedule/records').then(function(r){return r.json();}).then(build).catch(function(e){alert('產生簽到單失敗：'+(e&&e.message||e));}); }
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
  function saMeta(){return {reason:(document.getElementById('sa-reason').value||'').trim(),ry:parseInt(document.getElementById('sa-year').value)||0,m:parseInt(document.getElementById('sa-month').value)||0,d:parseInt(document.getElementById('sa-day').value)||0,start:(document.getElementById('sa-start').value||'').trim(),end:(document.getElementById('sa-end').value||'').trim()};}
  function saCollect(withAmt){var ppl=[];document.querySelectorAll('.sa-chk:checked').forEach(function(cb){var amt=withAmt?(parseInt(cb.closest('label').querySelector('.sa-amt').value)||0):0;ppl.push({name:cb.value,amount:amt});});document.querySelectorAll('#sa-manual > div').forEach(function(div){var nm=(div.querySelector('.sa-mname').value||'').trim();if(nm){var amt=withAmt?(parseInt(div.querySelector('.sa-mamt').value)||0):0;ppl.push({name:nm,amount:amt});}});return ppl;}
  var siBtn=document.getElementById('sa-signin');if(siBtn)siBtn.onclick=function(){var mt=saMeta();if(!mt.reason||!mt.ry||!mt.m||!mt.d){alert('請填事由與日期（民國年/月/日）');return;}var ppl=saCollect(false);if(!ppl.length){alert('請勾選或新增人員');return;}genSignin(ppl.map(function(p){return p.name;}),mt.reason,mt.ry,mt.m,mt.d,{start:mt.start,end:mt.end,manual:true});};
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
    app.querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){if(!confirm('確定刪除此筆出勤記錄？'))return;fetch('/schedule/records/'+b.getAttribute('data-del'),{method:'DELETE'}).then(function(r){return r.json();}).then(function(){load();});};});
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
  function load(){app.querySelectorAll('#att-tbody')[0].innerHTML="<tr><td colspan='8' style='text-align:center;color:var(--light);padding:24px'>載入中…</td></tr>";fetch('/schedule/records').then(function(r){return r.json();}).then(function(data){all=(data||[]).filter(function(r){return r.status==='checked-out';});render();}).catch(function(){app.querySelectorAll('#att-tbody')[0].innerHTML="<tr><td colspan='8' style='text-align:center;color:var(--err)'>讀取失敗</td></tr>";});}
  function exportExcel(){var p=new URLSearchParams();if(fY.value.trim())p.set('year',fY.value.trim());if(fM.value)p.set('month',fM.value);if(fN.value.trim())p.set('name',fN.value.trim());window.location.href='/schedule/export?'+p.toString();}
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
  const okMsgs = new Set(["pw_changed", "registered"]);
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
    `<div class='login-logo'>` +
    `<div class='login-badge'><svg width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect width='8' height='4' x='8' y='2' rx='1'></rect><path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'></path><path d='M12 11h4'></path><path d='M12 16h4'></path><path d='M8 11h.01'></path><path d='M8 16h.01'></path></svg></div>` +
    `<h1>跟課班表系統</h1><p>SCHEDULE MANAGEMENT</p></div>` +
    `${err}` +
    `<form method='post' action='${PREFIX}/login' style='display:flex;flex-direction:column;gap:0'>` +
    `<div class='form-group'>` +
    `<label class='form-label'>姓名</label>` +
    `<input name='name' autocomplete='name' required placeholder='請輸入姓名'></div>` +
    `<div class='form-group'>` +
    `<label class='form-label'>身分證後 4 碼</label>` +
    `<input name='code' type='password' inputmode='numeric' maxlength='4' autocomplete='current-password' required placeholder='例如：1234'></div>` +
    `<button class='btn btn-primary'>登入</button>` +
    `</form>` +
    `<div class='login-foot'><span style='color:var(--muted)'>第一次使用？</span><a href='${PREFIX}/register'>點此註冊</a></div>` +
    `</div></div></body></html>`
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

// ══════════════════════════════════════════════
//  註冊（臨時人員自填領據資料；註冊即建立登入帳號＋領據資料）
// ══════════════════════════════════════════════
router.get("/register", (req, res) => {
  const msg = req.query.msg || "";
  const err = msg ? alertHtml(msg, "err") : "";
  const feeBoxes = FEE_TYPES.map(f =>
    `<label style='display:inline-flex;align-items:center;gap:4px;margin:0 12px 6px 0;font-size:13px'>` +
    `<input type='checkbox' name='feeTypes' value='${esc(f)}' style='width:auto'>${esc(f)}</label>`
  ).join("");
  res.send(
    `<!DOCTYPE html><html lang='zh-TW'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>` +
    `<title>註冊 — 跟課班表系統</title>` +
    `<link href='https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600&display=swap' rel='stylesheet'>${CSS}</head><body>` +
    `<div class='login-wrap' style='padding:24px 12px'><div class='login-card' style='width:560px;max-width:100%'>` +
    `<div class='login-logo'><h1>📋 新人註冊</h1><p>填寫請款（領據）資料</p></div>` +
    `${err}` +
    `<form method='post' action='${PREFIX}/register'>` +
    `<div class='form-row cols-2'>` +
    `<div class='form-group'><label class='form-label'>姓名 *</label><input name='name' required></div>` +
    `<div class='form-group'><label class='form-label'>身分證字號 *（10 碼，末 4 碼為登入密碼）</label><input name='idNumber' maxlength='10' required placeholder='A123456789'></div>` +
    `</div>` +
    `<div class='form-row cols-2'>` +
    `<div class='form-group'><label class='form-label'>電話</label><input name='phone' inputmode='numeric'></div>` +
    `<div class='form-group'><label class='form-label'>事由名稱</label><input name='eventName' placeholder='例：處方兌換日跟課'></div>` +
    `</div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>工作內容</label><input name='workDescription' placeholder='例：場佈、報到、出席紀錄'></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>費用別</label><div>${feeBoxes}</div></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>領款方式</label>` +
    `<div style='display:flex;gap:16px'>` +
    `<label style='display:inline-flex;align-items:center;gap:4px'><input type='radio' name='payMethod' value='現金' checked style='width:auto'>現金</label>` +
    `<label style='display:inline-flex;align-items:center;gap:4px'><input type='radio' name='payMethod' value='匯款' style='width:auto'>匯款</label>` +
    `</div></div>` +
    `<div id='bank-box' style='display:none;border:1px solid var(--border-l);border-radius:4px;padding:12px;margin-bottom:12px'>` +
    `<div class='form-row cols-3'>` +
    `<div class='form-group'><label class='form-label'>銀行/分行</label><input name='bankName'></div>` +
    `<div class='form-group'><label class='form-label'>戶名</label><input name='accountName'></div>` +
    `<div class='form-group'><label class='form-label'>帳號</label><input name='account' inputmode='numeric'></div>` +
    `</div></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>戶籍地址</label><input name='address' id='reg-addr'></div>` +
    `<div class='form-group' style='margin-bottom:6px'><label class='form-label'>居住地址</label><input name='liveAddress' id='reg-live'></div>` +
    `<label style='display:inline-flex;align-items:center;gap:4px;font-size:13px;margin-bottom:16px'><input type='checkbox' id='same-addr' style='width:auto'>同戶籍地址</label>` +
    `<button class='btn btn-primary' style='width:100%;justify-content:center;padding:10px'>註冊</button>` +
    `<div style='text-align:center;margin-top:14px'><a href='${PREFIX}/login'>已有帳號？返回登入</a></div>` +
    `</form></div></div>` +
    `<script>(function(){` +
    `var r=document.querySelectorAll('input[name=payMethod]');var box=document.getElementById('bank-box');` +
    `function upd(){box.style.display=(document.querySelector('input[name=payMethod]:checked').value==='匯款')?'block':'none';}` +
    `r.forEach(function(x){x.addEventListener('change',upd);});upd();` +
    `var same=document.getElementById('same-addr'),a=document.getElementById('reg-addr'),l=document.getElementById('reg-live');` +
    `function sync(){if(same.checked){l.value=a.value;l.readOnly=true;}else{l.readOnly=false;}}` +
    `same.addEventListener('change',sync);a.addEventListener('input',function(){if(same.checked)l.value=a.value;});` +
    `})();</script></body></html>`
  );
});
router.post("/register", async (req, res) => {
  const b = req.body;
  const name = (b.name || "").trim();
  const idNumber = (b.idNumber || "").trim();
  if (!name || idNumber.length !== 10) return res.redirect(`${PREFIX}/register?msg=reg_badid`);
  const id4 = idNumber.slice(-4);
  try {
    const existing = await regUsersGet();
    if (existing.some(u => u.name === name && String(u.idNumber || "").slice(-4) === id4))
      return res.redirect(`${PREFIX}/register?msg=reg_dup`);
    const feeTypes = [].concat(b.feeTypes || []).filter(Boolean);
    const bankInfo = b.payMethod === "匯款"
      ? { bankName: (b.bankName || "").trim(), accountName: (b.accountName || "").trim(), account: (b.account || "").trim() }
      : {};
    await regUsersPost({
      name, idNumber,
      phone: (b.phone || "").trim(),
      eventName: (b.eventName || "").trim(),
      workDescription: (b.workDescription || "").trim(),
      feeTypes,
      payMethod: b.payMethod || "",
      bankInfo,
      address: (b.address || "").trim(),
      liveAddress: (b.liveAddress || "").trim(),
      registeredAt: new Date().toISOString(),
    });
    // 建立登入帳號（姓名＋身分證後4碼），若尚無相同帳號
    const sUsers = await getUsers();
    if (!sUsers.some(u => u.display_name === name && u.password_hash === hp(id4))) {
      await rpost("/users", { username: name, password_hash: hp(id4), display_name: name, role: "worker" });
    }
    res.redirect(`${PREFIX}/login?msg=registered`);
  } catch (e) {
    console.error("[schedule] register:", e.message);
    res.redirect(`${PREFIX}/register?msg=reg_fail`);
  }
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
    if (active) activeHint = `<div style='margin-top:10px'><span style='display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:#FDF3E3;color:var(--warn)'>● 目前有一筆未簽退</span></div>`;
  } catch (_) {}

  const ICO = {
    checkin: `<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>`,
    dash: `<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path>`,
    time: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path>`,
    key: `<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle>`,
    mail: `<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>`,
    user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>`,
  };

  // 收到的公告則數（首頁卡片提示）
  let msgCount = 0;
  try { msgCount = (await getBroadcasts()).filter(b => Array.isArray(b.recipientIds) && b.recipientIds.includes(sess.id)).length; }
  catch (_) {}
  // 是否已填領據資料（後台自主新增的工讀生通常沒有）
  let hasInfo = true;
  try { hasInfo = !!(await myRegRecord(sess.display_name)); } catch (_) {}
  const infoBadge = hasInfo
    ? ""
    : `<div style='margin-top:10px'><span style='display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:#FDF3E3;color:var(--warn)'>● 尚未填寫，請補資料</span></div>`;
  const msgBadge = msgCount
    ? `<div style='margin-top:10px'><span style='display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:rgba(26,158,122,.12);color:var(--accent)'>${msgCount} 則公告</span></div>`
    : "";
  const iconCard = (href, ico, title, desc, extra = "") =>
    `<a href='${href}' style='background:#fff;border:1px solid var(--border);border-radius:8px;padding:22px;box-shadow:var(--shadow-card);display:block;text-decoration:none;color:inherit;transition:box-shadow .2s' onmouseover="this.style.boxShadow='var(--shadow-raised)'" onmouseout="this.style.boxShadow='var(--shadow-card)'">` +
    `<div style='width:44px;height:44px;border-radius:10px;background:rgba(26,158,122,.12);color:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:12px'><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ico}</svg></div>` +
    `<div style='font-size:16px;font-weight:700;color:var(--subheading);margin-bottom:4px'>${esc(title)}</div>` +
    `<div style='font-size:13px;color:var(--muted);line-height:1.5'>${esc(desc)}</div>${extra}</a>`;

  const homeMsg = req.query.msg ? alertHtml(req.query.msg, "ok") : "";
  const body =
    `${homeMsg}` +
    `<div style='margin-bottom:22px'>` +
    `<h2 style='margin:0;font-size:22px;font-weight:700;color:var(--subheading)'>嗨，${esc(sess.display_name)}</h2>` +
    `<p style='margin:4px 0 0;font-size:15px;color:var(--muted)'>請選擇要使用的功能</p></div>` +
    `<div style='display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;margin-bottom:20px'>` +
    `${iconCard(`${PREFIX}/checkin`, ICO.checkin, "簽到 / 簽退", "上課現場簽到、下課回報時數與內容", activeHint)}` +
    `${iconCard(`${PREFIX}/dashboard`, ICO.dash, "我的班表", "查看可跟課的課程、登記與已被指派的班")}` +
    `${iconCard(`${PREFIX}/timesheet`, ICO.time, "我的工時", "查看已完成的課程與累計工作時數")}` +
    `${iconCard(`${PREFIX}/messages`, ICO.mail, "系統公告", "查看管理員發送的通知與過往公告", msgBadge)}` +
    `${iconCard(`${PREFIX}/my-info`, ICO.user, "我的資料", "填寫／更新領據資料（製作領據、申請單用）", infoBadge)}` +
    `${iconCard(`${PREFIX}/change-password`, ICO.key, "修改密碼", "更改自己的登入密碼")}` +
    `</div>` +
    `<div class='card' id='push-card'>` +
    `<div style='display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--nav-navy,#1E3A6E)'><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path></svg><span style='font-size:15px;font-weight:700'>指派通知</span></div>` +
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
//  工讀生：系統公告（收到的廣播內容）
// ══════════════════════════════════════════════
router.get("/messages", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  const mine = (await getBroadcasts())
    .filter(b => Array.isArray(b.recipientIds) && b.recipientIds.includes(sess.id));
  let list;
  if (mine.length) {
    list = mine.map(b =>
      `<div class='card' style='margin-bottom:12px'>` +
      `<div style='font-size:12px;color:var(--muted);margin-bottom:6px'>🔔 ${esc(fmtDateTime(b.sentAt))}</div>` +
      `<div style='font-size:15px;line-height:1.7;white-space:pre-wrap'>${msgToHtml(b.message)}</div>` +
      (b.askInfo ? `<div style='margin-top:12px'><a href='${PREFIX}/my-info' class='btn btn-sm btn-primary'>📝 填寫我的資料</a></div>` : "") +
      `</div>`
    ).join("");
  } else {
    list = "<div class='card'><p style='text-align:center;color:var(--light);padding:32px 0;font-size:13px'>目前尚無公告</p></div>";
  }
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a></div>` +
    `<div style='margin-bottom:16px'>` +
    `<h2 style='margin:0;font-size:22px;font-weight:700;color:var(--subheading)'>系統公告</h2>` +
    `<p style='margin:4px 0 0;font-size:14px;color:var(--muted)'>管理員發送給你的通知都會保留在這裡</p></div>` +
    list;
  res.send(layout("系統公告", body, sess));
});

// ══════════════════════════════════════════════
//  工讀生：填寫／更新自己的領據（報名）資料
//  （後台自主新增的工讀生沒有領據資料，可自行補填）
// ══════════════════════════════════════════════
async function myRegRecord(name) {
  const all = await regUsersGet();
  return all.find(u => u.name === name) || null;
}
router.get("/my-info", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  const rec = await myRegRecord(sess.display_name) || {};
  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, msg === "info_saved" ? "ok" : "err") : "";
  const v = (k) => esc(rec[k] || "");
  const bank = rec.bankInfo || {};
  const feeSet = new Set(Array.isArray(rec.feeTypes) ? rec.feeTypes : []);
  const feeBoxes = FEE_TYPES.map(f =>
    `<label style='display:inline-flex;align-items:center;gap:4px;margin:0 12px 6px 0;font-size:13px'>` +
    `<input type='checkbox' name='feeTypes' value='${esc(f)}'${feeSet.has(f) ? " checked" : ""} style='width:auto'>${esc(f)}</label>`
  ).join("");
  const isCash = (rec.payMethod || "現金") !== "匯款";
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a></div>` +
    `${notice}` +
    `<div class='card' style='max-width:620px'>` +
    `<div class='card-title'>我的領據資料</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:14px'>此資料用於製作領據／申請單等文件。請完整填寫，之後可隨時回來修改。</p>` +
    `<form method='post' action='${PREFIX}/my-info'>${hiddenCsrf(sess)}` +
    `<div class='form-row cols-2'>` +
    `<div class='form-group'><label class='form-label'>姓名 *</label><input name='name' required value='${rec.name ? v("name") : esc(sess.display_name)}'></div>` +
    `<div class='form-group'><label class='form-label'>身分證字號 *（10 碼）</label><input name='idNumber' maxlength='10' required placeholder='A123456789' value='${v("idNumber")}'></div>` +
    `</div>` +
    `<div class='form-row cols-2'>` +
    `<div class='form-group'><label class='form-label'>電話</label><input name='phone' inputmode='numeric' value='${v("phone")}'></div>` +
    `<div class='form-group'><label class='form-label'>事由名稱</label><input name='eventName' placeholder='例：處方兌換日跟課' value='${v("eventName")}'></div>` +
    `</div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>工作內容</label><input name='workDescription' placeholder='例：場佈、報到、出席紀錄' value='${v("workDescription")}'></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>費用別</label><div>${feeBoxes}</div></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>領款方式</label>` +
    `<div style='display:flex;gap:16px'>` +
    `<label style='display:inline-flex;align-items:center;gap:4px'><input type='radio' name='payMethod' value='現金'${isCash ? " checked" : ""} style='width:auto'>現金</label>` +
    `<label style='display:inline-flex;align-items:center;gap:4px'><input type='radio' name='payMethod' value='匯款'${isCash ? "" : " checked"} style='width:auto'>匯款</label>` +
    `</div></div>` +
    `<div id='bank-box' style='display:${isCash ? "none" : "block"};border:1px solid var(--border-l);border-radius:4px;padding:12px;margin-bottom:12px'>` +
    `<div class='form-row cols-3'>` +
    `<div class='form-group'><label class='form-label'>銀行/分行</label><input name='bankName' value='${esc(bank.bankName || "")}'></div>` +
    `<div class='form-group'><label class='form-label'>戶名</label><input name='accountName' value='${esc(bank.accountName || "")}'></div>` +
    `<div class='form-group'><label class='form-label'>帳號</label><input name='account' inputmode='numeric' value='${esc(bank.account || "")}'></div>` +
    `</div></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>戶籍地址</label><input name='address' id='mi-addr' value='${v("address")}'></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>居住地址</label><input name='liveAddress' id='mi-live' value='${v("liveAddress")}'></div>` +
    `<button class='btn btn-primary'>儲存資料</button>` +
    `</form></div>` +
    `<script>(function(){var r=document.querySelectorAll('input[name=payMethod]');var box=document.getElementById('bank-box');` +
    `function upd(){box.style.display=(document.querySelector('input[name=payMethod]:checked').value==='匯款')?'block':'none';}` +
    `r.forEach(function(x){x.addEventListener('change',upd);});upd();})();</script>`;
  res.send(layout("我的領據資料", body, sess));
});
router.post("/my-info", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/my-info?msg=csrf_err`);
  const b = req.body;
  const name = (b.name || "").trim();
  const idNumber = (b.idNumber || "").trim();
  if (!name || idNumber.length !== 10) return res.redirect(`${PREFIX}/my-info?msg=reg_badid`);
  const feeTypes = [].concat(b.feeTypes || []).filter(Boolean);
  const bankInfo = b.payMethod === "匯款"
    ? { bankName: (b.bankName || "").trim(), accountName: (b.accountName || "").trim(), account: (b.account || "").trim() }
    : {};
  const payload = {
    name, idNumber,
    phone: (b.phone || "").trim(),
    eventName: (b.eventName || "").trim(),
    workDescription: (b.workDescription || "").trim(),
    feeTypes,
    payMethod: b.payMethod || "",
    bankInfo,
    address: (b.address || "").trim(),
    liveAddress: (b.liveAddress || "").trim(),
  };
  try {
    const existing = await myRegRecord(sess.display_name);
    if (existing) await regUsersPatch(existing.id, payload);
    else await regUsersPost({ ...payload, registeredAt: new Date().toISOString() });
    res.redirect(`${PREFIX}/my-info?msg=info_saved`);
  } catch (e) {
    console.error("[schedule] my-info:", e.message);
    res.redirect(`${PREFIX}/my-info?msg=reg_fail`);
  }
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
  // 手動時數調整（管理員在後台加減；計入我的工時）
  const myAdj = (await getHoursAdjust()).filter(a => a.name === sess.display_name)
    .sort((a, b) => (b.year - a.year) || (b.month - a.month));
  const adjTotal = myAdj.reduce((s, a) => s + (Number(a.hours) || 0), 0);
  const totalHours = Math.round((recs.reduce((s, r) => s + (Number(r.hours) || 0), 0) + adjTotal) * 10) / 10;
  const fmtTime = iso => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }); }
    catch (_) { return ""; }
  };

  const monthKey = r => `${r.year}-${String(r.month).padStart(2, "0")}`;
  const adjKey = a => `${a.year}-${String(a.month).padStart(2, "0")}`;
  const monthLabel = k => { const [y, m] = k.split("-"); return `${y} 年 ${Number(m)} 月`; };
  const months = [...new Set([...recs.map(monthKey), ...myAdj.map(adjKey)])].sort().reverse();
  const defMonth = months[0] || "";

  let table, monthSel = "";
  if (recs.length || myAdj.length) {
    const rows = recs.map(r =>
      `<tr data-m='${esc(monthKey(r))}' data-h='${Number(r.hours) || 0}'>` +
      `<td style='white-space:nowrap'>${esc(r.year)}/${esc(r.month)}/${esc(r.day)}</td>` +
      `<td>${esc(r.course)}</td>` +
      `<td style='white-space:nowrap;color:var(--muted)'>${esc(fmtTime(r.checkinTime))} - ${esc(fmtTime(r.checkoutTime))}</td>` +
      `<td style='white-space:nowrap'><span class='badge b-blue'>${esc(r.hours)} 時</span></td>` +
      `</tr>`
    ).join("");
    const adjRows = myAdj.map(a =>
      `<tr data-m='${esc(adjKey(a))}' data-h='${Number(a.hours) || 0}' data-adj='1'>` +
      `<td style='white-space:nowrap'>${esc(a.year)}/${esc(a.month)}</td>` +
      `<td>時數調整${a.reason ? `（${esc(a.reason)}）` : ""}</td>` +
      `<td style='white-space:nowrap;color:var(--muted)'>—</td>` +
      `<td style='white-space:nowrap'><span class='badge ${Number(a.hours) < 0 ? "b-warn" : "b-green"}'>${Number(a.hours) > 0 ? "+" : ""}${esc(a.hours)} 時</span></td>` +
      `</tr>`
    ).join("");
    table = `<table class='ctbl' id='ts-table'><thead><tr><th>日期</th><th>課程</th><th>時段</th><th>時數</th></tr></thead>` +
      `<tbody>${rows}${adjRows}</tbody></table>`;
    if (months.length > 1) {
      monthSel =
        `<div style='margin-bottom:14px;display:flex;align-items:center;gap:8px'>` +
        `<label class='form-label' style='margin:0'>月份</label>` +
        `<select id='ts-month' style='width:auto;min-width:140px'>` +
        `<option value=''>全部</option>` +
        months.map(k => `<option value='${esc(k)}'>${esc(monthLabel(k))}</option>`).join("") +
        `</select></div>`;
    }
  } else {
    table = "<p style='text-align:center;color:var(--light);padding:32px 0;font-size:13px'>目前尚無已完成的簽到退記錄</p>";
  }

  const filterJs = (recs.length || myAdj.length) ? `<script>(function(){
    var sel=document.getElementById('ts-month'); if(!sel)return;
    var rows=[].slice.call(document.querySelectorAll('#ts-table tbody tr'));
    var cEl=document.getElementById('ts-count'),hEl=document.getElementById('ts-hours');
    function apply(){var m=sel.value,cnt=0,h=0;rows.forEach(function(tr){var show=(!m||tr.getAttribute('data-m')===m);tr.style.display=show?'':'none';if(show){h+=Number(tr.getAttribute('data-h'))||0;if(tr.getAttribute('data-adj')!=='1')cnt++;}});if(cEl)cEl.textContent=cnt;if(hEl)hEl.textContent=Math.round(h*10)/10;}
    sel.value=${JSON.stringify(defMonth)};sel.addEventListener('change',apply);apply();
  })();</script>` : "";

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a></div>` +
    `<div class='stats'>` +
    `<div class='stat'><strong id='ts-count'>${recs.length}</strong>已完成堂數</div>` +
    `<div class='stat'><strong id='ts-hours'>${totalHours}</strong>累計時數（時）</div>` +
    `</div>` +
    `<div class='card'><div class='card-title'>我的出勤記錄</div>${monthSel}${table}</div>` +
    filterJs;
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
    `<p style='font-size:12px;color:var(--muted);margin-bottom:14px'>預設密碼為身分證後 4 碼；可改成你自己的 4 位數字密碼。</p>` +
    `<form method='post' action='${PREFIX}/change-password'>${hiddenCsrf(sess)}` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>目前密碼</label>` +
    `<input name='current_password' type='password' inputmode='numeric' maxlength='4' required></div>` +
    `<div class='form-group' style='margin-bottom:12px'><label class='form-label'>新密碼（4 位數字）</label>` +
    `<input name='new_password' type='password' inputmode='numeric' maxlength='4' pattern='\\d{4}' required></div>` +
    `<div class='form-group' style='margin-bottom:16px'><label class='form-label'>確認新密碼</label>` +
    `<input name='confirm_password' type='password' inputmode='numeric' maxlength='4' required></div>` +
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
  if (!/^\d{4}$/.test(new_password || "")) return res.redirect(`${PREFIX}/change-password?msg=pw_need4`);
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
  var REGIONS = ['北投','士林','中山'];
  var app = document.getElementById('ck-app');
  function h(html){ app.innerHTML = html; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function val(id){ var e=document.getElementById(id); return e?e.value:''; }
  function api(url,opts){ return fetch(url,opts).then(function(r){ return r.json().catch(function(){return {};}); }); }
  function timeOptions(sel){ var o="<option value=''>--:--</option>"; for(var hh=6;hh<=22;hh++){ for(var mm=0;mm<60;mm+=30){ var t=(hh<10?'0':'')+hh+':'+(mm<10?'0':'')+mm; o+="<option value='"+t+"'"+(t===sel?" selected":"")+">"+t+"</option>"; } } return o; }
  function regionOptions(sel){ return REGIONS.map(function(r){ return "<option value='"+r+"'"+(r===sel?" selected":"")+">"+r+"</option>"; }).join(''); }

  // ── 相連課程偵測：同一天、且前一堂結束時間＝後一堂開始時間 ──
  function chainFrom(course){
    var chain=[course], cur=course, guard=0;
    while(guard++<20){
      var next=null;
      for(var i=0;i<ME.courses.length;i++){
        var c=ME.courses[i];
        if(chain.indexOf(c)>=0) continue;
        if(c.date===cur.date && c.start && c.end && cur.end && c.start===cur.end){ next=c; break; }
      }
      if(!next) break;
      chain.push(next); cur=next;
    }
    return chain;
  }

  // ── 模式選擇 ──
  function showModePicker(){
    h(
      "<div class='card'><div class='card-title'>選擇簽到類型</div>"+
      "<div style='display:grid;gap:10px;margin-top:6px'>"+
      "<button class='btn btn-success' id='m-regular'>一般簽到（跟課）</button>"+
      "<button class='btn btn-primary' id='m-presc'>處方日簽到</button>"+
      "<button class='btn btn-ghost' id='m-admin'>行政庶務簽到</button>"+
      "</div></div>"
    );
    document.getElementById('m-regular').onclick=showRegular;
    document.getElementById('m-presc').onclick=showPrescription;
    document.getElementById('m-admin').onclick=showAdmin;
  }
  function backBar(){ return "<div style='margin-bottom:10px'><button class='btn btn-sm btn-ghost' id='m-back'>← 重新選擇類型</button></div>"; }
  function bindBack(){ var b=document.getElementById('m-back'); if(b) b.onclick=showModePicker; }

  // ── 一般簽到（選一堂指派課，偵測相連課程） ──
  function showRegular(){
    if(!ME.courses.length){
      h(backBar()+"<div class='card'><div class='alert alert-err'>你目前沒有被指派的課程，無法一般簽到。請先在「我的班表」由專案人員指派。</div></div>");
      bindBack(); return;
    }
    var opts = ME.courses.map(function(c,i){ return "<option value='"+i+"'>"+esc(c.name)+"（"+esc(c.date)+" "+esc(c.time)+(c.region?" ／ "+esc(c.region):"")+"）</option>"; }).join('');
    h(backBar()+
      "<div class='card'><div class='card-title'>一般簽到</div>"+
      "<div class='form-group' style='margin-bottom:14px'><label class='form-label'>姓名</label><input value='"+esc(ME.name)+"' disabled></div>"+
      "<div class='form-group' style='margin-bottom:16px'><label class='form-label'>課程（僅能選被指派的課）</label>"+
      "<select id='ck-course'>"+opts+"</select></div>"+
      "<button class='btn btn-success' id='ck-next'>下一步</button>"+
      "<div id='ck-msg' style='margin-top:12px'></div></div>"
    );
    bindBack();
    document.getElementById('ck-next').onclick=function(){
      var course=ME.courses[+val('ck-course')];
      var chain=chainFrom(course);
      if(chain.length>1) askMerge(chain); else doCheckinRegular([course]);
    };
  }
  function askMerge(chain){
    var first=chain[0], last=chain[chain.length-1];
    var list=chain.map(function(c){ return "<li>"+esc(c.name)+"（"+esc(c.time)+(c.region?" ／ "+esc(c.region):"")+"）</li>"; }).join('');
    h(backBar()+
      "<div class='card'><div class='card-title'>偵測到相連課程</div>"+
      "<p style='font-size:13px;color:var(--muted)'>這堂課後面還有相接的課程，是否要合併為一次簽到（時數依課表 "+esc(first.start)+"–"+esc(last.end)+" 計算）？</p>"+
      "<ul style='margin:8px 0 14px;padding-left:20px;font-size:14px'>"+list+"</ul>"+
      "<div style='display:grid;gap:10px'>"+
      "<button class='btn btn-success' id='mg-yes'>合併簽到這 "+chain.length+" 堂（"+esc(first.start)+"–"+esc(last.end)+"）</button>"+
      "<button class='btn btn-ghost' id='mg-no'>只簽這一堂（"+esc(first.name)+"）</button>"+
      "</div><div id='ck-msg' style='margin-top:12px'></div></div>"
    );
    bindBack();
    document.getElementById('mg-yes').onclick=function(){ doCheckinRegular(chain); };
    document.getElementById('mg-no').onclick=function(){ doCheckinRegular([chain[0]]); };
  }
  function doCheckinRegular(chain){
    var msg=document.getElementById('ck-msg'); if(msg) msg.textContent='簽到中...';
    var payload={ mode:'一般', name:ME.name, courseIds: chain.map(function(c){return c.id;}) };
    api('/schedule/checkin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(res){ if(res.ok){ load(); } else if(msg){ msg.innerHTML="<div class='alert alert-err'>簽到失敗："+esc(res.error||'')+"</div>"; } });
  }

  // ── 處方日簽到（選管理端指派給你的「分區＋日期」）──
  function showPrescription(){
    var list=ME.presc||[];
    if(!list.length){
      h(backBar()+"<div class='card'><div class='alert alert-err'>你目前沒有被指派的處方日。請由管理端在月曆的處方日設定中將你排入。</div></div>");
      bindBack(); return;
    }
    var opts=list.map(function(p,i){ return "<option value='"+i+"'>"+esc(p.date)+"　"+esc(p.region)+"</option>"; }).join('');
    h(backBar()+
      "<div class='card'><div class='card-title'>處方日簽到</div>"+
      "<div class='form-group' style='margin-bottom:12px'><label class='form-label'>姓名</label><input value='"+esc(ME.name)+"' disabled></div>"+
      "<div class='form-group' style='margin-bottom:12px'><label class='form-label'>選擇處方日（分區＋日期，僅列出被指派的）</label><select id='px-sel'>"+opts+"</select></div>"+
      "<div id='px-info'></div>"+
      "<button class='btn btn-success' id='px-btn' style='margin-top:10px'>簽到</button>"+
      "<div id='ck-msg' style='margin-top:12px'></div></div>"
    );
    bindBack();
    function showInfo(){
      var p=list[+val('px-sel')]; var box=document.getElementById('px-info'); if(!box)return;
      if(!p){box.innerHTML='';return;}
      var li=(p.items||[]).map(function(it){return "<li>"+esc(it.desc)+"　"+(Number(it.count)||0)+" 人</li>";}).join('');
      box.innerHTML=li?("<div style='background:#f3e8ff;border-radius:8px;padding:10px;font-size:13px'><div style='font-weight:600;margin-bottom:4px'>當天工作內容</div><ul style='margin:0;padding-left:20px'>"+li+"</ul></div>"):"<p style='font-size:12px;color:var(--muted)'>此處方日尚未設定工作項目。</p>";
    }
    document.getElementById('px-sel').addEventListener('change',showInfo); showInfo();
    document.getElementById('px-btn').onclick=function(){
      var p=list[+val('px-sel')]; var msg=document.getElementById('ck-msg'); if(!p)return;
      msg.textContent='簽到中...';
      api('/schedule/checkin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'處方日',prescDate:p.date,prescRegion:p.region})})
        .then(function(res){ if(res.ok){ load(); } else { msg.innerHTML="<div class='alert alert-err'>簽到失敗："+esc(res.error||'')+"</div>"; } });
    };
  }

  // ── 行政庶務簽到（只需填工作內容；日期自動取今天）──
  function showAdmin(){
    h(backBar()+
      "<div class='card'><div class='card-title'>行政庶務簽到</div>"+
      "<div class='form-group' style='margin-bottom:16px'><label class='form-label'>工作內容</label><textarea id='ad-work' rows='3' placeholder='例：文件整理、核銷、場地準備'></textarea></div>"+
      "<button class='btn btn-success' id='ad-submit'>簽到</button>"+
      "<div id='ck-msg' style='margin-top:12px'></div></div>"
    );
    bindBack();
    document.getElementById('ad-submit').onclick=function(){
      var work=val('ad-work'); var msg=document.getElementById('ck-msg');
      if(!work.trim()){ msg.innerHTML="<div class='alert alert-err'>請填寫工作內容。</div>"; return; }
      msg.textContent='簽到中...';
      api('/schedule/checkin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'行政庶務',name:ME.name,workContent:work})})
        .then(function(res){ if(res.ok){ load(); } else { msg.innerHTML="<div class='alert alert-err'>簽到失敗："+esc(res.error||'')+"</div>"; } });
    };
  }

  // ── 簽退回報 ──
  function showCheckout(sid, rec){
    var t = rec.checkinTime ? new Date(rec.checkinTime).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}) : '';
    var timeInfo = (rec.schedStart&&rec.schedEnd) ? ("　課表時間："+esc(rec.schedStart)+"–"+esc(rec.schedEnd)) : '';
    h(
      "<div class='card'><div class='card-title'>簽退回報</div>"+
      "<div class='alert alert-ok'>已於 "+esc(t)+" 簽到（"+esc(rec.checkinMode||'一般')+"）<br>課程："+esc(rec.course||rec.workContent||'-')+timeInfo+"</div>"+
      "<div class='form-row cols-2'>"+
      "<div class='form-group'><label class='form-label'>課程老師</label><input id='f-teacher'></div>"+
      "<div class='form-group'><label class='form-label'>系統報名人數</label><input id='f-registeredCount' type='number' min='0'></div>"+
      "</div>"+
      "<div class='form-row cols-2'>"+
      "<div class='form-group'><label class='form-label'>線上報名實到</label><input id='f-actualCount' type='number' min='0'></div>"+
      "<div class='form-group'><label class='form-label'>現場候補人數</label><input id='f-walkInCount' type='number' min='0'></div>"+
      "</div>"+
      "<div class='form-group' style='margin-bottom:16px'><label class='form-label'>簡述上課內容 / 回報狀況</label><textarea id='f-summary' rows='4'></textarea></div>"+
      "<button class='btn btn-danger' id='co-btn'>簽退</button>"+
      "<div id='co-msg' style='margin-top:12px'></div></div>"
    );
    document.getElementById('co-btn').onclick=function(){
      var btn=this; btn.disabled=true; btn.textContent='簽退中...';
      var payload={ sessionId:sid, teacher:val('f-teacher'),
        registeredCount:val('f-registeredCount'), actualCount:val('f-actualCount'), walkInCount:val('f-walkInCount'), summary:val('f-summary') };
      api('/schedule/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(res){
        if(res.ok){
          h("<div class='card'><div class='card-title'>完成</div>"+
            "<div class='alert alert-ok'>✓ 已簽退，本次工作時數 <strong>"+esc(res.hours)+"</strong> 小時</div>"+
            "<div style='margin-top:16px'><a class='btn btn-ghost' href='/schedule/home'>返回首頁</a></div></div>");
        } else { document.getElementById('co-msg').innerHTML="<div class='alert alert-err'>簽退失敗："+esc(res.error||'')+"</div>"; btn.disabled=false; btn.textContent='簽退'; }
      });
    };
  }

  function load(){
    h("<div class='card'><p style='color:var(--light)'>載入中...</p></div>");
    api('/schedule/active-session?name='+encodeURIComponent(ME.name))
    .then(function(res){ if(res && res.found){ showCheckout(res.sessionId, res.record||{}); } else { showModePicker(); } });
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

  // 我被指派的處方日（日期＋分區）；只顯示今天（含）之後
  const today = todayTaipei();
  const prescDays   = await rget("/presc_days") || {};
  const prescAssign = await rget("/presc_assignments") || {};
  const myPresc = [];
  for (const [date, regs] of Object.entries(prescAssign)) {
    if (date < today) continue;
    for (const [region, widMap] of Object.entries(regs || {})) {
      if (!widMap || !widMap[sess.id]) continue;
      const items = (((prescDays[date] || {})[region]) || {}).items || [];
      myPresc.push({ date, region, items });
    }
  }
  myPresc.sort((a, b) => (a.date + a.region).localeCompare(b.date + b.region));

  // time_slot 形如 "09:00 - 10:00"，拆出起訖時間供相連偵測與下拉使用
  const splitTS = ts => {
    const m = String(ts || "").split("-").map(s => s.trim());
    return { start: m[0] || "", end: m[1] || "" };
  };
  const meJson = JSON.stringify({
    name: sess.display_name,
    courses: myCourses.map(c => {
      const { start, end } = splitTS(c.time_slot);
      return { id: c.id, name: c.course_name, date: c.date, time: c.time_slot, start, end, type: c.prescription_type, region: c.region, loc: c.location };
    }),
    presc: myPresc,
  });

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/home' class='btn btn-sm btn-ghost'>← 返回首頁</a></div>` +
    `<div id='ck-app'></div>` +
    `<script>window.__ME=${meJson};</script>` +
    CHECKIN_CLIENT_JS;
  res.send(layout("簽到 / 簽退", body, sess));
});

// ── 簽到 / 簽退：時間工具 ──
function hhmmToMin(t) { const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function rocFromDate(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { year: (+m[1]) - 1911, month: +m[2], day: +m[3] } : null;
}
function todayROC() {
  return rocFromDate(new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10));
}
// ── 稅務預警：某人某月（民國年）已簽退累計時數 ──
const HOURS_WARN = 48;
// 時數調整（管理員手動加減；存 /hours_adjust，計入月總時數、稅務預警與工時）
async function getHoursAdjust() {
  const data = await rget("/hours_adjust") || {};
  return Object.entries(data).map(([id, a]) => ({ id, ...a }));
}
function sumMonthAdjust(adjustments, name, rocYear, month) {
  return (adjustments || []).filter(a => a.name === name && Number(a.year) === rocYear && Number(a.month) === month)
    .reduce((s, a) => s + (Number(a.hours) || 0), 0);
}
function sumMonthHours(records, name, rocYear, month, adjustments) {
  const base = (records || []).filter(r => r.name === name && r.status === "checked-out" && !r.attendanceDeleted
    && Number(r.year) === rocYear && Number(r.month) === month)
    .reduce((s, r) => s + (Number(r.hours) || 0), 0);
  return Math.round((base + sumMonthAdjust(adjustments, name, rocYear, month)) * 10) / 10;
}
// 產生月時數對照與預警攔截腳本（表單加 class 'assign-form'；下拉用 name=worker_id，逐列用 data-wid）
function assignWarnScript(hoursByWid) {
  return `<script>window.__WH=${calData(hoursByWid)};window.__WARNH=${HOURS_WARN};` +
    `(function(){document.addEventListener('submit',function(e){var f=e.target;if(!f.classList||!f.classList.contains('assign-form'))return;` +
    `var sel=f.querySelector('[name=worker_id]');var wid=sel?sel.value:f.getAttribute('data-wid');var h=(window.__WH||{})[wid]||0;` +
    `if(h>=window.__WARNH){if(!confirm('此工讀生本月已排 '+h+' 小時，已達 '+window.__WARNH+' 小時（可能涉及稅務）。仍要排課嗎？'))e.preventDefault();}},true);})();</script>`;
}

// ── 查詢是否有進行中的簽到（新系統，讀 ATT_FB）──
router.get("/active-session", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.status(403).json({ error: "unauthorized" });
  try {
    const data = await rgetAtt() || {};
    const entries = Object.entries(data)
      .filter(([, r]) => r.name === sess.display_name && r.status === "checked-in" && !r.attendanceDeleted)
      .map(([id, r]) => ({ id, r }))
      .sort((a, b) => new Date(b.r.checkinTime) - new Date(a.r.checkinTime));
    if (!entries.length) return res.json({ found: false });
    res.json({ found: true, sessionId: entries[0].id, record: entries[0].r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 簽到（三模式：一般／處方日／行政庶務）──
router.post("/checkin", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.status(403).json({ error: "unauthorized" });
  const name = sess.display_name;
  const mode = req.body.mode || "一般";
  try {
    const all = await rgetAtt() || {};
    const active = Object.values(all).some(r => r.name === name && r.status === "checked-in" && !r.attendanceDeleted);
    if (active) return res.status(409).json({ error: "你有尚未簽退的記錄，請先完成簽退" });

    const nowISO = new Date().toISOString();
    const record = { name, checkinTime: nowISO, status: "checked-in", checkinMode: mode, source: "schedule" };

    if (mode === "行政庶務") {
      Object.assign(record, rocFromDate(req.body.date) || todayROC());
      record.course = "行政庶務";
      record.workContent = (req.body.workContent || "").trim();
    } else if (mode === "處方日") {
      const prescDate = req.body.prescDate, prescRegion = req.body.prescRegion;
      if (!prescDate || !prescRegion) return res.status(400).json({ error: "缺少處方日資料" });
      // 驗證此工讀生確實被指派到這個處方日（日期＋分區）
      const assigned = await rget(`/presc_assignments/${prescDate}/${prescRegion}/${sess.id}`);
      if (!assigned) return res.status(403).json({ error: "你未被指派此處方日" });
      const cfg = await rget(`/presc_days/${prescDate}/${prescRegion}`) || {};
      const items = Array.isArray(cfg.items) ? cfg.items : [];
      Object.assign(record, rocFromDate(prescDate) || todayROC());
      record.region = prescRegion;
      record.schedDate = prescDate;
      record.course = `${prescRegion}處方日`;
      record.workContent = items.map(it => it.desc).filter(Boolean).join("；");
      // 工作項目欄以工作內容（每項一段）呈現
      record.courses = items.filter(it => it.desc).map(it => ({ course: it.desc, workContent: "" }));
      // 依此處方日「選定的課程」課表時間取首尾區間作為時數依據
      const prescIds = (cfg.courseIds || []);
      const dayCourses = prescIds.length
        ? (await allCourses()).filter(c => prescIds.includes(c.id))
        : (await allCourses()).filter(c => c.date === prescDate && c.region === prescRegion);
      if (dayCourses.length) {
        const starts = dayCourses.map(c => String(c.time_slot || "").split("-")[0].trim()).filter(Boolean).sort();
        const ends = dayCourses.map(c => { const p = String(c.time_slot || "").split("-"); return p[1] ? p[1].trim() : ""; }).filter(Boolean).sort();
        record.schedStart = starts[0] || "";
        record.schedEnd = ends[ends.length - 1] || "";
      }
    } else { // 一般
      const cmap = await coursesMap();
      const courses = (req.body.courseIds || []).map(id => cmap[id]).filter(Boolean).map(c => {
        const parts = String(c.time_slot || "").split("-").map(x => x.trim());
        return { course: c.course_name, region: c.region, date: c.date, start: parts[0] || "", end: parts[1] || "", workContent: "" };
      });
      if (!courses.length) return res.status(400).json({ error: "缺少課程資料" });
      courses.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      const first = courses[0], last = courses[courses.length - 1];
      Object.assign(record, rocFromDate(first.date) || todayROC());
      record.courses = courses;
      record.course = courses.map(c => c.course).filter(Boolean).join("、");
      record.workContent = courses.map(c => c.workContent).filter(Boolean).join("；");
      record.region = first.region || "";
      record.schedDate = first.date;
      record.schedStart = first.start;
      record.schedEnd = last.end;
    }
    const result = await rpostAtt(record);
    // 臨時人員（處方日）簽到 → 通知管理員
    if (mode === "處方日") {
      try {
        const adminIds = await getUserIdsByRole("admin");
        await sendPushToUsers(adminIds, {
          title: "臨時人員簽到",
          body: `${name} 已簽到　${record.region}處方日（${record.schedDate}）`,
          url: `${PREFIX}/admin/presc/${record.schedDate}/${encodeURIComponent(record.region)}`,
        });
      } catch (e) { console.error("[schedule] 處方日簽到通知失敗:", e.message); }
    }
    res.json({ ok: true, sessionId: result.name });
  } catch (e) { console.error("[schedule] checkin:", e.message); res.status(500).json({ error: e.message }); }
});

// ── 簽退（時數：有課表起訖時間者取首尾區間；否則實際時鐘、至少 1 小時）──
router.post("/checkout", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.status(403).json({ error: "unauthorized" });
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "缺少 sessionId" });
  try {
    const rec = await rgetAtt(`/${sessionId}`);
    if (!rec) return res.status(404).json({ error: "找不到簽到記錄" });
    if (rec.name !== sess.display_name) return res.status(403).json({ error: "unauthorized" });
    const now = new Date();
    const sMin = hhmmToMin(rec.schedStart), eMin = hhmmToMin(rec.schedEnd);
    let hours;
    if (sMin != null && eMin != null && eMin > sMin) {
      hours = Math.round((eMin - sMin) / 60 * 10) / 10; // 依課表首尾區間
    } else {
      hours = Math.max(1, Math.ceil((now - new Date(rec.checkinTime)) / 3600000)); // 行政庶務等
    }
    await rpatchAtt(`/${sessionId}`, {
      checkoutTime: now.toISOString(), status: "checked-out", hours,
      teacher: req.body.teacher || "",
      registeredCount: req.body.registeredCount ?? "",
      actualCount: req.body.actualCount ?? "",
      walkInCount: req.body.walkInCount ?? "",
      summary: req.body.summary || "",
    });
    res.json({ ok: true, hours });
  } catch (e) { console.error("[schedule] checkout:", e.message); res.status(500).json({ error: e.message }); }
});

// ── 出勤記錄清單 / 刪除（新系統後台用，讀寫 ATT_FB）──
router.get("/records", async (req, res) => {
  const sess = getSess(req);
  if (!sess) return res.status(403).json({ error: "unauthorized" });
  try {
    const data = await rgetAtt() || {};
    const records = Object.entries(data).map(([id, r]) => ({ id, ...r })).filter(r => !r.attendanceDeleted);
    res.json(records);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete("/records/:id", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.status(403).json({ error: "unauthorized" });
  try {
    await rpatchAtt(`/${req.params.id}`, { attendanceDeleted: true, deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 工讀生報名處方日（自行登記，額滿為止；toggle）──
router.post("/presc-signup/:date/:region", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  const { date, region } = req.params;
  const back = `${PREFIX}/dashboard?day=${date}`;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${back}&msg=csrf_err`);
  const wid = sess.id;
  const cur = await rget(`/presc_assignments/${date}/${region}/${wid}`);
  if (cur) { // 已報名 → 取消
    await rdel(`/presc_assignments/${date}/${region}/${wid}`);
    return res.redirect(`${back}&msg=presc_cancel`);
  }
  const cfg = await rget(`/presc_days/${date}/${region}`) || {};
  const needed = ((cfg.items) || []).reduce((s, it) => s + (Number(it.count) || 0), 0);
  const assignObj = await rget(`/presc_assignments/${date}/${region}`) || {};
  if (needed && Object.keys(assignObj).length >= needed) return res.redirect(`${back}&msg=presc_full`);
  await rput(`/presc_assignments/${date}/${region}/${wid}`, { assigned_at: nowTaipei(), self: true });
  res.redirect(`${back}&msg=presc_signup`);
});

// ══════════════════════════════════════════════
//  工讀生 Dashboard
// ══════════════════════════════════════════════
router.get("/dashboard", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  const wid = sess.id;

  const nf         = await nofollowSets();
  const courses    = (await allCourses()).filter(c => isFollow(c, nf) && c.date >= todayTaipei()); // 只顯示開放跟課
  const availAll   = await rget("/availability") || {};
  const assignAll  = await rget("/assignments") || {};

  // 處方日：讓工讀生看到當天各分區要做的工作內容（及自己是否被排入）
  const prescDays   = await rget("/presc_days") || {};
  const prescAssign = await rget("/presc_assignments") || {};
  const prescWork = {}, prescCal = {};
  for (const [date, regs] of Object.entries(prescDays)) {
    const parts = [];
    for (const [region, cfg] of Object.entries(regs || {})) {
      const items = (cfg && cfg.items) || [];
      const courseIds = (cfg && cfg.courseIds) || [];
      const assignObj = (prescAssign[date] || {})[region] || {};
      const assignedN = Object.keys(assignObj).length;
      const neededN = items.reduce((s, it) => s + (Number(it.count) || 0), 0);
      (prescCal[date] = prescCal[date] || {})[region] = { needed: neededN, assigned: assignedN, courseIds };
      if (!items.length && !courseIds.length) continue;
      const mine = !!assignObj[wid];
      const li = items.map(it => `${esc(it.desc)} ${Number(it.count) || 0}人`).join("、") || "（尚未設定工作項目）";
      const act = `/schedule/presc-signup/${date}/${encodeURIComponent(region)}`;
      let btn;
      if (mine) btn = `<form method='post' action='${act}' style='display:inline'>${hiddenCsrf(sess)}<button class='btn btn-sm btn-warn'>取消登記</button></form>`;
      else if (neededN && assignedN >= neededN) btn = `<button class='btn btn-sm btn-ghost' disabled>已額滿</button>`;
      else btn = `<form method='post' action='${act}' style='display:inline'>${hiddenCsrf(sess)}<button class='btn btn-sm btn-success'>我可以跟課</button></form>`;
      parts.push(
        `<div style='padding:12px 0;border-top:1px solid rgba(0,0,0,.06)'>` +
        `<div style='display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px'>` +
        `<span class='badge b-blue'>${esc(region)} 處方日</span>` +
        `<span class='badge b-gray'>已登記 ${assignedN}/${neededN} 人</span>` +
        (mine ? `<span class='badge b-green'>你已報名</span>` : "") +
        `<span style='margin-left:auto'>${btn}</span></div>` +
        `<div style='font-size:13px;color:var(--text)'>工作內容：${li}</div></div>`
      );
    }
    if (parts.length) prescWork[date] = `<div style='background:#f3e8ff;border-radius:8px;padding:2px 14px 6px'>${parts.join("")}</div>`;
  }

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
    `<script>window.__CAL=${calData({ role: "worker", prefix: PREFIX, csrf: hiddenCsrf(sess), courses: calCoursesWorker, prescByDate: prescCal, prescWork })}</script>` +
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
  let date = "";
  try {
    const c = (await coursesMap())[req.params.cid];
    date = c ? c.date : "";
    const adminIds = await getUserIdsByRole("admin");
    await sendPushToUsers(adminIds, {
      title: "工讀生報名跟課",
      body: `${sess.display_name} 報名：${c ? c.course_name : ""}（${c ? c.date : ""}）`,
      url: `${PREFIX}/admin/course/${req.params.cid}`,
    });
  } catch (e) { console.error("[schedule] 報名通知失敗:", e.message); }
  if (req.get("X-Requested-With") === "fetch") return res.sendStatus(204);
  res.redirect(`${PREFIX}/dashboard?msg=avail_on${date ? `&day=${date}` : ""}`);
});

router.post("/unavail/:cid", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "worker") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/dashboard?msg=csrf_err`);
  await rdel(`/availability/${req.params.cid}/${sess.id}`);
  if (req.get("X-Requested-With") === "fetch") return res.sendStatus(204);
  let date = "";
  try { const c = (await coursesMap())[req.params.cid]; date = c ? c.date : ""; } catch (_) {}
  res.redirect(`${PREFIX}/dashboard?msg=avail_off${date ? `&day=${date}` : ""}`);
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

  const srcCourses = await allCourses();          // 課程來源：週報系統 ＋ 自訂活動
  const availAll   = await rget("/availability") || {};
  const assignAll  = await rget("/assignments") || {};
  const users      = await getUsers();
  const nf         = await nofollowSets();
  const userById   = Object.fromEntries(users.map(u => [u.id, u]));
  // 處方日設定與排班（以 日期＋分區 為單位）
  const prescDays   = await rget("/presc_days") || {};        // {date:{region:{items:[{desc,count}]}}}
  const prescAssign = await rget("/presc_assignments") || {}; // {date:{region:{wid:{...}}}}
  const prescCal = {};
  for (const [date, regs] of Object.entries(prescDays)) {
    prescCal[date] = {};
    for (const [region, cfg] of Object.entries(regs || {})) {
      const needed = ((cfg && cfg.items) || []).reduce((s, it) => s + (Number(it.count) || 0), 0);
      const assigned = Object.keys(((prescAssign[date] || {})[region]) || {}).length;
      prescCal[date][region] = { needed, assigned, courseIds: (cfg && cfg.courseIds) || [] };
    }
  }

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
    `<div class='stat hl'><strong>${canOpen}</strong>可開課</div>` +
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
    custom: !!c.custom, over: !!c.time_overridden,
    avail_count: c.avail_count,
    enrolled: Number(c.enrolled) || 0, capacity: Number(c.capacity) || 0,
    assigned: Object.keys(assignAll[c.id] || {}).map(wid => (userById[wid] || {}).display_name).filter(Boolean),
  }));
  const timeOpts = (() => { let o = "<option value=''>--:--</option>"; for (let hh = 6; hh <= 22; hh++) for (let mm = 0; mm < 60; mm += 30) { const t = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; o += `<option value='${t}'>${t}</option>`; } return o; })();
  const addEventForm =
    `<details class='card' style='margin-bottom:14px'>` +
    `<summary style='cursor:pointer;font-weight:600'>＋ 新增臨時活動（不在週報系統中的活動也能找臨時人員）</summary>` +
    `<form method='post' action='${PREFIX}/admin/courses/add' style='margin-top:12px'>${csrf}` +
    `<div class='form-row cols-2'>` +
    `<div class='form-group'><label class='form-label'>活動名稱</label><input name='course_name' required placeholder='例：社區健康園遊會'></div>` +
    `<div class='form-group'><label class='form-label'>分區</label><select name='region'>${REGIONS.map(r => `<option value='${r}'>${r}</option>`).join("")}<option value='其他'>其他</option></select></div>` +
    `</div>` +
    `<div class='form-row cols-4'>` +
    `<div class='form-group'><label class='form-label'>日期</label><input type='date' name='date' required></div>` +
    `<div class='form-group'><label class='form-label'>開始</label><select name='start'>${timeOpts}</select></div>` +
    `<div class='form-group'><label class='form-label'>結束</label><select name='end'>${timeOpts}</select></div>` +
    `<div class='form-group'><label class='form-label'>類型</label><input name='prescription_type' placeholder='活動' value='活動'></div>` +
    `</div>` +
    `<div class='form-group'><label class='form-label'>地點</label><input name='location' placeholder='選填'></div>` +
    `<button class='btn btn-success'>新增活動</button>` +
    `</form></details>`;
  const availTab =
    `<div class='btn-row' style='margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap'>` +
    `<a href='${PREFIX}/admin/follow-settings' class='btn btn-primary'>🔧 跟課設定（勾選要開放跟課的課程）</a>` +
    `<a href='${PREFIX}/admin/fixed-followers' class='btn btn-ghost'>🔒 固定跟課人員</a>` +
    `<a href='${PREFIX}/admin/presc-setup' class='btn btn-ghost'>🗓 處方日設定（勾選課程組成處方日）</a>` +
    `</div>` +
    addEventForm +
    `<div class='card'>` +
    `<div class='card-title'>課程月曆</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:8px'>點日期可看當天課程、指派工讀生、設定處方日。</p>` +
    `<div id='cal-app'><p style='color:var(--light)'>載入中…</p></div>` +
    `</div>` +
    `<script>window.__CAL=${calData({ role: "admin", prefix: PREFIX, courses: calCoursesAdmin, prescByDate: prescCal, regions: REGIONS })}</script>` +
    CAL_CLIENT_JS;

  // Tab 3：工讀生
  // 每位工讀生「已指派課程」明細（含各堂時長）
  const slotHours = ts => {
    const p = String(ts || "").split("-").map(x => x.trim());
    const sm = hhmmToMin(p[0]), em = hhmmToMin(p[1]);
    return (sm != null && em != null && em > sm) ? Math.round((em - sm) / 60 * 10) / 10 : null;
  };
  const assignedByWid = {};
  for (const c of courses) {
    const m = assignAll[c.id] || {};
    for (const wid of Object.keys(m)) {
      if (!m[wid]) continue;
      (assignedByWid[wid] = assignedByWid[wid] || []).push(c);
    }
  }
  Object.values(assignedByWid).forEach(l => l.sort((a, b) => (a.date + a.time_slot).localeCompare(b.date + b.time_slot)));
  const detailFor = wid => {
    const list = assignedByWid[wid] || [];
    if (!list.length) return "";
    const totalH = Math.round(list.reduce((s, c) => s + (slotHours(c.time_slot) || 0), 0) * 10) / 10;
    const items = list.map(c => {
      const h = slotHours(c.time_slot);
      return `<tr>` +
        `<td style='white-space:nowrap;color:var(--muted)'>${esc(c.date)}</td>` +
        `<td style='white-space:nowrap;color:var(--muted)'>${c.time_slot ? esc(c.time_slot) : "未排定"}</td>` +
        `<td>${esc(c.course_name)}${c.custom ? " <span class='badge b-gray' style='font-size:10px'>臨時</span>" : ""}</td>` +
        `<td>${regionTag(c.region)}</td>` +
        `<td style='white-space:nowrap'>${h != null ? `<span class='badge b-blue'>${h} 時</span>` : "—"}</td></tr>`;
    }).join("");
    return `<tr class='detail-row'><td colspan='4' style='padding:0;background:#F7FAF9'>` +
      `<details style='padding:8px 14px'>` +
      `<summary style='cursor:pointer;font-size:13px;color:var(--muted)'>📋 已跟課程明細（${list.length} 堂・約 ${totalH} 時）</summary>` +
      `<table style='margin-top:8px'><thead><tr><th>日期</th><th>時段</th><th>課程</th><th>地區</th><th>時長</th></tr></thead>` +
      `<tbody>${items}</tbody></table>` +
      `</details></td></tr>`;
  };
  let workerRows = workers.map(w =>
    `<tr>` +
    `<td><span style='font-weight:500'>${esc(w.display_name)}</span></td>` +
    `<td style='color:var(--muted)'>${esc(w.username)}</td>` +
    `<td><span class='badge b-blue'>${w.assign_count} 堂</span></td>` +
    `<td style='white-space:nowrap'>` +
    `<a href='${PREFIX}/admin/workers/${w.id}/hours' class='btn btn-sm btn-primary'>時數調整</a> ` +
    `<a href='${PREFIX}/admin/workers/${w.id}/edit' class='btn btn-sm btn-ghost'>編輯</a> ` +
    `<form method='post' action='${PREFIX}/admin/workers/${w.id}/delete' style='display:inline'>` +
    `${csrf}` +
    `<button class='btn btn-sm btn-danger' onclick="return confirm('確定刪除帳號？')">刪除</button></form>` +
    `</td></tr>` +
    detailFor(w.id)
  ).join("");
  if (!workerRows) workerRows = "<tr><td colspan='4' style='text-align:center;color:var(--light);padding:24px'>尚無工讀生帳號</td></tr>";

  // Tab 4：密碼管理
  let pwTab =
    `<div class='card'>` +
    `<div class='card-title'>變更管理員密碼</div>` +
    `<form method='post' action='${PREFIX}/admin/change-password'>${csrf}` +
    `<div class='form-row cols-3'>` +
    `<div class='form-group'><label class='form-label'>目前密碼</label>` +
    `<input name='current_password' type='password' inputmode='numeric' maxlength='4' required autocomplete='current-password'></div>` +
    `<div class='form-group'><label class='form-label'>新密碼（4 位數字）</label>` +
    `<input name='new_password' type='password' inputmode='numeric' maxlength='4' pattern='\\d{4}' required autocomplete='new-password'></div>` +
    `<div class='form-group'><label class='form-label'>確認新密碼</label>` +
    `<input name='confirm_password' type='password' inputmode='numeric' maxlength='4' required autocomplete='new-password'></div>` +
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
    `<div class='btn-row' style='margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap'>` +
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
  const courses = await allCourses();
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
    ["全部", ...REGIONS].map((r, i) =>
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
  const courses = await allCourses();
  const groups = groupByName(courses, { slots: {} });
  const patch = {};
  for (const g of Object.values(groups)) {
    const open = openSet.has(nameKey(g.name));
    for (const slotId of g.slots) patch[slotId] = open ? null : true;
  }
  if (Object.keys(patch).length) await rpatch(`/nofollow_slots`, patch);
  res.redirect(`${PREFIX}/admin/follow-settings?msg=follow_saved`);
});

// ── 管理員：固定跟課人員（依課名設定，儲存後自動指派未來場次）──
router.get("/admin/fixed-followers", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  // 進頁時自動補齊：把已同步進來的新未來場次也套上固定人員
  try { await applyFixedFollowers(); } catch (e) { console.error("[schedule] applyFixedFollowers:", e.message); }

  const courses = await allCourses();
  const groups = Object.values(groupByName(courses, { slots: {} }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant"));
  const fixed = await rget("/fixed_followers") || {};
  const workers = (await getUsers()).filter(u => u.role === "worker")
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "zh-Hant"));

  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, "ok") : "";

  let rows;
  if (!groups.length) {
    rows = "<p style='padding:20px;text-align:center;color:var(--light)'>目前無課程</p>";
  } else if (!workers.length) {
    rows = "<p style='padding:20px;text-align:center;color:var(--light)'>尚無工讀生帳號，請先建立帳號。</p>";
  } else {
    rows = groups.map(g => {
      const key = nameKey(g.name);
      const cur = fixed[key] || {};
      const curNames = workers.filter(w => cur[w.id]).map(w => esc(w.display_name)).join("、") || "—";
      const boxes = workers.map(w =>
        `<label style='display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid var(--border);border-radius:16px;font-size:13px;cursor:pointer'>` +
        `<input type='checkbox' name='fx_${key}' value='${esc(w.id)}' ${cur[w.id] ? "checked" : ""} style='width:auto'>${esc(w.display_name)}</label>`
      ).join(" ");
      return `<details class='ff-row' data-name="${esc(String(g.name).toLowerCase())}" data-region="${esc(g.region)}" style='border-bottom:1px solid var(--border-l);padding:10px 8px'>` +
        `<summary style='cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px'>` +
        `<span style='flex:1'>${regionTag(g.region)} ${esc(g.name)} ${prescTag(g.type)}</span>` +
        `<span style='font-size:12px;color:var(--muted);white-space:nowrap'>固定：${curNames}</span></summary>` +
        `<div style='display:flex;flex-wrap:wrap;gap:8px;margin-top:10px'>${boxes}</div></details>`;
    }).join("");
  }

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin/follow-settings' class='btn btn-sm btn-ghost'>← 返回跟課設定</a></div>` +
    `${notice}` +
    `<div class='card'>` +
    `<div class='card-title'>固定跟課人員</div>` +
    `<p style='font-size:13px;color:var(--muted);margin-bottom:14px'>為固定由特定人員跟課的課程設定人員。以「課程名稱」為單位，儲存後會<b>自動指派給該課所有未來場次</b>（工讀生免報名、直接顯示「已指派」）；日後新同步進來的同名場次也會自動補上。取消勾選則會回收之前自動指派的未來場次。</p>` +
    `<form method='post' action='${PREFIX}/admin/fixed-followers'>${hiddenCsrf(sess)}` +
    `<div id='ff-region' style='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px'>` +
    `<span style='font-size:12px;color:var(--muted);margin-right:4px'>地區</span>` +
    ["全部", ...REGIONS].map((rg, i) =>
      `<button type='button' class='btn btn-sm ${i === 0 ? "btn-primary" : "btn-ghost"}' data-reg='${rg === "全部" ? "" : rg}'>${rg}</button>`).join("") +
    `</div>` +
    `<input type='text' id='ff-search' placeholder='🔍 搜尋課名...' style='width:100%;margin-bottom:12px'>` +
    `<div style='border:1px solid var(--border);border-radius:4px;max-height:60vh;overflow:auto'>${rows}</div>` +
    `<div style='margin-top:16px'><button class='btn btn-primary'>💾 儲存並自動指派</button>` +
    `<span style='font-size:12px;color:var(--light);margin-left:10px'>共 ${groups.length} 種課程</span></div>` +
    `</form></div>` +
    `<script>(function(){` +
    `var s=document.getElementById('ff-search');var rbar=document.getElementById('ff-region');var reg='';` +
    `function apply(){var q=s.value.trim().toLowerCase();document.querySelectorAll('.ff-row').forEach(function(r){` +
    `var okName=(!q||r.getAttribute('data-name').indexOf(q)>=0);var okReg=(!reg||r.getAttribute('data-region')===reg);` +
    `r.style.display=(okName&&okReg)?'':'none';});}` +
    `s.addEventListener('input',apply);` +
    `rbar.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){` +
    `rbar.querySelectorAll('button').forEach(function(x){x.className='btn btn-sm btn-ghost';});b.className='btn btn-sm btn-primary';` +
    `reg=b.getAttribute('data-reg');apply();});});` +
    `})();</script>`;
  res.send(layout("固定跟課人員", body, sess));
});

router.post("/admin/fixed-followers", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/fixed-followers?msg=csrf_err`);
  const courses = await allCourses();
  const groups = Object.values(groupByName(courses, { slots: {} }));
  const next = {};
  for (const g of groups) {
    const key = nameKey(g.name);
    let sel = req.body[`fx_${key}`];
    if (sel === undefined) continue;
    sel = [].concat(sel).filter(Boolean);
    if (sel.length) { const o = {}; sel.forEach(w => { o[w] = true; }); next[key] = o; }
  }
  await rput("/fixed_followers", next);
  let result = { added: [], removed: 0 };
  try { result = await applyFixedFollowers(); } catch (e) { console.error("[schedule] applyFixedFollowers:", e.message); }
  // 對新指派的人員推播（失敗不影響）
  try {
    const cmap = await coursesMap();
    for (const a of result.added) {
      const c = cmap[a.cid];
      await sendPushToWorker(a.wid, {
        title: "固定跟課指派",
        body: c ? `${c.course_name}（${c.date} ${c.time_slot}）已固定排入你` : "你有新的固定跟課指派",
        url: `${PREFIX}/home`,
      });
    }
  } catch (e) { console.error("[schedule] fixed push:", e.message); }
  res.redirect(`${PREFIX}/admin/fixed-followers?msg=fixed_saved`);
});

// ── 管理員：課程月曆 ──
router.get("/admin/calendar", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  try { await applyFixedFollowers(); } catch (e) { console.error("[schedule] applyFixedFollowers:", e.message); }
  const month = req.query.month || todayTaipei().slice(0, 7);
  const day = req.query.day || "";
  const nf = await nofollowSets();
  const availAll = await rget("/availability") || {};
  const assignAll = await rget("/assignments") || {};
  const courses = (await allCourses()).map(c => {
    const f = isFollow(c, nf);
    const ac = Object.keys(assignAll[c.id] || {}).length;
    return { ...c, follow: f, _need: f, _done: ac > 0, avail_count: Object.keys(availAll[c.id] || {}).length, assign_count: ac };
  });
  const grid = calendarGrid(courses, month, `${PREFIX}/admin/calendar`, day, { assign: true });
  let dayHtml = "";
  if (day) {
    const dayAll = courses.filter(c => c.date === day).sort((a, b) => a.time_slot.localeCompare(b.time_slot));
    // 不跟課的課程隱藏（不需排工讀生），但「已有指派」的課即使不跟課也保留（才能管理該指派）
    const list = dayAll.filter(c => c.follow || c.assign_count > 0);
    const hiddenNF = dayAll.length - list.length;
    const nfHint = hiddenNF > 0
      ? `<p style='font-size:11px;color:var(--light);margin:0 0 8px'>已隱藏 ${hiddenNF} 堂「不跟課」的課程。需要的話可到 <a href='${PREFIX}/admin/follow-settings'>跟課設定</a> 開放。</p>`
      : "";
    if (list.length) {
      const rows = list.map(c =>
        `<tr>` +
        `<td style='white-space:nowrap;color:var(--muted)'>${esc(c.time_slot)}</td>` +
        `<td>${esc(c.course_name)}${c.follow ? "" : " <span class='badge b-gray' style='font-size:10px'>不跟課</span>"}</td>` +
        `<td>${regionTag(c.region)}</td>` +
        `<td>${prescTag(c.prescription_type)}</td>` +
        `<td>${c.avail_count ? `<span class='badge b-blue'>${c.avail_count}</span>` : "—"} ${c.assign_count ? `<span class='badge b-green'>✓ ${c.assign_count}</span>` : ""}</td>` +
        `<td><a href='${PREFIX}/admin/course/${c.id}' class='btn btn-sm btn-ghost'>查看</a></td></tr>`
      ).join("");
      dayHtml = `<div class='card'><div class='card-title'>${esc(day)}（週${weekdayStr(day)}）課程</div>` +
        nfHint +
        `<table><thead><tr><th>時段</th><th>課程</th><th>地區</th><th>類型</th><th>報名/指派</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else {
      dayHtml = `<div class='card'>${nfHint}<p style='color:var(--light);text-align:center;padding:20px'>${hiddenNF > 0 ? `${esc(day)} 課程皆設為「不跟課」，已隱藏` : `${esc(day)} 無課程`}</p></div>`;
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
  const courses = (await allCourses()).filter(c => isFollow(c, nf) && c.date >= todayTaipei())
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

  // 單人時數表（列印用）：選一位工讀生 + 年月，下載他當月的出勤時數表
  const roc = todayROC() || { year: new Date().getFullYear() - 1911, month: 1 };
  const workers = (await getUsers()).filter(u => u.role === "worker" && u.display_name)
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "zh-Hant"));
  const workerOpts = workers.map(w => `<option value='${esc(w.display_name)}'>${esc(w.display_name)}</option>`).join("");
  const monthSel = Array.from({ length: 12 }, (_, i) => `<option value='${i + 1}'${i + 1 === roc.month ? " selected" : ""}>${i + 1}月</option>`).join("");
  const singleCard = workers.length
    ? `<div class='card'>` +
      `<div class='card-title'>🧾 單人時數表（列印／存檔用）</div>` +
      `<p style='font-size:13px;color:var(--muted);margin-bottom:12px'>選一位工讀生與年月，下載他當月的出勤時數表（Excel，版面同「臨時人員出勤記錄」範例，含金額／簽名列）。</p>` +
      `<form method='get' action='${PREFIX}/export' style='display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap'>` +
      `<div class='form-group' style='flex:1;min-width:160px'><label class='form-label'>工讀生</label><select name='name' required>${workerOpts}</select></div>` +
      `<div class='form-group'><label class='form-label'>年份（民國）</label><input name='year' type='number' value='${roc.year}' required style='width:100px'></div>` +
      `<div class='form-group'><label class='form-label'>月份</label><select name='month' required>${monthSel}</select></div>` +
      `<button class='btn btn-success'>📥 下載時數表</button></form></div>`
    : `<div class='card'><div class='card-title'>🧾 單人時數表</div><p style='color:var(--light);font-size:13px'>目前沒有工讀生帳號。</p></div>`;

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin' class='btn btn-sm btn-ghost'>← 返回後台</a></div>` +
    `<div id='att-app'>` +
    singleCard +
    `<div class='card'>` +
    `<div class='card-title'>出勤與工時</div>` +
    `<div class='form-row cols-4' style='align-items:end'>` +
    `<div class='form-group'><label class='form-label'>年份（民國）</label><input id='f-year' type='number' placeholder='115'></div>` +
    `<div class='form-group'><label class='form-label'>月份</label><select id='f-month'>${monthOpts}</select></div>` +
    `<div class='form-group'><label class='form-label'>姓名</label><input id='f-name' placeholder='搜尋姓名'></div>` +
    `<div class='form-group' style='flex-direction:row;gap:8px'>` +
    `<button class='btn btn-primary' id='btn-search'>搜尋</button>` +
    `<button class='btn btn-success' id='btn-export'>📥 下載時數表 Excel</button></div>` +
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

// ── 時數表 Excel（版面 100% 比照範例「臨時人員出勤記錄」，含下半部金額/勞健保/簽名）──
// 台北時間 HH:MM
function fmtTimeTP(iso) {
  try {
    return new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return ""; }
}
// 台北時間 24 小時制 "HH:MM"
function clock24TP(iso) {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return ""; }
}
// "HH:MM"（24 時制）或已是 12 時制 → 範例的「上午/下午HH:MM」格式
function to12CN(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return String(t || "");
  let h = +m[1];
  const ap = h < 12 ? "上午" : "下午";
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return ap + String(h12).padStart(2, "0") + ":" + m[2];
}
// 時數表下半部金額列：A 留白、B..G 合併放標籤、H 放金額（可為公式或留空）
function moneyRow(ws, r, label, valueOrNull, tk, bdr, CUR) {
  const mid = { horizontal: "center", vertical: "middle" };
  for (let c = 1; c <= 8; c++) ws.getCell(r, c).style = { font: tk, alignment: mid, border: bdr };
  ws.mergeCells(r, 2, r, 7);
  const lab = ws.getCell(r, 2);
  lab.value = label;
  lab.style = { font: tk, alignment: { horizontal: "left", vertical: "middle" }, border: bdr };
  const val = ws.getCell(r, 8);
  if (valueOrNull !== null && valueOrNull !== undefined) val.value = valueOrNull;
  val.style = { font: tk, alignment: { horizontal: "right", vertical: "middle" }, border: bdr, numFmt: CUR };
}
function safeSheetName(wb, name) {
  // 移除 Excel 不允許的字元，限制 31 字
  let base = (name || "無名").replace(/[\\/?*[\]:]/g, "").slice(0, 31).trim() || "無名";
  const exists = () => wb.worksheets.some(ws => ws.name.toLowerCase() === base.toLowerCase());
  let i = 2;
  const orig = base;
  while (exists()) base = orig.slice(0, 29) + "_" + (i++);
  return base;
}
// 建立單一人員工作表（版面 100% 比照範例「臨時人員出勤記錄」，欄位 A~H）
function buildPersonSheet(wb, personName, records, workDescByName) {
  const ws = wb.addWorksheet(safeSheetName(wb, personName));

  const bdr  = { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} };
  const mid  = { horizontal:"center", vertical:"middle" };
  const lmid = { horizontal:"left",   vertical:"middle", wrapText:true };
  const tk   = { name:"DFKai-SB", size:12, charset:136 };
  const CUR  = '_-"$"* #,##0_-;\\-"$"* #,##0_-;_-"$"* "-"??_-;_-@_-';

  // 欄寬 A..H（比照範例：A編號 B年 C月 D日 E工作項目 F時分 G至時分 H共計）
  [6.141, 8, 6, 6.355, 32, 11.855, 12, 12.355].forEach((w, i) => { ws.getColumn(i+1).width = w; });

  // Row 1 大標題 A1:H1
  ws.mergeCells("A1:H1");
  ws.getRow(1).height = 22;
  ws.getCell("A1").value = "健康台灣深耕計畫專職人員出勤記錄表";
  ws.getCell("A1").style = { font:{...tk, size:14, bold:true}, alignment:mid };

  // Row 2 副標題 A2:H2
  ws.mergeCells("A2:H2");
  ws.getRow(2).height = 24;
  ws.getCell("A2").value = "臨時人員出勤記錄與工作內容說明";
  ws.getCell("A2").style = { font:{...tk, size:13, bold:true}, alignment:mid };

  // Row 3 姓名 + 工作內容 — 先設所有格子邊框再合併
  ws.getRow(3).height = 20.1;
  for (let c = 1; c <= 8; c++) ws.getCell(3, c).style = { font:tk, alignment:mid, border:bdr };
  ws.mergeCells("B3:D3");
  ws.mergeCells("F3:H3");
  ws.getCell("A3").value = "姓名";
  ws.getCell("B3").value = personName;
  ws.getCell("E3").value = "工作內容";
  // 工作內容：優先取出勤記錄上的 workDescription，否則取報名資料上的工作內容
  const workDesc = records.find(r => r.workDescription)?.workDescription
    || (workDescByName && workDescByName[personName]) || "";
  ws.getCell("F3").value = workDesc;
  ws.getCell("F3").style = { font:tk, alignment:lmid, border:bdr };

  // Row 4 欄位標題
  ws.getRow(4).height = 19;
  ["編號", "年", "月", "日", "工作項目", "時　分", "至時 分", "共計(時)"].forEach((h, i) => {
    const cell = ws.getCell(4, i+1);
    cell.value = h;
    cell.style = { font:tk, alignment:mid, border:bdr };
  });

  // 資料列（列高不設，讓 Excel 依工作項目自動撐開）
  const dataStart = 5;
  records.forEach((r, idx) => {
    const rn  = dataStart + idx;
    // 時分／至時分：有課表起訖時間（一般／處方日）優先，否則用實際簽到退時鐘；一律轉「上午/下午HH:MM」
    const ci  = to12CN(r.schedStart || clock24TP(r.checkinTime));
    const co  = to12CN(r.schedEnd   || clock24TP(r.checkoutTime));
    // 工作項目：多堂課以「；」合併，每堂顯示「課名（工作內容）」；單堂則取課名，行政庶務取工作內容
    let workItem;
    if (Array.isArray(r.courses) && r.courses.length > 0) {
      workItem = r.courses.map(c => {
        const nm = typeof c === "object" ? (c.course || "") : c;
        const wc = typeof c === "object" ? (c.workContent || "") : "";
        return wc ? `${nm}（${wc}）` : nm;
      }).filter(Boolean).join("；");
    } else {
      workItem = r.course || r.workContent || "";
    }
    const row = [idx+1, r.year, r.month, r.day, workItem, ci, co, r.hours];
    row.forEach((v, i) => {
      const cell = ws.getCell(rn, i+1);
      cell.value = v;
      cell.style = { font:tk, alignment: i === 4 ? lmid : mid, border:bdr };
    });
    // 依工作項目長度估算換行數設列高（可讀優先：單行 19，每多一行約 +17；E 欄寬 32 每行約 28 顯示寬）
    const dispW = [...String(workItem)].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
    const wrapLines = Math.max(1, Math.ceil(dispW / 28));
    ws.getRow(rn).height = wrapLines <= 1 ? 19 : 19 + (wrapLines - 1) * 17;
  });

  const n = records.length;
  const lastData = dataStart + n - 1;

  // 累計列：A..G 合併「累計」，H = SUM
  let r = dataStart + n;
  ws.getRow(r).height = 19;
  for (let c = 1; c <= 8; c++) ws.getCell(r, c).style = { font:{...tk, bold:true}, alignment:mid, border:bdr };
  ws.mergeCells(r, 1, r, 7);
  ws.getCell(r, 1).value = "累計";
  const totCell = ws.getCell(r, 8);
  totCell.value = n > 0 ? { formula: `SUM(H${dataStart}:H${lastData})` } : 0;
  totCell.style = { font:{...tk, bold:true}, alignment:mid, border:bdr };
  const totRow = r;

  // 金額（工作時數*300）
  r++; ws.getRow(r).height = 19;
  moneyRow(ws, r, "金額(工作時數*300)元", { formula: `300*H${totRow}` }, tk, bdr, CUR);
  const amtRow = r;
  // 自付勞保+職災費用（留空由承辦人填）
  r++; ws.getRow(r).height = 19;
  moneyRow(ws, r, "自付勞保+職災費用", null, tk, bdr, CUR);
  const laborRow = r;
  // 自付健保費用（留空）
  r++; ws.getRow(r).height = 19;
  moneyRow(ws, r, "自付健保費用", null, tk, bdr, CUR);
  const healthRow = r;
  // 非富邦銀行匯費（留空）
  r++; ws.getRow(r).height = 19;
  moneyRow(ws, r, "非富邦銀行匯費", null, tk, bdr, CUR);
  const feeRow = r;
  // 臨時工資支領薪餉 = 金額 - 勞保 - 健保 - 匯費（空白視為 0）
  r++; ws.getRow(r).height = 19;
  moneyRow(ws, r, "臨時工資支領薪餉", { formula: `H${amtRow}-H${laborRow}-H${healthRow}-H${feeRow}` }, tk, bdr, CUR);

  // 簽名列：A:B「簽名」，C:H 留白供簽名
  r++; ws.getRow(r).height = 26;
  for (let c = 1; c <= 8; c++) ws.getCell(r, c).style = { font:tk, alignment:mid, border:bdr };
  ws.mergeCells(r, 1, r, 2);
  ws.getCell(r, 1).value = "簽名";
  ws.getCell(r, 1).style = { font:{...tk, size:14, bold:true}, alignment:mid, border:bdr };
  ws.mergeCells(r, 3, r, 8);
}

// ── 管理員：下載時數 Excel（GET /schedule/export?year=&month=&name=）──
router.get("/export", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const { name: nameFilter, month: monthFilter, year: yearFilter } = req.query;
  try {
    const data = await rgetAtt();
    let records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    if (nameFilter)  records = records.filter(r => r.name  === nameFilter);
    if (monthFilter) records = records.filter(r => r.month === parseInt(monthFilter));
    if (yearFilter)  records = records.filter(r => r.year  === parseInt(yearFilter));
    records = records.filter(r => r.status === "checked-out" && !r.attendanceDeleted);
    records.sort((a, b) => new Date(a.checkinTime) - new Date(b.checkinTime));

    // 報名資料的工作內容（依姓名對應，供工作內容欄補值）
    const workDescByName = {};
    (await regUsersGet()).forEach(u => { if (u.name && u.workDescription) workDescByName[u.name] = u.workDescription; });

    // 按人分組
    const byPerson = {};
    records.forEach(r => {
      if (!byPerson[r.name]) byPerson[r.name] = [];
      byPerson[r.name].push(r);
    });

    const wb = new ExcelJS.Workbook();
    if (Object.keys(byPerson).length === 0) {
      buildPersonSheet(wb, nameFilter || "無記錄", [], workDescByName);
    } else {
      for (const [pname, pRecords] of Object.entries(byPerson)) {
        buildPersonSheet(wb, pname, pRecords, workDescByName);
      }
    }

    const fileName = `臨時人員出勤記錄_${yearFilter || ""}年${monthFilter ? monthFilter + "月" : ""}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("[schedule] export:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 管理員：文件匯出（簽到單 / 申請單）──
router.get("/admin/docs", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const courses = await allCourses();
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
    `<div class='form-row cols-2'>` +
    `<div class='form-group'><label class='form-label'>開始時間</label><input id='sa-start' type='time'></div>` +
    `<div class='form-group'><label class='form-label'>結束時間</label><input id='sa-end' type='time'></div>` +
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
  // 尚無領據資料的工讀生（依姓名比對報名資料）
  const infoNames = new Set((await regUsersGet()).map(u => u.name).filter(Boolean));
  const noInfoCount = workers.filter(w => !infoNames.has(w.display_name)).length;

  // 廣播紀錄
  const history = await getBroadcasts();
  const histRows = history.map(b => {
    const names = Array.isArray(b.recipientNames) ? b.recipientNames.filter(Boolean) : [];
    const cnt = names.length || (Array.isArray(b.recipientIds) ? b.recipientIds.length : 0);
    const who = names.length > 6
      ? `${esc(names.slice(0, 6).join("、"))} 等 ${cnt} 人`
      : (names.length ? esc(names.join("、")) : `${cnt} 人`);
    return `<div style='padding:12px 0;border-bottom:1px solid var(--border)'>` +
      `<div style='font-size:12px;color:var(--muted);margin-bottom:4px'>${esc(fmtDateTime(b.sentAt))}　·　收件：${who}</div>` +
      `<div style='font-size:14px;line-height:1.6;white-space:pre-wrap'>${msgToHtml(b.message)}</div>` +
      `</div>`;
  }).join("");
  const historyCard =
    `<div class='card'><div class='card-title'>📜 廣播紀錄</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:6px'>過去發送的通知內容都會保留在這裡，工讀生也可在「系統公告」頁看到收到的訊息。</p>` +
    (histRows || "<p style='text-align:center;color:var(--light);padding:24px 0;font-size:13px'>尚無發送紀錄</p>") +
    `</div>`;
  const rows = workers.map(w => {
    const noInfo = !infoNames.has(w.display_name);
    return `<label class='nt-row fs-row' data-noinfo='${noInfo ? 1 : 0}' style='gap:10px;padding:8px'><input type='checkbox' name='ids' value='${esc(w.id)}' style='width:auto;flex:none'><span style='flex:1'>${esc(w.display_name)}</span>` +
      (noInfo ? `<span class='badge b-warn' style='font-size:11px'>尚無資料</span>` : "") + `</label>`;
  }).join("");
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
    `<a href='#' id='nt-all' class='btn btn-sm btn-ghost'>全選</a><a href='#' id='nt-none' class='btn btn-sm btn-ghost'>全不選</a>` +
    (noInfoCount ? `<a href='#' id='nt-noinfo' class='btn btn-sm btn-warn'>勾選尚無資料者（${noInfoCount}）</a>` : "") + `</div>` +
    `<div style='border:1px solid var(--border);border-radius:4px;max-height:40vh;overflow:auto;margin-bottom:12px'>${rows || "<p style='padding:12px;color:var(--light)'>尚無工讀生</p>"}</div>` +
    `<label style='display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:14px'><input type='checkbox' name='askInfo' value='1' style='width:auto'>附上「填寫資料」連結（請對方補領據資料）</label>` +
    `<button class='btn btn-primary'>🔔 發送通知</button></form></div>` +
    `${historyCard}` +
    `<script>(function(){var s=document.getElementById('nt-search');if(!s)return;s.addEventListener('input',function(){var q=s.value.trim().toLowerCase();document.querySelectorAll('.nt-row').forEach(function(r){r.style.display=(!q||r.querySelector('span').textContent.toLowerCase().indexOf(q)>=0)?'':'none';});});document.getElementById('nt-all').addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.nt-row').forEach(function(r){if(r.style.display!=='none')r.querySelector('input').checked=true;});});document.getElementById('nt-none').addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.nt-row').forEach(function(r){if(r.style.display!=='none')r.querySelector('input').checked=false;});});var ni=document.getElementById('nt-noinfo');if(ni)ni.addEventListener('click',function(e){e.preventDefault();document.querySelectorAll('.nt-row').forEach(function(r){r.querySelector('input').checked=(r.getAttribute('data-noinfo')==='1');});});})();</script>`;
  res.send(layout("發送通知", body, sess));
});
router.post("/admin/notify", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/notify?msg=csrf_err`);
  const message = (req.body.message || "").trim();
  const ids = [].concat(req.body.ids || []);
  const askInfo = req.body.askInfo === "1";
  if (!message || !ids.length) return res.redirect(`${PREFIX}/admin/notify?msg=notify_need`);
  // 先存檔（即使推播失敗，內容仍可在紀錄查到）
  try {
    const nameById = Object.fromEntries((await getUsers()).map(u => [u.id, u.display_name]));
    await rpost("/broadcasts", {
      message,
      recipientIds: ids,
      recipientNames: ids.map(id => nameById[id]).filter(Boolean),
      sentBy: sess.display_name || "管理員",
      sentAt: new Date().toISOString(),
      askInfo,
    });
  } catch (e) { console.error("[schedule] 廣播存檔失敗:", e.message); }
  try {
    await sendPushToUsers(ids, { title: "系統通知", body: message, url: `${PREFIX}${askInfo ? "/my-info" : "/messages"}` });
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
  // 帳號狀態：報名資料中的人是否已有登入帳號（依姓名比對工讀生帳號）
  const acctNames = new Set((await getUsers()).filter(u => u.role === "worker").map(u => u.display_name));
  const hasAcct = u => !!u.name && acctNames.has(u.name);
  const missingCount = users.filter(u => u.name && !hasAcct(u) && String(u.idNumber || "").length >= 4).length;
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
      `<td style='white-space:nowrap'>${hasAcct(u) ? "<span class='badge b-green'>已有帳號</span>" : "<span class='badge b-gray'>尚無帳號</span>"}</td>` +
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
    (missingCount
      ? `<form method='post' action='${PREFIX}/admin/users/create-accounts' style='display:inline' onsubmit="return confirm('將為 ${missingCount} 位尚無帳號的報名者建立登入帳號（帳號＝姓名，密碼＝身分證後4碼）？')">${csrf}<button class='btn btn-sm btn-primary'>🔑 為尚無帳號者建立登入帳號（${missingCount}）</button></form>`
      : `<span class='badge b-green'>所有報名者皆已有帳號</span>`) +
    `<span style='font-size:12px;color:var(--light)'>含身分證、匯款等個資，僅管理員可見</span>` +
    `</div>` +
    `<div style='overflow-x:auto'>` +
    `<table style='min-width:1100px'><thead><tr>` +
    `<th>#</th><th>姓名</th><th>帳號</th><th>身分證</th><th>電話</th><th>事由名稱</th><th>工作內容</th><th>費用別</th><th>領款方式</th><th>匯款資訊</th><th>戶籍地址</th><th>居住地址</th><th>註冊時間</th><th></th>` +
    `</tr></thead><tbody>${rows || "<tr><td colspan='14' style='text-align:center;color:var(--light);padding:24px'>尚無註冊使用者</td></tr>"}</tbody></table>` +
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
// ── 為報名資料中尚無登入帳號者批次建立帳號（帳號＝姓名，密碼＝身分證後4碼）──
router.post("/admin/users/create-accounts", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/users?msg=csrf_err`);
  try {
    const regUsers = await regUsersGet();
    const acctNames = new Set((await getUsers()).filter(u => u.role === "worker").map(u => u.display_name));
    let created = 0, skipped = 0;
    for (const u of regUsers) {
      const name = (u.name || "").trim();
      const id4 = String(u.idNumber || "").slice(-4);
      if (!name || acctNames.has(name)) continue;
      if (id4.length < 4) { skipped++; continue; } // 無身分證無法設定預設密碼
      await rpost("/users", { username: name, password_hash: hp(id4), display_name: name, role: "worker" });
      acctNames.add(name); // 避免同批同名重複建立
      created++;
    }
    res.redirect(`${PREFIX}/admin/users?msg=${encodeURIComponent(`已建立 ${created} 個帳號${skipped ? `，${skipped} 位因缺身分證跳過` : ""}`)}`);
  } catch (e) {
    console.error("[schedule] create-accounts:", e.message);
    res.redirect(`${PREFIX}/admin/users?msg=帳號建立失敗`);
  }
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
  const start = (b.start || "").trim(), end = (b.end || "").trim();
  const time_slot = (start && end) ? `${start} - ${end}` : (b.time_slot || "").trim();
  await rpost("/courses", {
    course_name: (b.course_name || "").trim(),
    prescription_type: (b.prescription_type || "活動").trim(),
    date: b.date || "",
    time_slot,
    location: (b.location || "").trim(),
    region: (b.region || "").trim() || resolveRegion(b.course_name, b.location, null),
    capacity: parseInt(b.capacity, 10) || 0,
    enrolled: parseInt(b.enrolled, 10) || 0,
    custom: true,
    imported_at: nowTaipei(),
  });
  res.redirect(`${PREFIX}/admin?msg=course_added&tab=avail`);
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

  // 稅務預警：計算每位工讀生在本課程當月的累計時數（含手動時數調整）
  const attRecords = Object.values(await rgetAtt() || {});
  const adjustAll = await getHoursAdjust();
  const cRoc = rocFromDate(course.date) || todayROC();
  const hoursByWid = {};
  users.forEach(u => { if (u.role === "worker") hoursByWid[u.id] = sumMonthHours(attRecords, u.display_name, cRoc.year, cRoc.month, adjustAll); });
  const hLabel = wid => { const h = hoursByWid[wid] || 0; return h >= HOURS_WARN ? `（本月 ${h} 時 ⚠）` : `（本月 ${h} 時）`; };

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
        act = `<form method='post' action='${PREFIX}/admin/assign/${cid}/${w.id}' class='assign-form' data-wid='${esc(w.id)}' style='display:inline'>` +
          `${csrf}<button class='btn btn-sm btn-success'>確認指派</button></form>`;
      }
      const hh = hoursByWid[w.id] || 0;
      return `<tr><td><span style='font-weight:500'>${esc(w.display_name)}</span></td>` +
        `<td style='color:var(--muted)'>${esc(w.username)}</td>` +
        `<td style='color:${hh >= HOURS_WARN ? "#c0392b" : "var(--muted)"};font-size:12px'>本月 ${hh} 時${hh >= HOURS_WARN ? " ⚠" : ""}</td>` +
        `<td>${act}</td></tr>`;
    }).join("");
    availTable = `<table><thead><tr><th>姓名</th><th>帳號</th><th>本月時數</th><th></th></tr></thead>` +
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
    const opts = assignable.map(w => `<option value='${esc(w.id)}'>${esc(w.display_name)}${hLabel(w.id)}</option>`).join("");
    manual +=
      `<form method='post' action='${PREFIX}/admin/assign/${cid}/0' class='assign-form' style='display:flex;gap:10px;align-items:flex-end'>` +
      `${csrf}` +
      `<div class='form-group' style='flex:1'><label class='form-label'>選擇工讀生（僅列出已報名者）</label>` +
      `<select name='worker_id'>${opts}</select></div>` +
      `<button class='btn btn-primary' style='align-self:flex-end'>指派</button></form>`;
  } else {
    manual += "<p style='color:var(--light);font-size:13px'>目前沒有可指派的報名者（尚無人報名，或報名者皆已指派）。</p>";
  }
  // 直接指派任何工讀生（臨時改指派／忘了排先跟了，不需先登記「我可以跟課」）
  const allAssignable = users.filter(u => u.role === "worker" && !assignMap[u.id])
    .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "zh-Hant"));
  manual += `<hr class='divider'><div class='card-title'>直接指派工讀生（不需先登記）</div>`;
  if (allAssignable.length) {
    const opts2 = allAssignable.map(w => `<option value='${esc(w.id)}'>${esc(w.display_name)}（${esc(w.username)}）${hLabel(w.id)}</option>`).join("");
    manual +=
      `<form method='post' action='${PREFIX}/admin/assign/${cid}/0' class='assign-form' style='display:flex;gap:10px;align-items:flex-end'>` +
      `${csrf}<div class='form-group' style='flex:1'><label class='form-label'>選擇工讀生（全部帳號）</label>` +
      `<select name='worker_id'>${opts2}</select></div>` +
      `<button class='btn btn-success' style='align-self:flex-end'>指派</button></form>`;
  } else {
    manual += "<p style='color:var(--light);font-size:13px'>所有工讀生皆已指派此課。</p>";
  }

  // 課程時間卡（老師拖堂／臨時異動）
  const tsParts = String(course.time_slot || "").split("-").map(s => s.trim());
  const timeSel = (nm, selv) => { let o = "<option value=''>--:--</option>"; for (let hh = 6; hh <= 22; hh++) for (let mm = 0; mm < 60; mm += 30) { const t = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; o += `<option value='${t}'${t === selv ? " selected" : ""}>${t}</option>`; } return `<select name='${nm}'>${o}</select>`; };
  const timeCard =
    `<div class='card'><div class='card-title'>課程時間（老師拖堂／臨時異動）</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:10px'>目前：${esc(course.time_slot)}${course.time_overridden ? " <span style='color:#f59e0b'>（已調整）</span>" : ""}。修改只存在本系統、不會被週報／n8n 覆蓋，並影響月曆顯示與之後簽到的時數計算。</p>` +
    `<form method='post' action='${PREFIX}/admin/course/${cid}/time' style='display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap'>${csrf}` +
    `<div class='form-group'><label class='form-label'>開始</label>${timeSel("start", tsParts[0])}</div>` +
    `<div class='form-group'><label class='form-label'>結束</label>${timeSel("end", tsParts[1])}</div>` +
    `<button class='btn btn-primary' style='align-self:flex-end'>儲存時間</button></form>` +
    (course.time_overridden ? `<form method='post' action='${PREFIX}/admin/course/${cid}/time-reset' style='margin-top:8px'>${csrf}<button class='btn btn-sm btn-ghost'>還原為原始時間</button></form>` : "") +
    `</div>`;

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

  // 目前已指派名單（含「直接指派」而未登記報名者）；可逐一移除以便改派，移除時 unassign 路由會自動推播取消通知
  const assignedList = Object.keys(assignMap)
    .map(wid => ({ id: wid, ...(userById[wid] || {}), meta: assignMap[wid] || {} }))
    .sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || ""), "zh-Hant"));
  let assignedCard = `<div class='card'><div class='card-title'>目前已指派（${assignedList.length} 人）</div>`;
  if (assignedList.length) {
    assignedCard +=
      `<p style='font-size:12px;color:var(--muted);margin-bottom:10px'>要改派其他人時，先在這裡移除原本指派的工讀生（系統會自動推播「跟課指派已取消」通知給他），再於下方重新指派。</p>`;
    const rows = assignedList.map(w => {
      const nm = w.display_name ? esc(w.display_name) : `<span style='color:var(--light)'>(未知帳號 ${esc(w.id)})</span>`;
      const fixedTag = w.meta && w.meta.fixed ? ` <span class='badge b-gray'>固定跟課</span>` : "";
      return `<tr><td><span style='font-weight:500'>${nm}</span>${fixedTag}</td>` +
        `<td style='color:var(--muted)'>${esc(w.username || "")}</td>` +
        `<td><form method='post' action='${PREFIX}/admin/unassign/${cid}/${w.id}' style='display:inline' ` +
        `onsubmit="return confirm('確定移除此工讀生的指派？系統會發送取消通知給他。')">` +
        `${csrf}<button class='btn btn-sm btn-danger'>移除並通知</button></form></td></tr>`;
    }).join("");
    assignedCard += `<table><thead><tr><th>姓名</th><th>帳號</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    assignedCard += `<p style='color:var(--light);font-size:13px'>此課程目前尚未指派任何工讀生。</p>`;
  }
  assignedCard += `</div>`;

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
    (course.custom
      ? `<div style='margin-top:14px;padding-top:12px;border-top:1px solid var(--border-l)'>` +
        `<span class='badge b-gray' style='margin-right:10px'>臨時活動</span>` +
        `<form method='post' action='${PREFIX}/admin/courses/${cid}/delete' style='display:inline' onsubmit="return confirm('確定刪除此臨時活動？相關報名／指派也會一併移除。')">${csrf}` +
        `<button class='btn btn-sm btn-danger'>🗑 刪除此臨時活動</button></form></div>`
      : "") +
    `</div>` +
    `${timeCard}` +
    `${followCard}` +
    `${assignedCard}` +
    `<div class='card'>` +
    `<div class='card-title'>已報名工讀生（${avail.length} 人）</div>` +
    `${availTable}${manual}</div>` +
    assignWarnScript(hoursByWid);
  res.send(layout("課程詳情", body, sess));
});

// ── 修改課程時間（Supabase 課程存疊加 /time_overrides；自訂活動直接改 /courses）──
router.post("/admin/course/:cid/time", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=csrf_err`);
  const start = (req.body.start || "").trim(), end = (req.body.end || "").trim();
  if (!start || !end) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=bad_input`);
  const custom = await rget(`/courses/${cid}`);
  if (custom) await rpatch(`/courses/${cid}`, { time_slot: `${start} - ${end}` });
  else await rput(`/time_overrides/${cid}`, { start, end });
  res.redirect(`${PREFIX}/admin/course/${cid}?msg=time_saved`);
});
router.post("/admin/course/:cid/time-reset", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const cid = req.params.cid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/course/${cid}?msg=csrf_err`);
  await rdel(`/time_overrides/${cid}`);
  res.redirect(`${PREFIX}/admin/course/${cid}?msg=time_reset`);
});

// ══ 處方日「組成」設定（月曆→勾選當天課程→指定分區，收合成處方日）══
const PRESC_URL = (date, region) => `${PREFIX}/admin/presc/${date}/${encodeURIComponent(region)}`;
router.get("/admin/presc-setup", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const month = req.query.month || todayTaipei().slice(0, 7);
  const day = req.query.day || "";
  const notice = req.query.msg ? alertHtml(MSG_MAP[req.query.msg] || req.query.msg, "ok") : "";
  const courses = await allCourses();
  const prescDays = await rget("/presc_days") || {};
  const grid = calendarGrid(courses.map(c => ({ ...c, _x: false })), month, `${PREFIX}/admin/presc-setup`, day);
  const csrf = hiddenCsrf(sess);
  let dayHtml = "";
  if (day) {
    const list = courses.filter(c => c.date === day).sort((a, b) => a.time_slot.localeCompare(b.time_slot));
    const dayPresc = prescDays[day] || {};
    const setRegions = Object.keys(dayPresc).filter(r => (dayPresc[r].courseIds || []).length || (dayPresc[r].items || []).length);
    let summary = "";
    if (setRegions.length) {
      summary = `<div class='card'><div class='card-title'>${esc(day)} 已設定的處方日</div>` +
        setRegions.map(r => `<div style='margin-bottom:6px'><span class='badge b-blue'>${esc(r)}</span> ${(dayPresc[r].courseIds || []).length} 堂課 · <a href='${PRESC_URL(day, r)}'>設定工作項目／人數 →</a></div>`).join("") +
        `</div>`;
    }
    const idsByRegion = {};
    Object.keys(dayPresc).forEach(r => { idsByRegion[r] = dayPresc[r].courseIds || []; });
    if (list.length) {
      const rows = list.map(c =>
        `<label style='display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--border-l);border-radius:6px;margin-bottom:6px;cursor:pointer'>` +
        `<input type='checkbox' name='courseIds' value='${esc(c.id)}' style='width:auto'>` +
        `<span style='flex:1'><strong>${esc(c.time_slot)}</strong>　${esc(c.course_name)} <span class='b-gray'>${esc(c.region || "")}</span></span></label>`).join("");
      dayHtml = summary +
        `<div class='card'><div class='card-title'>${esc(day)}（週${weekdayStr(day)}）— 勾選課程組成處方日</div>` +
        `<form method='post' action='${PREFIX}/admin/presc-setup'>${csrf}` +
        `<input type='hidden' name='date' value='${esc(day)}'>` +
        `<div class='form-group' style='max-width:220px;margin-bottom:12px'><label class='form-label'>屬於哪一區的處方日</label>` +
        `<select name='region' id='ps-region'>${REGIONS.map(r => `<option value='${r}'>${r}</option>`).join("")}<option value='其他'>其他</option></select></div>` +
        `<div id='ps-list'>${rows}</div>` +
        `<p style='font-size:12px;color:var(--muted);margin:8px 0'>勾選的課會在主月曆收合成一個「處方日」；之後回主月曆點該處方日設定工作項目與人數。切換分區會載入該區已選的課。</p>` +
        `<button class='btn btn-primary'>儲存為處方日</button></form></div>` +
        `<script>window.__PSIDS=${calData(idsByRegion)};(function(){var sel=document.getElementById('ps-region');function apply(){var ids=(window.__PSIDS||{})[sel.value]||[];document.querySelectorAll('#ps-list input[name=courseIds]').forEach(function(cb){cb.checked=ids.indexOf(cb.value)>=0;});}sel.addEventListener('change',apply);apply();})();</script>`;
    } else {
      dayHtml = summary + `<div class='card'><p style='color:var(--light);text-align:center;padding:20px'>${esc(day)} 無課程可選</p></div>`;
    }
  }
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin?tab=avail' class='btn btn-sm btn-ghost'>← 返回報名狀況</a></div>` +
    notice +
    `<div class='card'><div class='card-title'>處方日設定 — 選日期</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:8px'>點日期 → 勾選當天課程 → 指定分區，即可組成處方日。</p>${grid}</div>` +
    dayHtml;
  res.send(layout("處方日設定", body, sess));
});
router.post("/admin/presc-setup", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/presc-setup?msg=csrf_err`);
  const date = req.body.date, region = req.body.region;
  if (!date || !region) return res.redirect(`${PREFIX}/admin/presc-setup`);
  const courseIds = [].concat(req.body.courseIds || []).filter(Boolean);
  await rpatch(`/presc_days/${date}/${region}`, { courseIds }); // patch：保留 items
  res.redirect(`${PREFIX}/admin/presc-setup?month=${date.slice(0, 7)}&day=${date}&msg=presc_courses_saved`);
});

// ══ 處方日設定（工作項目／人數／排班；依 日期＋分區）══
router.get("/admin/presc/:date/:region", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const { date, region } = req.params;
  const cfg = await rget(`/presc_days/${date}/${region}`) || {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  const assignObj = await rget(`/presc_assignments/${date}/${region}`) || {};
  const users = await getUsers();
  const userById = Object.fromEntries(users.map(u => [u.id, u]));
  const csrf = hiddenCsrf(sess);
  const notice = req.query.msg ? alertHtml(MSG_MAP[req.query.msg] || req.query.msg, "ok") : "";
  const needed = items.reduce((s, it) => s + (Number(it.count) || 0), 0);
  const assignedIds = Object.keys(assignObj);
  // 稅務預警：本月累計時數（含手動時數調整）
  const attRecords = Object.values(await rgetAtt() || {});
  const adjustAll = await getHoursAdjust();
  const pRoc = rocFromDate(date) || todayROC();
  const hoursByWid = {};
  users.forEach(u => { if (u.role === "worker") hoursByWid[u.id] = sumMonthHours(attRecords, u.display_name, pRoc.year, pRoc.month, adjustAll); });
  const hLabel = wid => { const h = hoursByWid[wid] || 0; return h >= HOURS_WARN ? `（本月 ${h} 時 ⚠）` : `（本月 ${h} 時）`; };

  const itemRows = (items.length ? items : [{ desc: "", count: 1 }]).map(it =>
    `<div class='pi-row' style='display:flex;gap:8px;margin-bottom:6px'>` +
    `<input name='desc' value='${esc(it.desc || "")}' placeholder='工作敘述（例：路線引導）' style='flex:1'>` +
    `<input name='count' type='number' min='0' value='${Number(it.count) || 0}' style='width:90px' list='cnt-opts'>` +
    `<button type='button' class='btn btn-sm btn-ghost pi-del'>移除</button></div>`).join("");
  // 簽到狀況：比對本處方日（日期＋分區）的簽到記錄，依姓名對應
  const fmtT = iso => { if (!iso) return ""; try { return new Date(iso).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }); } catch (_) { return ""; } };
  const statusByName = {};
  attRecords.forEach(r => {
    if (!r || r.attendanceDeleted) return;
    if (r.checkinMode !== "處方日" || r.schedDate !== date || r.region !== region) return;
    const prev = statusByName[r.name];
    if (!prev || new Date(r.checkinTime) > new Date(prev.checkinTime)) statusByName[r.name] = r;
  });
  const statusCell = name => {
    const r = statusByName[name];
    if (!r) return "<span class='badge b-gray'>未簽到</span>";
    if (r.status === "checked-in")
      return `<span class='badge b-open'>● 簽到中</span> <span style='font-size:12px;color:var(--muted)'>${esc(fmtT(r.checkinTime))} 起</span>`;
    return `<span class='badge b-blue'>✓ 已簽退</span> <span style='font-size:12px;color:var(--muted)'>${esc(fmtT(r.checkinTime))}–${esc(fmtT(r.checkoutTime))}（${esc(r.hours || 0)} 時）</span>`;
  };
  const signedCount = assignedIds.filter(wid => statusByName[(userById[wid] || {}).display_name]).length;
  const assignedRows = assignedIds.map(wid => {
    const u = userById[wid] || {};
    return `<tr><td>${esc(u.display_name || wid)}</td><td style='color:var(--muted)'>${esc(u.username || "")}</td>` +
      `<td>${statusCell(u.display_name)}</td>` +
      `<td><form method='post' action='${PRESC_URL(date, region)}/unassign/${wid}' style='display:inline'>${csrf}<button class='btn btn-sm btn-danger'>移除</button></form></td></tr>`;
  }).join("");

  const assignable = users.filter(u => u.role === "worker" && !assignObj[u.id]).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), "zh-Hant"));
  const assignForm = assignable.length
    ? `<form method='post' action='${PRESC_URL(date, region)}/assign' class='assign-form' style='display:flex;gap:10px;align-items:flex-end'>${csrf}<div class='form-group' style='flex:1'><label class='form-label'>加入工讀生（可直接排任何人）</label><select name='worker_id'>${assignable.map(w => `<option value='${esc(w.id)}'>${esc(w.display_name)}（${esc(w.username)}）${hLabel(w.id)}</option>`).join("")}</select></div><button class='btn btn-success'>加入</button></form>`
    : "<p style='color:var(--light);font-size:13px'>所有工讀生皆已排入。</p>";

  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin?tab=avail' class='btn btn-sm btn-ghost'>← 返回月曆</a></div>` +
    notice +
    `<div class='card'><h3 style='font-size:16px;font-weight:600;margin-bottom:4px'>處方日設定　${esc(date)}　<span class='badge b-blue'>${esc(region)}</span></h3>` +
    `<p style='font-size:13px;color:var(--muted);margin:0'>需求 ${needed} 人 · 已排 ${assignedIds.length} 人</p></div>` +
    `<div class='card'><div class='card-title'>工作項目與人數</div>` +
    `<datalist id='cnt-opts'>${[1, 2, 3, 4, 5, 6, 8, 10].map(n => `<option value='${n}'>`).join("")}</datalist>` +
    `<form method='post' action='${PRESC_URL(date, region)}/save'>${csrf}` +
    `<div id='pi-list'>${itemRows}</div>` +
    `<button type='button' class='btn btn-sm btn-ghost' id='pi-add' style='margin:6px 0 12px'>＋ 新增工作項目</button><br>` +
    `<button class='btn btn-primary'>儲存工作項目</button></form></div>` +
    `<div class='card'><div class='card-title'>已排工讀生（${assignedIds.length} / ${needed}）　·　已簽到 ${signedCount} 人</div>` +
    (assignedRows ? `<table class='ntbl'><thead><tr><th>姓名</th><th>帳號</th><th>簽到狀況</th><th></th></tr></thead><tbody>${assignedRows}</tbody></table>` : "<p style='color:var(--light);font-size:13px'>尚未排入任何人。</p>") +
    `<hr class='divider'>${assignForm}</div>` +
    `<script>(function(){function bind(){document.querySelectorAll('.pi-del').forEach(function(b){b.onclick=function(){b.closest('.pi-row').remove();};});}var a=document.getElementById('pi-add');if(a)a.onclick=function(){var d=document.createElement('div');d.className='pi-row';d.style.cssText='display:flex;gap:8px;margin-bottom:6px';d.innerHTML="<input name='desc' placeholder='工作敘述（例：路線引導）' style='flex:1'><input name='count' type='number' min='0' value='1' style='width:90px' list='cnt-opts'><button type='button' class='btn btn-sm btn-ghost pi-del'>移除</button>";document.getElementById('pi-list').appendChild(d);bind();};bind();})();</script>` +
    assignWarnScript(hoursByWid);
  res.send(layout("處方日設定", body, sess));
});
router.post("/admin/presc/:date/:region/save", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const { date, region } = req.params;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PRESC_URL(date, region)}?msg=csrf_err`);
  const descs = [].concat(req.body.desc || []);
  const counts = [].concat(req.body.count || []);
  const items = descs.map((d, i) => ({ desc: String(d || "").trim(), count: parseInt(counts[i], 10) || 0 }))
    .filter(it => it.desc || it.count);
  await rpatch(`/presc_days/${date}/${region}`, { items }); // patch：保留 courseIds
  res.redirect(`${PRESC_URL(date, region)}?msg=presc_saved`);
});
router.post("/admin/presc/:date/:region/assign", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const { date, region } = req.params;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PRESC_URL(date, region)}?msg=csrf_err`);
  const wid = req.body.worker_id;
  if (wid) {
    await rput(`/presc_assignments/${date}/${region}/${wid}`, { assigned_at: nowTaipei() });
    try { await sendPushToWorker(wid, { title: "處方日排班", body: `${date}　${region}　處方日已排入你`, url: `${PREFIX}/calendar?month=${date.slice(0, 7)}` }); } catch (e) { console.error("[schedule] presc push:", e.message); }
  }
  res.redirect(`${PRESC_URL(date, region)}?msg=presc_assigned`);
});
router.post("/admin/presc/:date/:region/unassign/:wid", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const { date, region, wid } = req.params;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PRESC_URL(date, region)}?msg=csrf_err`);
  await rdel(`/presc_assignments/${date}/${region}/${wid}`);
  res.redirect(`${PRESC_URL(date, region)}?msg=presc_unassigned`);
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

// ── 工讀生時數調整（手動加減；計入月總時數、稅務預警與工時）──
router.get("/admin/workers/:wid/hours", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const w = await getUser(req.params.wid);
  if (!w || w.role !== "worker") return res.redirect(`${PREFIX}/admin?tab=workers`);
  const msg = req.query.msg || "";
  const notice = msg ? alertHtml(msg, msg === "adj_need" ? "err" : "ok") : "";
  const now = todayROC();
  const mine = (await getHoursAdjust()).filter(a => a.wid === w.id)
    .sort((a, b) => (b.year - a.year) || (b.month - a.month) || String(b.at || "").localeCompare(String(a.at || "")));
  // 參考：本月（自動）時數與調整合計
  const attRecords = Object.values(await rgetAtt() || {});
  const autoNow = sumMonthHours(attRecords, w.display_name, now.year, now.month);
  const adjNow = sumMonthAdjust(mine, w.display_name, now.year, now.month);
  const monthOpts = Array.from({ length: 12 }, (_, i) => `<option value='${i + 1}'${i + 1 === now.month ? " selected" : ""}>${i + 1} 月</option>`).join("");
  const adjRows = mine.map(a =>
    `<tr><td style='white-space:nowrap'>${esc(a.year)}/${esc(a.month)}</td>` +
    `<td style='white-space:nowrap;font-weight:600;color:${Number(a.hours) < 0 ? "#c0392b" : "var(--ok)"}'>${Number(a.hours) > 0 ? "+" : ""}${esc(a.hours)} 時</td>` +
    `<td>${esc(a.reason || "-")}</td>` +
    `<td style='color:var(--muted);font-size:12px;white-space:nowrap'>${esc(a.by || "")}</td>` +
    `<td><form method='post' action='${PREFIX}/admin/workers/${w.id}/hours/${a.id}/delete' style='display:inline'>${hiddenCsrf(sess)}<button class='btn btn-sm btn-danger' onclick="return confirm('刪除此筆調整？')">刪除</button></form></td></tr>`
  ).join("");
  const body =
    `<div style='margin-bottom:16px'><a href='${PREFIX}/admin?tab=workers' class='btn btn-sm btn-ghost'>← 返回工讀生管理</a></div>` +
    `${notice}` +
    `<div class='card'><h3 style='font-size:16px;font-weight:600;margin-bottom:4px'>時數調整　${esc(w.display_name)}</h3>` +
    `<p style='font-size:13px;color:var(--muted);margin:0'>本月（${now.year}/${now.month}）自動 ${autoNow} 時　·　調整 ${adjNow > 0 ? "+" : ""}${adjNow} 時　·　合計 <strong>${Math.round((autoNow + adjNow) * 10) / 10}</strong> 時</p></div>` +
    `<div class='card'><div class='card-title'>新增時數調整</div>` +
    `<p style='font-size:12px;color:var(--muted);margin-bottom:12px'>正數＝加時（例：忘記簽到補時），負數＝扣時（例：超時上限）。年為民國年，會計入該月總時數、稅務預警與此工讀生的「我的工時」。</p>` +
    `<form method='post' action='${PREFIX}/admin/workers/${w.id}/hours' style='display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap'>${hiddenCsrf(sess)}` +
    `<div class='form-group'><label class='form-label'>年（民國）</label><input name='year' type='number' value='${now.year}' style='width:100px' required></div>` +
    `<div class='form-group'><label class='form-label'>月</label><select name='month' style='width:90px'>${monthOpts}</select></div>` +
    `<div class='form-group'><label class='form-label'>時數（可負）</label><input name='hours' type='number' step='0.5' placeholder='例：3 或 -2' style='width:130px' required></div>` +
    `<div class='form-group' style='flex:1;min-width:180px'><label class='form-label'>原因</label><input name='reason' placeholder='例：忘記簽到補 3 小時'></div>` +
    `<button class='btn btn-primary' style='align-self:flex-end'>新增調整</button></form></div>` +
    `<div class='card'><div class='card-title'>調整紀錄（${mine.length}）</div>` +
    (adjRows ? `<table class='ntbl'><thead><tr><th>年/月</th><th>時數</th><th>原因</th><th>操作人</th><th></th></tr></thead><tbody>${adjRows}</tbody></table>` : "<p style='color:var(--light);font-size:13px'>尚無調整紀錄。</p>") +
    `</div>`;
  res.send(layout("時數調整", body, sess));
});
router.post("/admin/workers/:wid/hours", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const wid = req.params.wid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/workers/${wid}/hours?msg=csrf_err`);
  const w = await getUser(wid);
  if (!w || w.role !== "worker") return res.redirect(`${PREFIX}/admin?tab=workers`);
  const year = parseInt(req.body.year, 10);
  const month = parseInt(req.body.month, 10);
  const hours = Number(req.body.hours);
  const reason = (req.body.reason || "").trim();
  if (!year || !month || month < 1 || month > 12 || !hours || isNaN(hours))
    return res.redirect(`${PREFIX}/admin/workers/${wid}/hours?msg=adj_need`);
  await rpost("/hours_adjust", { wid: w.id, name: w.display_name, year, month, hours, reason, by: sess.display_name || "管理員", at: new Date().toISOString() });
  res.redirect(`${PREFIX}/admin/workers/${wid}/hours?msg=adj_saved`);
});
router.post("/admin/workers/:wid/hours/:aid/delete", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  const wid = req.params.wid;
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin/workers/${wid}/hours?msg=csrf_err`);
  await rdel(`/hours_adjust/${req.params.aid}`);
  res.redirect(`${PREFIX}/admin/workers/${wid}/hours?msg=adj_deleted`);
});

router.post("/admin/change-password", async (req, res) => {
  const sess = getSess(req);
  if (!sess || sess.role !== "admin") return res.redirect(`${PREFIX}/login`);
  if (!csrfOk(req, req.body.csrf_token)) return res.redirect(`${PREFIX}/admin?msg=csrf_err`);
  const { current_password, new_password, confirm_password } = req.body;
  const me = await getUser(sess.id);
  if (!me || me.password_hash !== hp(current_password || "")) return res.redirect(`${PREFIX}/admin?msg=pw_wrong&tab=password`);
  if (!/^\d{4}$/.test(new_password || "")) return res.redirect(`${PREFIX}/admin?msg=pw_need4&tab=password`);
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
    const courses = (await allCourses()).filter(c => c.date === tomorrow);
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

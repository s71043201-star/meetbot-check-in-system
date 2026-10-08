// 合作夥伴（老師／診所）查詢用的資料來源：tpma-statistics 那份 Supabase
// prescription_data。資料由 n8n 每天 09:30 / 15:00 同步（儀表板按「立即同步」也會刷新），
// 這裡只讀、不寫，所以同步完 LINE 查到的就是最新的，不用另外維護。
const axios = require("axios");

const SUPA_URL = process.env.SUPA_URL || "https://ilcnqpywxaseeyasiwws.supabase.co";
const SUPA_KEY = process.env.SUPA_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsY25xcHl3eGFzZWV5YXNpd3dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIzODgsImV4cCI6MjA4OTQwODM4OH0.TrjIr4IMdvpstkN8tNBQtAEvvNDTLg3XcXXIpptJIs0";
const HDR = { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY };

const MAIN_TTL = 5 * 60 * 1000;   // 課表／禮券：5 分鐘
const ROWS_TTL = 10 * 60 * 1000;  // 處方明細（4 萬多筆）：10 分鐘

// 與儀表板 index.html 同口徑：ITRI、itri7 是工研院自測處方，不列入統計
const TEST_CLINICS = ["ITRI", "itri7"];
// 與儀表板 CLINIC_RENAMES 同步（儀表板／週報／clinic_report 也各有一份，改一邊要全改）
const CLINIC_RENAMES = [
  { from: "洪耳鼻喉科診所", to: "仁禾診所", since: "2026-08-10" },
];
// 診所帳號看的是「整間診所」：遷址更名前的舊名紀錄也算進新名字
const clinicSources = name => [name, ...CLINIC_RENAMES.filter(r => r.to === name).map(r => r.from)];
const canonicalClinic = name => {
  const rule = CLINIC_RENAMES.find(r => r.from === name);
  return rule ? rule.to : name;
};

const TYPE_LABEL = { exercise: "運動", nutrition: "營養", social: "社會", mental: "情緒調適" };

let mainCache = { at: 0, data: null };
let rowsCache = { at: 0, data: null };

async function fetchMain(force = false) {
  if (!force && mainCache.data && Date.now() - mainCache.at < MAIN_TTL) return mainCache.data;
  try {
    const { data } = await axios.get(SUPA_URL + "/rest/v1/prescription_data", {
      params: { id: "eq.main", select: "course_slots,course_slot_stats,voucher_stats,voucher_last_run_at,uploaded_at" },
      headers: HDR, timeout: 20000,
    });
    const row = (data && data[0]) || {};
    mainCache = { at: Date.now(), data: row };
    return row;
  } catch (e) {
    console.error("[partners] Supabase main 讀取失敗:", e.message);
    if (mainCache.data) return mainCache.data; // 失敗時沿用舊快取
    throw e;
  }
}

// raw_rows 拆成 main:rows:000、001… 多列存放（見 tpma-statistics #72）
async function fetchRawRows(force = false) {
  if (!force && rowsCache.data && Date.now() - rowsCache.at < ROWS_TTL) return rowsCache.data;
  try {
    const { data } = await axios.get(SUPA_URL + "/rest/v1/prescription_data", {
      params: { id: "like.main:rows:*", select: "id,raw_rows", order: "id" },
      headers: HDR, timeout: 60000,
    });
    const rows = (data || []).flatMap(c => c.raw_rows || [])
      .filter(r => r && !TEST_CLINICS.includes(r.clinic))
      .map(r => {
        const rule = CLINIC_RENAMES.find(x => x.from === r.clinic && (!x.since || (r.prescDate || "") >= x.since));
        return rule ? { ...r, clinic: rule.to } : r;
      });
    rowsCache = { at: Date.now(), data: rows };
    return rows;
  } catch (e) {
    console.error("[partners] Supabase raw_rows 讀取失敗:", e.message);
    if (rowsCache.data) return rowsCache.data;
    throw e;
  }
}

function todayTaipei(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000)
    .toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 10);
}

function fmtUpdated(iso) {
  if (!iso) return "未知";
  return new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── 名冊（綁定碼要對照的對象）──────────────────────────
// 老師：n8n 同步時存的 course_slot_stats.course_instructors（course_id → {a: 帳號, n: 姓名}）
async function listTeachers() {
  const main = await fetchMain();
  const map = (main.course_slot_stats && main.course_slot_stats.course_instructors) || {};
  const byAccount = {};
  Object.values(map).forEach(v => {
    if (!v || !v.a) return;
    if (!byAccount[v.a]) byAccount[v.a] = { key: v.a, name: v.n || v.a };
  });
  return Object.values(byAccount).sort((x, y) => x.key.localeCompare(y.key));
}

// 診所：處方明細裡出現過的開立診所（已排除測試、套用更名）
async function listClinics() {
  const rows = await fetchRawRows();
  const names = new Set(rows.map(r => r.clinic).filter(Boolean).map(canonicalClinic));
  return [...names].sort().map(n => ({ key: n, name: n }));
}

// ── 老師：自己的場次 ─────────────────────────────────
async function teacherSlots(account, fromDate, toDate) {
  const main = await fetchMain();
  const map = (main.course_slot_stats && main.course_slot_stats.course_instructors) || {};
  const myCourses = new Set(Object.entries(map).filter(([, v]) => v && v.a === account).map(([id]) => id));
  const slots = (main.course_slots || [])
    .filter(s => myCourses.has(s.course_id) && s.status !== "cancelled"
      && s.slot_date >= fromDate && s.slot_date <= toDate)
    .sort((a, b) => (a.slot_date + a.start_time).localeCompare(b.slot_date + b.start_time));
  return { slots, updatedAt: main.uploaded_at };
}

// ── 診所：開立／執行統計（口徑同儀表板 aggregateRawRows 的 clinicMap）──
async function clinicStats(clinic) {
  const rows = await fetchRawRows();
  const names = new Set(clinicSources(clinic));
  const month = todayTaipei().slice(0, 7);
  const s = { total: 0, enrolledOrEx: 0, ex: 0, monthIssued: 0, monthEx: 0, byType: {} };
  rows.forEach(r => {
    if (!names.has(r.clinic)) return;
    s.total++;
    if (r.enrolled || r.ex) s.enrolledOrEx++;
    if (r.ex) s.ex++;
    if ((r.prescDate || "").startsWith(month)) s.monthIssued++;
    if (r.ex && (r.execDate || r.prescDate || "").startsWith(month)) s.monthEx++;
    const t = r.type || "其他";
    if (!s.byType[t]) s.byType[t] = { issued: 0, ex: 0 };
    s.byType[t].issued++;
    if (r.ex) s.byType[t].ex++;
  });
  const main = await fetchMain();
  return { ...s, month, updatedAt: main.uploaded_at };
}

// ── 診所：禮券進度（C:\prescription\scripts\voucher_stats.py 每天 09:35 / 15:05 算好）──
async function clinicVoucher(clinic) {
  const main = await fetchMain();
  const by = (main.voucher_stats && main.voucher_stats.by_clinic) || {};
  const sum = { done4: 0, claimed: 0, unclaimed: 0, unknown: 0, found: false };
  clinicSources(clinic).forEach(n => {
    const v = by[n];
    if (!v) return;
    sum.found = true;
    ["done4", "claimed", "unclaimed", "unknown"].forEach(k => { sum[k] += Number(v[k]) || 0; });
  });
  return { ...sum, updatedAt: main.voucher_last_run_at };
}

module.exports = {
  TYPE_LABEL,
  fetchMain,
  todayTaipei,
  fmtUpdated,
  listTeachers,
  listClinics,
  teacherSlots,
  clinicStats,
  clinicVoucher,
};

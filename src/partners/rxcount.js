// 同仁指令「開立張數 <日期> [時間] [診所]」：查某個時間點之後各診所開立了幾張處方。
//
// 資料有兩份，接在一起算：
// - 即時：C:\prescription\scripts\clinic_quota_alert.py 每 5 分鐘把近 14 天每張處方的
//   （診所, 開立時間到秒）寫到 prescription_data id='live:issues'，延遲 ≤ 5 分鐘。
// - 更早：raw_rows（n8n 每天 09:30 / 15:00 同步），只有開立「日期」，沒有時間。
// 查詢起點落在即時資料範圍內就全用即時資料；更早的部分用 raw_rows 補到即時資料的起日前一天。
const axios = require("axios");
const data = require("./data");

const LIVE_TTL = 60 * 1000;
const STALE_MIN = 30;     // 即時資料超過這麼久沒更新，多半是本機排程沒在跑
const MAX_TEXT = 4800;    // LINE 單則上限 5000 字

const USAGE =
  "📊 開立張數 指令\n" + "═".repeat(16) + "\n" +
  "查某個時間點之後各診所開立了幾張處方：\n" +
  "• 開立張數 10/9 — 10/9 00:00 起\n" +
  "• 開立張數 10/9 16:50 — 指定到分鐘\n" +
  "• 開立張數 2026/10/9 杏華 — 只看名稱含「杏華」的診所\n" +
  "日期可寫 10/9、2026/10/9、115/10/9。";

let liveCache = { at: 0, data: null };

async function fetchLive() {
  if (liveCache.data && Date.now() - liveCache.at < LIVE_TTL) return liveCache.data;
  const { data: res } = await axios.get(data.SUPA_URL + "/rest/v1/prescription_data", {
    params: { id: "eq.live:issues", select: "raw_rows,uploaded_at" },
    headers: data.HDR, timeout: 30000,
  });
  const row = (res && res[0]) || {};
  const payload = row.raw_rows || {};
  const live = {
    since: payload.since || null,
    updatedAt: row.uploaded_at || null,
    // 開立時間 'YYYY/MM/DD HH:MM:SS' → 'YYYY-MM-DD HH:MM:SS'，跟 raw_rows 的 prescDate 同格式好比較
    rows: (payload.rows || []).map(r => ({ clinic: r.c, t: String(r.t || "").replace(/\//g, "-") })),
  };
  liveCache = { at: Date.now(), data: live };
  return live;
}

const pad = n => String(n).padStart(2, "0");

// 回傳 { date: 'YYYY-MM-DD', time: 'HH:MM', hasTime, keyword } 或 { error }
function parseArgs(arg) {
  let rest = String(arg || "").trim();
  const today = data.todayTaipei();
  let y, m, d;
  let mt = rest.match(/^(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (mt) {
    y = Number(mt[1]); if (y < 1000) y += 1911;   // 民國年
    m = Number(mt[2]); d = Number(mt[3]);
  } else if ((mt = rest.match(/^(\d{1,2})[\/\-.](\d{1,2})/))) {
    y = Number(today.slice(0, 4)); m = Number(mt[1]); d = Number(mt[2]);
  } else {
    return { error: "usage" };
  }
  rest = rest.slice(mt[0].length).trim();
  const date = y + "-" + pad(m) + "-" + pad(d);
  const dt = new Date(date + "T00:00:00Z");
  if (isNaN(dt) || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return { error: "「" + mt[0] + "」不是有效日期" };
  if (date > today) {
    if (/^\d{4}|^\d{3}[\/\-.]/.test(arg.trim())) return { error: date + " 還沒到" };
    // 只寫月/日又比今天晚，當成去年（例如 1 月查 12/20）
    return parseArgs((y - 1) + "/" + m + "/" + d + " " + rest);
  }
  let time = "00:00", hasTime = false;
  const tm = rest.match(/^(\d{1,2})[:：](\d{2})/);
  if (tm) {
    if (Number(tm[1]) > 23 || Number(tm[2]) > 59) return { error: "「" + tm[0] + "」不是有效時間" };
    time = pad(tm[1]) + ":" + tm[2]; hasTime = true;
    rest = rest.slice(tm[0].length).trim();
  }
  return { date, time, hasTime, keyword: rest };
}

async function query(arg) {
  const p = parseArgs(arg);
  if (p.error === "usage") return USAGE;
  if (p.error) return "❌ " + p.error + "\n\n" + USAGE;

  const live = await fetchLive();
  const start = p.date + " " + p.time + ":00";
  const counts = {};
  const add = name => { counts[name] = (counts[name] || 0) + 1; };
  const notes = [];
  let usedRaw = false;

  if (live.since && p.date >= live.since) {
    live.rows.forEach(r => { if (r.t >= start) add(data.renameClinic(r.clinic, r.t.slice(0, 10))); });
  } else {
    // 起點早於即時資料：之前那段用 raw_rows（只到日期），之後接即時資料
    usedRaw = true;
    const rows = await data.fetchRawRows();
    const until = live.since || "9999-12-31";
    rows.forEach(r => { const d = r.prescDate || ""; if (d >= p.date && d < until) add(r.clinic); });
    live.rows.forEach(r => add(data.renameClinic(r.clinic, r.t.slice(0, 10))));
    if (p.hasTime) notes.push("※ " + p.date.slice(5).replace("-", "/") + " 早於即時資料範圍，只能算到日期，時間 " + p.time + " 沒有作用");
  }

  const kw = p.keyword;
  let list = Object.entries(counts);
  if (kw) list = list.filter(([name]) => name.includes(kw));
  list.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = list.reduce((s, [, n]) => s + n, 0);

  const label = p.date.replace(/-/g, "/") + (p.hasTime ? " " + p.time : "");
  let msg = "📊 " + label + " 起開立張數" + (kw ? "（含「" + kw + "」）" : "") + "\n" + "═".repeat(16) + "\n";
  if (!list.length) {
    msg += kw ? "沒有名稱含「" + kw + "」的診所在這段期間開立。" : "這段期間沒有開立紀錄。";
  } else {
    msg += "合計 " + total + " 張（" + list.length + " 家）\n\n" +
      list.map(([name, n]) => "• " + name + "　" + n + " 張").join("\n");
  }
  msg += "\n\n";
  if (notes.length) msg += notes.join("\n") + "\n";
  msg += "（即時資料更新：" + data.fmtUpdated(live.updatedAt);
  if (usedRaw) msg += "；" + (live.since || "").slice(5).replace("-", "/") + " 以前為每日同步資料";
  msg += "）";
  if (live.updatedAt && Date.now() - new Date(live.updatedAt).getTime() > STALE_MIN * 60 * 1000) {
    msg += "\n⚠️ 即時資料超過 " + STALE_MIN + " 分鐘沒更新，最新開立可能還沒算進來";
  }
  return msg.length <= MAX_TEXT ? msg : msg.slice(0, MAX_TEXT - 30) + "\n…（內容過長，已截斷）";
}

module.exports = { query, parseArgs, USAGE };

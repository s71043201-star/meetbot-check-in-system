// 老師前一天課程提醒：每天 18:00（台北）推播隔天的場次與報名人數給已綁定的老師。
// 推播會吃 LINE 每月訊息額度（免費方案 200 則），所以：
//   ・隔天沒課的老師不發
//   ・剩餘額度低於 PARTNER_PUSH_RESERVE（預設 30）就整批暫停，並私訊通知戴豐逸
//   ・當天發過就記在 Firebase，Render 重啟也不會重發
const axios = require("axios");
const { TOKEN, MEMBERS } = require("../config");
const { sendLine } = require("../line");
const data = require("./data");
const bind = require("./bind");
const { fmtDate, hhmm } = require("./commands");

const REMIND_HOUR = Number(process.env.PARTNER_REMIND_HOUR || 18);
const PUSH_RESERVE = Number(process.env.PARTNER_PUSH_RESERVE || 30);
const SENT_FB = (process.env.PARTNERS_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/linePartners") + "Meta/reminderSent";
const ADMIN_NAME = "戴豐逸";

async function quotaLeft() {
  const hdr = { headers: { Authorization: "Bearer " + TOKEN } };
  const [q, c] = await Promise.all([
    axios.get("https://api.line.me/v2/bot/message/quota", hdr),
    axios.get("https://api.line.me/v2/bot/message/quota/consumption", hdr),
  ]);
  if (q.data.type === "none") return Infinity; // 無上限方案
  return (q.data.value || 0) - (c.data.totalUsage || 0);
}

function buildMessage(b, slots) {
  const lines = slots.map(s => {
    const cap = Number(s.capacity) || Number(s.max_capacity) || 0;
    return "• " + hhmm(s.start_time) + "-" + hhmm(s.end_time) + " " + s.course_name +
      (s.course_location ? "\n  📍 " + s.course_location : "") +
      "\n  目前報名 " + (Number(s.booked_count) || 0) + (cap ? " / " + cap : "") + " 人";
  });
  return "🔔 明日課程提醒\n" + b.name + " 老師您好，明天 " + fmtDate(slots[0].slot_date) + " 有 " + slots.length + " 場課：\n\n" +
    lines.join("\n\n") + "\n\n輸入「報名人數」可查看最新狀況，辛苦了！";
}

async function runTeacherReminders(dateKey) {
  const { data: sent } = await axios.get(SENT_FB + "/" + dateKey + ".json").catch(() => ({ data: null }));
  const done = sent || {};
  const tomorrow = data.todayTaipei(1);
  const teachers = Object.entries(await bind.allBindings(true)).filter(([, b]) => b.role === "teacher");

  const jobs = [];
  for (const [uid, b] of teachers) {
    if (done[uid]) continue;
    const { slots } = await data.teacherSlots(b.key, tomorrow, tomorrow);
    if (slots.length) jobs.push({ uid, b, slots });
  }
  if (!jobs.length) { console.log("[partners] " + dateKey + " 沒有需要提醒的老師"); return; }

  const left = await quotaLeft().catch(() => null);
  if (left !== null && left - jobs.length < PUSH_RESERVE) {
    const msg = "⚠️ LINE 推播額度不足，今天的老師課程提醒暫停\n\n本次需發 " + jobs.length + " 則，剩餘額度 " + left +
      " 則（保留 " + PUSH_RESERVE + " 則給緊急通知）。\n老師仍可自行輸入「報名人數」查詢（回覆不扣額度）。";
    await sendLine(MEMBERS[ADMIN_NAME], msg).catch(() => {});
    console.warn("[partners] 額度不足，略過 " + jobs.length + " 則提醒");
    await axios.patch(SENT_FB + "/" + dateKey + ".json", { _skippedForQuota: jobs.length }).catch(() => {});
    return;
  }

  for (const { uid, b, slots } of jobs) {
    try {
      await sendLine(uid, buildMessage(b, slots));
      await axios.patch(SENT_FB + "/" + dateKey + ".json", { [uid]: true });
    } catch (e) {
      console.error("[partners] 提醒 " + b.name + " 失敗:", e.message);
    }
  }
  console.log("[partners] 已發送 " + jobs.length + " 則明日課程提醒");
}

let lastRun = "";
let running = false;
function startPartnerReminder() {
  setInterval(async () => {
    if (!bind.BIND_SECRET || running) return;
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const dateKey = data.todayTaipei();
    // 18:00～21:00 之間第一次輪到就跑（Render 休眠剛醒也補得到），每天一次；太晚就不吵老師了
    if (now.getHours() < REMIND_HOUR || now.getHours() >= REMIND_HOUR + 3 || lastRun === dateKey) return;
    running = true;
    try {
      await runTeacherReminders(dateKey);
      lastRun = dateKey;
    } catch (e) {
      console.error("[partners] 老師提醒失敗:", e.message);
    } finally {
      running = false;
    }
  }, 60 * 1000);
}

module.exports = { startPartnerReminder, runTeacherReminders };

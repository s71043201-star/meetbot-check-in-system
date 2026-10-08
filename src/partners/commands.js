// 合作夥伴（老師／診所）的 LINE 指令。回覆一律用 replyToken（不吃每月推播額度）。
const { replyLine } = require("../line");
const data = require("./data");
const bind = require("./bind");

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
// 非同仁也能用的 MeetBot 系統連結關鍵字（其餘 MeetBot 指令只限計畫同仁）
const PUBLIC_KEYWORDS = ["簽到", "排班", "問題回報"];
const MAX_TEXT = 4800; // LINE 單則上限 5000 字

function fmtDate(d) {
  const dt = new Date(d + "T00:00:00+08:00");
  return (dt.getMonth() + 1) + "/" + dt.getDate() + "(" + WEEKDAY[dt.getDay()] + ")";
}
const hhmm = t => String(t || "").slice(0, 5);
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : 0) + "%";
function clip(text) {
  return text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT - 30) + "\n…（內容過長，已截斷）";
}

const TEACHER_HELP =
  "📋 老師可用指令\n" + "═".repeat(16) + "\n" +
  "• 我的課表 — 未來 30 天的場次\n" +
  "• 報名人數 — 未來 14 天各場報名狀況\n" +
  "• 解除綁定 — 取消這個 LINE 的老師身分\n\n" +
  "每天傍晚會提醒隔天的課程。";
const CLINIC_HELP =
  "📋 診所可用指令\n" + "═".repeat(16) + "\n" +
  "• 診所統計 — 本診所開立／執行數\n" +
  "• 禮券進度 — 四項完成民眾的禮券領取狀況\n" +
  "• 解除綁定 — 取消這個 LINE 的診所身分";
const UNBOUND_HELP =
  "👋 您好！請先完成身分綁定\n\n" +
  "請輸入「綁定 」加上計畫窗口提供的 6 碼綁定碼，例如：\n綁定 AB12CD\n\n" +
  "綁定後即可查詢課表、報名人數或診所統計。";

// 綁定碼亂猜防護：每個 LINE 帳號 1 小時內最多錯 5 次
const bindFails = {};
function tooManyFails(userId) {
  const now = Date.now();
  bindFails[userId] = (bindFails[userId] || []).filter(t => now - t < 60 * 60 * 1000);
  return bindFails[userId].length >= 5;
}

// ── 老師 ──────────────────────────────────────────
async function teacherSchedule(b) {
  const { slots, updatedAt } = await data.teacherSlots(b.key, data.todayTaipei(), data.todayTaipei(30));
  if (!slots.length) return "📅 " + b.name + " 老師，未來 30 天沒有排定的場次。\n\n（資料更新：" + data.fmtUpdated(updatedAt) + "）";
  const lines = slots.map(s =>
    "• " + fmtDate(s.slot_date) + " " + hhmm(s.start_time) + "-" + hhmm(s.end_time) + "\n  " +
    s.course_name + (s.course_location ? "\n  📍 " + s.course_location : ""));
  return clip("📅 " + b.name + " 老師的課表（未來 30 天，共 " + slots.length + " 場）\n\n" +
    lines.join("\n\n") + "\n\n（資料更新：" + data.fmtUpdated(updatedAt) + "）");
}

async function teacherEnrollment(b) {
  const { slots, updatedAt } = await data.teacherSlots(b.key, data.todayTaipei(), data.todayTaipei(14));
  if (!slots.length) return "👥 " + b.name + " 老師，未來 14 天沒有排定的場次。\n\n（資料更新：" + data.fmtUpdated(updatedAt) + "）";
  const lines = slots.map(s => {
    const cap = Number(s.capacity) || Number(s.max_capacity) || 0;
    const booked = Number(s.booked_count) || 0;
    const left = cap ? Math.max(cap - booked, 0) : null;
    return "• " + fmtDate(s.slot_date) + " " + hhmm(s.start_time) + " " + s.course_name + "\n  報名 " + booked +
      (cap ? " / " + cap + (left === 0 ? "（已額滿）" : "（剩 " + left + "）") : "");
  });
  return clip("👥 " + b.name + " 老師各場報名人數（未來 14 天）\n\n" + lines.join("\n") +
    "\n\n※ 現場加入的民眾不在預約數內\n（資料更新：" + data.fmtUpdated(updatedAt) + "）");
}

// ── 診所 ──────────────────────────────────────────
async function clinicSummary(b) {
  const s = await data.clinicStats(b.key);
  if (!s.total) return "📊 " + b.name + "\n目前還沒有開立紀錄。";
  const types = Object.entries(s.byType).sort((x, y) => y[1].issued - x[1].issued)
    .map(([t, v]) => "• " + t + "：開立 " + v.issued + "，執行 " + v.ex + "（" + pct(v.ex, v.issued) + "）");
  return clip("📊 " + b.name + " 處方統計\n" + "═".repeat(16) + "\n" +
    "【累計】\n開立 " + s.total + " 張\n選課或執行 " + s.enrolledOrEx + " 張（" + pct(s.enrolledOrEx, s.total) + "）\n" +
    "已執行 " + s.ex + " 張（執行率 " + pct(s.ex, s.total) + "）\n\n" +
    "【本月 " + s.month.replace("-", "/") + "】\n開立 " + s.monthIssued + " 張，執行 " + s.monthEx + " 張\n\n" +
    "【各處方類型】\n" + types.join("\n") +
    "\n\n（資料更新：" + data.fmtUpdated(s.updatedAt) + "）");
}

async function clinicVoucher(b) {
  const v = await data.clinicVoucher(b.key);
  if (!v.found) return "🎁 " + b.name + "\n目前還沒有民眾完成四項處方。\n\n（資料更新：" + data.fmtUpdated(v.updatedAt) + "）";
  return "🎁 " + b.name + " 禮券進度\n" + "═".repeat(16) + "\n" +
    "四項處方都完成：" + v.done4 + " 人\n已領禮券：" + v.claimed + " 人\n尚未領取：" + v.unclaimed + " 人" +
    (v.unknown ? "\n⚠ 點數查詢失敗、狀態不明：" + v.unknown + " 人" : "") +
    "\n\n可提醒尚未領取的民眾回來兌換。\n（資料更新：" + data.fmtUpdated(v.updatedAt) + "）";
}

// ── 計畫同仁用：查綁定碼／名單 ─────────────────────────
async function staffCodes(keyword) {
  if (!bind.BIND_SECRET) return "❌ 尚未設定 PARTNER_BIND_SECRET，綁定功能未啟用";
  const all = await bind.allEntities();
  const kw = (keyword || "").trim();
  if (!kw) {
    const t = all.filter(e => e.role === "teacher").length;
    const c = all.filter(e => e.role === "clinic").length;
    return "🔑 綁定碼查詢\n\n目前可綁定：老師 " + t + " 位、診所 " + c + " 家\n\n" +
      "輸入「綁定碼 姓名或診所名」查單筆，例如：\n綁定碼 仁禾\n綁定碼 A08";
  }
  const hits = all.filter(e => e.name.includes(kw) || e.key.toUpperCase() === kw.toUpperCase());
  if (!hits.length) return "🔍 找不到「" + kw + "」\n\n老師要先有開課紀錄、診所要先有開立紀錄才會出現在名冊。";
  return clip("🔑 綁定碼（" + hits.length + " 筆）\n\n" + hits.slice(0, 20).map(e =>
    bind.ROLE_LABEL[e.role] + "｜" + e.name + (e.role === "teacher" ? "（" + e.key + "）" : "") + "\n綁定 " + e.code
  ).join("\n\n") + (hits.length > 20 ? "\n\n…還有 " + (hits.length - 20) + " 筆，請縮小關鍵字" : "") +
    "\n\n把「綁定 XXXXXX」整行傳給對方，請他加好友後貼上送出即可。");
}

async function staffList() {
  const all = Object.values(await bind.allBindings(true));
  if (!all.length) return "目前還沒有老師或診所完成綁定。";
  const group = role => all.filter(b => b.role === role)
    .map(b => "• " + b.name + (b.displayName ? "（LINE：" + b.displayName + "）" : "")).join("\n") || "（無）";
  return clip("👥 已綁定名單（共 " + all.length + " 位）\n\n【老師】\n" + group("teacher") + "\n\n【診所】\n" + group("clinic") +
    "\n\n要移除請輸入「解除綁定 名字」");
}

async function staffUnbind(name) {
  const entries = Object.entries(await bind.allBindings(true)).filter(([, b]) => b.name === name || b.displayName === name);
  if (!entries.length) return "🔍 已綁定名單裡找不到「" + name + "」";
  for (const [uid] of entries) {
    await bind.removeBinding(uid);
    await bind.unlinkMenu(uid);
  }
  return "✅ 已解除 " + entries.length + " 個 LINE 帳號的綁定（" + name + "）";
}

// ── 入口 ──────────────────────────────────────────
// 回傳 true = 這則訊息已處理。isStaff = 計畫同仁（config.MEMBERS）
async function handlePartnerMessage({ userId, text, replyToken, isStaff }) {
  const reply = msg => replyLine(replyToken, msg).then(() => true);

  const bindMatch = text.match(/^綁定\s*([A-Za-z0-9]{6})$/);
  if (bindMatch) {
    if (!bind.BIND_SECRET) return reply("❌ 綁定功能尚未啟用，請聯絡計畫窗口");
    if (tooManyFails(userId)) return reply("❌ 嘗試次數過多，請 1 小時後再試，或聯絡計畫窗口確認綁定碼");
    const ent = await bind.findByCode(bindMatch[1]);
    if (!ent) {
      bindFails[userId].push(Date.now());
      return reply("❌ 綁定碼不正確，請確認後再試一次（英文大小寫都可以）");
    }
    await bind.saveBinding(userId, {
      role: ent.role, key: ent.key, name: ent.name,
      displayName: await bind.displayName(userId),
      boundAt: new Date().toISOString(),
    });
    const menuOk = await bind.linkMenu(userId, ent.role);
    return reply("✅ 綁定完成：" + ent.name + "（" + bind.ROLE_LABEL[ent.role] + "）\n\n" +
      (ent.role === "teacher" ? TEACHER_HELP : CLINIC_HELP) +
      (menuOk ? "\n\n下方選單已切換成" + bind.ROLE_LABEL[ent.role] + "專用。" : ""));
  }

  if (isStaff) {
    const codeMatch = text.match(/^綁定碼\s*(.*)$/);
    if (codeMatch) return reply(await staffCodes(codeMatch[1]));
    if (text === "夥伴名單") return reply(await staffList());
    const unbindMatch = text.match(/^解除綁定\s+(.+)$/);
    if (unbindMatch) return reply(await staffUnbind(unbindMatch[1].trim()));
  }

  const b = await bind.getBinding(userId);

  if (text === "解除綁定" && b) {
    await bind.removeBinding(userId);
    await bind.unlinkMenu(userId);
    return reply("✅ 已解除綁定（" + b.name + "）。需要時可再輸入綁定碼重新綁定。");
  }

  const TEACHER_CMDS = { "我的課表": teacherSchedule, "課表": teacherSchedule, "報名人數": teacherEnrollment };
  const CLINIC_CMDS = { "診所統計": clinicSummary, "統計": clinicSummary, "禮券進度": clinicVoucher, "禮券": clinicVoucher };

  if (b && b.role === "teacher" && TEACHER_CMDS[text]) return reply(await TEACHER_CMDS[text](b));
  if (b && b.role === "clinic" && CLINIC_CMDS[text]) return reply(await CLINIC_CMDS[text](b));

  // 以下只處理非同仁：同仁的其餘訊息交回原本的 MeetBot 指令；
  // 臨時人員也會用的系統連結（簽到、排班、問題回報）一樣交回去
  if (isStaff || PUBLIC_KEYWORDS.includes(text)) return false;

  const HELP_WORDS = ["指令", "說明", "help", "Help", "?", "？"];
  if (!b) {
    // 未綁定的人只在看起來像指令時才提示綁定，一般對話不打擾（留給後台人工回覆）
    const looksLikeCmd = HELP_WORDS.includes(text) || text.startsWith("綁定") || TEACHER_CMDS[text] || CLINIC_CMDS[text];
    return looksLikeCmd ? reply(UNBOUND_HELP) : true;
  }
  if (TEACHER_CMDS[text] || CLINIC_CMDS[text]) {
    return reply("此功能僅限" + (b.role === "teacher" ? "診所" : "老師") + "使用。\n\n" + (b.role === "teacher" ? TEACHER_HELP : CLINIC_HELP));
  }
  if (HELP_WORDS.includes(text)) {
    return reply(b.role === "teacher" ? TEACHER_HELP : CLINIC_HELP);
  }
  // 其他閒聊不回，留給 LINE 後台人工回覆
  return true;
}

module.exports = { handlePartnerMessage, UNBOUND_HELP, PUBLIC_KEYWORDS, fmtDate, hhmm };

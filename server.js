const express = require("express");
const axios   = require("axios");
const ExcelJS = require("exceljs");
const https   = require("https");
const path    = require("path");
// 課程記錄暫存（記憶體，不限期）
const docStore = new Map();
function storeDoc(html, fileName) {
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2);
  docStore.set(uid, { html, fileName });
  return uid;
}

function generateRecordHtml(data) {
  const row = (label, value) =>
    `<tr><th>${label}</th><td>${value || "-"}</td></tr>`;
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>課程記錄 - ${data.name}</title>
<style>
  body{font-family:"Noto Sans TC",sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#333}
  h1{font-size:18px;text-align:center;margin-bottom:4px}
  h2{font-size:14px;text-align:center;color:#555;margin-bottom:24px;font-weight:normal}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ccc;padding:10px 14px;font-size:14px}
  th{background:#f0f4f9;width:35%;font-weight:600;text-align:left}
  td{text-align:left}
  .print-btn{display:block;margin:24px auto;padding:10px 28px;background:#1a73e8;color:#fff;border:none;border-radius:4px;font-size:15px;cursor:pointer}
  @media print{.print-btn{display:none}}
</style></head><body>
<h1>台北市醫師公會健康台灣深耕計畫</h1>
<h2>臺北市慢性病防治全人健康智慧整合照護計畫・處方課程開課紀錄表</h2>
<table>
  ${row("填表人", data.name)}
  ${row("課程日期", data.date)}
  ${row("課程開始時間", data.checkinStr)}
  ${row("課程結束時間", data.checkoutStr)}
  ${row("課程預計時數", data.plannedHours)}
  ${row("實際工作時數", data.hours + " 小時")}
  ${row("課程屬性", data.courseType)}
  ${row("課程名稱", data.course)}
  ${row("課程老師", data.teacher)}
  ${row("系統報名人數", data.registeredCount ?? "-")}
  ${row("線上報名實到人數", data.actualCount ?? "-")}
  ${row("無報名現場候補人數", data.walkInCount ?? "-")}
  ${row("簡述上課內容或回報狀況", data.summary)}
</table>
<button class="print-btn" onclick="window.print()">列印 / 另存 PDF</button>
</body></html>`;
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── CORS ──────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── 常數 ──────────────────────────────────────
const TOKEN = process.env.LINE_TOKEN;
const TEAM  = ["黃琴茹","蔡蕙芳","吳承儒","張鈺微","吳亞璇","許雅淇","戴豐逸","陳佩研"];

const MEMBERS = {
  "黃琴茹": "U858b6b722d9a01e1a927d07f8ffc65ed",
  "蔡蕙芳": "Uc05e7076d830f4f75ecc14a07b697e5c",
  "吳承儒": "U1307dd217e15b4ef777f8f0561c2e589",
  "張鈺微": "U7c71775e251051b61994eda22ddc2bec",
  "吳亞璇": "Ue69dbd040159f69636c08dfd9568aa63",
  "許雅淇": "U87efc2433f2ab838929cbfbdb2851748",
  "戴豐逸": "Uece4baaf97cfab39ad79c6ed0ee55d03",
  "陳佩研": "Uc8e074d50b3b20581945f5c6aca80d1d",
};

const ID_TO_NAME = Object.fromEntries(Object.entries(MEMBERS).map(([k, v]) => [v, k]));

const BOSS_IDS = [
  "Uc05e7076d830f4f75ecc14a07b697e5c", // 蔡蕙芳
  "Uece4baaf97cfab39ad79c6ed0ee55d03", // 戴豐逸
];

// 臨時人員系統：陳佩研、戴豐逸
const SYSTEMS = {
  "週報":     { name: "週報統計系統",             url: "https://s71043201-star.github.io/tpma-statistics/" },
  "會議":     { name: "meetbot 會議任務追蹤系統",  url: "https://s71043201-star.github.io/meetbot-app/" },
  "歷次列管": { name: "會議歷次列管事項生成系統",  url: "https://s71043201-star.github.io/meeting-system/" },
  "簽到":     { name: "臨時人員簽到系統",          url: "https://meetbot-check-in-system.onrender.com/checkin.html" },
  "後台":     { name: "出缺勤後台管理",            url: "https://meetbot-check-in-system.onrender.com/admin.html" },
};

const ATT_BOSS_IDS = [
  "Uc8e074d50b3b20581945f5c6aca80d1d",
  "Uece4baaf97cfab39ad79c6ed0ee55d03",
];
// 測試中：暫時只通知戴豐逸，測試完畢後再加回陳佩研
const ATT_NOTIFY_IDS = [
  "Uece4baaf97cfab39ad79c6ed0ee55d03", // 戴豐逸
];

const TASKS_FB = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/tasks.json";
const ATT_FB   = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/attendance";

// ── 工具函式 ──────────────────────────────────
async function sendLine(userId, message) {
  if (!userId || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

async function sendLineWithQuickReply(userId, message, quickItems) {
  if (!userId || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message, quickReply: { items: quickItems } }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

function daysLeft(deadline) {
  const today = new Date().toISOString().slice(0, 10);
  return Math.ceil((new Date(deadline) - new Date(today)) / 86400000);
}

function toTaipei(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function toROCYear(date) {
  return date.getFullYear() - 1911;
}

// ── Firebase：任務 ─────────────────────────────
async function fetchTasksFromFirebase() {
  return new Promise((resolve) => {
    https.get(TASKS_FB, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const obj = JSON.parse(data);
          resolve(obj ? Object.values(obj) : []);
        } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

// ── Firebase：出缺勤 ──────────────────────────
async function fbGet(subPath) {
  const { data } = await axios.get(`${ATT_FB}${subPath || ""}.json`);
  return data;
}
async function fbPost(record) {
  const { data } = await axios.post(`${ATT_FB}.json`, record);
  return data;
}
async function fbPut(subPath, record) {
  const { data } = await axios.put(`${ATT_FB}${subPath}.json`, record);
  return data;
}

async function fetchAttendance() {
  return new Promise((resolve) => {
    https.get(`${ATT_FB}.json`, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const obj = JSON.parse(data);
          resolve(obj ? Object.values(obj) : []);
        } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

function buildAttendanceReport(records, month) {
  const filtered = records.filter(r => r.month === month && r.status === "checked-out");
  if (filtered.length === 0) return `📭 ${month} 月無臨時人員出勤記錄`;

  const byName = {};
  filtered.forEach(r => {
    if (!byName[r.name]) byName[r.name] = { count: 0, hours: 0, list: [] };
    byName[r.name].count++;
    byName[r.name].hours += r.hours || 0;
    byName[r.name].list.push(r);
  });

  const total = filtered.reduce((s, r) => s + (r.hours || 0), 0);
  let msg = `📊 ${month} 月臨時人員出勤記錄\n${"═".repeat(22)}\n`;
  msg += `出勤人次：${filtered.length} 筆　總時數：${Math.round(total * 10) / 10} 小時\n${"─".repeat(22)}\n`;

  Object.entries(byName).forEach(([name, info]) => {
    msg += `\n👤 ${name}　出勤 ${info.count} 次　合計 ${Math.round(info.hours * 10) / 10} 時\n`;
    info.list.sort((a, b) => a.day - b.day).forEach(r => {
      msg += `   • ${month}/${r.day}（${r.course}）${r.hours} 時\n`;
    });
  });

  return msg.trim();
}

// ══════════════════════════════════════════════
// MeetBot Webhook
// ══════════════════════════════════════════════
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;
    const userId = event.source.userId;
    const text   = event.message.text.trim();
    console.log(`👤 ${userId} 說：${text}`);

    // ── 指令說明 ──
    if (["指令", "說明", "help", "Help", "?", "？"].includes(text)) {
      const sysLines = Object.entries(SYSTEMS).map(([kw, s]) => `• ${kw} — ${s.name}`).join("\n");
      await sendLine(userId, `📋 MeetBot 可用指令\n${"═".repeat(20)}\n\n👤 個人功能\n• 工作 — 查看我的待辦任務\n\n🔑 管理員功能\n• 進度 — 查看全團隊任務進度\n• 臨時人員 3 — 查看某月出勤記錄\n\n🖥 系統連結（輸入關鍵字取得網址）\n${sysLines}\n\n💬 管理員專用\n• 提醒 姓名 — 向指定成員發出工作提醒（隨時可用）`);
      continue;
    }

    // ── 系統網址 ──
    if (SYSTEMS[text]) {
      const s = SYSTEMS[text];
      await sendLine(userId, `🖥 ${s.name}\n\n🔗 ${s.url}`);
      continue;
    }

    // ── 提醒（圖文選單按鈕，無姓名 → 快速選人） ──
    if (text === "提醒") {
      if (!BOSS_IDS.includes(userId)) {
        await sendLine(userId, "❌ 此功能僅限管理員使用");
        continue;
      }
      const senderName  = ID_TO_NAME[userId] || "";
      const targets     = TEAM.filter(n => n !== senderName);
      const quickItems  = targets.map(name => ({
        type: "action",
        action: { type: "message", label: name, text: `提醒 ${name}` }
      }));
      await sendLineWithQuickReply(userId, "請選擇要提醒的成員：", quickItems);
      continue;
    }

    // ── 提醒指定成員（蔡蕙芳/戴豐逸，含姓名） ──
    const remindMatch = text.match(/^提醒\s*(.+)$/);
    if (remindMatch) {
      if (!BOSS_IDS.includes(userId)) {
        await sendLine(userId, "❌ 此功能僅限管理員使用");
        continue;
      }
      const targetName = remindMatch[1].trim();
      const targetId   = MEMBERS[targetName];
      if (!targetId) {
        await sendLine(userId, `❌ 找不到成員「${targetName}」`);
        continue;
      }
      await sendLine(targetId, `📌 工作進度提醒\n\n蔡蕙芳 希望你查看今日工作進度，並在系統中勾選已完成的任務。\n\n🔗 meetbot 系統：https://s71043201-star.github.io/meetbot-app/`);
      await sendLine(userId, `✅ 已向 ${targetName} 發出提醒`);
      continue;
    }

    // ── 臨時人員 ──
    if (text === "臨時人員") {
      if (!ATT_BOSS_IDS.includes(userId)) {
        await sendLine(userId, "❌ 此功能僅限管理員使用");
        continue;
      }
      await sendLine(userId, `📋 臨時人員查詢\n\n請輸入要查詢的月份：\n臨時人員 3\n（或「臨時人員 3月」）`);
      continue;
    }

    const tempMatch = text.match(/^臨時人員\s*(\d+)月?$/);
    if (tempMatch) {
      if (!ATT_BOSS_IDS.includes(userId)) {
        await sendLine(userId, "❌ 此功能僅限管理員使用");
        continue;
      }
      const month   = parseInt(tempMatch[1]);
      const records = await fetchAttendance();
      await sendLine(userId, buildAttendanceReport(records, month));
      continue;
    }

    // ── 下載 → 推送 Word 報告下載連結（蔡蕙芳/戴豐逸）──
    if (text === "下載") {
      if (!BOSS_IDS.includes(userId)) {
        await sendLine(userId, "❌ 此功能僅限管理員使用");
        continue;
      }
      await sendLine(userId,
        `📄 MeetBot 任務報告下載\n\n` +
        `點以下連結即可下載本週全團隊任務報告（.doc）：\n\n` +
        `https://meetbot-check-in-system.onrender.com/export-word\n\n` +
        `⚠️ 初次載入可能需稍等 10 秒（冷啟動）`
      );
      continue;
    }

    // ── 工作 ──
    if (text === "工作") {
      const name = ID_TO_NAME[userId];
      if (!name) { await sendLine(userId, "❌ 找不到你的帳號，請聯絡管理員"); continue; }
      const tasks = await fetchTasksFromFirebase();
      const mine  = tasks.filter(t => t.assignee === name && !t.done);
      if (mine.length === 0) {
        await sendLine(userId, `✅ ${name}，你目前沒有待辦任務！繼續保持 💪`);
      } else {
        const lines = mine.map((t, i) => {
          const d = daysLeft(t.deadline);
          const tag = d < 0 ? "🚨 逾期" : d === 0 ? "⚡ 今天截止" : d <= 2 ? `⏰ 剩 ${d} 天` : `📅 ${t.deadline}`;
          return `${i+1}. ${t.title}\n   ${tag}`;
        }).join("\n\n");
        await sendLine(userId, `📋 ${name} 的待辦任務（共 ${mine.length} 項）\n\n${lines}\n\n請在期限前完成 ✓`);
      }
      continue;
    }

    // ── 進度 ──
    if (text === "進度") {
      if (!BOSS_IDS.includes(userId)) {
        await sendLine(userId, "❌ 此功能僅限管理員使用");
        continue;
      }
      const tasks   = await fetchTasksFromFirebase();
      const total   = tasks.length;
      const done    = tasks.filter(t => t.done).length;
      const overdue = tasks.filter(t => !t.done && daysLeft(t.deadline) < 0).length;
      const pct     = total ? Math.round(done / total * 100) : 0;

      const memberLines = TEAM.map(name => {
        const mine      = tasks.filter(t => t.assignee === name);
        const mDone     = mine.filter(t => t.done).length;
        const pending   = mine.filter(t => !t.done);
        const doneList  = mine.filter(t => t.done);
        let lines = `👤 ${name}（${mDone}/${mine.length} 完成）`;
        if (pending.length > 0) {
          lines += "\n📌 待辦：";
          pending.forEach(t => {
            const d = daysLeft(t.deadline);
            const tag = d < 0 ? `🚨逾期${Math.abs(d)}天` : d === 0 ? "⚡今天截止" : d <= 2 ? `⏰剩${d}天` : `📅${t.deadline}`;
            lines += `\n  • ${t.title}\n    ${tag}`;
          });
        }
        if (doneList.length > 0) {
          lines += "\n✅ 已完成：";
          doneList.forEach(t => { lines += `\n  • ${t.title}`; });
        }
        if (mine.length === 0) lines += "\n  （尚無指派任務）";
        return lines;
      }).join("\n\n" + "─".repeat(18) + "\n\n");

      await sendLine(userId,
        `📊 全團隊任務進度報告\n${"═".repeat(20)}\n整體完成率：${pct}%（${done}/${total}）\n逾期任務：${overdue} 項\n${"═".repeat(20)}\n\n${memberLines}\n\n⏰ ${new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}`
      );
      continue;
    }
  }
});

// ── AI 解析會議記錄 ────────────────────────────
app.post("/parse-meeting", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "缺少 text" });
  const today_str = new Date().toISOString().slice(0, 10);
  try {
    const response = await axios.post("https://api.anthropic.com/v1/messages", {
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: `你是會議記錄分析助理。從以下會議紀錄中，找出所有「任務/行動項目」。\n每個任務需包含：負責人、任務描述、截止日期。今天是 ${today_str}。\n若日期只說「本週五」請換算成實際日期。若無法確定截止日期，設定為 7 天後。\n負責人請從以下名單選最接近的：${TEAM.join("、")}。若無法對應，填「待指派」。\n\n請只回傳 JSON 陣列，格式如下，不要有任何說明文字：\n[{"title":"任務描述","assignee":"負責人","deadline":"YYYY-MM-DD"}]\n\n會議紀錄：\n${text}` }]
    }, { headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } });
    const raw   = response.data.content?.find(b => b.type === "text")?.text || "[]";
    const items = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 任務提醒 ──────────────────────────────────
app.post("/check-reminders", async (req, res) => {
  const { tasks, reminders } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "缺少參數" });
  const hour = new Date().getHours();
  let sent = 0;
  for (const task of tasks) {
    if (task.done) continue;
    const dl     = daysLeft(task.deadline);
    const userId = MEMBERS[task.assignee];
    if (!userId) continue;
    if (reminders.dayBefore?.on && dl === reminders.dayBefore.days && hour === reminders.dayBefore.hour) {
      await sendLine(userId, `📋 任務提醒 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n截止日期：${task.deadline}（剩 ${dl} 天）\n\n請記得完成 ✓`);
      sent++;
    }
    if (reminders.hourBefore?.on && dl === 0 && hour === (23 - reminders.hourBefore.hours)) {
      await sendLine(userId, `⚡ 緊急提醒 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n今天截止！剩約 ${reminders.hourBefore.hours} 小時\n\n請盡快完成 🔥`);
      sent++;
    }
    if (reminders.overdueAlert?.on && dl < 0) {
      await sendLine(userId, `🚨 逾期警示 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n已逾期 ${Math.abs(dl)} 天！\n\n請盡快處理 ⚠️`);
      sent++;
    }
  }
  res.json({ ok: true, sent });
});

// ── 新任務通知 ────────────────────────────────
app.post("/notify-new-task", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "缺少 task" });
  const userId = MEMBERS[task.assignee];
  if (!userId) return res.json({ ok: false, reason: "找不到成員" });
  try {
    await sendLine(userId, `📋 新任務指派 - MeetBot\n\n你有一項新任務：\n「${task.title}」\n\n截止日期：${task.deadline}\n來源會議：${task.meeting}\n\n請記得在期限前完成 ✓`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════
// 出缺勤系統
// ══════════════════════════════════════════════

// ── 簽到 ──────────────────────────────────────
app.post("/checkin", async (req, res) => {
  const { name, eventName, workDescription, feeTypes, payMethod, bankInfo, idNumber, address, liveAddress, phone } = req.body;
  if (!name) return res.status(400).json({ error: "缺少姓名" });

  const now    = new Date();
  const taipei = toTaipei(now);

  const record = {
    name, eventName: eventName || "",
    workDescription: workDescription || "",
    feeTypes: feeTypes || [],
    payMethod: payMethod || "",
    bankInfo: bankInfo || {},
    idNumber: idNumber || "",
    address: address || "",
    liveAddress: liveAddress || "",
    phone: phone || "",
    checkinTime: now.toISOString(),
    year:  toROCYear(taipei),
    month: taipei.getMonth() + 1,
    day:   taipei.getDate(),
    status: "checked-in"
  };

  try {
    const result    = await fbPost(record);
    const sessionId = result.name;
    const timeStr   = taipei.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const msg = `✅ 臨時人員簽到\n\n👤 姓名：${name}\n📋 活動：${eventName || "-"}\n⏰ 簽到時間：${timeStr}`;
    for (const uid of ATT_NOTIFY_IDS) await sendLine(uid, msg).catch(() => {});
    res.json({ ok: true, sessionId });
  } catch (e) {
    console.error("checkin:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 簽退 ──────────────────────────────────────
app.post("/checkout", async (req, res) => {
  const { sessionId, shift, workContent, note, checkinType, courses, scheduledTime } = req.body;
  if (!sessionId) return res.status(400).json({ error: "缺少 sessionId" });

  const now    = new Date();
  const taipei = toTaipei(now);

  try {
    const record      = await fbGet(`/${sessionId}`);
    if (!record) return res.status(404).json({ error: "找不到簽到記錄" });
    const checkinTime = new Date(record.checkinTime);
    const hours       = Math.round((now - checkinTime) / 3600000 * 10) / 10;
    const { courseType, teacher, plannedHours, registeredCount, actualCount, walkInCount, summary } = req.body;
    const course      = req.body.course || "";
    const checkinStr  = toTaipei(checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const checkoutStr = taipei.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const dateStr     = `${record.year}/${record.month}/${record.day}`;
    const typeLabel   = checkinType === "處方日" ? "處方日" : "一般";

    const updated = {
      ...record,
      checkoutTime:     now.toISOString(),
      checkinType:      checkinType || "一般",
      course:           course,
      courses:          courses || [],
      scheduledTime:    scheduledTime || "",
      courseType:       courseType || "",
      teacher:          teacher || "",
      plannedHours:     plannedHours || "",
      registeredCount:  registeredCount ?? "",
      actualCount:      actualCount ?? "",
      walkInCount:      walkInCount ?? "",
      summary:          summary || "",
      hours,
      status: "checked-out"
    };
    await fbPut(`/${sessionId}`, updated);

    // 產生課程記錄頁
    const recordHtml = generateRecordHtml({
      name: record.name, course: course, date: dateStr,
      checkinStr, checkoutStr, hours, plannedHours, courseType,
      teacher, registeredCount, actualCount, walkInCount, summary
    });
    const uid = storeDoc(recordHtml, `課程記錄_${record.name}`);
    const downloadUrl = `${process.env.BASE_URL || "https://meetbot-check-in-system.onrender.com"}/download/${uid}`;

    const msg = `🔚 臨時人員簽退\n\n👤 姓名：${record.name}\n🏷 類型：${typeLabel}\n📚 課程：${course || "-"}\n🏷 屬性：${courseType || "-"}\n⏰ 簽到：${checkinStr}　簽退：${checkoutStr}\n⏱ 時數：${hours} 小時\n👥 實到：${actualCount ?? "-"} 人\n\n📄 課程記錄（可列印/存PDF）：\n${downloadUrl}`;
    for (const notifyId of ATT_NOTIFY_IDS) await sendLine(notifyId, msg).catch(() => {});
    res.json({ ok: true, hours });
  } catch (e) {
    console.error("checkout:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢單一 session ──────────────────────────
app.get("/session/:id", async (req, res) => {
  try {
    const record = await fbGet(`/${req.params.id}`);
    if (!record) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, record, sessionId: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢姓名是否有進行中的簽到 ────────────────
app.get("/active-session", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "缺少 name" });
  try {
    const data = await fbGet();
    if (!data) return res.json({ found: false });
    const entry = Object.entries(data).find(
      ([, r]) => r.name === name && r.status === "checked-in"
    );
    if (!entry) return res.json({ found: false });
    res.json({ found: true, sessionId: entry[0], record: entry[1] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢領據歷史資料（依姓名） ─────────────────
app.get("/receipt-data", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "缺少 name" });
  try {
    const data = await fbGet();
    if (!data) return res.json({ found: false });
    // 找該姓名最新一筆有身分證資料的紀錄
    const entries = Object.entries(data)
      .filter(([, r]) => r.name === name && r.idNumber)
      .sort((a, b) => new Date(b[1].checkinTime) - new Date(a[1].checkinTime));
    if (entries.length === 0) return res.json({ found: false });
    const record = entries[0][1];
    res.json({
      found: true,
      record: {
        eventName: record.eventName,
        workDescription: record.workDescription,
        feeTypes: record.feeTypes,
        payMethod: record.payMethod,
        bankInfo: record.bankInfo,
        idNumber: record.idNumber,
        address: record.address,
        liveAddress: record.liveAddress,
        phone: record.phone,
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢記錄 ──────────────────────────────────
app.get("/records", async (req, res) => {
  try {
    const data    = await fbGet();
    const records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    res.json(records);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 刪除記錄 ──────────────────────────────────
app.delete("/records/:id", async (req, res) => {
  try {
    await axios.delete(`${ATT_FB}/${req.params.id}.json`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 匯出 Excel ────────────────────────────────
function safeSheetName(wb, name) {
  // 移除 Excel 不允許的字元，限制 31 字
  let base = (name || '無名').replace(/[\\/?*[\]:]/g, '').slice(0, 31).trim() || '無名';
  // 避免與已存在的工作表名稱衝突（不分大小寫）
  const exists = () => wb.worksheets.some(ws => ws.name.toLowerCase() === base.toLowerCase());
  let i = 2;
  const orig = base;
  while (exists()) base = orig.slice(0, 29) + '_' + (i++);
  return base;
}

function buildPersonSheet(wb, personName, records) {
  const ws = wb.addWorksheet(safeSheetName(wb, personName));

  const bdr  = { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} };
  const mid  = { horizontal:"center", vertical:"middle" };
  const lmid = { horizontal:"left",   vertical:"middle", wrapText:true };
  const tk   = { name:"DFKai-SB", size:12, charset:136 };

  // 欄寬：A(1) B(2)編號 C(3)年 D(4)月 E(5)日 F(6)課程名稱 G(7)時分 H(8)至時分 I(9)共計
  [5, 8, 8, 12, 12, 32, 13, 13, 13].forEach((w, i) => { ws.getColumn(i+1).width = w; });

  // Row 1 大標題
  ws.mergeCells("B1:I1");
  ws.getRow(1).height = 42;
  ws.getCell("B1").value = "健康台灣深耕計畫專職人員出勤記錄表";
  ws.getCell("B1").style = { font:{...tk, size:14, bold:true}, alignment:mid };

  // Row 2 副標題
  ws.mergeCells("B2:I2");
  ws.getRow(2).height = 36;
  ws.getCell("B2").value = "臨時人員出勤記錄與工作內容說明";
  ws.getCell("B2").style = { font:{...tk, size:13, bold:true}, alignment:mid };

  // Row 3 姓名 + 工作內容
  ws.mergeCells("C3:D3");
  ws.mergeCells("F3:I3");
  ws.getRow(3).height = 90;
  ws.getCell("B3").value = "姓名";
  ws.getCell("B3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("C3").value = personName;
  ws.getCell("C3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("E3").value = "工作內容";
  ws.getCell("E3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("F3").value = "協助處方課執行期間\n場地協助、報到協助、出席紀錄、活動影像紀錄、課後滿意度調查提醒等";
  ws.getCell("F3").style = { font:tk, alignment:lmid, border:bdr };

  // Row 4 欄位標題
  ws.getRow(4).height = 30;
  ["", "編號", "年", "月", "日", "課程名稱", "時　分", "至時分", "共計（時）"].forEach((h, i) => {
    if (i === 0) return;
    const cell = ws.getCell(4, i+1);
    cell.value = h;
    cell.style = { font:tk, alignment:mid, border:bdr };
  });

  // 資料列
  let totalHours = 0;
  const dataStart = 5;
  records.forEach((r, idx) => {
    const rn  = dataStart + idx;
    ws.getRow(rn).height = 30;
    const ci  = toTaipei(new Date(r.checkinTime)).toLocaleTimeString("zh-TW",  { hour:"2-digit", minute:"2-digit" });
    const co  = toTaipei(new Date(r.checkoutTime)).toLocaleTimeString("zh-TW", { hour:"2-digit", minute:"2-digit" });
    const row = ["", idx+1, r.year, r.month, r.day, r.course||"", ci, co, r.hours];
    row.forEach((v, i) => {
      if (i === 0) return;
      const cell = ws.getCell(rn, i+1);
      cell.value = v;
      cell.style = { font:tk, alignment: i === 5 ? lmid : mid, border:bdr };
    });
    totalHours += r.hours || 0;
  });

  // 合計列
  const tr = dataStart + records.length;
  ws.getRow(tr).height = 30;
  // 不使用 mergeCells，改為逐格設定邊線確保底線完整
  for (let c = 2; c <= 9; c++) {
    const cell = ws.getCell(tr, c);
    if (c === 2) {
      cell.value = "累計";
      cell.style = { font:{...tk, bold:true}, alignment:mid, border:bdr };
    } else if (c === 9) {
      cell.value = Math.round(totalHours * 10) / 10;
      cell.style = { font:{...tk, bold:true}, alignment:mid, border:bdr };
    } else {
      cell.style = { border:bdr };
    }
  }
}

app.get("/export", async (req, res) => {
  const { name: nameFilter, month: monthFilter, year: yearFilter } = req.query;
  try {
    const data = await fbGet();
    let records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    if (nameFilter)  records = records.filter(r => r.name  === nameFilter);
    if (monthFilter) records = records.filter(r => r.month === parseInt(monthFilter));
    if (yearFilter)  records = records.filter(r => r.year  === parseInt(yearFilter));
    records = records.filter(r => r.status === "checked-out");
    records.sort((a, b) => new Date(a.checkinTime) - new Date(b.checkinTime));

    // 按人分組
    const byPerson = {};
    records.forEach(r => {
      if (!byPerson[r.name]) byPerson[r.name] = [];
      byPerson[r.name].push(r);
    });

    const wb = new ExcelJS.Workbook();
    if (Object.keys(byPerson).length === 0) {
      buildPersonSheet(wb, nameFilter || "無記錄", []);
    } else {
      for (const [pname, pRecords] of Object.entries(byPerson)) {
        buildPersonSheet(wb, pname, pRecords);
      }
    }

    const fileName = `臨時人員出勤記錄_${yearFilter||""}年${monthFilter ? monthFilter+"月" : ""}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("export:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 下載 Word 檔 ──────────────────────────────
app.get("/download/:uid", (req, res) => {
  const item = docStore.get(req.params.uid);
  if (!item) return res.status(404).send("頁面不存在（伺服器重啟後連結會失效，請重新簽到簽退產生新記錄）");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(item.html);
});

// ── 任務完成通知 ──────────────────────────────
app.post("/notify-task-done", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "缺少 task" });
  const userId = MEMBERS[task.assignee];
  if (!userId) return res.json({ ok: false, reason: "找不到成員" });
  try {
    await sendLine(userId, `🎉 恭喜 ${task.assignee}！\n\n「${task.title}」已完成！\n\n辛苦了，繼續保持 💪`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 匯出 Word 任務報告 ────────────────────────
app.get("/export-word", async (req, res) => {
  try {
    const tasks = await fetchTasksFromFirebase();
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    const total = tasks.length;
    const doneCount = tasks.filter(t => t.done).length;
    const pct = total ? Math.round(doneCount / total * 100) : 0;

    const statusOf = (t) => {
      if (t.done) return "✅ 已完成";
      const today = new Date().toISOString().slice(0, 10);
      const d = Math.ceil((new Date(t.deadline) - new Date(today)) / 86400000);
      if (d < 0) return `🚨 逾期 ${Math.abs(d)} 天`;
      if (d === 0) return "⚡ 今天截止";
      if (d <= 2) return `⏰ 剩 ${d} 天`;
      return `📅 ${t.deadline} 截止`;
    };

    let rows = "";
    TEAM.forEach(name => {
      const mine = tasks.filter(t => t.assignee === name);
      if (mine.length === 0) return;
      const done = mine.filter(t => t.done).length;
      rows += `<tr><td colspan="4" style="background:#1a2240;color:#7eb3ff;font-weight:bold;font-size:14pt;padding:8px 12px;">👤 ${name}　${done}/${mine.length} 完成</td></tr>`;
      mine.forEach((t, i) => {
        const bg = i % 2 === 0 ? "#f5f7ff" : "#ffffff";
        const noteHtml = t.progressNote
          ? `<br><span style="color:#4f8cff;font-size:11pt;">📝 ${t.progressNote}${t.progressNoteTime ? `（${t.progressNoteTime}）` : ""}</span>`
          : "";
        rows += `<tr style="background:${bg};"><td style="padding:7px 12px;">${t.title}${noteHtml}</td><td style="padding:7px 12px;white-space:nowrap;">${t.assignee}</td><td style="padding:7px 12px;white-space:nowrap;">${t.deadline}</td><td style="padding:7px 12px;white-space:nowrap;">${statusOf(t)}</td></tr>`;
      });
    });

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<style>
  body{font-family:"Microsoft JhengHei","微軟正黑體",sans-serif;color:#1a1a2e;}
  h1{font-size:18pt;color:#4f8cff;margin-bottom:4px;}
  .sub{font-size:12pt;color:#5a6285;margin-bottom:18px;}
  table{border-collapse:collapse;width:100%;}
  th{background:#2a3560;color:#fff;font-size:12pt;padding:8px 12px;text-align:left;}
  td{border-bottom:1px solid #e0e4f0;vertical-align:top;font-size:12pt;}
</style></head>
<body>
<h1>📋 MeetBot 任務進度報告</h1>
<div class="sub">匯出時間：${now}　整體完成率：${pct}%（${doneCount}/${total}）</div>
<table>
  <tr><th style="width:50%">任務</th><th style="width:12%">負責人</th><th style="width:15%">截止日期</th><th style="width:23%">狀態</th></tr>
  ${rows}
</table>
<p style="margin-top:20px;font-size:11pt;color:#8890aa;">此報告由 MeetBot 系統自動生成</p>
</body></html>`;

    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''MeetBot%E4%BB%BB%E5%8B%99%E5%A0%B1%E5%91%8A.doc");
    res.send("\uFEFF" + html);
  } catch (e) {
    console.error("匯出失敗:", e.message);
    res.status(500).send("匯出失敗：" + e.message);
  }
});

// ── 測試 ──────────────────────────────────────
app.get("/test-me", async (req, res) => {
  try {
    await sendLine("Uece4baaf97cfab39ad79c6ed0ee55d03", "📋 MeetBot 測試成功！LINE Bot 已正常連線 🎉");
    res.send("訊息已發送 ✅");
  } catch (e) {
    res.status(500).send("發送失敗：" + e.message);
  }
});

// ── 匯出領據 Excel ──────────────────────────────
// ── 匯出領據 Word ───────────────────────────────
app.get("/export-full", async (req, res) => {
  const { name, month, year } = req.query;
  try {
    const data = await fbGet();
    let records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    if (month) records = records.filter(r => r.month === parseInt(month));
    if (year)  records = records.filter(r => r.year  === parseInt(year));

    const grouped = {};
    records.forEach(r => {
      if (!r.name) return;
      if (name && r.name !== name) return;
      if (!grouped[r.name]) grouped[r.name] = [];
      grouped[r.name].push(r);
    });

    const allFeeTypes = ["稿費","審查費","講座鐘點費","臨時人員費","出席費","交通差旅費","其他"];

    let pages = "";
    for (const [pName, pRecs] of Object.entries(grouped)) {
      const latest = pRecs.find(r => r.idNumber) || pRecs[0];
      const fa = Array.isArray(latest.feeTypes) ? latest.feeTypes : [];
      const feeStr = allFeeTypes.map(ft => `□${ft}`).join("");
      const pm = latest.payMethod || "";
      const bi = latest.bankInfo || {};
      const idNum = latest.idNumber || "";
      const idCells = Array.from({length:10}, (_,i) =>
        `<td class="id-cell">${idNum[i] || ""}</td>`
      ).join("");
      const addr = latest.address || "";
      const la = latest.liveAddress || "";
      const sameAddr = !la || la === addr;

      pages += `
      <div class="page">
        <h2>社團法人台北市醫師公會　領據（健康台灣深耕計畫）</h2>
        <table>
          <tr>
            <th class="lbl">領款人姓名</th>
            <td class="val">${pName}</td>
            <th class="lbl" colspan="3">事由或會議名稱</th>
            <td class="val" colspan="5">${latest.eventName || ""}</td>
          </tr>
          <tr>
            <th class="lbl">費用別</th>
            <td colspan="9">${feeStr}</td>
          </tr>
          <tr>
            <th class="lbl">金額</th>
            <td colspan="9">新臺幣＿＿＿萬＿＿＿仟＿＿＿佰＿＿＿拾＿＿＿元整（＄＿＿＿＿＿＿）</td>
          </tr>
          <tr>
            <th class="lbl" rowspan="4">領款方式</th>
            <td colspan="9">□現金</td>
          </tr>
          <tr>
            <td colspan="9">□匯款</td>
          </tr>
          <tr>
            <td colspan="9">受款銀行名稱:${bi.bankName || ""}</td>
          </tr>
          <tr>
            <td colspan="4">戶名:${bi.accountName || ""}</td>
            <td colspan="5">帳號:${bi.account || ""}</td>
          </tr>
          <tr>
            <th class="lbl">領款日期</th>
            <td colspan="4" style="text-align:center;">中華民國＿＿＿年＿＿月＿＿日</td>
            <td colspan="2" style="text-align:center;font-weight:bold;">領款人簽章</td>
            <td colspan="3" style="height:50px;"></td>
          </tr>
          <tr>
            <th class="lbl">身分證號碼</th>
            ${idCells}
          </tr>
          <tr>
            <th class="lbl" rowspan="2">戶籍地址</th>
            <td colspan="2">${addr ? addr : ""}市縣</td>
            <td colspan="2">區市鄉鎮</td>
            <td colspan="2">里村</td>
            <td>鄰</td>
            <td colspan="2">路街</td>
          </tr>
          <tr>
            <td colspan="2">段</td>
            <td>巷</td>
            <td>弄</td>
            <td colspan="2">號</td>
            <td>樓</td>
            <td colspan="2">之</td>
          </tr>
          <tr>
            <th class="lbl" rowspan="2">居住地址</th>
            <td colspan="9">${sameAddr ? "☑" : "□"}同上　${sameAddr ? "□" : "☑"}請另填：${sameAddr ? "" : la}</td>
          </tr>
          <tr>
            <td colspan="9" style="height:24px;"></td>
          </tr>
          <tr>
            <th class="lbl">連絡電話</th>
            <td colspan="9">${latest.phone || ""}</td>
          </tr>
        </table>
      </div>`;
    }

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="urn:schemas-microsoft-com:office:word"
  xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 2cm 1.5cm 2cm 1.5cm; }
  body { font-family: "DFKai-SB","標楷體","Microsoft JhengHei",sans-serif; color: #000; font-size: 12pt; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  h2 { font-size: 15pt; text-align: center; margin-bottom: 12px; font-weight: bold; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #000; padding: 6px 8px; font-size: 11pt; vertical-align: middle; }
  th.lbl { background: #fff; font-weight: bold; text-align: center; width: 90px; }
  td { text-align: left; }
  .id-cell { width: 30px; height: 30px; text-align: center; font-size: 14pt; font-family: "Courier New", monospace; }
</style></head>
<body>${pages}</body></html>`;

    const fn = `領據_${name || "全部人員"}.doc`;
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`);
    res.send("\uFEFF" + html);
  } catch (e) {
    console.error("export-full:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.redirect("/checkin.html"));

// ── 排程器：平日提醒 ──────────────────────────
let lastRun430 = "";
let lastRun450 = "";

setInterval(async () => {
  const taipei  = toTaipei(new Date());
  const day     = taipei.getDay();   // 0=Sun, 6=Sat
  const hour    = taipei.getHours();
  const min     = taipei.getMinutes();
  const dateKey = taipei.toISOString().slice(0, 10);

  if (day === 0 || day === 6) return;

  // 16:30 — 除蔡蕙芳以外所有人：請至 meetbot 勾選完成項目
  if (hour === 16 && min === 30 && lastRun430 !== dateKey) {
    lastRun430 = dateKey;
    const targets = Object.entries(MEMBERS)
      .filter(([name]) => name !== "蔡蕙芳")
      .map(([, id]) => id);
    const msg = `📌 下午工作進度提醒\n\n現在是 16:30，請至 meetbot 系統查看您的待辦任務，並勾選今日已完成的項目。\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
    for (const id of targets) await sendLine(id, msg).catch(() => {});
    console.log("排程 16:30 提醒已發送");
  }

  // 16:50 — 蔡蕙芳：查看進度並可選擇向誰發提醒
  if (hour === 16 && min === 50 && lastRun450 !== dateKey) {
    lastRun450 = dateKey;
    const memberNames = TEAM.filter(n => n !== "蔡蕙芳");
    const quickItems  = memberNames.map(name => ({
      type: "action",
      action: { type: "message", label: name, text: `提醒 ${name}` }
    }));
    const msg = `📊 下午進度追蹤提醒\n\n現在是 16:50，請查看今日全員工作進度。\n\n如需向特定成員補發提醒，請點選下方姓名：\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
    for (const bossId of BOSS_IDS) {
      await sendLineWithQuickReply(bossId, msg, quickItems).catch(() => {});
    }
    console.log("排程 16:50 提醒已發送");
  }
}, 60000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`MeetBot + 出缺勤系統啟動，port ${PORT}`));

const express = require("express");
const axios = require("axios");
const router = express.Router();
const { TEAM, MEMBERS } = require("../config");
const { daysLeft, toTaipei } = require("../utils");
const { sendSlack, slackMention, sendSlackToUser } = require("../slack");

// ── AI 解析會議記錄 ────────────────────────────
router.post("/parse-meeting", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "缺少 text" });
  const today_str = new Date().toISOString().slice(0, 10);
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const response = await axios.post(geminiUrl, {
      contents: [{ role: "user", parts: [{ text: `你是會議記錄分析助理。從以下會議紀錄中，找出所有「任務/行動項目」。\n每個任務需包含：負責人、任務描述、截止日期。今天是 ${today_str}。\n若日期只說「本週五」請換算成實際日期。若無法確定截止日期，設定為 7 天後。\n負責人請從以下名單選最接近的：${TEAM.join("、")}。若無法對應，填「待指派」。\n\n請只回傳 JSON 陣列，格式如下，不要有任何說明文字：\n[{"title":"任務描述","assignee":"負責人","deadline":"YYYY-MM-DD"}]\n\n會議紀錄：\n${text}` }] }],
      generationConfig: { maxOutputTokens: 4000 }
    }, { headers: { "Content-Type": "application/json" } });
    const raw = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const items = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 任務提醒 ──────────────────────────────────
router.post("/check-reminders", async (req, res) => {
  const { tasks, reminders, routineTasks } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "缺少參數" });
  const taipei = toTaipei(new Date());
  const hour = taipei.getHours();
  const weekday = taipei.getDay(); // 0=日, 1=一, ..., 6=六
  let sent = 0;
  const slackByPerson = {};
  for (const task of tasks) {
    if (task.done) continue;
    const dl = daysLeft(task.deadline);
    if (reminders.dayBefore?.on && dl === reminders.dayBefore.days && hour === reminders.dayBefore.hour) {
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push(`📋 「${task.title}」— 截止：${task.deadline}（剩 ${dl} 天）`);
      sent++;
    }
    if (reminders.hourBefore?.on && dl === 0 && hour === (23 - reminders.hourBefore.hours)) {
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push(`⚡ 「${task.title}」— 今天截止！`);
      sent++;
    }
    if (reminders.overdueAlert?.on && dl < 0) {
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push(`🚨 「${task.title}」— 已逾期 ${Math.abs(dl)} 天！`);
      sent++;
    }
  }
  // 例行任務提醒：比對台灣時間的星期幾 + 小時
  const WD_NAMES = ["日","一","二","三","四","五","六"];
  if (Array.isArray(routineTasks)) {
    for (const rt of routineTasks) {
      if (!rt.reminderOn) continue;
      if (rt.reminderWeekday === weekday && rt.reminderHour === hour) {
        const name = rt.assignee || "未指派";
        if (!slackByPerson[name]) slackByPerson[name] = [];
        slackByPerson[name].push(`🔄 例行任務提醒 —「${rt.title}」（每週${WD_NAMES[rt.reminderWeekday]} ${String(rt.reminderHour).padStart(2,"0")}:00）`);
        sent++;
      }
    }
  }
  for (const [name, items] of Object.entries(slackByPerson)) {
    await sendSlackToUser(name, `📬 任務提醒 - MeetBot\n\n你有 ${items.length} 項任務需注意：\n\n${items.join("\n")}\n\n請盡快處理 ✓\n🔗 https://s71043201-star.github.io/meetbot-app/`);
  }
  res.json({ ok: true, sent });
});

// ── 新任務通知 ────────────────────────────────
router.post("/notify-new-task", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "缺少 task" });
  const userId = MEMBERS[task.assignee];
  if (!userId) return res.json({ ok: false, reason: "找不到成員" });
  try {
    await sendSlackToUser(task.assignee, `📋 新任務指派 - MeetBot\n\n你有一項新任務：\n「${task.title}」\n\n截止日期：${task.deadline}\n來源會議：${task.meeting}\n\n請記得在期限前完成 ✓\n🔗 https://s71043201-star.github.io/meetbot-app/`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 任務完成通知 ──────────────────────────────
router.post("/notify-task-done", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "缺少 task" });
  const userId = MEMBERS[task.assignee];
  if (!userId) return res.json({ ok: false, reason: "找不到成員" });
  try {
    await sendSlackToUser(task.assignee, `🎉 恭喜！\n\n「${task.title}」已完成！\n\n辛苦了，繼續保持 💪`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

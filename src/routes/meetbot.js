const express = require("express");
const axios = require("axios");
const router = express.Router();
const { TEAM, MEMBERS, ANTHROPIC_API_KEY } = require("../config");
const { daysLeft } = require("../utils");
const { sendSlack, slackMention } = require("../slack");

// ── AI 解析會議記錄 ────────────────────────────
router.post("/parse-meeting", async (req, res) => {
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
router.post("/check-reminders", async (req, res) => {
  const { tasks, reminders } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "缺少參數" });
  const hour = new Date().getHours();
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
  for (const [name, items] of Object.entries(slackByPerson)) {
    await sendSlack(`📬 任務提醒 - MeetBot\n\n${slackMention(name)} 你有 ${items.length} 項任務需注意：\n\n${items.join("\n")}\n\n請盡快處理 ✓`);
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
    await sendSlack(`📋 新任務指派 - MeetBot\n\n${slackMention(task.assignee)} 有一項新任務：\n「${task.title}」\n\n截止日期：${task.deadline}\n來源會議：${task.meeting}\n\n請記得在期限前完成 ✓`);
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
    await sendSlack(`🎉 恭喜 ${slackMention(task.assignee)}！\n\n「${task.title}」已完成！\n\n辛苦了，繼續保持 💪`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

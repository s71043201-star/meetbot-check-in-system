const express = require("express");
const router = express.Router();
const { TEAM, MEMBERS } = require("../config");
const { daysLeft, toTaipei } = require("../utils");
const { sendSlack, slackMention, sendSlackToUser } = require("../slack");

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

const { TEAM } = require("./config");
const { toTaipei } = require("./utils");
const { sendSlack, sendSlackToUser } = require("./slack");
const { fetchRoutineTasksFromFirebase } = require("./firebase");

let lastRun430 = "";
let lastRun450 = "";
const routineReminderSent = {}; // 防止同一小時重複發送：key = "taskId-dateKey-hour"
const dailyReminderSent = {};   // 一天只提醒一次：key = "name-dateKey"

function startScheduler() {
  setInterval(async () => {
    const taipei  = toTaipei(new Date());
    const day     = taipei.getDay();
    const hour    = taipei.getHours();
    const min     = taipei.getMinutes();
    const dateKey = taipei.toISOString().slice(0, 10);

    if (day === 0 || day === 6) return;

    // 16:30 — 全員提醒
    if (hour === 16 && min === 30 && lastRun430 !== dateKey) {
      lastRun430 = dateKey;
      const msg = `📌 下午工作進度提醒\n\n現在是 16:30，請至 meetbot 系統查看您的待辦任務，並勾選今日已完成的項目。\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
      await sendSlack(msg);
      console.log("排程 16:30 Slack 提醒已發送");
    }

    // 16:50 — 管理員提醒
    if (hour === 16 && min === 50 && lastRun450 !== dateKey) {
      lastRun450 = dateKey;
      const memberNames = TEAM.filter(n => n !== "蔡蕙芳").join("、");
      const msg = `📊 下午進度追蹤提醒\n\n現在是 16:50，請查看今日全員工作進度。\n\n團隊成員：${memberNames}\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
      await sendSlack(msg);
      console.log("排程 16:50 Slack 提醒已發送");
    }

    // 例行任務提醒：每分鐘檢查，比對台灣時間星期幾 + 小時
    try {
      const routineTasks = await fetchRoutineTasksFromFirebase();
      const WD_NAMES = ["日","一","二","三","四","五","六"];
      for (const rt of routineTasks) {
        if (!rt.reminderOn) continue;
        if (rt.reminderWeekday !== day || rt.reminderHour !== hour) continue;
        const sentKey = `${rt.id}-${dateKey}-${hour}`;
        if (routineReminderSent[sentKey]) continue;
        routineReminderSent[sentKey] = true;
        const name = rt.assignee || "未指派";
        // 一天只提醒一次同一位同仁
        const dailyKey = `${name}-${dateKey}`;
        if (dailyReminderSent[dailyKey]) continue;
        dailyReminderSent[dailyKey] = true;
        const msg = `🔄 例行任務提醒 - MeetBot\n\n提醒你有一項例行任務：\n「${rt.title}」\n\n排程：每週${WD_NAMES[rt.reminderWeekday]} ${String(rt.reminderHour).padStart(2,"0")}:00\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
        await sendSlackToUser(name, msg);
        console.log(`例行任務提醒已發送：${rt.title} → ${name}`);
      }
    } catch (e) {
      console.error("例行任務提醒檢查失敗:", e.message);
    }
  }, 60000);
}

module.exports = { startScheduler };

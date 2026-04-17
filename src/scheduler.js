const axios = require("axios");
const { TEAM, MEETINGS_FB, SLACK_WEBHOOK_URL } = require("./config");
const { toTaipei } = require("./utils");
const { sendSlack, sendSlackToUser } = require("./slack");
const { sendLine, sendLineWithQuickReply } = require("./line");
const { MEMBERS, BOSS_IDS } = require("./config");
const { fetchRoutineTasksFromFirebase } = require("./firebase");

let lastRun430 = "";
let lastRun450 = "";
const routineReminderSent = {};
const dailyReminderSent = {};

// -- Meeting auto-reminder --
let lastMeetingCheck = "";
let meetingCheckRunning = false;

async function autoCheckMeetingReminders() {
  if (meetingCheckRunning) { console.log("[meeting reminder] still running, skip"); return; }
  meetingCheckRunning = true;
  try {
    let webhookUrl = SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      const FB_BASE = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot";
      const whRes = await axios.get(FB_BASE + "/slackWebhook.json");
      webhookUrl = whRes.data;
    }
    if (!webhookUrl) { console.log("[meeting reminder] no Slack webhook, skip"); return; }

    const meetingsRes = await axios.get(MEETINGS_FB + ".json");
    const meetingsObj = meetingsRes.data;
    if (!meetingsObj) { console.log("[meeting reminder] no meetings"); return; }
    const meetings = Object.values(meetingsObj);

    const taipei = toTaipei(new Date());
    const todayStr = taipei.getFullYear() + "-" + String(taipei.getMonth()+1).padStart(2,"0") + "-" + String(taipei.getDate()).padStart(2,"0");
    let sent = 0;

    for (const m of meetings) {
      if (!m.date) continue;
      const dl = Math.ceil((new Date(m.date + "T00:00:00+08:00") - new Date(todayStr + "T00:00:00+08:00")) / 86400000);
      const checks = [
        { key: "day7", days: 7, label: "7 \u5929" },
        { key: "day3", days: 3, label: "3 \u5929" },
        { key: "day1", days: 1, label: "1 \u5929" },
      ];
      for (const check of checks) {
        if (dl === check.days && !(m.slackSent && m.slackSent[check.key])) {
          const participants = (m.participants || []).join("\u3001") || "\u5168\u54E1";
          const msg = "\u{1F4C5} *\u6703\u8B70\u63D0\u9192\uFF08" + check.label + "\u524D\uFF09*\n\n" +
            "\u{1F4CC} *" + m.title + "*\n" +
            "\u{1F5D3} \u65E5\u671F\uFF1A" + m.date + "\n" +
            "\u23F0 \u6642\u9593\uFF1A" + (m.time || "\u672A\u5B9A") + "\n" +
            "\u{1F4CD} \u5730\u9EDE\uFF1A" + (m.location || "\u672A\u5B9A") + "\n" +
            "\u{1F465} \u53C3\u52A0\u8005\uFF1A" + participants + "\n" +
            (m.description ? "\n\u{1F4DD} " + m.description + "\n" : "") +
            "\n\u8ACB\u63D0\u524D\u6E96\u5099\uFF01";
          try {
            await axios.post(webhookUrl, { text: msg });
            await axios.patch(MEETINGS_FB + "/" + m.id + ".json", {
              ["slackSent/" + check.key]: true
            });
            sent++;
          } catch (e) { console.error("[meeting reminder] Slack send error:", e.message); }
        }
      }
    }
    if (sent > 0) console.log("[meeting reminder] sent " + sent + " reminders");
    else console.log("[meeting reminder] nothing to send");
  } catch (e) {
    console.error("[meeting reminder] auto check failed:", e.message);
  } finally {
    meetingCheckRunning = false;
  }
}

function startScheduler() {
  setInterval(async () => {
    const taipei  = toTaipei(new Date());
    const day     = taipei.getDay();
    const hour    = taipei.getHours();
    const min     = taipei.getMinutes();
    const dateKey = taipei.toISOString().slice(0, 10);

    if (day === 0 || day === 6) return;

    // 16:30 -- all members reminder via LINE
    if (hour === 16 && min === 30 && lastRun430 !== dateKey) {
      lastRun430 = dateKey;
      const targets = Object.entries(MEMBERS)
        .filter(([name]) => name !== "\u8521\u8559\u82B3")
        .map(([, id]) => id);
      const msg = "\u{1F4CC} \u4E0B\u5348\u5DE5\u4F5C\u9032\u5EA6\u63D0\u9192\n\n\u73FE\u5728\u662F 16:30\uFF0C\u8ACB\u81F3 meetbot \u7CFB\u7D71\u67E5\u770B\u60A8\u7684\u5F85\u8FA6\u4EFB\u52D9\uFF0C\u4E26\u52FE\u9078\u4ECA\u65E5\u5DF2\u5B8C\u6210\u7684\u9805\u76EE\u3002\n\n\u{1F517} https://s71043201-star.github.io/meetbot-app/";
      for (const id of targets) await sendLine(id, msg).catch(() => {});
      await sendSlack(msg);
      console.log("scheduler 16:30 reminder sent");
    }

    // 16:50 -- boss reminder via LINE with quick reply
    if (hour === 16 && min === 50 && lastRun450 !== dateKey) {
      lastRun450 = dateKey;
      const memberNames = TEAM.filter(n => n !== "\u8521\u8559\u82B3");
      const quickItems = memberNames.map(name => ({
        type: "action",
        action: { type: "message", label: name, text: "\u63D0\u9192 " + name }
      }));
      const msg = "\u{1F4CA} \u4E0B\u5348\u9032\u5EA6\u8FFD\u8E64\u63D0\u9192\n\n\u73FE\u5728\u662F 16:50\uFF0C\u8ACB\u67E5\u770B\u4ECA\u65E5\u5168\u54E1\u5DE5\u4F5C\u9032\u5EA6\u3002\n\n\u5982\u9700\u5411\u7279\u5B9A\u6210\u54E1\u88DC\u767C\u63D0\u9192\uFF0C\u8ACB\u9EDE\u9078\u4E0B\u65B9\u59D3\u540D\uFF1A\n\n\u{1F517} https://s71043201-star.github.io/meetbot-app/";
      for (const bossId of BOSS_IDS) {
        await sendLineWithQuickReply(bossId, msg, quickItems).catch(() => {});
      }
      await sendSlack(msg);
      console.log("scheduler 16:50 reminder sent");
    }

    // Routine task reminders
    try {
      const routineTasks = await fetchRoutineTasksFromFirebase();
      const WD_NAMES = ["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"];
      for (const rt of routineTasks) {
        if (!rt.reminderOn) continue;
        if (rt.reminderWeekday !== day || rt.reminderHour !== hour) continue;
        const sentKey = (rt.id || rt.title) + "-" + dateKey + "-" + hour;
        if (routineReminderSent[sentKey]) continue;
        routineReminderSent[sentKey] = true;
        const name = rt.assignee || "\u672A\u6307\u6D3E";
        const dailyKey = name + "-" + dateKey;
        if (dailyReminderSent[dailyKey]) continue;
        dailyReminderSent[dailyKey] = true;
        const msg = "\u{1F504} \u4F8B\u884C\u4EFB\u52D9\u63D0\u9192 - MeetBot\n\n\u63D0\u9192\u4F60\u6709\u4E00\u9805\u4F8B\u884C\u4EFB\u52D9\uFF1A\n\u300C" + rt.title + "\u300D\n\n\u6392\u7A0B\uFF1A\u6BCF\u9031" + WD_NAMES[rt.reminderWeekday] + " " + String(rt.reminderHour).padStart(2,"0") + ":00\n\n\u{1F517} https://s71043201-star.github.io/meetbot-app/";
        await sendSlackToUser(name, msg);
        console.log("routine reminder sent: " + rt.title + " -> " + name);
      }
    } catch (e) {
      console.error("routine reminder check failed:", e.message);
    }

    // Meeting reminders (hourly, 8:00-20:00)
    const checkKey = dateKey + "-" + hour;
    if (min === 0 && hour >= 8 && hour <= 20 && lastMeetingCheck !== checkKey) {
      lastMeetingCheck = checkKey;
      console.log("[meeting reminder] " + hour + ":00 auto check...");
      await autoCheckMeetingReminders();
    }
  }, 60000);

  // Run meeting check on startup
  setTimeout(() => autoCheckMeetingReminders(), 5000);
}

module.exports = { startScheduler };

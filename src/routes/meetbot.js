const express = require("express");
const axios = require("axios");
const router = express.Router();
const { TEAM, MEMBERS } = require("../config");
const { daysLeft, toTaipei } = require("../utils");
const { sendSlack, slackMention, sendSlackToUser } = require("../slack");

// -- Gemini AI models (fallback chain) --
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview"];

async function callGemini(prompt, geminiKey) {
  let lastErr;
  for (const model of GEMINI_MODELS) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + geminiKey;
    try {
      console.log("Gemini model: " + model);
      const response = await axios.post(url, {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4000 }
      }, { headers: { "Content-Type": "application/json" }, timeout: 30000 });
      const parts = response.data.candidates && response.data.candidates[0] && response.data.candidates[0].content && response.data.candidates[0].content.parts || [];
      const textPart = parts.filter(p => p.text).pop();
      console.log("Gemini " + model + " OK");
      return textPart ? textPart.text : "[]";
    } catch (e) {
      const status = e.response && e.response.status;
      const msg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
      console.warn("Gemini " + model + " failed (" + status + "): " + msg);
      lastErr = e;
      if (status === 429 || status === 503) continue;
      throw e;
    }
  }
  throw lastErr;
}

// -- AI parse meeting --
router.post("/parse-meeting", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "\u7F3A\u5C11 text" });
  const today_str = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })).toISOString().slice(0, 10);
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: "\u672A\u8A2D\u5B9A GEMINI_API_KEY" });
    const prompt = "\u4F60\u662F\u6703\u8B70\u8A18\u9304\u5206\u6790\u52A9\u7406\u3002\u5F9E\u4EE5\u4E0B\u6703\u8B70\u7D00\u9304\u4E2D\uFF0C\u627E\u51FA\u6240\u6709\u300C\u4EFB\u52D9/\u884C\u52D5\u9805\u76EE\u300D\u3002\n\u6BCF\u500B\u4EFB\u52D9\u9700\u5305\u542B\uFF1A\u8CA0\u8CAC\u4EBA\uFF08\u53EF\u591A\u4EBA\uFF09\u3001\u4EFB\u52D9\u63CF\u8FF0\u3001\u622A\u6B62\u65E5\u671F\u3002\u4ECA\u5929\u662F " + today_str + "\u3002\n\u82E5\u65E5\u671F\u53EA\u8AAA\u300C\u672C\u9031\u4E94\u300D\u8ACB\u63DB\u7B97\u6210\u5BE6\u969B\u65E5\u671F\u3002\u82E5\u7121\u6CD5\u78BA\u5B9A\u622A\u6B62\u65E5\u671F\uFF0C\u8A2D\u5B9A\u70BA 7 \u5929\u5F8C\u3002\n\u8CA0\u8CAC\u4EBA\u8ACB\u5F9E\u4EE5\u4E0B\u540D\u55AE\u9078\u6700\u63A5\u8FD1\u7684\uFF1A" + TEAM.join("\u3001") + "\u3002\u82E5\u7121\u6CD5\u5C0D\u61C9\uFF0C\u586B\u300C\u5F85\u6307\u6D3E\u300D\u3002\n\u82E5\u4EFB\u52D9\u6709\u591A\u4F4D\u8CA0\u8CAC\u4EBA\uFF0C\u7528\u9017\u865F\u5206\u9694\u3002\n\n\u8ACB\u53EA\u56DE\u50B3 JSON \u9663\u5217\uFF0C\u683C\u5F0F\u5982\u4E0B\uFF0C\u4E0D\u8981\u6709\u4EFB\u4F55\u8AAA\u660E\u6587\u5B57\uFF1A\n[{\"title\":\"\u4EFB\u52D9\u63CF\u8FF0\",\"assignee\":\"\u8CA0\u8CAC\u4EBA1,\u8CA0\u8CAC\u4EBA2\",\"deadline\":\"YYYY-MM-DD\"}]\n\n\u6703\u8B70\u7D00\u9304\uFF1A\n" + text;
    const raw = await callGemini(prompt, geminiKey);
    const items = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ items });
  } catch (e) {
    console.error("parse-meeting error:", e.response ? e.response.data : e.message);
    const msg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message || "AI \u89E3\u6790\u5931\u6557";
    res.status(500).json({ error: msg });
  }
});

// -- Gemini Proxy --
router.post("/gemini-proxy", async (req, res) => {
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const model = req.body.model || "gemini-2.5-flash";
    delete req.body.model;
    if (model.includes("2.5")) {
      req.body.generationConfig = { maxOutputTokens: 65536, ...(req.body.generationConfig || {}) };
      if (!req.body.generationConfig.thinkingConfig) req.body.generationConfig.thinkingConfig = { thinkingBudget: 128 };
      delete req.body.thinkingConfig;
    }
    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + geminiKey;
    const response = await axios.post(geminiUrl, req.body, { headers: { "Content-Type": "application/json" } });
    res.json(response.data);
  } catch (e) {
    res.status((e.response && e.response.status) || 500).json((e.response && e.response.data) || { error: e.message });
  }
});

// -- Task reminders --
router.post("/check-reminders", async (req, res) => {
  const { tasks, reminders, routineTasks } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "\u7F3A\u5C11\u53C3\u6578" });
  const taipei = toTaipei(new Date());
  const hour = taipei.getHours();
  const weekday = taipei.getDay();
  let sent = 0;
  const slackByPerson = {};
  for (const task of tasks) {
    if (task.done) continue;
    const dl = daysLeft(task.deadline);
    if (reminders.dayBefore && reminders.dayBefore.on && dl === reminders.dayBefore.days && hour === reminders.dayBefore.hour) {
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push("\u{1F4CB} \u300C" + task.title + "\u300D\u2014 \u622A\u6B62\uFF1A" + task.deadline + "\uFF08\u5269 " + dl + " \u5929\uFF09");
      sent++;
    }
    if (reminders.hourBefore && reminders.hourBefore.on && dl === 0 && hour === (23 - reminders.hourBefore.hours)) {
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push("\u26A1 \u300C" + task.title + "\u300D\u2014 \u4ECA\u5929\u622A\u6B62\uFF01");
      sent++;
    }
    if (reminders.overdueAlert && reminders.overdueAlert.on && dl < 0) {
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push("\u{1F6A8} \u300C" + task.title + "\u300D\u2014 \u5DF2\u903E\u671F " + Math.abs(dl) + " \u5929\uFF01");
      sent++;
    }
  }
  const WD_NAMES = ["\u65E5","\u4E00","\u4E8C","\u4E09","\u56DB","\u4E94","\u516D"];
  if (Array.isArray(routineTasks)) {
    for (const rt of routineTasks) {
      if (!rt.reminderOn) continue;
      if (rt.reminderWeekday === weekday && rt.reminderHour === hour) {
        const name = rt.assignee || "\u672A\u6307\u6D3E";
        if (!slackByPerson[name]) slackByPerson[name] = [];
        slackByPerson[name].push("\u{1F504} \u4F8B\u884C\u4EFB\u52D9\u63D0\u9192 \u2014\u300C" + rt.title + "\u300D\uFF08\u6BCF\u9031" + WD_NAMES[rt.reminderWeekday] + " " + String(rt.reminderHour).padStart(2,"0") + ":00\uFF09");
        sent++;
      }
    }
  }
  for (const [name, items] of Object.entries(slackByPerson)) {
    await sendSlackToUser(name, "\u{1F4EC} \u4EFB\u52D9\u63D0\u9192 - MeetBot\n\n\u4F60\u6709 " + items.length + " \u9805\u4EFB\u52D9\u9700\u6CE8\u610F\uFF1A\n\n" + items.join("\n") + "\n\n\u8ACB\u76E1\u5FEB\u8655\u7406 \u2713\n\u{1F517} https://s71043201-star.github.io/meetbot-app/");
  }
  res.json({ ok: true, sent });
});

// -- New task notification --
router.post("/notify-new-task", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "\u7F3A\u5C11 task" });
  try {
    await sendSlackToUser(task.assignee, "\u{1F4CB} \u65B0\u4EFB\u52D9\u6307\u6D3E - MeetBot\n\n\u4F60\u6709\u4E00\u9805\u65B0\u4EFB\u52D9\uFF1A\n\u300C" + task.title + "\u300D\n\n\u622A\u6B62\u65E5\u671F\uFF1A" + task.deadline + "\n\u4F86\u6E90\u6703\u8B70\uFF1A" + task.meeting + "\n\n\u8ACB\u8A18\u5F97\u5728\u671F\u9650\u524D\u5B8C\u6210 \u2713\n\u{1F517} https://s71043201-star.github.io/meetbot-app/");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -- Task done notification --
router.post("/notify-task-done", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "\u7F3A\u5C11 task" });
  try {
    await sendSlackToUser(task.assignee, "\u{1F389} \u606D\u559C\uFF01\n\n\u300C" + task.title + "\u300D\u5DF2\u5B8C\u6210\uFF01\n\n\u8F9B\u82E6\u4E86\uFF0C\u7E7C\u7E8C\u4FDD\u6301 \u{1F4AA}");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -- Export PDF report --
router.get("/export-pdf", async (req, res) => {
  const { fetchTasksFromFirebase } = require("../firebase");
  try {
    let tasks = await fetchTasksFromFirebase();
    const { from, to } = req.query;
    if (from || to) {
      tasks = tasks.filter(t => {
        const dateStr = t.createdAt || new Date(t.id).toISOString().slice(0,10);
        if (from && dateStr < from) return false;
        if (to && dateStr > to) return false;
        return true;
      });
    }
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    const total = tasks.length;
    const doneCount = tasks.filter(t => t.done).length;
    const pct = total ? Math.round(doneCount / total * 100) : 0;

    const statusOf = (t) => {
      if (t.done) return "\u2705 \u5DF2\u5B8C\u6210";
      const today = new Date().toISOString().slice(0, 10);
      const d = Math.ceil((new Date(t.deadline) - new Date(today)) / 86400000);
      if (d < 0) return "\u{1F6A8} \u903E\u671F " + Math.abs(d) + " \u5929";
      if (d === 0) return "\u26A1 \u4ECA\u5929\u622A\u6B62";
      if (d <= 2) return "\u23F0 \u5269 " + d + " \u5929";
      return "\u{1F4C5} " + t.deadline + " \u622A\u6B62";
    };

    let rows = "";
    TEAM.forEach(name => {
      const mine = tasks.filter(t => t.assignee === name);
      if (mine.length === 0) return;
      const done = mine.filter(t => t.done).length;
      rows += '<tr><td colspan="4" class="member-header">\u{1F464} ' + name + '\u3000' + done + '/' + mine.length + ' \u5B8C\u6210</td></tr>';
      mine.forEach((t, i) => {
        const bg = i % 2 === 0 ? "#f5f7ff" : "#ffffff";
        const noteHtml = t.progressNote
          ? '<br><span class="note">\u{1F4DD} ' + t.progressNote + (t.progressNoteTime ? '\uFF08' + t.progressNoteTime + '\uFF09' : '') + '</span>'
          : "";
        rows += '<tr style="background:' + bg + ';"><td class="td-main">' + t.title + noteHtml + '</td><td class="td-cell">' + t.assignee + '</td><td class="td-cell">' + t.deadline + '</td><td class="td-cell">' + statusOf(t) + '</td></tr>';
      });
    });

    const html = '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">' +
'<title>MeetBot \u4EFB\u52D9\u9032\u5EA6\u5831\u544A</title>' +
'<style>' +
'*{box-sizing:border-box;margin:0;padding:0;}' +
'body{font-family:"Microsoft JhengHei","\u5FAE\u8EDF\u6B63\u9ED1\u9AD4","Noto Sans TC",sans-serif;color:#1a1a2e;padding:24px;}' +
'h1{font-size:20px;color:#4f8cff;margin-bottom:6px;}' +
'.sub{font-size:13px;color:#5a6285;margin-bottom:20px;}' +
'.save-btn{display:inline-block;margin-bottom:20px;padding:10px 24px;background:#4f8cff;color:#fff;border:none;border-radius:6px;font-size:15px;cursor:pointer;font-family:inherit;}' +
'table{border-collapse:collapse;width:100%;font-size:13px;}' +
'th{background:#2a3560;color:#fff;padding:8px 10px;text-align:left;}' +
'td{border-bottom:1px solid #e0e4f0;vertical-align:top;padding:7px 10px;}' +
'.member-header{background:#1a2240;color:#7eb3ff;font-weight:bold;font-size:14px;padding:8px 10px;}' +
'.td-main{width:50%;}' +
'.td-cell{width:17%;white-space:nowrap;}' +
'.note{color:#4f8cff;font-size:12px;}' +
'.footer{margin-top:18px;font-size:11px;color:#8890aa;}' +
'@media print{.save-btn{display:none;}body{padding:12px;}}' +
'</style></head>' +
'<body>' +
'<button class="save-btn" onclick="window.print()">\u53E6\u5B58 PDF</button>' +
'<h1>\u{1F4CB} MeetBot \u4EFB\u52D9\u9032\u5EA6\u5831\u544A</h1>' +
'<div class="sub">\u532F\u51FA\u6642\u9593\uFF1A' + now + (from||to ? '\u3000\u65B0\u589E\u65E5\u671F\uFF1A' + (from||'\u8D77\u59CB') + '\uFF5E' + (to||'\u7D50\u675F') : '') + '\u3000\u6574\u9AD4\u5B8C\u6210\u7387\uFF1A' + pct + '%\uFF08' + doneCount + '/' + total + '\uFF09</div>' +
'<table>' +
'<tr><th class="td-main">\u4EFB\u52D9</th><th class="td-cell">\u8CA0\u8CAC\u4EBA</th><th class="td-cell">\u622A\u6B62\u65E5\u671F</th><th class="td-cell">\u72C0\u614B</th></tr>' +
rows +
'</table>' +
'<div class="footer">\u6B64\u5831\u544A\u7531 MeetBot \u7CFB\u7D71\u81EA\u52D5\u751F\u6210</div>' +
'</body></html>';

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    console.error("\u532F\u51FA\u5931\u6557:", e.message);
    res.status(500).send("\u532F\u51FA\u5931\u6557\uFF1A" + e.message);
  }
});

// -- Slack send --
router.post("/send-slack", async (req, res) => {
  const { webhookUrl, message } = req.body;
  if (!webhookUrl || !message) return res.status(400).json({ error: "Missing params" });
  try {
    await axios.post(webhookUrl, { text: message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -- Check meeting reminders --
router.post("/check-meeting-reminders", async (req, res) => {
  const { MEETINGS_FB, SLACK_WEBHOOK_URL } = require("../config");
  const { webhookUrl } = req.body;
  const wh = webhookUrl || SLACK_WEBHOOK_URL;
  if (!wh) return res.status(400).json({ error: "Missing webhookUrl" });
  try {
    const meetingsRes = await axios.get(MEETINGS_FB + ".json");
    const meetingsObj = meetingsRes.data;
    if (!meetingsObj) return res.json({ ok: true, sent: 0 });
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
            await axios.post(wh, { text: msg });
            await axios.patch(MEETINGS_FB + "/" + m.id + ".json", {
              ["slackSent/" + check.key]: true
            });
            sent++;
          } catch (e) { console.error("Slack send error:", e.message); }
        }
      }
    }
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

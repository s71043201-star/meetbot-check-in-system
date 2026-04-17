const express = require("express");
const router = express.Router();
const { TEAM, MEMBERS, ID_TO_NAME, BOSS_IDS, SYSTEMS, ATT_BOSS_IDS } = require("../config");
const { daysLeft } = require("../utils");
const { fetchTasksFromFirebase, fetchAttendance } = require("../firebase");
const { sendLine, replyLine, replyLineMulti, replyLineWithQuickReply } = require("../line");
const { sendSlack, slackMention, sendSlackToUser } = require("../slack");

function buildAttendanceReport(records, month) {
  const filtered = records.filter(r => r.month === month && r.status === "checked-out");
  if (filtered.length === 0) return "\u{1F4ED} " + month + " \u6708\u7121\u81E8\u6642\u4EBA\u54E1\u51FA\u52E4\u8A18\u9304";

  const byName = {};
  filtered.forEach(r => {
    if (!byName[r.name]) byName[r.name] = { count: 0, hours: 0, list: [] };
    byName[r.name].count++;
    byName[r.name].hours += r.hours || 0;
    byName[r.name].list.push(r);
  });

  const total = filtered.reduce((s, r) => s + (r.hours || 0), 0);
  let msg = "\u{1F4CA} " + month + " \u6708\u81E8\u6642\u4EBA\u54E1\u51FA\u52E4\u8A18\u9304\n" + "\u2550".repeat(22) + "\n";
  msg += "\u51FA\u52E4\u4EBA\u6B21\uFF1A" + filtered.length + " \u7B46\u3000\u7E3D\u6642\u6578\uFF1A" + Math.round(total * 10) / 10 + " \u5C0F\u6642\n" + "\u2500".repeat(22) + "\n";

  Object.entries(byName).forEach(([name, info]) => {
    msg += "\n\u{1F464} " + name + "\u3000\u51FA\u52E4 " + info.count + " \u6B21\u3000\u5408\u8A08 " + Math.round(info.hours * 10) / 10 + " \u6642\n";
    info.list.sort((a, b) => a.day - b.day).forEach(r => {
      msg += "   \u2022 " + month + "/" + r.day + "\uFF08" + r.course + "\uFF09" + r.hours + " \u6642\n";
    });
  });

  return msg.trim();
}

// -- webhook diagnosis --
let lastWebhook = null;
router.get("/debug-webhook", (req, res) => {
  res.json(lastWebhook || { message: "\u5C1A\u672A\u6536\u5230\u4EFB\u4F55 webhook" });
});

// MeetBot Webhook
router.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  lastWebhook = { time: new Date().toISOString(), body: req.body };
  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;
    const userId     = event.source.userId;
    const text       = event.message.text.trim();
    const replyToken = event.replyToken;
    console.log("\u{1F464} " + userId + " \u8AAA\uFF1A" + text);

    // -- help --
    if (["\u6307\u4EE4", "\u8AAA\u660E", "help", "Help", "?", "\uFF1F"].includes(text)) {
      const isBoss = BOSS_IDS.includes(userId);
      const isAttBoss = ATT_BOSS_IDS.includes(userId);
      const sysLines = Object.entries(SYSTEMS)
        .filter(([kw]) => !["\u5F8C\u53F0","\u7C3D\u5230"].includes(kw) || isAttBoss)
        .map(([kw, s]) => "\u2022 " + kw + " \u2014 " + s.name).join("\n");
      let msg = "\u{1F4CB} MeetBot \u53EF\u7528\u6307\u4EE4\n" + "\u2550".repeat(20) + "\n\n\u{1F464} \u500B\u4EBA\u529F\u80FD\n\u2022 \u5DE5\u4F5C \u2014 \u67E5\u770B\u6211\u7684\u5F85\u8FA6\u4EFB\u52D9\n\n\u{1F5A5} \u7CFB\u7D71\u9023\u7D50\uFF08\u8F38\u5165\u95DC\u9375\u5B57\u53D6\u5F97\u7DB2\u5740\uFF09\n" + sysLines;
      if (isBoss) msg += "\n\n\u{1F511} \u7BA1\u7406\u54E1\u529F\u80FD\n\u2022 \u9032\u5EA6 \u2014 \u67E5\u770B\u5168\u5718\u968A\u4EFB\u52D9\u9032\u5EA6\n\u2022 \u4E0B\u8F09 \u2014 \u4E0B\u8F09\u4EFB\u52D9\u9032\u5EA6\u5831\u544A\uFF08PDF\uFF09\n\u2022 \u81E8\u6642\u4EBA\u54E1 3 \u2014 \u67E5\u770B\u67D0\u6708\u51FA\u52E4\u8A18\u9304\n\u2022 \u63D0\u9192 \u59D3\u540D \u2014 \u5411\u6307\u5B9A\u6210\u54E1\u767C\u51FA\u5DE5\u4F5C\u63D0\u9192";
      await replyLine(replyToken, msg);
      continue;
    }

    // -- system urls --
    if (SYSTEMS[text]) {
      const s = SYSTEMS[text];
      const restricted = ["\u5F8C\u53F0", "\u7C3D\u5230"].includes(text);
      if (restricted && !ATT_BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "\u274C \u6B64\u529F\u80FD\u50C5\u9650\u7BA1\u7406\u54E1\u8207\u4F69\u7814\u4F7F\u7528\n\n\u4F60\u53EF\u4EE5\u4F7F\u7528\uFF1A\n\u2022 \u5DE5\u4F5C \u2014 \u67E5\u770B\u6211\u7684\u5F85\u8FA6\u4EFB\u52D9\n\u2022 \u6703\u8B70 \u2014 \u6703\u8B70\u4EFB\u52D9\u7CFB\u7D71\n\u2022 \u9031\u5831 \u2014 \u9031\u5831\u7D71\u8A08\u7CFB\u7D71\n\u2022 \u6B77\u6B21\u5217\u7BA1 \u2014 \u6703\u8B70\u5217\u7BA1\u4E8B\u9805\u7CFB\u7D71");
      } else if (text === "\u7C3D\u5230") {
        const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=" + encodeURIComponent(s.url);
        await replyLineMulti(replyToken, [
          { type: "text", text: "\u{1F5A5} " + s.name + "\n\n\u{1F517} " + s.url },
          { type: "image", originalContentUrl: qrUrl, previewImageUrl: qrUrl }
        ]);
      } else {
        await replyLine(replyToken, "\u{1F5A5} " + s.name + "\n\n\u{1F517} " + s.url);
      }
      continue;
    }

    // -- remind (no name) --
    if (text === "\u63D0\u9192") {
      if (!BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "\u274C \u6B64\u529F\u80FD\u50C5\u9650\u7BA1\u7406\u54E1\u4F7F\u7528");
        continue;
      }
      const senderName = ID_TO_NAME[userId] || "";
      const targets = TEAM.filter(n => n !== senderName);
      const quickItems = targets.map(name => ({
        type: "action",
        action: { type: "message", label: name, text: "\u63D0\u9192 " + name }
      }));
      await replyLineWithQuickReply(replyToken, "\u8ACB\u9078\u64C7\u8981\u63D0\u9192\u7684\u6210\u54E1\uFF1A", quickItems);
      continue;
    }

    // -- remind specific member --
    const remindMatch = text.match(/^\u63D0\u9192\s*(.+)$/);
    if (remindMatch) {
      if (!BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "\u274C \u6B64\u529F\u80FD\u50C5\u9650\u7BA1\u7406\u54E1\u4F7F\u7528");
        continue;
      }
      const targetName = remindMatch[1].trim();
      const targetId = MEMBERS[targetName];
      if (!targetId) {
        await replyLine(replyToken, "\u274C \u627E\u4E0D\u5230\u6210\u54E1\u300C" + targetName + "\u300D");
        continue;
      }
      const senderName = ID_TO_NAME[userId] || "\u7BA1\u7406\u54E1";
      const remindMsg = "\u{1F4CC} \u5DE5\u4F5C\u9032\u5EA6\u63D0\u9192\n\n" + senderName + " \u5E0C\u671B\u4F60\u67E5\u770B\u4ECA\u65E5\u5DE5\u4F5C\u9032\u5EA6\uFF0C\u4E26\u5728\u7CFB\u7D71\u4E2D\u52FE\u9078\u5DF2\u5B8C\u6210\u7684\u4EFB\u52D9\u3002\n\n\u{1F517} meetbot \u7CFB\u7D71\uFF1Ahttps://s71043201-star.github.io/meetbot-app/";
      await sendLine(targetId, remindMsg).catch(() => {});
      await sendSlack("\u{1F4CC} \u5DE5\u4F5C\u9032\u5EA6\u63D0\u9192\n\n" + slackMention(targetName) + " \u8ACB\u67E5\u770B\u4ECA\u65E5\u5DE5\u4F5C\u9032\u5EA6\uFF0C\u4E26\u5728\u7CFB\u7D71\u4E2D\u52FE\u9078\u5DF2\u5B8C\u6210\u7684\u4EFB\u52D9\u3002\n\n\u{1F517} meetbot \u7CFB\u7D71\uFF1Ahttps://s71043201-star.github.io/meetbot-app/");
      await replyLine(replyToken, "\u2705 \u5DF2\u5411 " + targetName + " \u767C\u51FA\u63D0\u9192");
      continue;
    }

    // -- temp staff --
    if (text === "\u81E8\u6642\u4EBA\u54E1") {
      if (!ATT_BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "\u274C \u6B64\u529F\u80FD\u50C5\u9650\u7BA1\u7406\u54E1\u4F7F\u7528");
        continue;
      }
      const monthItems = Array.from({ length: 12 }, (_, i) => ({
        type: "action",
        action: { type: "message", label: (i + 1) + "\u6708", text: "\u81E8\u6642\u4EBA\u54E1 " + (i + 1) }
      }));
      await replyLineWithQuickReply(replyToken, "\u{1F4CB} \u81E8\u6642\u4EBA\u54E1\u67E5\u8A62\n\n\u8ACB\u9078\u64C7\u8981\u67E5\u8A62\u7684\u6708\u4EFD\uFF1A", monthItems);
      continue;
    }

    const tempMatch = text.match(/^\u81E8\u6642\u4EBA\u54E1\s*(\d+)\u6708?$/);
    if (tempMatch) {
      if (!ATT_BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "\u274C \u6B64\u529F\u80FD\u50C5\u9650\u7BA1\u7406\u54E1\u4F7F\u7528");
        continue;
      }
      const month = parseInt(tempMatch[1]);
      const records = await fetchAttendance();
      await replyLine(replyToken, buildAttendanceReport(records, month));
      continue;
    }

    // -- download --
    if (text === "\u4E0B\u8F09") {
      if (!BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "\u274C \u6B64\u529F\u80FD\u50C5\u9650\u7BA1\u7406\u54E1\u4F7F\u7528");
        continue;
      }
      await replyLine(replyToken,
        "\u{1F4C4} MeetBot \u4EFB\u52D9\u5831\u544A\n\n" +
        "\u9EDE\u4EE5\u4E0B\u9023\u7D50\u958B\u555F\u5831\u544A\uFF0C\u518D\u9EDE\u300C\u53E6\u5B58 PDF\u300D\u5373\u53EF\u4E0B\u8F09\uFF1A\n\n" +
        "https://meetbot-check-in-system.onrender.com/export-pdf\n\n" +
        "\u26A0\uFE0F \u521D\u6B21\u8F09\u5165\u53EF\u80FD\u9700\u7A0D\u7B49 10 \u79D2\uFF08\u51B7\u555F\u52D5\uFF09"
      );
      continue;
    }

    // -- my tasks --
    if (text === "\u5DE5\u4F5C") {
      const name = ID_TO_NAME[userId];
      if (!name) { await replyLine(replyToken, "\u274C \u627E\u4E0D\u5230\u4F60\u7684\u5E33\u865F\uFF0C\u8ACB\u806F\u7D61\u7BA1\u7406\u54E1"); continue; }
      const tasks = await fetchTasksFromFirebase();
      const mine = tasks.filter(t => t.assignee === name && !t.done);
      if (mine.length === 0) {
        await replyLine(replyToken, "\u2705 " + name + "\uFF0C\u4F60\u76EE\u524D\u6C92\u6709\u5F85\u8FA6\u4EFB\u52D9\uFF01\u7E7C\u7E8C\u4FDD\u6301 \u{1F4AA}");
      } else {
        const lines = mine.map((t, i) => {
          const d = daysLeft(t.deadline);
          const tag = d < 0 ? "\u{1F6A8} \u903E\u671F" : d === 0 ? "\u26A1 \u4ECA\u5929\u622A\u6B62" : d <= 2 ? "\u23F0 \u5269 " + d + " \u5929" : "\u{1F4C5} " + t.deadline;
          return (i+1) + ". " + t.title + "\n   " + tag;
        }).join("\n\n");
        await replyLine(replyToken, "\u{1F4CB} " + name + " \u7684\u5F85\u8FA6\u4EFB\u52D9\uFF08\u5171 " + mine.length + " \u9805\uFF09\n\n" + lines + "\n\n\u8ACB\u5728\u671F\u9650\u524D\u5B8C\u6210 \u2713");
      }
      continue;
    }

    // -- progress --
    if (text === "\u9032\u5EA6") {
      if (!BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "\u274C \u6B64\u529F\u80FD\u50C5\u9650\u7BA1\u7406\u54E1\u4F7F\u7528");
        continue;
      }
      const tasks = await fetchTasksFromFirebase();
      const total = tasks.length;
      const done = tasks.filter(t => t.done).length;
      const overdue = tasks.filter(t => !t.done && daysLeft(t.deadline) < 0).length;
      const pct = total ? Math.round(done / total * 100) : 0;

      const memberLines = TEAM.map(name => {
        const mine = tasks.filter(t => t.assignee === name);
        const mDone = mine.filter(t => t.done).length;
        const pending = mine.filter(t => !t.done);
        const doneList = mine.filter(t => t.done);
        let lines = "\u{1F464} " + name + "\uFF08" + mDone + "/" + mine.length + " \u5B8C\u6210\uFF09";
        if (pending.length > 0) {
          lines += "\n\u{1F4CC} \u5F85\u8FA6\uFF1A";
          pending.forEach(t => {
            const d = daysLeft(t.deadline);
            const tag = d < 0 ? "\u{1F6A8}\u903E\u671F" + Math.abs(d) + "\u5929" : d === 0 ? "\u26A1\u4ECA\u5929\u622A\u6B62" : d <= 2 ? "\u23F0\u5269" + d + "\u5929" : "\u{1F4C5}" + t.deadline;
            lines += "\n  \u2022 " + t.title + "\n    " + tag;
          });
        }
        if (doneList.length > 0) {
          lines += "\n\u2705 \u5DF2\u5B8C\u6210\uFF1A";
          doneList.forEach(t => { lines += "\n  \u2022 " + t.title; });
        }
        if (mine.length === 0) lines += "\n  \uFF08\u5C1A\u7121\u6307\u6D3E\u4EFB\u52D9\uFF09";
        return lines;
      }).join("\n\n" + "\u2500".repeat(18) + "\n\n");

      await replyLine(replyToken,
        "\u{1F4CA} \u5168\u5718\u968A\u4EFB\u52D9\u9032\u5EA6\u5831\u544A\n" + "\u2550".repeat(20) + "\n\u6574\u9AD4\u5B8C\u6210\u7387\uFF1A" + pct + "%\uFF08" + done + "/" + total + "\uFF09\n\u903E\u671F\u4EFB\u52D9\uFF1A" + overdue + " \u9805\n" + "\u2550".repeat(20) + "\n\n" + memberLines + "\n\n\u23F0 " + new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})
      );
      continue;
    }
  }
});

module.exports = router;

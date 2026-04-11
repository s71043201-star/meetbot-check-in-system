const express = require("express");
const router = express.Router();
const { TEAM, MEMBERS, ID_TO_NAME, BOSS_IDS, SYSTEMS, ATT_BOSS_IDS } = require("../config");
const { daysLeft } = require("../utils");
const { fetchTasksFromFirebase, fetchAttendance } = require("../firebase");
const { sendLine, sendLineMessages, sendLineWithQuickReply } = require("../line");
const { sendSlackToUser } = require("../slack");

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
router.post("/webhook", async (req, res) => {
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
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(s.url)}`;
      await sendLineMessages(userId, [
        { type: "text", text: `🖥 ${s.name}\n\n🔗 ${s.url}` },
        { type: "image", originalContentUrl: qrUrl, previewImageUrl: qrUrl }
      ]);
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
      const senderName = ID_TO_NAME[userId] || "管理員";
      await sendSlackToUser(targetName, `📌 工作進度提醒\n\n${senderName} 希望你查看今日工作進度，並在系統中勾選已完成的任務。\n\n🔗 https://s71043201-star.github.io/meetbot-app/`);
      await sendLine(userId, `✅ 已向 ${targetName} 發出 Slack 私訊提醒`);
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

module.exports = router;

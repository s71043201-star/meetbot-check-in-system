const { TEAM } = require("../config");
const { daysLeft } = require("../utils");

function buildExportWordHtml(tasks) {
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

  return html;
}

module.exports = { buildExportWordHtml };

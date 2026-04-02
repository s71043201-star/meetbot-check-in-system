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

module.exports = { generateRecordHtml };

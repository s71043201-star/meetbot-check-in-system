const { toTaipei } = require("../utils");

function safeSheetName(wb, name) {
  let base = (name || '無名').replace(/[\\/?*[\]:]/g, '').slice(0, 31).trim() || '無名';
  const exists = () => wb.worksheets.some(ws => ws.name.toLowerCase() === base.toLowerCase());
  let i = 2;
  const orig = base;
  while (exists()) base = orig.slice(0, 29) + '_' + (i++);
  return base;
}

function buildPersonSheet(wb, personName, records) {
  const ws = wb.addWorksheet(safeSheetName(wb, personName));

  const bdr  = { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} };
  const mid  = { horizontal:"center", vertical:"middle" };
  const lmid = { horizontal:"left",   vertical:"middle", wrapText:true };
  const tk   = { name:"DFKai-SB", size:12, charset:136 };

  [5, 8, 8, 12, 12, 32, 13, 13, 13].forEach((w, i) => { ws.getColumn(i+1).width = w; });

  // Row 1 大標題
  ws.mergeCells("B1:I1");
  ws.getRow(1).height = 42;
  ws.getCell("B1").value = "健康台灣深耕計畫專職人員出勤記錄表";
  ws.getCell("B1").style = { font:{...tk, size:14, bold:true}, alignment:mid };

  // Row 2 副標題
  ws.mergeCells("B2:I2");
  ws.getRow(2).height = 36;
  ws.getCell("B2").value = "臨時人員出勤記錄與工作內容說明";
  ws.getCell("B2").style = { font:{...tk, size:13, bold:true}, alignment:mid };

  // Row 3 姓名 + 工作內容
  ws.mergeCells("C3:D3");
  ws.mergeCells("F3:I3");
  ws.getRow(3).height = 90;
  ws.getCell("B3").value = "姓名";
  ws.getCell("B3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("C3").value = personName;
  ws.getCell("C3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("E3").value = "工作內容";
  ws.getCell("E3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("F3").value = "協助處方課執行期間\n場地協助、報到協助、出席紀錄、活動影像紀錄、課後滿意度調查提醒等";
  ws.getCell("F3").style = { font:tk, alignment:lmid, border:bdr };

  // Row 4 欄位標題
  ws.getRow(4).height = 30;
  ["", "編號", "年", "月", "日", "課程名稱", "時　分", "至時分", "共計（時）"].forEach((h, i) => {
    if (i === 0) return;
    const cell = ws.getCell(4, i+1);
    cell.value = h;
    cell.style = { font:tk, alignment:mid, border:bdr };
  });

  // 資料列 — 支援多課程：每堂課程佔一行
  let totalHours = 0;
  let rowIdx = 0;
  const dataStart = 5;

  records.forEach((r) => {
    const ci  = toTaipei(new Date(r.checkinTime)).toLocaleTimeString("zh-TW",  { hour:"2-digit", minute:"2-digit" });
    const co  = r.checkoutTime ? toTaipei(new Date(r.checkoutTime)).toLocaleTimeString("zh-TW", { hour:"2-digit", minute:"2-digit" }) : "-";

    // 多課程支援：若有 courses 陣列則展開
    const courses = r.courses || [{ course: r.course }];
    courses.forEach((c, cIdx) => {
      const rn = dataStart + rowIdx;
      ws.getRow(rn).height = 30;
      const courseName = c.course || r.course || "";
      const hours = cIdx === 0 ? (r.hours || 0) : "";
      const row = ["", rowIdx + 1, r.year, r.month, r.day, courseName, ci, co, hours];
      row.forEach((v, i) => {
        if (i === 0) return;
        const cell = ws.getCell(rn, i + 1);
        cell.value = v;
        cell.style = { font: tk, alignment: i === 5 ? lmid : mid, border: bdr };
      });
      rowIdx++;
    });
    totalHours += r.hours || 0;
  });

  // 合計列
  const tr = dataStart + rowIdx;
  ws.getRow(tr).height = 30;
  for (let c = 2; c <= 9; c++) {
    const cell = ws.getCell(tr, c);
    if (c === 2) {
      cell.value = "累計";
      cell.style = { font:{...tk, bold:true}, alignment:mid, border:bdr };
    } else if (c === 9) {
      cell.value = Math.round(totalHours * 10) / 10;
      cell.style = { font:{...tk, bold:true}, alignment:mid, border:bdr };
    } else {
      cell.style = { border:bdr };
    }
  }
}

module.exports = { safeSheetName, buildPersonSheet };

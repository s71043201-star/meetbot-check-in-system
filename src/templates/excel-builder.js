const { toTaipei } = require("../utils");

function safeSheetName(wb, name) {
  // 移除 Excel 不允許的字元，限制 31 字
  let base = (name || '無名').replace(/[\\/?*[\]:]/g, '').slice(0, 31).trim() || '無名';
  // 避免與已存在的工作表名稱衝突（不分大小寫）
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

  // 欄寬：A(1) B(2)編號 C(3)年 D(4)月 E(5)日 F(6)課程名稱 G(7)時分 H(8)至時分 I(9)共計
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

  // 資料列
  let totalHours = 0;
  const dataStart = 5;
  records.forEach((r, idx) => {
    const rn  = dataStart + idx;
    ws.getRow(rn).height = 30;
    const ci  = toTaipei(new Date(r.checkinTime)).toLocaleTimeString("zh-TW",  { hour:"2-digit", minute:"2-digit" });
    const co  = toTaipei(new Date(r.checkoutTime)).toLocaleTimeString("zh-TW", { hour:"2-digit", minute:"2-digit" });
    const row = ["", idx+1, r.year, r.month, r.day, r.course||"", ci, co, r.hours];
    row.forEach((v, i) => {
      if (i === 0) return;
      const cell = ws.getCell(rn, i+1);
      cell.value = v;
      cell.style = { font:tk, alignment: i === 5 ? lmid : mid, border:bdr };
    });
    totalHours += r.hours || 0;
  });

  // 合計列
  const tr = dataStart + records.length;
  ws.getRow(tr).height = 30;
  // 不使用 mergeCells，改為逐格設定邊線確保底線完整
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

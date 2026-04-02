const express = require("express");
const ExcelJS = require("exceljs");
const router = express.Router();
const { docStore } = require("../utils");
const { fbGet } = require("../firebase");
const { fetchTasksFromFirebase } = require("../firebase");
const { buildPersonSheet } = require("../templates/excel-builder");
const { buildExportWordHtml } = require("../templates/export-word-html");
const { buildExportFullHtml } = require("../templates/export-full-html");

// ── 匯出 Excel ────────────────────────────────
router.get("/export", async (req, res) => {
  const { name: nameFilter, month: monthFilter, year: yearFilter } = req.query;
  try {
    const data = await fbGet();
    let records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    if (nameFilter)  records = records.filter(r => r.name  === nameFilter);
    if (monthFilter) records = records.filter(r => r.month === parseInt(monthFilter));
    if (yearFilter)  records = records.filter(r => r.year  === parseInt(yearFilter));
    records = records.filter(r => r.status === "checked-out");
    records.sort((a, b) => new Date(a.checkinTime) - new Date(b.checkinTime));

    // 按人分組
    const byPerson = {};
    records.forEach(r => {
      if (!byPerson[r.name]) byPerson[r.name] = [];
      byPerson[r.name].push(r);
    });

    const wb = new ExcelJS.Workbook();
    if (Object.keys(byPerson).length === 0) {
      buildPersonSheet(wb, nameFilter || "無記錄", []);
    } else {
      for (const [pname, pRecords] of Object.entries(byPerson)) {
        buildPersonSheet(wb, pname, pRecords);
      }
    }

    const fileName = `臨時人員出勤記錄_${yearFilter||""}年${monthFilter ? monthFilter+"月" : ""}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("export:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 下載課程記錄頁 ──────────────────────────────
router.get("/download/:uid", (req, res) => {
  const item = docStore.get(req.params.uid);
  if (!item) return res.status(404).send("頁面不存在（伺服器重啟後連結會失效，請重新簽到簽退產生新記錄）");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(item.html);
});

// ── 匯出 Word 任務報告 ────────────────────────
router.get("/export-word", async (req, res) => {
  try {
    const tasks = await fetchTasksFromFirebase();
    const html = buildExportWordHtml(tasks);
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''MeetBot%E4%BB%BB%E5%8B%99%E5%A0%B1%E5%91%8A.doc");
    res.send("\uFEFF" + html);
  } catch (e) {
    console.error("匯出失敗:", e.message);
    res.status(500).send("匯出失敗：" + e.message);
  }
});

// ── 匯出領據 Word ───────────────────────────────
router.get("/export-full", async (req, res) => {
  const { name, month, year } = req.query;
  try {
    const data = await fbGet();
    let records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    if (month) records = records.filter(r => r.month === parseInt(month));
    if (year)  records = records.filter(r => r.year  === parseInt(year));

    const grouped = {};
    records.forEach(r => {
      if (!r.name) return;
      if (name && r.name !== name) return;
      if (!grouped[r.name]) grouped[r.name] = [];
      grouped[r.name].push(r);
    });

    const html = buildExportFullHtml(grouped);
    const fn = `領據_${name || "全部人員"}.doc`;
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fn)}`);
    res.send("\uFEFF" + html);
  } catch (e) {
    console.error("export-full:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

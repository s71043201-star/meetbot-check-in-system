const express = require("express");
const router = express.Router();
const { getDoc } = require("../utils");
const { fetchTasksFromFirebase } = require("../firebase");
const { buildExportWordHtml } = require("../templates/export-word-html");

// ── 舊版匯出 Excel／領據（已停用）──────────────
// 沒有驗證又會輸出身分證、匯款帳號等個資；改用
// /schedule/export（時數 Excel）與 /schedule/admin/export-receipts（領據），需管理員登入。
router.all(["/export", "/export-full"], (req, res) => {
  res.status(403).json({ error: "此舊版路徑已停用，請改用 /schedule 跟課班表系統" });
});

// ── 下載課程記錄頁 ──────────────────────────────
router.get("/download/:uid", async (req, res) => {
  const item = await getDoc(req.params.uid);
  if (!item) return res.status(404).send("頁面不存在或已過期（7天後自動刪除，請重新簽到簽退產生新記錄）");
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

module.exports = router;

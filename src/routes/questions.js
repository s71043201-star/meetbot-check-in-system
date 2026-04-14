const express = require("express");
const ExcelJS = require("exceljs");
const router = express.Router();
const { qaGet, qaPost, qaPut } = require("../firebase");

const UNITS = ["衛服部", "健康處方管理系統", "合作診所相關", "社區駐點辦公室", "課務與社區資源", "行政與人事管理"];
const STATUSES = ["待處理", "處理中", "已回覆", "已結案"];

// ── 輔助：取得所有未刪除問題 ─────────────────────
async function getAllQuestions() {
  const data = await qaGet();
  if (!data) return [];
  return Object.entries(data)
    .map(([id, r]) => ({ id, ...r }))
    .filter(r => !r.deleted);
}

// ── 輔助：篩選 ──────────────────────────────────
function applyFilters(questions, query) {
  let result = questions;
  if (query.unit)     result = result.filter(r => r.unit === query.unit);
  if (query.status)   result = result.filter(r => r.status === query.status);
  if (query.category) result = result.filter(r => r.category === query.category);
  if (query.priority) result = result.filter(r => r.priority === query.priority);
  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    result = result.filter(r =>
      (r.content || "").toLowerCase().includes(kw) ||
      (r.contactName || "").toLowerCase().includes(kw) ||
      (r.answer || "").toLowerCase().includes(kw)
    );
  }
  if (query.dateFrom) {
    result = result.filter(r => r.createdAt >= query.dateFrom);
  }
  if (query.dateTo) {
    const to = query.dateTo + "T23:59:59";
    result = result.filter(r => r.createdAt <= to);
  }
  return result.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// ── 統計 ─────────────────────────────────────────
router.get("/api/questions/stats", async (req, res) => {
  try {
    const all = await getAllQuestions();
    const byStatus = {};
    const byUnit = {};
    const byCategory = {};
    STATUSES.forEach(s => byStatus[s] = 0);
    UNITS.forEach(u => byUnit[u] = 0);
    all.forEach(r => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byUnit[r.unit] = (byUnit[r.unit] || 0) + 1;
      if (r.category) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    });
    res.json({ total: all.length, byStatus, byUnit, byCategory });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 匯出 Excel ──────────────────────────────────
router.get("/api/questions/export", async (req, res) => {
  try {
    const all = await getAllQuestions();
    const filtered = applyFilters(all, req.query);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("問題清單");
    ws.columns = [
      { header: "編號", key: "idx", width: 6 },
      { header: "提問單位", key: "unit", width: 12 },
      { header: "聯絡人", key: "contactName", width: 12 },
      { header: "聯絡方式", key: "contactInfo", width: 20 },
      { header: "問題類別", key: "category", width: 14 },
      { header: "問題內容", key: "content", width: 40 },
      { header: "優先等級", key: "priority", width: 10 },
      { header: "狀態", key: "status", width: 10 },
      { header: "回覆內容", key: "answer", width: 40 },
      { header: "回覆人", key: "answeredBy", width: 12 },
      { header: "提問時間", key: "createdAt", width: 18 },
      { header: "回覆時間", key: "answeredAt", width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    filtered.forEach((r, i) => {
      ws.addRow({
        idx: i + 1,
        unit: r.unit,
        contactName: r.contactName,
        contactInfo: r.contactInfo,
        category: r.category,
        content: r.content,
        priority: r.priority,
        status: r.status,
        answer: r.answer || "",
        answeredBy: r.answeredBy || "",
        createdAt: r.createdAt ? r.createdAt.slice(0, 16).replace("T", " ") : "",
        answeredAt: r.answeredAt ? r.answeredAt.slice(0, 16).replace("T", " ") : "",
      });
    });

    const fileName = `問題清單_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 公開查詢（依聯絡方式搜尋） ─────────────────
router.get("/api/questions/public/search", async (req, res) => {
  const { contactInfo } = req.query;
  if (!contactInfo) return res.status(400).json({ error: "請提供聯絡方式" });
  try {
    const all = await getAllQuestions();
    const matches = all
      .filter(r => r.contactInfo === contactInfo)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .map(r => ({
        id: r.id,
        unit: r.unit,
        category: r.category,
        content: r.content,
        priority: r.priority,
        status: r.status,
        answer: r.answer || "",
        answeredAt: r.answeredAt || "",
        createdAt: r.createdAt,
      }));
    res.json(matches);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 列表查詢 ─────────────────────────────────────
router.get("/api/questions", async (req, res) => {
  try {
    const all = await getAllQuestions();
    const filtered = applyFilters(all, req.query);
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 新增問題 ─────────────────────────────────────
router.post("/api/questions", async (req, res) => {
  const { unit, contactName, contactInfo, category, content, priority } = req.body;
  if (!content) return res.status(400).json({ error: "缺少問題內容" });

  const now = new Date().toISOString();
  const record = {
    unit: unit || "民眾端",
    contactName: contactName || "",
    contactInfo: contactInfo || "",
    category: category || "其他",
    content,
    priority: priority || "一般",
    status: "待處理",
    answer: "",
    answeredBy: "",
    answeredAt: "",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await qaPost(record);
    res.json({ ok: true, id: result.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 取得單筆 ─────────────────────────────────────
router.get("/api/questions/:id", async (req, res) => {
  try {
    const record = await qaGet(`/${req.params.id}`);
    if (!record || record.deleted) return res.status(404).json({ error: "not found" });
    res.json({ id: req.params.id, ...record });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 更新（回覆、改狀態） ────────────────────────
router.put("/api/questions/:id", async (req, res) => {
  try {
    const existing = await qaGet(`/${req.params.id}`);
    if (!existing || existing.deleted) return res.status(404).json({ error: "not found" });

    const updates = {};
    const allowed = ["answer", "answeredBy", "status", "category", "priority"];
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    updates.updatedAt = new Date().toISOString();

    if (updates.answer && updates.status === "已回覆") {
      updates.answeredAt = updates.updatedAt;
    }

    const merged = { ...existing, ...updates };
    await qaPut(`/${req.params.id}`, merged);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 刪除（軟刪除） ─────────────────────────────
router.delete("/api/questions/:id", async (req, res) => {
  try {
    const existing = await qaGet(`/${req.params.id}`);
    if (!existing) return res.status(404).json({ error: "not found" });
    await qaPut(`/${req.params.id}`, { ...existing, deleted: true, deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 批量更新狀態 ────────────────────────────────
router.post("/api/questions/batch-update", async (req, res) => {
  const { ids, status } = req.body;
  if (!ids || !ids.length || !status) return res.status(400).json({ error: "缺少 ids 或 status" });
  try {
    const now = new Date().toISOString();
    for (const id of ids) {
      const existing = await qaGet(`/${id}`);
      if (existing && !existing.deleted) {
        await qaPut(`/${id}`, { ...existing, status, updatedAt: now });
      }
    }
    res.json({ ok: true, updated: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

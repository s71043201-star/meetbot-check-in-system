const express = require("express");
const axios = require("axios");
const router = express.Router();
const { ATT_FB } = require("../config");
const { toTaipei, toROCYear, storeDoc } = require("../utils");
const { fbGet, fbPost, fbPut, fbDelete } = require("../firebase");
const { sendSlack } = require("../slack");
const { generateRecordHtml } = require("../templates/record-html");

// ── 簽到 ──────────────────────────────────────
router.post("/checkin", async (req, res) => {
  const { name, eventName, workDescription, feeTypes, payMethod, bankInfo, idNumber, address, liveAddress, phone } = req.body;
  if (!name) return res.status(400).json({ error: "缺少姓名" });

  const now    = new Date();
  const taipei = toTaipei(now);

  const record = {
    name, eventName: eventName || "",
    workDescription: workDescription || "",
    feeTypes: feeTypes || [],
    payMethod: payMethod || "",
    bankInfo: bankInfo || {},
    idNumber: idNumber || "",
    address: address || "",
    liveAddress: liveAddress || "",
    phone: phone || "",
    checkinTime: now.toISOString(),
    year:  toROCYear(taipei),
    month: taipei.getMonth() + 1,
    day:   taipei.getDate(),
    status: "checked-in"
  };

  try {
    const result    = await fbPost(record);
    const sessionId = result.name;
    const timeStr   = taipei.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const msg = `✅ 臨時人員簽到\n\n👤 姓名：${name}\n📋 活動：${eventName || "-"}\n⏰ 簽到時間：${timeStr}`;
    await sendSlack(msg);
    res.json({ ok: true, sessionId });
  } catch (e) {
    console.error("checkin:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 簽退 ──────────────────────────────────────
router.post("/checkout", async (req, res) => {
  const { sessionId, shift, workContent, note, checkinType, courses, scheduledTime, uploadedFiles } = req.body;
  if (!sessionId) return res.status(400).json({ error: "缺少 sessionId" });

  const now    = new Date();
  const taipei = toTaipei(now);

  try {
    const record      = await fbGet(`/${sessionId}`);
    if (!record) return res.status(404).json({ error: "找不到簽到記錄" });
    const checkinTime = new Date(record.checkinTime);
    const hours       = Math.ceil((now - checkinTime) / 3600000 * 2) / 2;
    const { courseType, teacher, plannedHours, registeredCount, actualCount, walkInCount, summary } = req.body;
    const course      = req.body.course || "";
    const checkinStr  = toTaipei(checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const checkoutStr = taipei.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const dateStr     = `${record.year}/${record.month}/${record.day}`;
    const typeLabel   = checkinType === "處方日" ? "處方日" : checkinType === "行政庶務" ? "行政庶務" : "一般";

    const updated = {
      ...record,
      checkoutTime:     now.toISOString(),
      checkinType:      checkinType || "一般",
      course:           course,
      courses:          courses || [],
      scheduledTime:    scheduledTime || "",
      courseType:       courseType || "",
      teacher:          teacher || "",
      plannedHours:     plannedHours || "",
      registeredCount:  registeredCount ?? "",
      actualCount:      actualCount ?? "",
      walkInCount:      walkInCount ?? "",
      summary:          summary || "",
      workContent:      workContent || "",
      note:             note || "",
      uploadedFiles:    uploadedFiles || [],
      hours,
      status: "checked-out"
    };
    await fbPut(`/${sessionId}`, updated);

    // 產生課程記錄頁（支援多課程分區顯示）
    // courses 可能是完整物件陣列（處方日新格式）或字串陣列（舊格式）
    let coursesForHtml = null;
    if (courses && courses.length > 0 && typeof courses[0] === "object") {
      coursesForHtml = courses;
    }
    const recordHtml = generateRecordHtml({
      name: record.name, course: course, date: dateStr,
      checkinStr, checkoutStr, hours, plannedHours, courseType,
      teacher, registeredCount, actualCount, walkInCount, summary,
      courses: coursesForHtml,
    });
    const uid = storeDoc(recordHtml, `課程記錄_${record.name}`);
    const downloadUrl = `${process.env.BASE_URL || "https://meetbot-check-in-system.onrender.com"}/download/${uid}`;

    const msg = `🔚 臨時人員簽退\n\n👤 姓名：${record.name}\n🏷 類型：${typeLabel}\n📚 課程：${course || "-"}\n🏷 屬性：${courseType || "-"}\n⏰ 簽到：${checkinStr}　簽退：${checkoutStr}\n⏱ 時數：${hours} 小時\n👥 實到：${actualCount ?? "-"} 人\n\n📄 課程記錄（可列印/存PDF）：\n${downloadUrl}`;
    await sendSlack(msg);
    res.json({ ok: true, hours });
  } catch (e) {
    console.error("checkout:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 檔案上傳（行政庶務）─────────────────────────
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { uploadFile } = require("../storage");

router.post("/upload-files", upload.array("files", 10), async (req, res) => {
  try {
    const sessionId = req.body.sessionId || "unknown";
    const results = [];
    for (const file of (req.files || [])) {
      const result = await uploadFile(file.buffer, file.originalname, file.mimetype, sessionId);
      results.push(result);
    }
    res.json({ ok: true, files: results });
  } catch (e) {
    console.error("upload-files:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢單一 session ──────────────────────────
router.get("/session/:id", async (req, res) => {
  try {
    const record = await fbGet(`/${req.params.id}`);
    if (!record) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, record, sessionId: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢姓名是否有進行中的簽到 ────────────────
router.get("/active-session", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "缺少 name" });
  try {
    const data = await fbGet();
    if (!data) return res.json({ found: false });
    const entry = Object.entries(data).find(
      ([, r]) => r.name === name && r.status === "checked-in"
    );
    if (!entry) return res.json({ found: false });
    res.json({ found: true, sessionId: entry[0], record: entry[1] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢領據歷史資料（依姓名） ─────────────────
router.get("/receipt-data", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "缺少 name" });
  try {
    const data = await fbGet();
    if (!data) return res.json({ found: false });
    // 找該姓名最新一筆有身分證資料的紀錄
    const entries = Object.entries(data)
      .filter(([, r]) => r.name === name && r.idNumber)
      .sort((a, b) => new Date(b[1].checkinTime) - new Date(a[1].checkinTime));
    if (entries.length === 0) return res.json({ found: false });
    const record = entries[0][1];
    res.json({
      found: true,
      record: {
        eventName: record.eventName,
        workDescription: record.workDescription,
        feeTypes: record.feeTypes,
        payMethod: record.payMethod,
        bankInfo: record.bankInfo,
        idNumber: record.idNumber,
        address: record.address,
        liveAddress: record.liveAddress,
        phone: record.phone,
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢記錄 ──────────────────────────────────
router.get("/records", async (req, res) => {
  try {
    const data    = await fbGet();
    const records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    res.json(records);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 批量軟刪除記錄 ─────────────────────────────
router.post("/records/batch-delete", async (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: "缺少 ids" });
  try {
    const now = new Date().toISOString();
    for (const id of ids) {
      const existing = await fbGet(`/${id}`);
      if (existing) await fbPut(`/${id}`, { ...existing, attendanceDeleted: true, deletedAt: now });
    }
    res.json({ ok: true, deleted: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 更新單筆記錄 ─────────────────────────────
router.put("/records/:id", async (req, res) => {
  try {
    const existing = await fbGet(`/${req.params.id}`);
    if (!existing) return res.status(404).json({ error: "not found" });
    const updated = { ...existing, ...req.body };
    await fbPut(`/${req.params.id}`, updated);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 軟刪除記錄（標記 deleted） ──────────────────
router.delete("/records/:id", async (req, res) => {
  try {
    const existing = await fbGet(`/${req.params.id}`);
    if (!existing) return res.status(404).json({ error: "not found" });
    await fbPut(`/${req.params.id}`, { ...existing, attendanceDeleted: true, deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 還原已刪除記錄 ──────────────────────────────
router.post("/records/:id/restore", async (req, res) => {
  try {
    const existing = await fbGet(`/${req.params.id}`);
    if (!existing) return res.status(404).json({ error: "not found" });
    const { attendanceDeleted, deletedAt, ...rest } = existing;
    await fbPut(`/${req.params.id}`, rest);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

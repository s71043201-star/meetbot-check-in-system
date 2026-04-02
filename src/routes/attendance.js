const express = require("express");
const router = express.Router();
const { MEMBERS, ATT_NOTIFY_IDS, BASE_URL } = require("../config");
const { fbGet, fbPost, fbPut, fbDelete } = require("../firebase");
const { sendLine } = require("../line");
const { toTaipei, toROCYear, storeDoc } = require("../utils");
const { generateRecordHtml } = require("../templates/record-html");

// ── 簽到 ──
router.post("/checkin", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "缺少姓名" });

  const now    = new Date();
  const taipei = toTaipei(now);

  const record = {
    name,
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
    const msg = `✅ 臨時人員簽到\n\n👤 姓名：${name}\n⏰ 簽到時間：${timeStr}`;
    for (const uid of ATT_NOTIFY_IDS) await sendLine(uid, msg).catch(() => {});
    res.json({ ok: true, sessionId });
  } catch (e) {
    console.error("checkin:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 簽退（支援多課程） ──
router.post("/checkout", async (req, res) => {
  const { sessionId, courses } = req.body;
  if (!sessionId) return res.status(400).json({ error: "缺少 sessionId" });

  const now    = new Date();
  const taipei = toTaipei(now);

  try {
    const record = await fbGet(`/${sessionId}`);
    if (!record) return res.status(404).json({ error: "找不到簽到記錄" });
    const checkinTime = new Date(record.checkinTime);
    const hours       = Math.round((now - checkinTime) / 3600000 * 10) / 10;
    const checkinStr  = toTaipei(checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const checkoutStr = taipei.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const dateStr     = `${record.year}/${record.month}/${record.day}`;

    // 支援舊格式（扁平欄位）和新格式（courses 陣列）
    let coursesData;
    if (courses && Array.isArray(courses) && courses.length > 0) {
      coursesData = courses;
    } else {
      // 向下相容：從扁平欄位組裝
      const { courseType, teacher, plannedHours, registeredCount, actualCount, walkInCount, summary } = req.body;
      coursesData = [{
        course: req.body.course || record.course || "",
        courseType: courseType || "",
        teacher: teacher || "",
        plannedHours: plannedHours || "",
        registeredCount: registeredCount ?? "",
        actualCount: actualCount ?? "",
        walkInCount: walkInCount ?? "",
        summary: summary || "",
      }];
    }

    const updated = {
      ...record,
      checkoutTime: now.toISOString(),
      courses: coursesData,
      hours,
      status: "checked-out"
    };
    await fbPut(`/${sessionId}`, updated);

    // 產生課程記錄頁
    const recordHtml = generateRecordHtml({
      name: record.name, date: dateStr,
      checkinStr, checkoutStr, hours,
      courses: coursesData,
    });
    const uid = storeDoc(recordHtml, `課程記錄_${record.name}`);
    const downloadUrl = `${BASE_URL}/download/${uid}`;

    const courseNames = coursesData.map(c => c.course).filter(Boolean).join("、") || "-";
    const totalActual = coursesData.reduce((s, c) => s + (parseInt(c.actualCount) || 0), 0);
    const msg = `🔚 臨時人員簽退\n\n👤 姓名：${record.name}\n📚 課程：${courseNames}\n⏰ 簽到：${checkinStr}　簽退：${checkoutStr}\n⏱ 時數：${hours} 小時\n👥 實到：${totalActual} 人\n\n📄 課程記錄（可列印/存PDF）：\n${downloadUrl}`;
    for (const notifyId of ATT_NOTIFY_IDS) await sendLine(notifyId, msg).catch(() => {});
    res.json({ ok: true, hours });
  } catch (e) {
    console.error("checkout:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢單一 session ──
router.get("/session/:id", async (req, res) => {
  try {
    const record = await fbGet(`/${req.params.id}`);
    if (!record) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, record, sessionId: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢姓名是否有進行中的簽到 ──
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

// ── 查詢記錄 ──
router.get("/records", async (req, res) => {
  try {
    const data    = await fbGet();
    const records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    res.json(records);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 刪除記錄 ──
router.delete("/records/:id", async (req, res) => {
  try {
    await fbDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

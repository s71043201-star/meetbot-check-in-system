const express = require("express");
const router = express.Router();

// ── 舊版簽到／後台 API（已停用）────────────────
// 早期 checkin.html / admin.html 用的端點，沒有伺服器端驗證，
// 且會回傳身分證、匯款帳號、地址、電話等個資，因此一律關閉。
// 功能已由 /schedule 底下的新系統取代（有 session 與角色檢查）：
//   簽到簽退 → /schedule/checkin、/schedule/checkout
//   出勤後台 → /schedule/admin/attendance、/schedule/records
//   人員資料 → /schedule/admin/users
const LEGACY_PATHS = [
  "/admin/verify-password",
  "/register",
  "/login",
  "/users", "/users/:id",
  "/checkin",
  "/checkout",
  "/upload-files",
  "/session/:id",
  "/active-session",
  "/receipt-data",
  "/records", "/records/batch-delete", "/records/:id", "/records/:id/restore",
];

router.all(LEGACY_PATHS, (req, res) => {
  res.status(403).json({ error: "此舊版路徑已停用，請改用 /schedule 跟課班表系統" });
});

module.exports = router;

// 本機預覽用啟動器：用 demo 命名空間，不動正式資料。（可安全刪除）
process.env.SCHED_FB = process.env.SCHED_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/schedule_demo";
// 簽到出勤資料也用 demo 命名空間，避免測試污染正式 attendance
process.env.ATT_FB = process.env.ATT_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/attendance_demo";
// 使用者報名資料也用 demo 假資料，避免測試碰到正式個資
process.env.USERS_FB = process.env.USERS_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/users_demo";
process.env.PORT = process.env.PORT || "3001";
process.env.BASE_URL = "http://localhost:3001";
require("./server.js");

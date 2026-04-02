const TOKEN = process.env.LINE_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.BASE_URL || "https://meetbot-check-in-system.onrender.com";
const PORT = process.env.PORT || 3000;

const TEAM = ["黃琴茹","蔡蕙芳","吳承儒","張鈺微","吳亞璇","許雅淇","戴豐逸","陳佩研"];

const MEMBERS = {
  "黃琴茹": "U858b6b722d9a01e1a927d07f8ffc65ed",
  "蔡蕙芳": "Uc05e7076d830f4f75ecc14a07b697e5c",
  "吳承儒": "U1307dd217e15b4ef777f8f0561c2e589",
  "張鈺微": "U7c71775e251051b61994eda22ddc2bec",
  "吳亞璇": "Ue69dbd040159f69636c08dfd9568aa63",
  "許雅淇": "U87efc2433f2ab838929cbfbdb2851748",
  "戴豐逸": "Uece4baaf97cfab39ad79c6ed0ee55d03",
  "陳佩研": "Uc8e074d50b3b20581945f5c6aca80d1d",
};

const ID_TO_NAME = Object.fromEntries(Object.entries(MEMBERS).map(([k, v]) => [v, k]));

const BOSS_IDS = [
  "Uc05e7076d830f4f75ecc14a07b697e5c", // 蔡蕙芳
  "Uece4baaf97cfab39ad79c6ed0ee55d03", // 戴豐逸
];

const SYSTEMS = {
  "週報":     { name: "週報統計系統",             url: "https://s71043201-star.github.io/tpma-statistics/" },
  "會議":     { name: "meetbot 會議任務追蹤系統",  url: "https://s71043201-star.github.io/meetbot-app/" },
  "歷次列管": { name: "會議歷次列管事項生成系統",  url: "https://s71043201-star.github.io/meeting-system/" },
  "簽到":     { name: "臨時人員簽到系統",          url: "https://meetbot-check-in-system.onrender.com/checkin.html" },
  "後台":     { name: "出缺勤後台管理",            url: "https://meetbot-check-in-system.onrender.com/admin.html" },
};

const ATT_BOSS_IDS = [
  "Uc8e074d50b3b20581945f5c6aca80d1d",
  "Uece4baaf97cfab39ad79c6ed0ee55d03",
];

// 測試中：暫時只通知戴豐逸，測試完畢後再加回陳佩研
const ATT_NOTIFY_IDS = [
  "Uece4baaf97cfab39ad79c6ed0ee55d03", // 戴豐逸
];

const TASKS_FB = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/tasks.json";
const ATT_FB   = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/attendance";

module.exports = {
  TOKEN, ANTHROPIC_API_KEY, BASE_URL, PORT,
  TEAM, MEMBERS, ID_TO_NAME, BOSS_IDS,
  SYSTEMS, ATT_BOSS_IDS, ATT_NOTIFY_IDS,
  TASKS_FB, ATT_FB,
};

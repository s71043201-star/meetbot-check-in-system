// 診所停權（改密碼）的 LINE 指令 — 只收指令、不碰密碼。
//
// 流程：「停權診所」→ 回 4 碼確認碼 →「確認停權 1234」→ 在 Firebase /clinicSuspend/requests/{id}
// 寫一筆 pending（附 HMAC 簽章）→ 戴豐逸電腦上的 C:\prescription\scripts\clinic_suspend.py
// 每分鐘來拿、驗簽章後才真的改密碼，做完會 LINE 推播結果。
// 帳密表跟 admin 帳密都只在那台電腦上，Render 這邊沒有，所以就算這裡被打穿也改不了密碼。
const crypto = require("crypto");
const axios = require("axios");
const { replyLine } = require("./line");

const SUSPEND_FB = process.env.SUSPEND_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/clinicSuspend/requests";
const SECRET = process.env.SUSPEND_SECRET || "";

// 本機腳本有同一份名單（ALLOWED_REQUESTERS），兩邊都要過
const ADMIN_IDS = new Set([
  "Uece4baaf97cfab39ad79c6ed0ee55d03", // 戴豐逸
]);

const ACTIONS = {
  suspend: { label: "停權", ask: "停權診所", confirm: "確認停權" },
  restore: { label: "還原", ask: "還原診所", confirm: "確認還原" },
};
const CONFIRM_TTL = 5 * 60 * 1000;
const pending = {}; // userId → { action, code, exp }

const STATUS_LABEL = {
  pending: "⏳ 等待本機執行", running: "⚙️ 執行中", done: "✅ 已完成",
  error: "❌ 失敗", rejected: "⛔ 被拒絕", expired: "⌛ 已作廢",
};

function sign(id, action, at, by) {
  return crypto.createHmac("sha256", SECRET).update(id + "|" + action + "|" + at + "|" + by).digest("hex");
}

function fmtTime(ms) {
  return new Date(ms).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

async function latestRequest() {
  const { data } = await axios.get(SUSPEND_FB + ".json", {
    params: { orderBy: '"requestedAt"', limitToLast: 1 }, timeout: 10000,
  }).catch(() => axios.get(SUSPEND_FB + ".json", { timeout: 10000 })); // 沒建索引時退回抓全部
  const rows = Object.entries(data || {}).sort((a, b) => (b[1].requestedAt || 0) - (a[1].requestedAt || 0));
  return rows.length ? { id: rows[0][0], ...rows[0][1] } : null;
}

async function statusText() {
  const r = await latestRequest();
  if (!r) return "目前沒有停權／還原紀錄。";
  const a = ACTIONS[r.action] || { label: r.action };
  let msg = "📋 最近一次診所" + a.label + "\n" + STATUS_LABEL[r.status] + "\n送出：" + fmtTime(r.requestedAt);
  if (r.finishedAt) msg += "\n完成：" + fmtTime(r.finishedAt);
  if (r.status === "done") {
    msg += "\n\n診所 " + r.clinics + " 家、帳號 " + r.total + " 個\n成功 " + r.okCount + " 個";
    const failed = r.failed || [];
    if (failed.length) msg += "，失敗 " + failed.length + " 個\n" + failed.slice(0, 20).map(f => "• " + f.clinic + " " + f.account).join("\n");
  }
  if (r.error) msg += "\n\n" + r.error;
  if (r.status === "pending" && Date.now() - r.requestedAt > 3 * 60 * 1000) {
    msg += "\n\n⚠️ 已等超過 3 分鐘，戴豐逸的電腦可能沒開；15 分鐘內沒執行會自動作廢。";
  }
  return msg;
}

// 回傳 true = 這則訊息已處理
async function handleSuspendMessage({ userId, text, replyToken }) {
  const isAsk = Object.entries(ACTIONS).find(([, a]) => text === a.ask);
  const confirmMatch = text.match(/^(確認停權|確認還原)\s*(\d{4})$/);
  if (!isAsk && !confirmMatch && text !== "停權狀態") return false;
  // 不是指定的人就當作沒看到，交給後面的一般指令處理（不透露有這個功能）
  if (!ADMIN_IDS.has(userId)) return false;

  const reply = msg => replyLine(replyToken, msg).then(() => true);
  if (!SECRET) return reply("❌ 尚未設定 SUSPEND_SECRET，停權功能未啟用");

  if (text === "停權狀態") return reply(await statusText());

  if (isAsk) {
    const [action, a] = isAsk;
    const code = String(crypto.randomInt(0, 10000)).padStart(4, "0");
    pending[userId] = { action, code, exp: Date.now() + CONFIRM_TTL };
    return reply(
      (action === "suspend" ? "🔒" : "🔓") + " 診所" + a.label + "\n" + "═".repeat(16) + "\n" +
      "對象：第七次推動會議開立量 1–36 名的診所，帳密表上的醫師帳號（實際筆數執行完會回報）\n" +
      (action === "suspend"
        ? "做法：密碼改成「原密碼＋@」，改完已登入的醫師最多再用 15 分鐘\n"
        : "做法：密碼改回帳密表上的原密碼\n") +
      "\n確定要執行請在 5 分鐘內輸入：\n" + a.confirm + " " + code);
  }

  const action = confirmMatch[1] === "確認停權" ? "suspend" : "restore";
  const p = pending[userId];
  if (!p || p.action !== action || Date.now() > p.exp) {
    delete pending[userId];
    return reply("確認碼已過期或不存在，請重新輸入「" + ACTIONS[action].ask + "」");
  }
  if (p.code !== confirmMatch[2]) return reply("確認碼不對，請再確認一次");
  delete pending[userId];

  const id = Date.now() + "-" + crypto.randomBytes(4).toString("hex");
  const at = Date.now();
  await axios.put(SUSPEND_FB + "/" + id + ".json", {
    action, requestedBy: userId, requestedAt: at, status: "pending", sig: sign(id, action, at, userId),
  }, { timeout: 10000 });
  return reply("📨 已送出診所" + ACTIONS[action].label + "，戴豐逸電腦上的程式約 1 分鐘內執行，完成後會推播結果。\n\n" +
    "要查進度請輸入「停權狀態」。");
}

module.exports = { handleSuspendMessage, sign };

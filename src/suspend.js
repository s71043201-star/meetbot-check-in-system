// 診所停權（改密碼）的 LINE 指令 — 只收指令、不碰密碼。
//
// 流程：「停權診所 [對象]」→ 列出對到的診所＋4 碼確認碼 →「確認停權 1234」→ 在 Firebase
// /clinicSuspend/requests/{id} 寫一筆 pending（對象一起簽進 HMAC）→ 戴豐逸電腦上的
// C:\prescription\scripts\clinic_suspend.py 每分鐘來拿、驗簽章並比對名單後才真的改密碼，做完會 LINE 推播結果。
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
  "Ue69dbd040159f69636c08dfd9568aa63", // 吳亞璇
]);

// 第七次合作診所推動會議「依開立量排序」1–36 名（截至 115/10/01）。
// 本機 clinic_suspend.py 的 CLINICS 是同一份：名次＋名稱兩邊不一致時本機會拒絕執行，改一邊要兩邊改。
const CLINICS = [
  "慈田耳鼻喉科診所", "石牌鄭身心醫學診所", "蔡秉勳小兒科診所", "陳獻明小兒科診所", "鄭醫師診所",
  "洪耳鼻喉科診所", "仁禾診所", "周賢章耳鼻喉科診所", "王志靈內科診所", "榮清耳鼻喉科診所",
  "愛林診所", "王永良診所", "臻心復健科診所", "天母康健身心診所", "榮陽安心診所",
  "雙連婦產科小兒科", "蕭雨青小兒科診所", "翰譽耳鼻喉科診所", "鴻林診所", "正恩耳鼻喉科診所",
  "仁友皮膚科診所", "寧康聯合診所", "葉眼科診所", "張虔熙小兒科診所", "心福內科診所",
  "何叔芳小兒科診所", "士林欣然耳鼻喉科診所", "台北欣安耳鼻喉科", "王三郎診所", "科安診所",
  "惠康診所", "洪志淳皮膚科診所", "清田婦產科家醫科", "晨昕診所", "昱德聯合診所",
  "德泰耳鼻喉科診所",
].map((name, i) => ({ rank: i + 1, name }));

const ACTIONS = {
  suspend: { label: "停權", ask: "停權診所", confirm: "確認停權" },
  restore: { label: "還原", ask: "還原診所", confirm: "確認還原" },
};
const CONFIRM_TTL = 5 * 60 * 1000;
const pending = {}; // userId → { action, code, exp, ranks }

const STATUS_LABEL = {
  pending: "⏳ 等待本機執行", running: "⚙️ 執行中", done: "✅ 已完成",
  error: "❌ 失敗", rejected: "⛔ 被拒絕", expired: "⌛ 已作廢",
};

const USAGE =
  "指定對象的寫法（可混用，用空白或逗號隔開）：\n" +
  "• 停權診所 — 1–36 名全部\n" +
  "• 停權診所 5 — 第 5 名\n" +
  "• 停權診所 1-10 — 第 1 到 10 名\n" +
  "• 停權診所 科安 — 用診所名稱\n" +
  "• 停權診所 3,5 科安 愛林\n" +
  "還原就把「停權」換成「還原」（或「復權」）。\n" +
  "編號對照請輸入「停權名單」。";

const HELP =
  "🔐 診所停權／還原 指令\n" + "═".repeat(16) + "\n" +
  "【查詢】\n" +
  "• 停權名單 — 1–36 名診所編號對照＋目前狀態\n" +
  "• 停權狀態 — 最近一次執行結果\n\n" +
  "【停權】密碼改成「原密碼＋@」\n" +
  "• 停權診所 — 1–36 名全部\n" +
  "• 停權診所 5 ／ 1-10 ／ 科安 — 指定對象（可混用）\n" +
  "• 確認停權 1234 — 送出後 5 分鐘內輸入確認碼\n\n" +
  "【還原】密碼改回帳密表上的原密碼\n" +
  "• 還原診所（或 復權診所）＋對象，寫法同停權\n" +
  "• 確認還原 1234（或 確認復權 1234）\n\n" +
  "送出後戴豐逸電腦上的程式約 1 分鐘內執行，完成會推播結果；電腦沒開 15 分鐘後自動作廢。";
const HELP_WORDS = ["停權", "停權說明", "停權指令", "還原", "復權", "停權?", "停權？"];

// 對象文字 → { ranks } 或 { error }
function parseTargets(arg) {
  const s = String(arg || "").trim().replace(/\s*[-~～–—]\s*/g, "-");
  if (!s) return { ranks: CLINICS.map(c => c.rank) };
  const max = CLINICS.length;
  const picked = new Set();
  for (const tok of s.split(/[\s,，、]+/).filter(Boolean)) {
    const range = tok.match(/^(\d+)-(\d+)$/);
    if (range || /^\d+$/.test(tok)) {
      const a = Number(range ? range[1] : tok), b = Number(range ? range[2] : tok);
      if (a < 1 || b > max || a > b) return { error: "名次「" + tok + "」超出範圍，只能是 1–" + max };
      for (let r = a; r <= b; r++) picked.add(r);
      continue;
    }
    const exact = CLINICS.filter(c => c.name === tok);
    const hits = exact.length ? exact : CLINICS.filter(c => c.name.includes(tok));
    if (!hits.length) return { error: "1–" + max + " 名裡找不到「" + tok + "」" };
    if (hits.length > 1) {
      return { error: "「" + tok + "」對到不只一家，請寫完整一點或改用名次：\n" +
        hits.map(c => c.rank + ". " + c.name).join("\n") };
    }
    picked.add(hits[0].rank);
  }
  return { ranks: [...picked].sort((x, y) => x - y) };
}

const namesOf = ranks => ranks.map(r => CLINICS[r - 1].name);
const isAll = ranks => ranks.length === CLINICS.length;

function sign(id, action, at, by, ranks) {
  return crypto.createHmac("sha256", SECRET)
    .update(id + "|" + action + "|" + at + "|" + by + "|" + ranks.join(",") + "|" + namesOf(ranks).join(","))
    .digest("hex");
}

function fmtTime(ms) {
  return new Date(ms).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtTargets(ranks) {
  if (isAll(ranks)) return "1–" + CLINICS.length + " 名全部 " + ranks.length + " 家";
  return ranks.length + " 家\n" + ranks.map(r => "  " + r + ". " + CLINICS[r - 1].name).join("\n");
}

async function latestRequest() {
  const { data } = await axios.get(SUSPEND_FB + ".json", {
    params: { orderBy: '"requestedAt"', limitToLast: 1 }, timeout: 10000,
  }).catch(() => axios.get(SUSPEND_FB + ".json", { timeout: 10000 })); // 沒建索引時退回抓全部
  const rows = Object.entries(data || {}).sort((a, b) => (b[1].requestedAt || 0) - (a[1].requestedAt || 0));
  return rows.length ? { id: rows[0][0], ...rows[0][1] } : null;
}

// 依 LINE 執行紀錄推算每家目前狀態（只算從這裡送出、成功完成的；手動跑腳本的不會反映）
async function clinicStates() {
  const { data } = await axios.get(SUSPEND_FB + ".json", { timeout: 10000 });
  const state = {};
  Object.values(data || {})
    .filter(r => r && r.status === "done" && Array.isArray(r.ranks))
    .sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0))
    .forEach(r => {
      const failedClinics = new Set((r.failed || []).map(f => f.clinic));
      r.ranks.forEach(rank => {
        const c = CLINICS[rank - 1];
        if (c) state[rank] = failedClinics.has(c.name) ? "partial" : r.action;
      });
    });
  return state;
}

async function listText() {
  const state = await clinicStates().catch(() => ({}));
  const icon = { suspend: " 🔒", partial: " ⚠️" };
  const lines = CLINICS.map(c => c.rank + ". " + c.name + (icon[state[c.rank]] || ""));
  const n = Object.values(state).filter(v => v === "suspend").length;
  return "📋 停權名單（第七次推動會議開立量排序）\n" + "═".repeat(16) + "\n" + lines.join("\n") +
    "\n\n🔒 停權中 " + n + " 家" + (Object.values(state).includes("partial") ? "　⚠️ 上次有帳號沒改成功" : "") +
    "\n（狀態依 LINE 送出的紀錄）\n\n例：停權診所 5、停權診所 1-10、停權診所 科安";
}

async function statusText() {
  const r = await latestRequest();
  if (!r) return "目前沒有停權／還原紀錄。";
  const a = ACTIONS[r.action] || { label: r.action };
  let msg = "📋 最近一次診所" + a.label + "\n" + STATUS_LABEL[r.status] + "\n送出：" + fmtTime(r.requestedAt);
  if (r.requestedByName) msg += "（" + r.requestedByName + "）";
  if (r.finishedAt) msg += "\n完成：" + fmtTime(r.finishedAt);
  if (Array.isArray(r.ranks)) msg += "\n對象：" + fmtTargets(r.ranks);
  if (r.status === "done") {
    msg += "\n\n醫師帳號 " + r.total + " 個，成功 " + r.okCount + " 個";
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
async function handleSuspendMessage({ userId, userName, text, replyToken }) {
  const askMatch = text.match(/^(停權診所|還原診所|復權診所)\s*(.*)$/s);
  const confirmMatch = text.match(/^(確認停權|確認還原|確認復權)\s*(\d{4})$/);
  const isHelp = HELP_WORDS.includes(text);
  if (!askMatch && !confirmMatch && !isHelp && text !== "停權狀態" && text !== "停權名單") return false;
  // 不是指定的人就當作沒看到，交給後面的一般指令處理（不透露有這個功能）
  if (!ADMIN_IDS.has(userId)) return false;

  const reply = msg => replyLine(replyToken, msg).then(() => true);
  if (!SECRET) return reply("❌ 尚未設定 SUSPEND_SECRET，停權功能未啟用");

  if (isHelp) return reply(HELP);
  if (text === "停權名單") return reply(await listText());
  if (text === "停權狀態") return reply(await statusText());

  if (askMatch) {
    const action = askMatch[1] === "停權診所" ? "suspend" : "restore";
    const a = ACTIONS[action];
    const t = parseTargets(askMatch[2]);
    if (t.error) return reply("❌ " + t.error + "\n\n" + USAGE);
    const code = String(crypto.randomInt(0, 10000)).padStart(4, "0");
    pending[userId] = { action, code, exp: Date.now() + CONFIRM_TTL, ranks: t.ranks };
    return reply(
      (action === "suspend" ? "🔒" : "🔓") + " 診所" + a.label + "\n" + "═".repeat(16) + "\n" +
      "對象：" + fmtTargets(t.ranks) + "\n（帳密表上這些診所的所有醫師帳號）\n\n" +
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
    action, requestedBy: userId, requestedByName: userName || "", requestedAt: at, status: "pending",
    ranks: p.ranks, clinicNames: namesOf(p.ranks), sig: sign(id, action, at, userId, p.ranks),
  }, { timeout: 10000 });
  return reply("📨 已送出診所" + ACTIONS[action].label + "（" + fmtTargets(p.ranks).split("\n")[0] + "），" +
    "戴豐逸電腦上的程式約 1 分鐘內執行，完成後會推播結果給你。\n\n要查進度請輸入「停權狀態」。");
}

module.exports = { handleSuspendMessage, parseTargets, sign, CLINICS };

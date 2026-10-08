// 合作夥伴綁定：老師／診所在 LINE 傳「綁定 XXXXXX」就自動對應身分並換上該角色的圖文選單。
//
// 綁定碼不存資料庫，是用 PARTNER_BIND_SECRET 對「角色:對象」算 HMAC 得到的固定 6 碼：
//   ・新老師、新診所一出現在同步資料裡就自動有碼，不用一個一個建
//   ・要讓所有舊碼作廢，換掉 PARTNER_BIND_SECRET 即可（已綁定的人不受影響）
// 綁定結果存 Firebase /linePartners/{LINE userId}。
const crypto = require("crypto");
const axios = require("axios");
const { TOKEN } = require("../config");
const { listTeachers, listClinics } = require("./data");

const PARTNERS_FB = process.env.PARTNERS_FB ||
  "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/linePartners";
const BIND_SECRET = process.env.PARTNER_BIND_SECRET || "";

// 易混淆的 0/O/1/I 不用
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROLE_LABEL = { teacher: "老師", clinic: "診所" };
const MENU_NAME = { teacher: "partner-teacher-v1", clinic: "partner-clinic-v1" };

function bindCode(role, key) {
  if (!BIND_SECRET) return null;
  const buf = crypto.createHmac("sha256", BIND_SECRET).update(role + ":" + key).digest();
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return code;
}

// 全部可綁定的對象（含綁定碼），名冊隨每次同步自動更新
async function allEntities() {
  const [teachers, clinics] = await Promise.all([
    listTeachers().catch(() => []),
    listClinics().catch(() => []),
  ]);
  return [
    ...teachers.map(t => ({ role: "teacher", ...t })),
    ...clinics.map(c => ({ role: "clinic", ...c })),
  ].map(e => ({ ...e, code: bindCode(e.role, e.key) }));
}

async function findByCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!BIND_SECRET || !/^[A-Z0-9]{6}$/.test(c)) return null;
  return (await allEntities()).find(e => e.code === c) || null;
}

// ── Firebase 綁定紀錄（快取 1 分鐘，webhook 每則訊息都會查）──
let bindCache = { at: 0, data: {} };
async function allBindings(force = false) {
  if (!force && Date.now() - bindCache.at < 60 * 1000) return bindCache.data;
  try {
    const { data } = await axios.get(PARTNERS_FB + ".json", { timeout: 10000 });
    bindCache = { at: Date.now(), data: data || {} };
  } catch (e) {
    console.error("[partners] 讀取綁定紀錄失敗:", e.message);
  }
  return bindCache.data;
}
async function getBinding(userId) {
  return (await allBindings())[userId] || null;
}
async function saveBinding(userId, rec) {
  await axios.put(PARTNERS_FB + "/" + userId + ".json", rec, { timeout: 10000 });
  bindCache.data = { ...bindCache.data, [userId]: rec };
}
async function removeBinding(userId) {
  await axios.delete(PARTNERS_FB + "/" + userId + ".json", { timeout: 10000 });
  const next = { ...bindCache.data };
  delete next[userId];
  bindCache.data = next;
}

// ── 圖文選單：依角色自動套用 ─────────────────────────
const lineHdr = () => ({ Authorization: "Bearer " + TOKEN });
let menuIdCache = { at: 0, ids: {} };
async function menuIdFor(role) {
  if (Date.now() - menuIdCache.at > 10 * 60 * 1000) {
    const { data } = await axios.get("https://api.line.me/v2/bot/richmenu/list", { headers: lineHdr() });
    const ids = {};
    (data.richmenus || []).forEach(m => { ids[m.name] = m.richMenuId; });
    menuIdCache = { at: Date.now(), ids };
  }
  return menuIdCache.ids[MENU_NAME[role]] || null;
}
function resetMenuCache() { menuIdCache = { at: 0, ids: {} }; }

async function linkMenu(userId, role) {
  try {
    const id = await menuIdFor(role);
    if (!id) { console.warn("[partners] 找不到 " + MENU_NAME[role] + " 圖文選單，請先開 /setup-partner-menus"); return false; }
    await axios.post("https://api.line.me/v2/bot/user/" + userId + "/richmenu/" + id, {}, { headers: lineHdr() });
    return true;
  } catch (e) {
    console.error("[partners] 套用圖文選單失敗:", e.response ? JSON.stringify(e.response.data) : e.message);
    return false;
  }
}
async function unlinkMenu(userId) {
  try {
    await axios.delete("https://api.line.me/v2/bot/user/" + userId + "/richmenu", { headers: lineHdr() });
  } catch (e) { /* 本來就沒有個人選單 */ }
}

async function displayName(userId) {
  try {
    const { data } = await axios.get("https://api.line.me/v2/bot/profile/" + userId, { headers: lineHdr() });
    return data.displayName || "";
  } catch (e) { return ""; }
}

module.exports = {
  ROLE_LABEL,
  MENU_NAME,
  BIND_SECRET,
  bindCode,
  allEntities,
  findByCode,
  allBindings,
  getBinding,
  saveBinding,
  removeBinding,
  linkMenu,
  unlinkMenu,
  resetMenuCache,
  displayName,
};

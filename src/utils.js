const axios = require("axios");
const { ATT_FB } = require("./config");

const DOC_STORE_FB = ATT_FB.replace("/attendance", "/doc-store");

// 課程記錄暫存（Firebase，7天過期）
async function storeDoc(html, fileName) {
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const doc = {
    html,
    fileName,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  };
  await axios.put(`${DOC_STORE_FB}/${uid}.json`, doc);
  return uid;
}

async function getDoc(uid) {
  try {
    const { data } = await axios.get(`${DOC_STORE_FB}/${uid}.json`);
    if (!data) return null;
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
      axios.delete(`${DOC_STORE_FB}/${uid}.json`).catch(() => {});
      return null;
    }
    return data;
  } catch (err) {
    console.error("[DocStore] getDoc failed:", err.message);
    return null;
  }
}

async function cleanupExpiredDocs() {
  try {
    const { data } = await axios.get(`${DOC_STORE_FB}.json`);
    if (!data) return;
    const now = new Date();
    for (const [uid, doc] of Object.entries(data)) {
      if (doc && doc.expiresAt && new Date(doc.expiresAt) < now) {
        await axios.delete(`${DOC_STORE_FB}/${uid}.json`).catch(() => {});
      }
    }
    console.log("[DocStore] cleanup completed");
  } catch (err) {
    console.error("[DocStore] cleanup error:", err.message);
  }
}

function daysLeft(deadline) {
  const today = new Date().toISOString().slice(0, 10);
  return Math.ceil((new Date(deadline) - new Date(today)) / 86400000);
}

function toTaipei(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function toROCYear(date) {
  return date.getFullYear() - 1911;
}

module.exports = {
  storeDoc,
  getDoc,
  cleanupExpiredDocs,
  daysLeft,
  toTaipei,
  toROCYear,
};

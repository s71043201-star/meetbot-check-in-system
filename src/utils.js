// 課程記錄暫存（記憶體，不限期）
const docStore = new Map();

function storeDoc(html, fileName) {
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2);
  docStore.set(uid, { html, fileName });
  return uid;
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

module.exports = { docStore, storeDoc, daysLeft, toTaipei, toROCYear };

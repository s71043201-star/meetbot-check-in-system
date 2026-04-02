const axios = require("axios");
const https = require("https");
const { TASKS_FB, ATT_FB } = require("./config");

// ── Firebase：任務 ─────────────────────────────
async function fetchTasksFromFirebase() {
  return new Promise((resolve) => {
    https.get(TASKS_FB, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const obj = JSON.parse(data);
          resolve(obj ? Object.values(obj) : []);
        } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

// ── Firebase：出缺勤 ──────────────────────────
async function fbGet(subPath) {
  const { data } = await axios.get(`${ATT_FB}${subPath || ""}.json`);
  return data;
}

async function fbPost(record) {
  const { data } = await axios.post(`${ATT_FB}.json`, record);
  return data;
}

async function fbPut(subPath, record) {
  const { data } = await axios.put(`${ATT_FB}${subPath}.json`, record);
  return data;
}

async function fbDelete(subPath) {
  const { data } = await axios.delete(`${ATT_FB}${subPath}.json`);
  return data;
}

async function fetchAttendance() {
  return new Promise((resolve) => {
    https.get(`${ATT_FB}.json`, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const obj = JSON.parse(data);
          resolve(obj ? Object.values(obj) : []);
        } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

module.exports = {
  fetchTasksFromFirebase,
  fbGet,
  fbPost,
  fbPut,
  fbDelete,
  fetchAttendance,
};

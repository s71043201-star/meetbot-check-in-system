const axios = require("axios");
const https = require("https");
const { TASKS_FB, ROUTINE_TASKS_FB, ATT_FB, USERS_FB } = require("./config");

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

// ── Firebase：例行任務 ────────────────────────
async function fetchRoutineTasksFromFirebase() {
  return new Promise((resolve) => {
    https.get(ROUTINE_TASKS_FB, (res) => {
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

// ── Firebase：使用者 ──────────────────────────
async function userGet(subPath) {
  const { data } = await axios.get(`${USERS_FB}${subPath || ""}.json`);
  return data;
}

async function userPost(record) {
  const { data } = await axios.post(`${USERS_FB}.json`, record);
  return data;
}

async function userPut(subPath, record) {
  const { data } = await axios.put(`${USERS_FB}${subPath}.json`, record);
  return data;
}

async function userDelete(subPath) {
  const { data } = await axios.delete(`${USERS_FB}${subPath}.json`);
  return data;
}

module.exports = {
  fetchTasksFromFirebase,
  fetchRoutineTasksFromFirebase,
  fbGet,
  fbPost,
  fbPut,
  fbDelete,
  fetchAttendance,
  userGet,
  userPost,
  userPut,
  userDelete,
};

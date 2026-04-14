const axios = require("axios");
const https = require("https");
const { TASKS_FB, ROUTINE_TASKS_FB, ATT_FB, USERS_FB, QA_FB } = require("./config");

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
        } catch (e) {
          console.error("[Firebase] fetchTasks parse error:", e.message);
          resolve([]);
        }
      });
    }).on("error", (e) => {
      console.error("[Firebase] fetchTasks network error:", e.message);
      resolve([]);
    });
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
        } catch (e) {
          console.error("[Firebase] fetchRoutineTasks parse error:", e.message);
          resolve([]);
        }
      });
    }).on("error", (e) => {
      console.error("[Firebase] fetchRoutineTasks network error:", e.message);
      resolve([]);
    });
  });
}

// ── Firebase：出缺勤 ──────────────────────────
async function fbGet(subPath) {
  try {
    const { data } = await axios.get(`${ATT_FB}${subPath || ""}.json`);
    return data;
  } catch (err) {
    console.error(`[Firebase] fbGet(${subPath || ""}) failed:`, err.message);
    throw err;
  }
}

async function fbPost(record) {
  try {
    const { data } = await axios.post(`${ATT_FB}.json`, record);
    return data;
  } catch (err) {
    console.error("[Firebase] fbPost failed:", err.message);
    throw err;
  }
}

async function fbPut(subPath, record) {
  try {
    const { data } = await axios.put(`${ATT_FB}${subPath}.json`, record);
    return data;
  } catch (err) {
    console.error(`[Firebase] fbPut(${subPath}) failed:`, err.message);
    throw err;
  }
}

async function fbDelete(subPath) {
  try {
    const { data } = await axios.delete(`${ATT_FB}${subPath}.json`);
    return data;
  } catch (err) {
    console.error(`[Firebase] fbDelete(${subPath}) failed:`, err.message);
    throw err;
  }
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
        } catch (e) {
          console.error("[Firebase] fetchAttendance parse error:", e.message);
          resolve([]);
        }
      });
    }).on("error", (e) => {
      console.error("[Firebase] fetchAttendance network error:", e.message);
      resolve([]);
    });
  });
}

// ── Firebase：使用者 ──────────────────────────
async function userGet(subPath) {
  try {
    const { data } = await axios.get(`${USERS_FB}${subPath || ""}.json`);
    return data;
  } catch (err) {
    console.error(`[Firebase] userGet(${subPath || ""}) failed:`, err.message);
    throw err;
  }
}

async function userPost(record) {
  try {
    const { data } = await axios.post(`${USERS_FB}.json`, record);
    return data;
  } catch (err) {
    console.error("[Firebase] userPost failed:", err.message);
    throw err;
  }
}

async function userPut(subPath, record) {
  try {
    const { data } = await axios.put(`${USERS_FB}${subPath}.json`, record);
    return data;
  } catch (err) {
    console.error(`[Firebase] userPut(${subPath}) failed:`, err.message);
    throw err;
  }
}

async function userDelete(subPath) {
  try {
    const { data } = await axios.delete(`${USERS_FB}${subPath}.json`);
    return data;
  } catch (err) {
    console.error(`[Firebase] userDelete(${subPath}) failed:`, err.message);
    throw err;
  }
}

// ── Firebase：審計日誌 ────────────────────────
const AUDIT_FB = ATT_FB.replace("/attendance", "/audit-logs");

async function auditLog(entry) {
  try {
    await axios.post(`${AUDIT_FB}.json`, {
      ...entry,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("[Audit] Failed to write audit log:", err.message);
  }
}

// ── Firebase：QA 問題回報 ────────────────────────
async function qaGet(subPath) {
  const { data } = await axios.get(`${QA_FB}${subPath || ""}.json`);
  return data;
}

async function qaPost(record) {
  const { data } = await axios.post(`${QA_FB}.json`, record);
  return data;
}

async function qaPut(subPath, record) {
  const { data } = await axios.put(`${QA_FB}${subPath}.json`, record);
  return data;
}

async function qaDelete(subPath) {
  const { data } = await axios.delete(`${QA_FB}${subPath}.json`);
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
  auditLog,
  qaGet,
  qaPost,
  qaPut,
  qaDelete,
};

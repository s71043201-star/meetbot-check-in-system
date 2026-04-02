const { TEAM } = require("./config");
const { toTaipei } = require("./utils");
const { sendSlack } = require("./slack");

let lastRun430 = "";
let lastRun450 = "";

function startScheduler() {
  setInterval(async () => {
    const taipei  = toTaipei(new Date());
    const day     = taipei.getDay();
    const hour    = taipei.getHours();
    const min     = taipei.getMinutes();
    const dateKey = taipei.toISOString().slice(0, 10);

    if (day === 0 || day === 6) return;

    // 16:30 — 全員提醒
    if (hour === 16 && min === 30 && lastRun430 !== dateKey) {
      lastRun430 = dateKey;
      const msg = `📌 下午工作進度提醒\n\n現在是 16:30，請至 meetbot 系統查看您的待辦任務，並勾選今日已完成的項目。\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
      await sendSlack(msg);
      console.log("排程 16:30 Slack 提醒已發送");
    }

    // 16:50 — 管理員提醒
    if (hour === 16 && min === 50 && lastRun450 !== dateKey) {
      lastRun450 = dateKey;
      const memberNames = TEAM.filter(n => n !== "蔡蕙芳").join("、");
      const msg = `📊 下午進度追蹤提醒\n\n現在是 16:50，請查看今日全員工作進度。\n\n團隊成員：${memberNames}\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
      await sendSlack(msg);
      console.log("排程 16:50 Slack 提醒已發送");
    }
  }, 60000);
}

module.exports = { startScheduler };

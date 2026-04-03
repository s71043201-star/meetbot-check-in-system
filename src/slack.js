const axios = require("axios");
const { SLACK_WEBHOOK_URL, SLACK_BOT_TOKEN, SLACK_MEMBERS } = require("./config");

function slackMention(name) {
  const id = SLACK_MEMBERS[name];
  return id ? `<@${id}>` : name;
}

// 發送到頻道（Webhook）
async function sendSlack(text) {
  if (!SLACK_WEBHOOK_URL) return;
  await axios.post(SLACK_WEBHOOK_URL, { text }).catch(e => console.error("Slack 頻道發送失敗:", e.message));
}

// 發送私訊 DM（Bot Token + chat.postMessage）
async function sendSlackDM(userId, text) {
  if (!SLACK_BOT_TOKEN || !userId) return;
  await axios.post("https://slack.com/api/chat.postMessage", {
    channel: userId,
    text,
  }, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  }).catch(e => console.error("Slack DM 發送失敗:", e.message));
}

// 依姓名發送私訊
async function sendSlackToUser(name, text) {
  const userId = SLACK_MEMBERS[name];
  if (!userId) {
    console.warn(`找不到 ${name} 的 Slack ID，改發頻道`);
    await sendSlack(text);
    return;
  }
  await sendSlackDM(userId, text);
}

module.exports = { sendSlack, slackMention, sendSlackDM, sendSlackToUser };

const axios = require("axios");
const { SLACK_WEBHOOK_URL, SLACK_MEMBERS } = require("./config");

function slackMention(name) {
  const id = SLACK_MEMBERS[name];
  return id ? `<@${id}>` : name;
}

async function sendSlack(text) {
  if (!SLACK_WEBHOOK_URL) return;
  await axios.post(SLACK_WEBHOOK_URL, { text }).catch(e => console.error("Slack 發送失敗:", e.message));
}

module.exports = { sendSlack, slackMention };

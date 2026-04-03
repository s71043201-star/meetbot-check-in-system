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
  if (!SLACK_BOT_TOKEN) { console.error("SLACK_BOT_TOKEN 未設定，無法發送 DM"); return; }
  if (!userId) return;
  try {
    const res = await axios.post("https://slack.com/api/chat.postMessage", {
      channel: userId,
      text,
    }, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    if (!res.data.ok) {
      console.error(`Slack DM 失敗 (${userId}):`, res.data.error);
    } else {
      console.log(`Slack DM 已發送給 ${userId}`);
    }
  } catch (e) {
    console.error("Slack DM 發送失敗:", e.message);
  }
}

// 依姓名發送私訊（支援逗號分隔多人）
async function sendSlackToUser(name, text) {
  const names = (name || "").split(",").map(s => s.trim()).filter(Boolean);
  if (names.length === 0) {
    console.warn("sendSlackToUser: 無有效姓名，改發頻道");
    await sendSlack(text);
    return;
  }
  for (const n of names) {
    const userId = SLACK_MEMBERS[n];
    if (!userId) {
      console.warn(`找不到 ${n} 的 Slack ID，改發頻道`);
      await sendSlack(text);
    } else {
      await sendSlackDM(userId, text);
    }
  }
}

module.exports = { sendSlack, slackMention, sendSlackDM, sendSlackToUser };

const axios = require("axios");
const { TOKEN } = require("./config");

async function sendLine(userId, message) {
  if (!userId || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message }]
  }, { headers: { Authorization: "Bearer " + TOKEN } });
}

async function sendLineMessages(userId, messages) {
  if (!userId || !TOKEN || !messages.length) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: messages
  }, { headers: { Authorization: "Bearer " + TOKEN } });
}

async function sendLineWithQuickReply(userId, message, quickItems) {
  if (!userId || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message, quickReply: { items: quickItems } }]
  }, { headers: { Authorization: "Bearer " + TOKEN } });
}

// Reply 系列（使用 replyToken，免費額度）
async function replyLine(replyToken, message) {
  if (!replyToken || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages: [{ type: "text", text: message }]
  }, { headers: { Authorization: "Bearer " + TOKEN } });
}

async function replyLineMulti(replyToken, messages) {
  if (!replyToken || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages
  }, { headers: { Authorization: "Bearer " + TOKEN } });
}

async function replyLineWithQuickReply(replyToken, message, quickItems) {
  if (!replyToken || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages: [{ type: "text", text: message, quickReply: { items: quickItems } }]
  }, { headers: { Authorization: "Bearer " + TOKEN } });
}

module.exports = {
  sendLine,
  sendLineMessages,
  sendLineWithQuickReply,
  replyLine,
  replyLineMulti,
  replyLineWithQuickReply,
};

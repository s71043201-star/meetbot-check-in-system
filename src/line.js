const axios = require("axios");
const { TOKEN } = require("./config");

async function sendLine(userId, message) {
  if (!userId || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

async function sendLineMessages(userId, messages) {
  if (!userId || !TOKEN || !messages.length) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: messages
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

async function sendLineWithQuickReply(userId, message, quickItems) {
  if (!userId || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message, quickReply: { items: quickItems } }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

module.exports = {
  sendLine,
  sendLineMessages,
  sendLineWithQuickReply,
};

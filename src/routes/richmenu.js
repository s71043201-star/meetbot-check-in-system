const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const router = express.Router();
const { TOKEN, MEMBERS, RICHMENU_ADMIN_IDS } = require("../config");

// -- Rich menu PNG generator (2x2 colored grid) --
function makeRichMenuPNG(w, h, colors) {
  const midX = Math.floor(w / 2);
  const midY = Math.floor(h / 2);
  const bd = 4;

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function crc32(buf) {
    let v = 0xFFFFFFFF;
    for (const b of buf) v = crcTable[(v ^ b) & 0xFF] ^ (v >>> 8);
    return (v ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const t = Buffer.from(type, "ascii");
    const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length);
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([lb, t, data, cb]);
  }

  function makeLine(y) {
    const line = Buffer.alloc(1 + w * 3); line[0] = 0;
    const isBorderY = y >= midY - bd && y < midY + bd;
    for (let x = 0; x < w; x++) {
      const isBorderX = x >= midX - bd && x < midX + bd;
      let c;
      if (isBorderX || isBorderY) c = { r: 255, g: 255, b: 255 };
      else {
        const q = (y < midY ? 0 : 2) + (x < midX ? 0 : 1);
        c = colors[q];
      }
      line[1 + x * 3] = c.r; line[2 + x * 3] = c.g; line[3 + x * 3] = c.b;
    }
    return line;
  }

  const topLine = makeLine(0);
  const borderLine = makeLine(midY);
  const botLine = makeLine(h - 1);
  const lines = [];
  for (let y = 0; y < h; y++) {
    if (y >= midY - bd && y < midY + bd) lines.push(borderLine);
    else lines.push(y < midY ? topLine : botLine);
  }
  const compressed = zlib.deflateSync(Buffer.concat(lines));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))
  ]);
}

// -- Setup regular user rich menu --
router.get("/setup-richmenu", async (req, res) => {
  const secret = process.env.SETUP_SECRET || "meetbot2024";
  if (req.query.secret !== secret) return res.status(403).send("Forbidden");

  const log = [];
  const lineHdr = { Authorization: "Bearer " + TOKEN };

  try {
    const menuDef = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "regular-user-menu",
      chatBarText: "\u529F\u80FD\u9078\u55AE",
      areas: [
        { bounds: { x: 0,    y: 0,    width: 1250, height: 843 },
          action: { type: "message", label: "\u9031\u5831", text: "\u9031\u5831" } },
        { bounds: { x: 1250, y: 0,    width: 1250, height: 843 },
          action: { type: "message", label: "\u5DE5\u4F5C", text: "\u5DE5\u4F5C" } },
        { bounds: { x: 0,    y: 843,  width: 1250, height: 843 },
          action: { type: "uri", label: "meetbot",
                    uri: "https://s71043201-star.github.io/meetbot-app/" } },
        { bounds: { x: 1250, y: 843,  width: 1250, height: 843 },
          action: { type: "message", label: "\u6307\u4EE4\u8AAA\u660E", text: "\u6307\u4EE4" } },
      ]
    };
    const { data: created } = await axios.post(
      "https://api.line.me/v2/bot/richmenu", menuDef,
      { headers: { ...lineHdr, "Content-Type": "application/json" } }
    );
    const richMenuId = created.richMenuId;
    log.push("\u2705 \u5EFA\u7ACB\u9078\u55AE: " + richMenuId);

    const imgPath = path.join(__dirname, "..", "..", "public", "richmenu-regular.jpg");
    const imgBuf = fs.readFileSync(imgPath);
    await axios.post(
      "https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content",
      imgBuf, { headers: { ...lineHdr, "Content-Type": "image/jpeg" } }
    );
    log.push("\u2705 \u4E0A\u50B3\u5716\u7247 (" + Math.round(imgBuf.length / 1024) + " KB)");

    const regularUsers = Object.entries(MEMBERS).filter(([, id]) => !RICHMENU_ADMIN_IDS.has(id));
    for (const [name, uid] of regularUsers) {
      await axios.post(
        "https://api.line.me/v2/bot/user/" + uid + "/richmenu/" + richMenuId,
        {}, { headers: lineHdr }
      );
      log.push("\u2705 \u7D81\u5B9A " + name);
    }

    res.send(log.join("\n") + "\n\n\u2705 \u5B8C\u6210\uFF01");
  } catch (e) {
    const errMsg = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
    res.status(500).send(log.join("\n") + "\n\n\u274C \u932F\u8AA4: " + errMsg);
  }
});

// -- Admin menu (6 areas) --
router.get("/setup-admin-menu", async (req, res) => {
  const secret = process.env.SETUP_SECRET || "meetbot2024";
  if (req.query.secret !== secret) return res.status(403).send("Forbidden");
  const log = [];
  const lineHdr = { Authorization: "Bearer " + TOKEN };
  try {
    const menuDef = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "admin-menu-6",
      chatBarText: "\u529F\u80FD\u9078\u55AE",
      areas: [
        { bounds: { x: 0,    y: 0,    width: 833, height: 843 }, action: { type: "message", label: "\u7C3D\u5230",   text: "\u7C3D\u5230" } },
        { bounds: { x: 833,  y: 0,    width: 833, height: 843 }, action: { type: "message", label: "\u5F8C\u53F0",   text: "\u5F8C\u53F0" } },
        { bounds: { x: 1666, y: 0,    width: 834, height: 843 }, action: { type: "message", label: "\u5DE5\u4F5C",   text: "\u5DE5\u4F5C" } },
        { bounds: { x: 0,    y: 843,  width: 833, height: 843 }, action: { type: "uri",     label: "Meetbot", uri: "https://s71043201-star.github.io/meetbot-app/" } },
        { bounds: { x: 833,  y: 843,  width: 833, height: 843 }, action: { type: "message", label: "\u81E8\u6642\u4EBA\u54E1", text: "\u81E8\u6642\u4EBA\u54E1" } },
        { bounds: { x: 1666, y: 843,  width: 834, height: 843 }, action: { type: "message", label: "\u6307\u4EE4\u8AAA\u660E", text: "\u6307\u4EE4" } },
      ]
    };
    const { data: created } = await axios.post("https://api.line.me/v2/bot/richmenu", menuDef,
      { headers: { ...lineHdr, "Content-Type": "application/json" } });
    const richMenuId = created.richMenuId;
    log.push("\u2705 \u5EFA\u7ACB\u9078\u55AE: " + richMenuId);
    const imgBuf = fs.readFileSync(path.join(__dirname, "..", "..", "public", "richmenu-admin.jpg"));
    await axios.post("https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content",
      imgBuf, { headers: { ...lineHdr, "Content-Type": "image/jpeg" } });
    log.push("\u2705 \u4E0A\u50B3\u5716\u7247 (" + Math.round(imgBuf.length / 1024) + " KB)");
    const targets = [
      ["\u9673\u4F69\u7814", "Uc8e074d50b3b20581945f5c6aca80d1d"],
      ["\u6234\u8C50\u9038", "Uece4baaf97cfab39ad79c6ed0ee55d03"],
    ];
    for (const [name, uid] of targets) {
      await axios.post("https://api.line.me/v2/bot/user/" + uid + "/richmenu/" + richMenuId, {}, { headers: lineHdr });
      log.push("\u2705 \u7D81\u5B9A " + name);
    }
    res.send(log.join("\n") + "\n\n\u2705 \u5B8C\u6210\uFF01");
  } catch (e) {
    res.status(500).send(log.join("\n") + "\n\n\u274C \u932F\u8AA4: " + ((e.response && e.response.data) ? JSON.stringify(e.response.data) : e.message));
  }
});

// -- Huifang menu (6 areas) --
router.get("/setup-huifang-menu", async (req, res) => {
  const secret = process.env.SETUP_SECRET || "meetbot2024";
  if (req.query.secret !== secret) return res.status(403).send("Forbidden");
  const log = [];
  const lineHdr = { Authorization: "Bearer " + TOKEN };
  try {
    const menuDef = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "huifang-menu-6",
      chatBarText: "\u529F\u80FD\u9078\u55AE",
      areas: [
        { bounds: { x: 0,    y: 0,    width: 833, height: 843 }, action: { type: "uri",     label: "\u9031\u5831",   uri: "https://s71043201-star.github.io/tpma-statistics/" } },
        { bounds: { x: 833,  y: 0,    width: 833, height: 843 }, action: { type: "message", label: "\u9032\u5EA6",   text: "\u9032\u5EA6" } },
        { bounds: { x: 1666, y: 0,    width: 834, height: 843 }, action: { type: "message", label: "\u4E0B\u8F09",   text: "\u4E0B\u8F09" } },
        { bounds: { x: 0,    y: 843,  width: 833, height: 843 }, action: { type: "message", label: "\u63D0\u9192",   text: "\u63D0\u9192" } },
        { bounds: { x: 833,  y: 843,  width: 833, height: 843 }, action: { type: "message", label: "\u5DE5\u4F5C",   text: "\u5DE5\u4F5C" } },
        { bounds: { x: 1666, y: 843,  width: 834, height: 843 }, action: { type: "uri",     label: "Meetbot",   uri: "https://s71043201-star.github.io/meetbot-app/" } },
      ]
    };
    const { data: created } = await axios.post("https://api.line.me/v2/bot/richmenu", menuDef,
      { headers: { ...lineHdr, "Content-Type": "application/json" } });
    const richMenuId = created.richMenuId;
    log.push("\u2705 \u5EFA\u7ACB\u9078\u55AE: " + richMenuId);
    const imgBuf = fs.readFileSync(path.join(__dirname, "..", "..", "public", "richmenu-huifang.jpg"));
    await axios.post("https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content",
      imgBuf, { headers: { ...lineHdr, "Content-Type": "image/jpeg" } });
    log.push("\u2705 \u4E0A\u50B3\u5716\u7247 (" + Math.round(imgBuf.length / 1024) + " KB)");
    const huifangId = "Uc05e7076d830f4f75ecc14a07b697e5c";
    await axios.post("https://api.line.me/v2/bot/user/" + huifangId + "/richmenu/" + richMenuId, {}, { headers: lineHdr });
    log.push("\u2705 \u7D81\u5B9A \u8521\u8559\u82B3");
    res.send(log.join("\n") + "\n\n\u2705 \u5B8C\u6210\uFF01");
  } catch (e) {
    res.status(500).send(log.join("\n") + "\n\n\u274C \u932F\u8AA4: " + ((e.response && e.response.data) ? JSON.stringify(e.response.data) : e.message));
  }
});

// -- Link boss to huifang menu --
router.get("/link-boss-menu", async (req, res) => {
  const secret = process.env.SETUP_SECRET || "meetbot2024";
  if (req.query.secret !== secret) return res.status(403).send("Forbidden");
  const lineHdr = { Authorization: "Bearer " + TOKEN };
  try {
    const huifangId = "Uc05e7076d830f4f75ecc14a07b697e5c";
    const daifengyi = "Uece4baaf97cfab39ad79c6ed0ee55d03";
    const { data } = await axios.get("https://api.line.me/v2/bot/user/" + huifangId + "/richmenu", { headers: lineHdr });
    const menuId = data.richMenuId;
    await axios.post("https://api.line.me/v2/bot/user/" + daifengyi + "/richmenu/" + menuId, {}, { headers: lineHdr });
    res.send("\u2705 \u5DF2\u5C07\u6234\u8C50\u9038\u7D81\u5B9A\u81F3\u8559\u82B3\u7684\u9078\u55AE (" + menuId + ")");
  } catch (e) {
    res.status(500).send("\u274C \u5931\u6557\uFF1A" + ((e.response && e.response.data) ? JSON.stringify(e.response.data) : e.message));
  }
});

// -- LINE quota --
router.get("/line-quota", async (req, res) => {
  try {
    const [quota, consumption] = await Promise.all([
      axios.get("https://api.line.me/v2/bot/message/quota", { headers: { Authorization: "Bearer " + TOKEN } }),
      axios.get("https://api.line.me/v2/bot/message/quota/consumption", { headers: { Authorization: "Bearer " + TOKEN } }),
    ]);
    const limit = quota.data.value != null ? quota.data.value : "\u7121\u9650\u5236";
    const used  = consumption.data.totalUsage;
    res.send("\u{1F4CA} LINE \u8A0A\u606F\u984D\u5EA6\n\u672C\u6708\u5DF2\u7528\uFF1A" + used + " \u5247\n\u4E0A\u9650\uFF1A" + limit + " \u5247\n\u5269\u9918\uFF1A" + (limit === "\u7121\u9650\u5236" ? "\u7121\u9650\u5236" : limit - used) + " \u5247");
  } catch (e) {
    res.status(500).send("\u67E5\u8A62\u5931\u6557\uFF1A" + ((e.response && e.response.data) ? JSON.stringify(e.response.data) : e.message));
  }
});

// -- Test Slack --
router.get("/test-slack", async (req, res) => {
  const { SLACK_WEBHOOK_URL } = require("../config");
  const hasUrl = !!SLACK_WEBHOOK_URL;
  if (!hasUrl) return res.json({ ok: false, reason: "SLACK_WEBHOOK_URL \u672A\u8A2D\u5B9A", envKeys: Object.keys(process.env).filter(k => k.includes("SLACK")) });
  try {
    await axios.post(SLACK_WEBHOOK_URL, { text: "\u2705 Slack \u9023\u7DDA\u6E2C\u8A66\u6210\u529F\uFF01" });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;

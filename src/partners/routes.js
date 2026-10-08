// 合作夥伴的管理用 endpoint（需 SETUP_SECRET）：
//   /setup-partner-menus — 建立老師／診所圖文選單，並重新套用給所有已綁定的人
//   /partner-codes       — 下載全部綁定碼 CSV（名冊隨同步自動更新，新老師／新診所自動有碼）
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { TOKEN } = require("../config");
const bind = require("./bind");

// 不沿用其他 setup 路由的預設密碼（寫在公開 repo 裡），一定要在 Render 設 SETUP_SECRET
const checkSecret = req => !!process.env.SETUP_SECRET && req.query.secret === process.env.SETUP_SECRET;

const COL = 833;
const MENUS = {
  teacher: {
    image: "richmenu-teacher.jpg",
    chatBarText: "老師選單",
    texts: ["我的課表", "報名人數", "指令"],
  },
  clinic: {
    image: "richmenu-clinic.jpg",
    chatBarText: "診所選單",
    texts: ["診所統計", "禮券進度", "指令"],
  },
};

router.get("/setup-partner-menus", async (req, res) => {
  if (!checkSecret(req)) return res.status(403).send("Forbidden");
  const hdr = { Authorization: "Bearer " + TOKEN };
  const log = [];
  try {
    const { data: list } = await axios.get("https://api.line.me/v2/bot/richmenu/list", { headers: hdr });
    for (const [role, m] of Object.entries(MENUS)) {
      const name = bind.MENU_NAME[role];
      // 同名舊選單先刪掉，避免越建越多
      for (const old of (list.richmenus || []).filter(x => x.name === name)) {
        await axios.delete("https://api.line.me/v2/bot/richmenu/" + old.richMenuId, { headers: hdr });
        log.push("🗑 刪除舊選單 " + name + " (" + old.richMenuId + ")");
      }
      const { data: created } = await axios.post("https://api.line.me/v2/bot/richmenu", {
        size: { width: 2500, height: 843 },
        selected: true,
        name,
        chatBarText: m.chatBarText,
        areas: m.texts.map((text, i) => ({
          bounds: { x: i * COL, y: 0, width: i === 2 ? 2500 - 2 * COL : COL, height: 843 },
          action: { type: "message", label: text, text },
        })),
      }, { headers: { ...hdr, "Content-Type": "application/json" } });
      const img = fs.readFileSync(path.join(__dirname, "..", "..", "public", m.image));
      await axios.post("https://api-data.line.me/v2/bot/richmenu/" + created.richMenuId + "/content",
        img, { headers: { ...hdr, "Content-Type": "image/jpeg" } });
      log.push("✅ 建立 " + name + " (" + created.richMenuId + ")");
    }
    bind.resetMenuCache();

    const bindings = Object.entries(await bind.allBindings(true));
    let ok = 0;
    for (const [uid, b] of bindings) if (await bind.linkMenu(uid, b.role)) ok++;
    log.push("✅ 重新套用選單：" + ok + " / " + bindings.length + " 位已綁定的老師／診所");
    res.type("text/plain; charset=utf-8").send(log.join("\n") + "\n\n完成！");
  } catch (e) {
    const msg = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
    res.status(500).type("text/plain; charset=utf-8").send(log.join("\n") + "\n\n❌ 錯誤：" + msg);
  }
});

router.get("/partner-codes", async (req, res) => {
  if (!checkSecret(req)) return res.status(403).send("Forbidden");
  if (!bind.BIND_SECRET) return res.status(500).send("PARTNER_BIND_SECRET 未設定");
  const [entities, bindings] = await Promise.all([bind.allEntities(), bind.allBindings(true)]);
  const bound = new Set(Object.values(bindings).map(b => b.role + ":" + b.key));
  const esc = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const lines = [["角色", "名稱", "帳號", "綁定訊息", "已綁定"].map(esc).join(",")];
  entities.forEach(e => lines.push([
    bind.ROLE_LABEL[e.role], e.name, e.role === "teacher" ? e.key : "", "綁定 " + e.code,
    bound.has(e.role + ":" + e.key) ? "是" : "",
  ].map(esc).join(",")));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent("LINE綁定碼.csv"));
  res.send("﻿" + lines.join("\r\n")); // BOM 讓 Excel 正確顯示中文
});

module.exports = router;

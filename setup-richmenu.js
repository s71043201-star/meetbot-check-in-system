'use strict';
// setup-richmenu.js — 一次性執行，設定 LINE 圖文選單
// 執行前確認已安裝 sharp：npm install sharp
// 執行方式（CMD）：
//   set LINE_TOKEN=xxxxxx
//   node setup-richmenu.js

const axios = require('axios');
const sharp = require('sharp');

const TOKEN = process.env.LINE_TOKEN;
if (!TOKEN) { console.error('請先執行：set LINE_TOKEN=你的token'); process.exit(1); }

const API     = 'https://api.line.me/v2/bot';
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

// ── 成員清單 ───────────────────────────────────
const MEMBERS = {
  '黃琴茹': 'U858b6b722d9a01e1a927d07f8ffc65ed',
  '蔡蕙芳': 'Uc05e7076d830f4f75ecc14a07b697e5c',
  '吳承儒': 'U1307dd217e15b4ef777f8f0561c2e589',
  '張鈺微': 'U7c71775e251051b61994eda22ddc2bec',
  '吳亞璇': 'Ue69dbd040159f69636c08dfd9568aa63',
  '許雅淇': 'U87efc2433f2ab838929cbfbdb2851748',
  '戴豐逸': 'Uece4baaf97cfab39ad79c6ed0ee55d03',
  '陳佩研': 'Uc8e074d50b3b20581945f5c6aca80d1d',
};
const BOSS_IDS = [
  'Uc05e7076d830f4f75ecc14a07b697e5c',
  'Uece4baaf97cfab39ad79c6ed0ee55d03',
];

// ── 圖片下載（Unsplash，無需 API Key） ──────────
// 使用固定 seed，確保每次產生相同圖片
const UNSPLASH = {
  remind:   'https://images.unsplash.com/photo-1614680376408-81e91ffe3db7?w=833&h=843&fit=crop&auto=format',
  progress: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=833&h=843&fit=crop&auto=format',
  work:     'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=833&h=843&fit=crop&auto=format',
  meetbot:  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=833&h=843&fit=crop&auto=format',
  admin:    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=833&h=843&fit=crop&auto=format',
  help:     'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=833&h=843&fit=crop&auto=format',
  report:   'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=833&h=843&fit=crop&auto=format',
  meeting:  'https://images.unsplash.com/photo-1507925921958-8a62f3d1a50d?w=833&h=843&fit=crop&auto=format',
};

// 備用漸層色（圖片下載失敗時使用）
const FALLBACK = {
  remind:   [255, 143,   0],
  progress: [142,  36, 170],
  work:     [ 26, 115, 232],
  meetbot:  [  0, 137, 123],
  admin:    [ 52, 168,  83],
  help:     [ 84, 110, 122],
  report:   [255, 143,   0],
  meeting:  [142,  36, 170],
};

async function fetchImage(key, w, h) {
  try {
    process.stdout.write(`    下載 ${key} 圖片...`);
    const resp = await axios.get(UNSPLASH[key], {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 5,
    });
    const buf = await sharp(Buffer.from(resp.data)).resize(w, h, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
    process.stdout.write(' OK\n');
    return buf;
  } catch {
    process.stdout.write(' 失敗，使用備用色\n');
    const [r, g, b] = FALLBACK[key];
    return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).jpeg({ quality: 85 }).toBuffer();
  }
}

// ── 格子圖片合成 ───────────────────────────────
async function createGridPng(cells) {
  const W = 2500, H = 1686, BORDER = 8, RADIUS = 20;
  const xs = [0, 833, 1666, 2500];
  const ys = [0, 843, 1686];
  const FONT = "'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif";

  const composites = [];

  for (let i = 0; i < cells.length; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const left = xs[col] + BORDER;
    const top  = ys[row] + BORDER;
    const w    = xs[col+1] - xs[col] - BORDER*2;
    const h    = ys[row+1] - ys[row] - BORDER*2;
    const cx   = Math.round(w / 2);
    const cy   = Math.round(h / 2);
    const cell = cells[i];

    // 1. 背景圖片
    const bgBuf = await fetchImage(cell.imgKey, w, h);

    // 2. SVG 文字疊層（漸層暗化 + 圓角遮罩 + 文字）
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="rgba(0,0,0,0.10)"/>
          <stop offset="60%"  stop-color="rgba(0,0,0,0.35)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.72)"/>
        </linearGradient>
        <clipPath id="clip">
          <rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}"/>
        </clipPath>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#grad)" clip-path="url(#clip)"/>
      <text x="${cx}" y="${cy - 65}"
        font-size="210" text-anchor="middle" dominant-baseline="middle"
        fill="white" font-family="${FONT}">${cell.icon}</text>
      <text x="${cx}" y="${cy + 120}"
        font-size="145" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
        fill="white" font-family="${FONT}"
        style="text-shadow:0 4px 12px rgba(0,0,0,0.5)">${cell.label}</text>
      <text x="${cx}" y="${cy + 260}"
        font-size="80" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
        fill="rgba(255,255,255,0.88)" font-family="${FONT}">${cell.sub}</text>
    </svg>`);

    const overlayBuf = await sharp(overlay).png().toBuffer();

    const cellBuf = await sharp(bgBuf)
      .composite([{ input: overlayBuf, blend: 'over' }])
      .jpeg({ quality: 85 })
      .toBuffer();

    composites.push({ input: cellBuf, left, top });
  }

  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 220, g: 225, b: 230 } }
  }).jpeg({ quality: 85 }).composite(composites).toBuffer();
}

// ── 選單設定 ───────────────────────────────────
const CW1 = 833, CW2 = 833, CW3 = 834, CH = 843;

function area(x, y, w, h, action) {
  return { bounds: { x, y, width: w, height: h }, action };
}

const ADMIN_MENU = {
  size: { width: 2500, height: 1686 }, selected: true,
  name: '管理員選單', chatBarText: '功能選單',
  areas: [
    area(0,         0,  CW1, CH, { type:'message', label:'提醒',    text:'提醒' }),
    area(CW1,       0,  CW2, CH, { type:'message', label:'進度',    text:'進度' }),
    area(CW1+CW2,   0,  CW3, CH, { type:'message', label:'工作',    text:'工作' }),
    area(0,         CH, CW1, CH, { type:'uri',     label:'Meetbot', uri:'https://s71043201-star.github.io/meetbot-app/' }),
    area(CW1,       CH, CW2, CH, { type:'uri',     label:'後台',    uri:'https://meetbot-check-in-system.onrender.com/admin.html' }),
    area(CW1+CW2,   CH, CW3, CH, { type:'message', label:'指令說明', text:'指令' }),
  ],
};

const MEMBER_MENU = {
  size: { width: 2500, height: 1686 }, selected: true,
  name: '一般成員選單', chatBarText: '功能選單',
  areas: [
    area(0,         0,  CW1, CH, { type:'message', label:'工作',    text:'工作' }),
    area(CW1,       0,  CW2, CH, { type:'uri',     label:'Meetbot', uri:'https://s71043201-star.github.io/meetbot-app/' }),
    area(CW1+CW2,   0,  CW3, CH, { type:'uri',     label:'後台',    uri:'https://meetbot-check-in-system.onrender.com/admin.html' }),
    area(0,         CH, CW1, CH, { type:'uri',     label:'週報',    uri:'https://s71043201-star.github.io/tpma-statistics/' }),
    area(CW1,       CH, CW2, CH, { type:'uri',     label:'歷次列管', uri:'https://s71043201-star.github.io/meeting-system/' }),
    area(CW1+CW2,   CH, CW3, CH, { type:'message', label:'指令說明', text:'指令' }),
  ],
};

const ADMIN_CELLS = [
  { imgKey:'remind',   icon:'🔔', label:'提醒',    sub:'發送工作提醒' },
  { imgKey:'progress', icon:'📊', label:'進度',    sub:'查看全員進度' },
  { imgKey:'work',     icon:'📋', label:'工作',    sub:'查看我的待辦' },
  { imgKey:'meetbot',  icon:'💻', label:'Meetbot', sub:'任務追蹤系統' },
  { imgKey:'admin',    icon:'🖥', label:'後台',    sub:'出缺勤後台管理' },
  { imgKey:'help',     icon:'❓', label:'指令說明', sub:'查看所有指令' },
];

const MEMBER_CELLS = [
  { imgKey:'work',     icon:'📋', label:'工作',    sub:'查看我的待辦' },
  { imgKey:'meetbot',  icon:'💻', label:'Meetbot', sub:'任務追蹤系統' },
  { imgKey:'admin',    icon:'🖥', label:'後台',    sub:'出缺勤後台管理' },
  { imgKey:'report',   icon:'📈', label:'週報',    sub:'週報統計系統' },
  { imgKey:'meeting',  icon:'📝', label:'歷次列管', sub:'會議事項生成' },
  { imgKey:'help',     icon:'❓', label:'指令說明', sub:'查看所有指令' },
];

// ── 主流程 ─────────────────────────────────────
async function deleteExisting() {
  const { data } = await axios.get(`${API}/richmenu/list`, { headers: HEADERS });
  for (const m of (data.richmenus || [])) {
    await axios.delete(`${API}/richmenu/${m.richMenuId}`, { headers: HEADERS });
    console.log(`  刪除舊選單 ${m.richMenuId}`);
  }
}

async function buildMenu(config, cells) {
  const { data } = await axios.post(`${API}/richmenu`, config, { headers: HEADERS });
  const id = data.richMenuId;
  console.log(`  建立選單 ${id}`);
  console.log('  合成圖片中...');
  const img = await createGridPng(cells);
  process.stdout.write(`  上傳圖片 ${(img.length/1024).toFixed(0)}KB...`);
  await axios.post(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, img, {
    headers: { ...HEADERS, 'Content-Type': 'image/jpeg' },
    maxBodyLength: Infinity,
  });
  process.stdout.write(' 完成\n');
  return id;
}

async function main() {
  console.log('=== LINE 圖文選單設定 ===\n');
  console.log('1. 清除舊選單');
  await deleteExisting();

  console.log('\n2. 建立管理員選單');
  const adminId = await buildMenu(ADMIN_MENU, ADMIN_CELLS);

  console.log('\n3. 建立一般成員選單');
  const memberId = await buildMenu(MEMBER_MENU, MEMBER_CELLS);

  console.log('\n4. 指派選單給所有成員');
  for (const [name, userId] of Object.entries(MEMBERS)) {
    const menuId = BOSS_IDS.includes(userId) ? adminId : memberId;
    const role   = BOSS_IDS.includes(userId) ? '管理員' : '一般';
    try {
      await axios.post(`${API}/user/${userId}/richmenu/${menuId}`, {}, { headers: HEADERS });
      console.log(`  ${name}（${role}）→ OK`);
    } catch (e) {
      console.log(`  ${name} 失敗：${e.response?.data?.message || e.message}`);
    }
  }
  console.log('\n=== 設定完成 ===');
}

main().catch(e => {
  console.error('失敗：', e.response?.data || e.message);
  process.exit(1);
});

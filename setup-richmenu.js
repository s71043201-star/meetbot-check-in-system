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

// ── 電路板風格色彩（每格一組） ─────────────────
// admin 6 格：提醒/進度/工作/Meetbot/後台/指令說明
const CIRCUIT_COLORS = {
  remind:   { bg1:'#0d1b2a', bg2:'#1b3a52', line:'#00e5ff' },
  progress: { bg1:'#1a0533', bg2:'#3d0f6b', line:'#d500f9' },
  work:     { bg1:'#00251a', bg2:'#00574b', line:'#00e676' },
  meetbot:  { bg1:'#0a1929', bg2:'#0d47a1', line:'#448aff' },
  admin:    { bg1:'#1c0a00', bg2:'#5d1a00', line:'#ff6d00' },
  help:     { bg1:'#1a1a2e', bg2:'#16213e', line:'#e040fb' },
  report:   { bg1:'#00251a', bg2:'#00574b', line:'#00e676' },
  meeting:  { bg1:'#0d1b2a', bg2:'#1b3a52', line:'#00e5ff' },
};

function makeCellSvg(w, h, icon, label, sub, colorKey) {
  const { bg1, bg2, line } = CIRCUIT_COLORS[colorKey];
  const cx = Math.round(w / 2), cy = Math.round(h / 2);
  const FONT = "'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif";
  const STEP = Math.round(w / 30);  // 格線間距
  const RADIUS = 20;

  let lines = '';
  for (let x = -h; x < w + h; x += STEP) {
    lines += `<line x1="${x}" y1="0" x2="${x+h}" y2="${h}" stroke="${line}" stroke-width="1.2" opacity="0.3"/>`;
  }
  for (let y = 0; y < h + STEP; y += STEP) {
    lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${line}" stroke-width="0.8" opacity="0.2"/>`;
  }
  let dots = '';
  for (let x = 0; x <= w; x += STEP * 2) {
    for (let y = 0; y <= h; y += STEP * 2) {
      dots += `<circle cx="${x}" cy="${y}" r="4" fill="${line}" opacity="0.6"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="black" stop-opacity="0"/>
        <stop offset="60%" stop-color="black" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.65"/>
      </linearGradient>
      <clipPath id="clip"><rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}"/></clipPath>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)" rx="${RADIUS}"/>
    <g clip-path="url(#clip)">${lines}${dots}</g>
    <rect width="${w}" height="${h}" fill="url(#fade)" clip-path="url(#clip)"/>
    <text x="${cx}" y="${cy - 65}"
      font-size="210" text-anchor="middle" dominant-baseline="middle"
      fill="white" font-family="${FONT}">${icon}</text>
    <text x="${cx}" y="${cy + 120}"
      font-size="145" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
      fill="white" font-family="${FONT}">${label}</text>
    <text x="${cx}" y="${cy + 265}"
      font-size="80" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
      fill="rgba(255,255,255,0.85)" font-family="${FONT}">${sub}</text>
  </svg>`;
}

// ── 格子圖片合成 ───────────────────────────────
async function createGridPng(cells) {
  const W = 2500, H = 1686, BORDER = 8;
  const xs = [0, 833, 1666, 2500];
  const ys = [0, 843, 1686];

  const composites = [];

  for (let i = 0; i < cells.length; i++) {
    const col  = i % 3, row = Math.floor(i / 3);
    const left = xs[col] + BORDER;
    const top  = ys[row] + BORDER;
    const w    = xs[col+1] - xs[col] - BORDER * 2;
    const h    = ys[row+1] - ys[row] - BORDER * 2;

    const svg    = makeCellSvg(w, h, cells[i].icon, cells[i].label, cells[i].sub, cells[i].colorKey);
    const cellBuf = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
    composites.push({ input: cellBuf, left, top });
  }

  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 15, g: 15, b: 25 } }
  }).jpeg({ quality: 88 }).composite(composites).toBuffer();
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
  { colorKey:'remind',   icon:'🔔', label:'提醒',    sub:'發送工作提醒' },
  { colorKey:'progress', icon:'📊', label:'進度',    sub:'查看全員進度' },
  { colorKey:'work',     icon:'📋', label:'工作',    sub:'查看我的待辦' },
  { colorKey:'meetbot',  icon:'💻', label:'Meetbot', sub:'任務追蹤系統' },
  { colorKey:'admin',    icon:'🖥', label:'後台',    sub:'出缺勤後台管理' },
  { colorKey:'help',     icon:'❓', label:'指令說明', sub:'查看所有指令' },
];

const MEMBER_CELLS = [
  { colorKey:'work',     icon:'📋', label:'工作',    sub:'查看我的待辦' },
  { colorKey:'meetbot',  icon:'💻', label:'Meetbot', sub:'任務追蹤系統' },
  { colorKey:'admin',    icon:'🖥', label:'後台',    sub:'出缺勤後台管理' },
  { colorKey:'report',   icon:'📈', label:'週報',    sub:'週報統計系統' },
  { colorKey:'meeting',  icon:'📝', label:'歷次列管', sub:'會議事項生成' },
  { colorKey:'help',     icon:'❓', label:'指令說明', sub:'查看所有指令' },
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

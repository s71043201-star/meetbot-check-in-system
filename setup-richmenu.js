'use strict';
// setup-richmenu.js — 一次性執行，設定 LINE 圖文選單
// 執行前先安裝 sharp：npm install sharp
// 執行方式（CMD）：
//   set LINE_TOKEN=xxxxxx
//   node setup-richmenu.js

const axios = require('axios');
const sharp = require('sharp');

const TOKEN = process.env.LINE_TOKEN;
if (!TOKEN) { console.error('請先執行：set LINE_TOKEN=你的token'); process.exit(1); }

const API     = 'https://api.line.me/v2/bot';
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

// ── 成員清單（與 server.js 保持一致）──────────────
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

// ── PNG 產生器（SVG + sharp，支援中文）────────────
async function createGridPng(cells) {
  const W = 2500, H = 1686;
  const xs = [0, 833, 1666, 2500]; // 欄邊界
  const ys = [0, 843, 1686];       // 列邊界
  const PAD = 10, R = 20;
  const FONT = "'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif";

  let rects = '', labels = '';
  cells.forEach((cell, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x  = xs[col] + PAD, y  = ys[row] + PAD;
    const w  = xs[col+1] - xs[col] - PAD*2;
    const h  = ys[row+1] - ys[row] - PAD*2;
    const cx = xs[col] + (xs[col+1]-xs[col]) / 2;
    const cy = ys[row] + (ys[row+1]-ys[row]) / 2;

    rects += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${cell.color}" rx="${R}"/>`;

    // 大圖示文字
    labels += `<text x="${cx}" y="${cy - 55}"
      font-size="210" text-anchor="middle" dominant-baseline="middle"
      fill="white" font-family="${FONT}">${cell.icon}</text>`;
    // 主標題
    labels += `<text x="${cx}" y="${cy + 120}"
      font-size="140" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
      fill="white" font-family="${FONT}">${cell.label}</text>`;
    // 副說明
    labels += `<text x="${cx}" y="${cy + 255}"
      font-size="78" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
      fill="rgba(255,255,255,0.85)" font-family="${FONT}">${cell.sub}</text>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#dde1e7"/>
    ${rects}
    ${labels}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── 圖文選單定義 ────────────────────────────────
const CW1 = 833, CW2 = 833, CW3 = 834, CH = 843;

function area(x, y, w, h, action) {
  return { bounds: { x, y, width: w, height: h }, action };
}

const ADMIN_MENU = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '管理員選單',
  chatBarText: '功能選單',
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
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '一般成員選單',
  chatBarText: '功能選單',
  areas: [
    area(0,         0,  CW1, CH, { type:'message', label:'工作',    text:'工作' }),
    area(CW1,       0,  CW2, CH, { type:'uri',     label:'Meetbot', uri:'https://s71043201-star.github.io/meetbot-app/' }),
    area(CW1+CW2,   0,  CW3, CH, { type:'uri',     label:'簽到系統', uri:'https://meetbot-check-in-system.onrender.com/checkin.html' }),
    area(0,         CH, CW1, CH, { type:'uri',     label:'週報',    uri:'https://s71043201-star.github.io/tpma-statistics/' }),
    area(CW1,       CH, CW2, CH, { type:'uri',     label:'歷次列管', uri:'https://s71043201-star.github.io/meeting-system/' }),
    area(CW1+CW2,   CH, CW3, CH, { type:'message', label:'指令說明', text:'指令' }),
  ],
};

// 管理員選單：提醒/進度/工作/Meetbot/簽到/指令
const ADMIN_CELLS = [
  { color:'#FF8F00', icon:'🔔', label:'提醒',    sub:'發送工作提醒' },
  { color:'#8E24AA', icon:'📊', label:'進度',    sub:'查看全員進度' },
  { color:'#1A73E8', icon:'📋', label:'工作',    sub:'查看我的待辦' },
  { color:'#00897B', icon:'💻', label:'Meetbot', sub:'任務追蹤系統' },
  { color:'#34A853', icon:'🖥', label:'後台',    sub:'出缺勤後台管理' },
  { color:'#546E7A', icon:'❓', label:'指令說明', sub:'查看所有指令' },
];

// 一般成員選單：工作/Meetbot/簽到/週報/歷次列管/指令
const MEMBER_CELLS = [
  { color:'#1A73E8', icon:'📋', label:'工作',    sub:'查看我的待辦' },
  { color:'#00897B', icon:'💻', label:'Meetbot', sub:'任務追蹤系統' },
  { color:'#34A853', icon:'🖥', label:'後台',    sub:'出缺勤後台管理' },
  { color:'#FF8F00', icon:'📈', label:'週報',    sub:'週報統計系統' },
  { color:'#8E24AA', icon:'📝', label:'歷次列管', sub:'會議事項生成' },
  { color:'#546E7A', icon:'❓', label:'指令說明', sub:'查看所有指令' },
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

  process.stdout.write('  產生圖片中...');
  const img = await createGridPng(cells);
  process.stdout.write(` ${(img.length/1024).toFixed(0)}KB  上傳中...\n`);

  await axios.post(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, img, {
    headers: { ...HEADERS, 'Content-Type': 'image/png' },
    maxBodyLength: Infinity,
  });
  console.log('  圖片上傳完成');
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

'use strict';
// setup-richmenu.js — 一次性執行，設定 LINE 圖文選單
// 執行方式：LINE_TOKEN=xxx node setup-richmenu.js

const axios = require('axios');
const zlib  = require('zlib');

const TOKEN = process.env.LINE_TOKEN;
if (!TOKEN) { console.error('請先設定環境變數：LINE_TOKEN=xxx node setup-richmenu.js'); process.exit(1); }

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
  'Uc05e7076d830f4f75ecc14a07b697e5c', // 蔡蕙芳
  'Uece4baaf97cfab39ad79c6ed0ee55d03', // 戴豐逸
];

// ── 純 Node.js PNG 產生器（無外部相依）────────────
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len    = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
  const t      = Buffer.from(type);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

// 產生 2500x1686 三列兩行彩色格子 PNG
function createGridPng(cellColors /* [[r,g,b] x6], 左到右上到下 */) {
  const W = 2500, H = 1686, BORDER = 10;
  const COL_W = [833, 833, 834];
  const ROW_H = [843, 843];

  const scanlines = [];
  for (let y = 0; y < H; y++) {
    const row    = Buffer.allocUnsafe(1 + W * 3);
    row[0]       = 0; // filter type: None
    const ri     = y < ROW_H[0] ? 0 : 1;
    const cellY0 = ri === 0 ? 0 : ROW_H[0];
    let offset   = 1;
    for (let x = 0; x < W; x++) {
      const ci     = x < COL_W[0] ? 0 : x < COL_W[0] + COL_W[1] ? 1 : 2;
      const cellX0 = ci === 0 ? 0 : ci === 1 ? COL_W[0] : COL_W[0] + COL_W[1];
      const lx = x - cellX0, ly = y - cellY0;
      const onBorder = lx < BORDER || lx >= COL_W[ci] - BORDER ||
                       ly < BORDER || ly >= ROW_H[ri] - BORDER;
      if (onBorder) {
        row[offset++] = 255; row[offset++] = 255; row[offset++] = 255;
      } else {
        const [r, g, b] = cellColors[ri * 3 + ci];
        row[offset++] = r; row[offset++] = g; row[offset++] = b;
      }
    }
    scanlines.push(row);
  }

  const raw        = Buffer.concat(scanlines);
  const compressed = zlib.deflateSync(raw, { level: 1 }); // 純色壓縮率極高

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr.writeUInt8(8, 8); ihdr.writeUInt8(2, 9); ihdr.fill(0, 10);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 圖文選單定義 ────────────────────────────────
const CW1 = 833, CW2 = 833, CW3 = 834, CH = 843;

function area(x, y, w, h, action) {
  return { bounds: { x, y, width: w, height: h }, action };
}

// 管理員：提醒 / 進度 / 工作 / Meetbot / 簽到系統 / 指令說明
const ADMIN_MENU = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '管理員選單',
  chatBarText: '功能選單',
  areas: [
    area(0,           0,  CW1, CH, { type: 'message', label: '提醒',   text: '提醒' }),
    area(CW1,         0,  CW2, CH, { type: 'message', label: '進度',   text: '進度' }),
    area(CW1 + CW2,   0,  CW3, CH, { type: 'message', label: '工作',   text: '工作' }),
    area(0,           CH, CW1, CH, { type: 'uri',     label: 'Meetbot', uri: 'https://s71043201-star.github.io/meetbot-app/' }),
    area(CW1,         CH, CW2, CH, { type: 'uri',     label: '簽到系統', uri: 'https://meetbot-check-in-system.onrender.com/checkin.html' }),
    area(CW1 + CW2,   CH, CW3, CH, { type: 'message', label: '指令說明', text: '指令' }),
  ],
};

// 一般成員：工作 / Meetbot / 簽到系統 / 週報 / 歷次列管 / 指令說明
const MEMBER_MENU = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '一般成員選單',
  chatBarText: '功能選單',
  areas: [
    area(0,           0,  CW1, CH, { type: 'message', label: '工作',    text: '工作' }),
    area(CW1,         0,  CW2, CH, { type: 'uri',     label: 'Meetbot', uri: 'https://s71043201-star.github.io/meetbot-app/' }),
    area(CW1 + CW2,   0,  CW3, CH, { type: 'uri',     label: '簽到系統', uri: 'https://meetbot-check-in-system.onrender.com/checkin.html' }),
    area(0,           CH, CW1, CH, { type: 'uri',     label: '週報',    uri: 'https://s71043201-star.github.io/tpma-statistics/' }),
    area(CW1,         CH, CW2, CH, { type: 'uri',     label: '歷次列管', uri: 'https://s71043201-star.github.io/meeting-system/' }),
    area(CW1 + CW2,   CH, CW3, CH, { type: 'message', label: '指令說明', text: '指令' }),
  ],
};

// 格子顏色（左到右、上到下）
// 管理員：橙=提醒, 紫=進度, 藍=工作, 青=Meetbot, 綠=簽到, 灰=指令
const ADMIN_COLORS = [
  [255, 143,   0],
  [142,  36, 170],
  [ 26, 115, 232],
  [  0, 137, 123],
  [ 52, 168,  83],
  [ 84, 110, 122],
];
// 一般成員：藍=工作, 青=Meetbot, 綠=簽到, 橙=週報, 紫=歷次列管, 灰=指令
const MEMBER_COLORS = [
  [ 26, 115, 232],
  [  0, 137, 123],
  [ 52, 168,  83],
  [255, 143,   0],
  [142,  36, 170],
  [ 84, 110, 122],
];

// ── 主流程 ─────────────────────────────────────
async function deleteExisting() {
  const { data } = await axios.get(`${API}/richmenu/list`, { headers: HEADERS });
  for (const m of (data.richmenus || [])) {
    await axios.delete(`${API}/richmenu/${m.richMenuId}`, { headers: HEADERS });
    console.log(`  刪除舊選單 ${m.richMenuId}`);
  }
}

async function buildMenu(config, colors) {
  const { data } = await axios.post(`${API}/richmenu`, config, { headers: HEADERS });
  const id = data.richMenuId;
  console.log(`  建立選單 ${id}`);

  process.stdout.write('  產生圖片中...');
  const img = createGridPng(colors);
  process.stdout.write(` ${(img.length / 1024).toFixed(0)}KB  上傳中...\n`);

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
  const adminId = await buildMenu(ADMIN_MENU, ADMIN_COLORS);

  console.log('\n3. 建立一般成員選單');
  const memberId = await buildMenu(MEMBER_MENU, MEMBER_COLORS);

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
  console.log('\n管理員選單色碼說明：');
  console.log('  上列：橙=提醒  紫=進度  藍=工作');
  console.log('  下列：青=Meetbot  綠=簽到系統  灰=指令說明');
  console.log('\n一般成員選單色碼說明：');
  console.log('  上列：藍=工作  青=Meetbot  綠=簽到系統');
  console.log('  下列：橙=週報  紫=歷次列管  灰=指令說明');
}

main().catch(e => {
  console.error('失敗：', e.response?.data || e.message);
  process.exit(1);
});

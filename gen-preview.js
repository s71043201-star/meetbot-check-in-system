'use strict';
const sharp = require('sharp');
const axios = require('axios');
const fs = require('fs');

const W = 750, H = 504;
const cw = 250, ch = 252;
const FONT = "'Microsoft JhengHei','PingFang TC',sans-serif";
const LABELS = ['提醒', '進度', '工作', 'Meetbot', '後台', '指令說明'];
const ICONS  = ['🔔', '📊', '📋', '💻', '🖥', '❓'];

// ── 科技風 SVG 背景 ────────────────────────────

// G: 電路板風格（深藍底 + 線路網格）
const G_COLORS = [
  { bg1:'#0d1b2a', bg2:'#1b3a52', line:'#00e5ff' },
  { bg1:'#1a0533', bg2:'#3d0f6b', line:'#d500f9' },
  { bg1:'#00251a', bg2:'#00574b', line:'#00e676' },
  { bg1:'#0a1929', bg2:'#0d47a1', line:'#448aff' },
  { bg1:'#1c0a00', bg2:'#5d1a00', line:'#ff6d00' },
  { bg1:'#1a1a2e', bg2:'#16213e', line:'#e040fb' },
];
function svgG(w, h, i) {
  const { bg1, bg2, line } = G_COLORS[i];
  const cx = w/2, cy = h/2;
  // 斜格線路圖案
  const step = 28;
  let lines = '';
  for (let x = -h; x < w + h; x += step) {
    lines += `<line x1="${x}" y1="0" x2="${x+h}" y2="${h}" stroke="${line}" stroke-width="0.6" opacity="0.35"/>`;
  }
  for (let y = 0; y < h + step; y += step) {
    lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${line}" stroke-width="0.6" opacity="0.25"/>`;
  }
  // 交叉點
  let dots = '';
  for (let x = 0; x < w; x += step*2) {
    for (let y = 0; y < h; y += step*2) {
      dots += `<circle cx="${x}" cy="${y}" r="2.5" fill="${line}" opacity="0.55"/>`;
    }
  }
  return cell(w, h, `
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)" rx="6"/>
    ${lines}${dots}
    <rect width="${w}" height="${h}" fill="rgba(0,0,0,0)" rx="6"/>
    ${text(w, h, ICONS[i], LABELS[i])}`);
}

// H: 光暈漸層（深色底 + 彩色發光球）
const H_COLORS = [
  { bg:'#050510', g1:'#1a237e', g2:'#311b92' },
  { bg:'#0a0520', g1:'#6a1b9a', g2:'#880e4f' },
  { bg:'#001510', g1:'#004d40', g2:'#1b5e20' },
  { bg:'#050d20', g1:'#0d47a1', g2:'#006064' },
  { bg:'#1a0800', g1:'#bf360c', g2:'#e65100' },
  { bg:'#100520', g1:'#4a148c', g2:'#1a237e' },
];
function svgH(w, h, i) {
  const { bg, g1, g2 } = H_COLORS[i];
  const cx = w/2, cy = h/2;
  return cell(w, h, `
    <defs>
      <radialGradient id="g1" cx="35%" cy="35%" r="60%">
        <stop offset="0%" stop-color="${g1}" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="${bg}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="g2" cx="70%" cy="70%" r="55%">
        <stop offset="0%" stop-color="${g2}" stop-opacity="0.75"/>
        <stop offset="100%" stop-color="${bg}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="${bg}" rx="6"/>
    <rect width="${w}" height="${h}" fill="url(#g1)" rx="6"/>
    <rect width="${w}" height="${h}" fill="url(#g2)" rx="6"/>
    ${text(w, h, ICONS[i], LABELS[i])}`);
}

// I: 幾何三角（科技多邊形風）
const I_COLORS = [
  ['#0077b6','#00b4d8','#90e0ef'],
  ['#7209b7','#a663cc','#c77dff'],
  ['#2d6a4f','#52b788','#95d5b2'],
  ['#03045e','#0096c7','#48cae4'],
  ['#9d0208','#e85d04','#faa307'],
  ['#3d405b','#81b29a','#f2cc8f'],
];
function svgI(w, h, i) {
  const [c1, c2, c3] = I_COLORS[i];
  const cx = w/2, cy = h/2;
  return cell(w, h, `
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)" rx="6"/>
    <polygon points="0,${h} ${w*0.45},0 ${w*0.9},${h}" fill="${c3}" opacity="0.18"/>
    <polygon points="${w*0.1},0 ${w},${h*0.6} ${w},0" fill="${c3}" opacity="0.15"/>
    <polygon points="0,${h*0.4} ${w*0.6},${h} 0,${h}" fill="rgba(0,0,0,0.15)"/>
    ${text(w, h, ICONS[i], LABELS[i])}`);
}

async function makeSvgPreview(name, svgFn) {
  const composites = [];
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const w = cw - 4, h = ch - 4;
    const svg = svgFn(w, h, i);
    const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
    composites.push({ input: buf, left: col * cw + 2, top: row * ch + 2 });
  }
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: { r:20,g:20,b:20 } } })
    .jpeg({ quality: 92 }).composite(composites).toBuffer();
  fs.writeFileSync(`preview_${name}.jpg`, out);
  console.log(`已生成 preview_${name}.jpg`);
}

function cell(w, h, svgBody) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svgBody}</svg>`;
}

function text(w, h, icon, label) {
  const cx = w / 2, cy = h / 2;
  return `
    <text x="${cx}" y="${cy - 28}" font-size="56" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}">${icon}</text>
    <text x="${cx}" y="${cy + 38}" font-size="30" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="${FONT}" style="text-shadow:0 2px 8px rgba(0,0,0,0.5)">${label}</text>`;
}

// A: 深色漸層
const A_COLORS = [
  ['#1a237e','#3949ab'],
  ['#4a148c','#7b1fa2'],
  ['#1b5e20','#388e3c'],
  ['#006064','#00897b'],
  ['#bf360c','#e64a19'],
  ['#37474f','#607d8b'],
];
function svgA(w, h, i) {
  const [c1, c2] = A_COLORS[i];
  return cell(w, h, `
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)" rx="6"/>
    ${text(w, h, ICONS[i], LABELS[i])}`);
}

// B: 霓虹漸層
const B_COLORS = [
  ['#f953c6','#b91d73'],
  ['#4776e6','#8e54e9'],
  ['#11998e','#38ef7d'],
  ['#f7971e','#ffd200'],
  ['#e74c3c','#f39c12'],
  ['#2980b9','#6dd5fa'],
];
function svgB(w, h, i) {
  const [c1, c2] = B_COLORS[i];
  return cell(w, h, `
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)" rx="6"/>
    ${text(w, h, ICONS[i], LABELS[i])}`);
}

// C: 莫蘭迪
const C_COLORS = ['#8fa8b8','#b5939a','#93a893','#b0a88e','#9990a8','#a89b8e'];
function svgC(w, h, i) {
  const bg = C_COLORS[i];
  return cell(w, h, `
    <rect width="${w}" height="${h}" fill="${bg}" rx="6"/>
    <rect width="${w}" height="${h}" fill="rgba(0,0,0,0.18)" rx="6"/>
    ${text(w, h, ICONS[i], LABELS[i])}`);
}

// D: 玻璃質感
const D_GLOW = ['#5c6bc0','#ab47bc','#26a69a','#42a5f5','#ef5350','#78909c'];
function svgD(w, h, i) {
  const g = D_GLOW[i];
  const cx = w / 2, cy = h / 2;
  return cell(w, h, `
    <rect width="${w}" height="${h}" fill="#111" rx="6"/>
    <circle cx="${cx}" cy="${cy - 10}" r="${Math.round(w * 0.5)}" fill="${g}" opacity="0.22"/>
    <circle cx="${cx}" cy="${cy - 10}" r="${Math.round(w * 0.27)}" fill="${g}" opacity="0.18"/>
    <rect width="${w}" height="${h}" fill="rgba(255,255,255,0.04)" rx="6"/>
    ${text(w, h, ICONS[i], LABELS[i])}`);
}

// E: 純色磚塊
const E_COLORS = ['#e53935','#8e24aa','#1e88e5','#00897b','#f4511e','#546e7a'];
function svgE(w, h, i) {
  return cell(w, h, `
    <rect width="${w}" height="${h}" fill="${E_COLORS[i]}" rx="6"/>
    ${text(w, h, ICONS[i], LABELS[i])}`);
}

const STYLES = [
  { name: 'A_深色漸層', fn: svgA, bg: { r:30,  g:30,  b:30  } },
  { name: 'B_霓虹漸層', fn: svgB, bg: { r:20,  g:20,  b:30  } },
  { name: 'C_莫蘭迪',   fn: svgC, bg: { r:200, g:195, b:190 } },
  { name: 'D_玻璃質感', fn: svgD, bg: { r:13,  g:13,  b:13  } },
  { name: 'E_純色磚塊', fn: svgE, bg: { r:240, g:240, b:240 } },
];

async function makePreview(style) {
  const composites = [];
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const svg = style.fn(cw - 4, ch - 4, i);
    const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
    composites.push({ input: buf, left: col * cw + 2, top: row * ch + 2 });
  }
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: style.bg } })
    .jpeg({ quality: 92 }).composite(composites).toBuffer();
  const fname = `preview_${style.name}.jpg`;
  fs.writeFileSync(fname, out);
  console.log(`已生成 ${fname}`);
}

(async () => {
  await makeSvgPreview('G_電路板', svgG);
  await makeSvgPreview('H_光暈', svgH);
  await makeSvgPreview('I_幾何', svgI);
  console.log('完成');
})();

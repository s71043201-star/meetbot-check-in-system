'use strict';
const sharp = require('sharp');
const fs = require('fs');

const W = 2500, H = 1686, BORDER = 8;
const xs = [0, 833, 1666, 2500], ys = [0, 843, 1686];
const FONT = "'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif";

const COLORS = {
  remind:   { bg1:'#4a1010', bg2:'#8b2525', line:'#f07868' },
  progress: { bg1:'#4a1f0a', bg2:'#8b3a18', line:'#f09a6a' },
  work:     { bg1:'#4a2a0a', bg2:'#8b5018', line:'#f0b870' },
  meetbot:  { bg1:'#353510', bg2:'#626020', line:'#d4d055' },
  admin:    { bg1:'#1a3510', bg2:'#336020', line:'#90cc60' },
  help:     { bg1:'#3a1a10', bg2:'#703020', line:'#e88060' },
  report:   { bg1:'#1a3510', bg2:'#336020', line:'#90cc60' },
  meeting:  { bg1:'#4a1010', bg2:'#8b2525', line:'#f07868' },
};

function bell(cx, cy, s) {
  return `<g transform="translate(${cx},${cy})">
    <path d="M0,${-s*88} C${-s*50},${-s*88} ${-s*78},${-s*42} ${-s*78},${s*8} L${-s*78},${s*32} Q${-s*78},${s*45} ${-s*65},${s*45} L${s*65},${s*45} Q${s*78},${s*45} ${s*78},${s*32} L${s*78},${s*8} C${s*78},${-s*42} ${s*50},${-s*88} 0,${-s*88}Z" fill="white" opacity="0.92"/>
    <circle cx="0" cy="${-s*97}" r="${s*13}" fill="white" opacity="0.85"/>
    <circle cx="0" cy="${s*57}" r="${s*18}" fill="white" opacity="0.88"/>
    <path d="M${-s*96},${s*0} C${-s*110},${s*20} ${-s*110},${s*42} ${-s*96},${s*52}" stroke="white" stroke-width="${s*8}" fill="none" opacity="0.5" stroke-linecap="round"/>
    <path d="M${s*96},${s*0} C${s*110},${s*20} ${s*110},${s*42} ${s*96},${s*52}" stroke="white" stroke-width="${s*8}" fill="none" opacity="0.5" stroke-linecap="round"/>
  </g>`;
}

function chart(cx, cy, s) {
  return `<g transform="translate(${cx},${cy})">
    <rect x="${-s*82}" y="${-s*28}" width="${s*44}" height="${s*82}" rx="${s*9}" fill="white" opacity="0.88"/>
    <rect x="${-s*22}" y="${-s*72}" width="${s*44}" height="${s*126}" rx="${s*9}" fill="white" opacity="0.92"/>
    <rect x="${s*38}"  y="${s*8}"   width="${s*44}" height="${s*46}"  rx="${s*9}" fill="white" opacity="0.82"/>
    <rect x="${-s*88}" y="${s*60}"  width="${s*176}" height="${s*10}" rx="${s*5}" fill="white" opacity="0.7"/>
  </g>`;
}

function clipboard(cx, cy, s) {
  return `<g transform="translate(${cx},${cy})">
    <rect x="${-s*72}" y="${-s*72}" width="${s*144}" height="${s*158}" rx="${s*14}" fill="white" opacity="0.92"/>
    <rect x="${-s*30}" y="${-s*86}" width="${s*60}"  height="${s*28}"  rx="${s*9}"  fill="white" opacity="0.78"/>
    <rect x="${-s*52}" y="${-s*34}" width="${s*104}" height="${s*10}"  rx="${s*5}"  fill="rgba(0,0,0,0.18)"/>
    <rect x="${-s*52}" y="${-s*12}" width="${s*84}"  height="${s*10}"  rx="${s*5}"  fill="rgba(0,0,0,0.18)"/>
    <path d="M${-s*52},${s*22} L${-s*36},${s*38} L${-s*12},${s*6}" stroke="rgba(0,0,0,0.35)" stroke-width="${s*10}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${-s*4}"  y="${s*18}" width="${s*56}"  height="${s*10}"  rx="${s*5}"  fill="rgba(0,0,0,0.18)"/>
  </g>`;
}

function laptop(cx, cy, s) {
  return `<g transform="translate(${cx},${cy})">
    <rect x="${-s*88}" y="${-s*90}" width="${s*176}" height="${s*124}" rx="${s*13}" fill="white" opacity="0.92"/>
    <rect x="${-s*74}" y="${-s*76}" width="${s*148}" height="${s*98}"  rx="${s*7}"  fill="rgba(0,0,0,0.15)"/>
    <rect x="${-s*58}" y="${-s*63}" width="${s*64}"  height="${s*10}"  rx="${s*4}"  fill="white" opacity="0.7"/>
    <rect x="${-s*58}" y="${-s*46}" width="${s*96}"  height="${s*8}"   rx="${s*4}"  fill="white" opacity="0.5"/>
    <rect x="${-s*58}" y="${-s*32}" width="${s*76}"  height="${s*8}"   rx="${s*4}"  fill="white" opacity="0.5"/>
    <circle cx="${s*46}" cy="${-s*34}" r="${s*18}" fill="white" opacity="0.65"/>
    <path d="M${s*38},${-s*34} L${s*44},${-s*28} L${s*56},${-s*42}" stroke="rgba(0,0,0,0.45)" stroke-width="${s*7}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${-s*98}" y="${s*40}"  width="${s*196}" height="${s*30}"  rx="${s*11}" fill="white" opacity="0.92"/>
    <rect x="${-s*72}" y="${s*34}"  width="${s*144}" height="${s*12}"  rx="${s*6}"  fill="white" opacity="0.7"/>
  </g>`;
}

function monitor(cx, cy, s) {
  return `<g transform="translate(${cx},${cy})">
    <rect x="${-s*92}" y="${-s*86}" width="${s*184}" height="${s*134}" rx="${s*13}" fill="white" opacity="0.92"/>
    <rect x="${-s*78}" y="${-s*72}" width="${s*156}" height="${s*106}" rx="${s*7}"  fill="rgba(0,0,0,0.15)"/>
    <rect x="${-s*65}" y="${-s*30}" width="${s*32}"  height="${s*52}"  rx="${s*5}"  fill="white" opacity="0.65"/>
    <rect x="${-s*25}" y="${-s*52}" width="${s*32}"  height="${s*74}"  rx="${s*5}"  fill="white" opacity="0.72"/>
    <rect x="${s*15}"  y="${-s*18}" width="${s*32}"  height="${s*40}"  rx="${s*5}"  fill="white" opacity="0.58"/>
    <rect x="${s*55}"  y="${-s*40}" width="${s*14}"  height="${s*62}"  rx="${s*4}"  fill="white" opacity="0.5"/>
    <rect x="${-s*12}" y="${s*52}"  width="${s*24}"  height="${s*28}"  rx="${s*5}"  fill="white" opacity="0.85"/>
    <rect x="${-s*44}" y="${s*74}"  width="${s*88}"  height="${s*14}"  rx="${s*7}"  fill="white" opacity="0.85"/>
  </g>`;
}

function book(cx, cy, s) {
  return `<g transform="translate(${cx},${cy})">
    <path d="M0,${-s*84} L${-s*84},${-s*74} Q${-s*96},${-s*70} ${-s*96},${-s*57} L${-s*96},${s*72} Q${-s*96},${s*84} ${-s*84},${s*84} L0,${s*74}Z" fill="white" opacity="0.92"/>
    <path d="M0,${-s*84} L${s*84},${-s*74} Q${s*96},${-s*70} ${s*96},${-s*57} L${s*96},${s*72} Q${s*96},${s*84} ${s*84},${s*84} L0,${s*74}Z" fill="white" opacity="0.92"/>
    <rect x="${-s*6}"  y="${-s*84}" width="${s*12}" height="${s*168}" rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${-s*80}" y="${-s*42}" width="${s*64}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${-s*80}" y="${-s*26}" width="${s*52}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${-s*80}" y="${-s*10}" width="${s*60}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${-s*80}" y="${s*6}"   width="${s*46}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${s*16}"  y="${-s*42}" width="${s*64}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${s*28}"  y="${-s*26}" width="${s*52}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${s*20}"  y="${-s*10}" width="${s*60}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${s*34}"  y="${s*6}"   width="${s*46}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
  </g>`;
}

const ICON_FNS = { remind: bell, progress: chart, work: clipboard, meetbot: laptop, admin: monitor, help: book, report: chart, meeting: book };

function makeCellSvg(w, h, label, sub, colorKey) {
  const { bg1, bg2, line } = COLORS[colorKey];
  const cx = Math.round(w/2), cy = Math.round(h/2);
  const STEP = Math.round(w/30), RADIUS = 20;
  const s = w / 820;

  let lines = '';
  for (let x = -h; x < w+h; x += STEP)
    lines += `<line x1="${x}" y1="0" x2="${x+h}" y2="${h}" stroke="${line}" stroke-width="1.2" opacity="0.28"/>`;
  for (let y = 0; y < h+STEP; y += STEP)
    lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${line}" stroke-width="0.8" opacity="0.18"/>`;
  let dots = '';
  for (let x = 0; x <= w; x += STEP*2)
    for (let y = 0; y <= h; y += STEP*2)
      dots += `<circle cx="${x}" cy="${y}" r="4" fill="${line}" opacity="0.55"/>`;

  const iconSvg = (ICON_FNS[colorKey] || bell)(cx, cy - Math.round(s * 70), s);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="black" stop-opacity="0"/>
        <stop offset="55%"  stop-color="black" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.65"/>
      </linearGradient>
      <clipPath id="clip"><rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}"/></clipPath>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)" rx="${RADIUS}"/>
    <g clip-path="url(#clip)">${lines}${dots}</g>
    <rect width="${w}" height="${h}" fill="url(#fade)" clip-path="url(#clip)"/>
    ${iconSvg}
    <text x="${cx}" y="${cy + Math.round(s*120)}"
      font-size="${Math.round(s*145)}" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
      fill="white" font-family="${FONT}">${label}</text>
    <text x="${cx}" y="${cy + Math.round(s*265)}"
      font-size="${Math.round(s*80)}" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
      fill="rgba(255,255,255,0.85)" font-family="${FONT}">${sub}</text>
  </svg>`;
}

const CELLS = [
  { colorKey:'remind',   label:'提醒',    sub:'發送工作提醒' },
  { colorKey:'progress', label:'進度',    sub:'查看全員進度' },
  { colorKey:'work',     label:'工作',    sub:'查看我的待辦' },
  { colorKey:'meetbot',  label:'Meetbot', sub:'任務追蹤系統' },
  { colorKey:'admin',    label:'後台',    sub:'出缺勤後台管理' },
  { colorKey:'help',     label:'指令說明', sub:'查看所有指令' },
];

(async () => {
  const comp = [];
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const w = xs[col+1] - xs[col] - BORDER*2;
    const h = ys[row+1] - ys[row] - BORDER*2;
    const c = CELLS[i];
    const buf = await sharp(Buffer.from(makeCellSvg(w, h, c.label, c.sub, c.colorKey))).jpeg({ quality: 88 }).toBuffer();
    comp.push({ input: buf, left: xs[col]+BORDER, top: ys[row]+BORDER });
  }
  const out = await sharp({ create: { width: W, height: H, channels: 3, background: { r:30,g:15,b:10 } } })
    .jpeg({ quality: 88 }).composite(comp).toBuffer();
  fs.writeFileSync('preview_qstyle.jpg', out);
  console.log('saved', out.length, 'bytes');
})().catch(e => console.error(e));

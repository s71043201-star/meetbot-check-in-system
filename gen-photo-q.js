'use strict';
const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');

const FONT = "'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif";
const W=2500, H=1686, B=8;
const xs=[0,833,1666,2500], ys=[0,843,1686];

const UNSPLASH = {
  remind:   'https://images.unsplash.com/photo-1614680376408-81e91ffe3db7?w=833&h=843&fit=crop&auto=format',
  progress: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=833&h=843&fit=crop&auto=format',
  work:     'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=833&h=843&fit=crop&auto=format',
  meetbot:  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=833&h=843&fit=crop&auto=format',
  admin:    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=833&h=843&fit=crop&auto=format',
  help:     'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=833&h=843&fit=crop&auto=format',
};
const FALLBACK = { remind:{r:60,g:30,b:20}, progress:{r:40,g:20,b:70}, work:{r:20,g:50,b:90}, meetbot:{r:0,g:70,b:70}, admin:{r:20,g:70,b:30}, help:{r:40,g:50,b:60} };

async function fetchPhoto(key, w, h) {
  try {
    process.stdout.write(`  ${key}...`);
    const resp = await axios.get(UNSPLASH[key], { responseType:'arraybuffer', timeout:20000 });
    const buf = await sharp(Buffer.from(resp.data)).resize(w,h,{fit:'cover'}).jpeg({quality:88}).toBuffer();
    process.stdout.write(' OK\n');
    return buf;
  } catch {
    process.stdout.write(' fallback\n');
    const {r,g,b} = FALLBACK[key];
    return sharp({create:{width:w,height:h,channels:3,background:{r,g,b}}}).jpeg({quality:88}).toBuffer();
  }
}

function bell(cx,cy,s) {
  return `<g transform="translate(${cx},${cy})">
    <path d="M0,${-s*88} C${-s*50},${-s*88} ${-s*78},${-s*42} ${-s*78},${s*8} L${-s*78},${s*32} Q${-s*78},${s*45} ${-s*65},${s*45} L${s*65},${s*45} Q${s*78},${s*45} ${s*78},${s*32} L${s*78},${s*8} C${s*78},${-s*42} ${s*50},${-s*88} 0,${-s*88}Z" fill="white" opacity="0.92"/>
    <circle cx="0" cy="${-s*97}" r="${s*13}" fill="white" opacity="0.85"/>
    <circle cx="0" cy="${s*57}" r="${s*18}" fill="white" opacity="0.88"/>
    <path d="M${-s*96},0 C${-s*110},${s*20} ${-s*110},${s*42} ${-s*96},${s*52}" stroke="white" stroke-width="${s*8}" fill="none" opacity="0.5" stroke-linecap="round"/>
    <path d="M${s*96},0 C${s*110},${s*20} ${s*110},${s*42} ${s*96},${s*52}" stroke="white" stroke-width="${s*8}" fill="none" opacity="0.5" stroke-linecap="round"/>
  </g>`;
}
function chart(cx,cy,s) {
  return `<g transform="translate(${cx},${cy})">
    <rect x="${-s*82}" y="${-s*28}" width="${s*44}" height="${s*82}" rx="${s*9}" fill="white" opacity="0.88"/>
    <rect x="${-s*22}" y="${-s*72}" width="${s*44}" height="${s*126}" rx="${s*9}" fill="white" opacity="0.92"/>
    <rect x="${s*38}"  y="${s*8}"   width="${s*44}" height="${s*46}"  rx="${s*9}" fill="white" opacity="0.82"/>
    <rect x="${-s*88}" y="${s*60}"  width="${s*176}" height="${s*10}" rx="${s*5}" fill="white" opacity="0.7"/>
  </g>`;
}
function clipboard(cx,cy,s) {
  return `<g transform="translate(${cx},${cy})">
    <rect x="${-s*72}" y="${-s*72}" width="${s*144}" height="${s*158}" rx="${s*14}" fill="white" opacity="0.92"/>
    <rect x="${-s*30}" y="${-s*86}" width="${s*60}"  height="${s*28}"  rx="${s*9}"  fill="white" opacity="0.78"/>
    <rect x="${-s*52}" y="${-s*34}" width="${s*104}" height="${s*10}"  rx="${s*5}"  fill="rgba(0,0,0,0.18)"/>
    <rect x="${-s*52}" y="${-s*12}" width="${s*84}"  height="${s*10}"  rx="${s*5}"  fill="rgba(0,0,0,0.18)"/>
    <path d="M${-s*52},${s*22} L${-s*36},${s*38} L${-s*12},${s*6}" stroke="rgba(0,0,0,0.35)" stroke-width="${s*10}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${-s*4}" y="${s*18}" width="${s*56}" height="${s*10}" rx="${s*5}" fill="rgba(0,0,0,0.18)"/>
  </g>`;
}
function laptop(cx,cy,s) {
  return `<g transform="translate(${cx},${cy})">
    <rect x="${-s*88}" y="${-s*90}" width="${s*176}" height="${s*124}" rx="${s*13}" fill="white" opacity="0.92"/>
    <rect x="${-s*74}" y="${-s*76}" width="${s*148}" height="${s*98}"  rx="${s*7}"  fill="rgba(0,0,0,0.15)"/>
    <rect x="${-s*58}" y="${-s*63}" width="${s*64}"  height="${s*10}"  rx="${s*4}"  fill="white" opacity="0.7"/>
    <rect x="${-s*58}" y="${-s*46}" width="${s*96}"  height="${s*8}"   rx="${s*4}"  fill="white" opacity="0.5"/>
    <circle cx="${s*46}" cy="${-s*34}" r="${s*18}" fill="white" opacity="0.65"/>
    <path d="M${s*38},${-s*34} L${s*44},${-s*28} L${s*56},${-s*42}" stroke="rgba(0,0,0,0.45)" stroke-width="${s*7}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${-s*98}" y="${s*40}"  width="${s*196}" height="${s*30}"  rx="${s*11}" fill="white" opacity="0.92"/>
    <rect x="${-s*72}" y="${s*34}"  width="${s*144}" height="${s*12}"  rx="${s*6}"  fill="white" opacity="0.7"/>
  </g>`;
}
function monitor(cx,cy,s) {
  return `<g transform="translate(${cx},${cy})">
    <rect x="${-s*92}" y="${-s*86}" width="${s*184}" height="${s*134}" rx="${s*13}" fill="white" opacity="0.92"/>
    <rect x="${-s*78}" y="${-s*72}" width="${s*156}" height="${s*106}" rx="${s*7}"  fill="rgba(0,0,0,0.15)"/>
    <rect x="${-s*65}" y="${-s*30}" width="${s*32}"  height="${s*52}"  rx="${s*5}"  fill="white" opacity="0.65"/>
    <rect x="${-s*25}" y="${-s*52}" width="${s*32}"  height="${s*74}"  rx="${s*5}"  fill="white" opacity="0.72"/>
    <rect x="${s*15}"  y="${-s*18}" width="${s*32}"  height="${s*40}"  rx="${s*5}"  fill="white" opacity="0.58"/>
    <rect x="${-s*12}" y="${s*52}"  width="${s*24}"  height="${s*28}"  rx="${s*5}"  fill="white" opacity="0.85"/>
    <rect x="${-s*44}" y="${s*74}"  width="${s*88}"  height="${s*14}"  rx="${s*7}"  fill="white" opacity="0.85"/>
  </g>`;
}
function book(cx,cy,s) {
  return `<g transform="translate(${cx},${cy})">
    <path d="M0,${-s*84} L${-s*84},${-s*74} Q${-s*96},${-s*70} ${-s*96},${-s*57} L${-s*96},${s*72} Q${-s*96},${s*84} ${-s*84},${s*84} L0,${s*74}Z" fill="white" opacity="0.92"/>
    <path d="M0,${-s*84} L${s*84},${-s*74} Q${s*96},${-s*70} ${s*96},${-s*57} L${s*96},${s*72} Q${s*96},${s*84} ${s*84},${s*84} L0,${s*74}Z" fill="white" opacity="0.92"/>
    <rect x="${-s*6}"  y="${-s*84}" width="${s*12}" height="${s*168}" rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${-s*80}" y="${-s*42}" width="${s*64}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${-s*80}" y="${-s*26}" width="${s*52}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${s*16}"  y="${-s*42}" width="${s*64}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
    <rect x="${s*28}"  y="${-s*26}" width="${s*52}" height="${s*8}"   rx="${s*4}"  fill="rgba(0,0,0,0.2)"/>
  </g>`;
}
const ICONS = { remind:bell, progress:chart, work:clipboard, meetbot:laptop, admin:monitor, help:book };

const CELLS = [
  {key:'remind',   label:'提醒',    sub:'發送工作提醒'},
  {key:'progress', label:'進度',    sub:'查看全員進度'},
  {key:'work',     label:'工作',    sub:'查看我的待辦'},
  {key:'meetbot',  label:'Meetbot', sub:'任務追蹤系統'},
  {key:'admin',    label:'後台',    sub:'出缺勤後台管理'},
  {key:'help',     label:'指令說明', sub:'查看所有指令'},
];

(async () => {
  const comp = [];
  for (let i = 0; i < 6; i++) {
    const col=i%3, row=Math.floor(i/3);
    const w=xs[col+1]-xs[col]-B*2, h=ys[row+1]-ys[row]-B*2;
    const cx=Math.round(w/2), cy=Math.round(h/2), s=w/820;
    const c = CELLS[i];

    const photo = await fetchPhoto(c.key, w, h);
    const iconSvg = (ICONS[c.key]||bell)(cx, cy-Math.round(s*70), s);
    const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="black" stop-opacity="0"/>
          <stop offset="50%"  stop-color="black" stop-opacity="0.2"/>
          <stop offset="100%" stop-color="black" stop-opacity="0.72"/>
        </linearGradient>
        <clipPath id="cp"><rect width="${w}" height="${h}" rx="20" ry="20"/></clipPath>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#f)" clip-path="url(#cp)"/>
      ${iconSvg}
      <text x="${cx}" y="${cy+Math.round(s*120)}" font-size="${Math.round(s*145)}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="${FONT}">${c.label}</text>
      <text x="${cx}" y="${cy+Math.round(s*265)}" font-size="${Math.round(s*80)}"  font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.88)" font-family="${FONT}">${c.sub}</text>
    </svg>`;

    const ovBuf = await sharp(Buffer.from(overlaySvg)).png().toBuffer();
    const cell  = await sharp(photo).composite([{input:ovBuf, blend:'over'}]).jpeg({quality:88}).toBuffer();
    comp.push({input:cell, left:xs[col]+B, top:ys[row]+B});
  }
  const out = await sharp({create:{width:W,height:H,channels:3,background:{r:30,g:30,b:30}}})
    .jpeg({quality:88}).composite(comp).toBuffer();
  fs.writeFileSync('preview_photo_q.jpg', out);
  console.log('saved', Math.round(out.length/1024)+'KB');
})().catch(e => console.error(e));

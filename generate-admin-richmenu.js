const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 2500, height: 1686, deviceScaleFactor: 1 });

  const htmlPath = 'file:///' + path.resolve(__dirname, 'richmenu-admin.html').replace(/\\/g, '/');
  await page.goto(htmlPath, { waitUntil: 'networkidle0' });

  const outPath = path.join(__dirname, 'public', 'richmenu-admin.jpg');
  fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
  await page.screenshot({ path: outPath, type: 'jpeg', quality: 85, clip: { x:0, y:0, width:2500, height:1686 } });
  await browser.close();

  console.log('✅ 生成完成:', outPath, `(${(fs.statSync(outPath).size/1024).toFixed(0)} KB)`);
})();

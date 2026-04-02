function buildExportFullHtml(grouped) {
  const allFeeTypes = ["稿費","審查費","講座鐘點費","臨時人員費","出席費","交通差旅費","其他"];
  const B = 'border:1px solid #000;';
  const P = 'padding:5px 8px;font-size:12pt;vertical-align:middle;';
  const S = `style="${B}${P}"`;
  const SL = `style="${B}${P}font-weight:bold;text-align:center"`;

  let pages = [];
  for (const [pName, pRecs] of Object.entries(grouped)) {
    const latest = pRecs.find(r => r.idNumber) || pRecs[0];
    const fa = Array.isArray(latest.feeTypes) ? latest.feeTypes : [];
    const feeStr = allFeeTypes.map(ft => `${fa.includes(ft) ? "☑" : "□"}${ft}`).join(" ");
    const pm = latest.payMethod || "";
    const bi = latest.bankInfo || {};
    const idNum = latest.idNumber || "";
    const addr = latest.address || "";
    const la = latest.liveAddress || "";
    const sameAddr = !la || la === addr;
    const phone = latest.phone || "";
    const bankName = bi.bankName || "";
    const bankAccName = bi.bankAccountName || bi.accountName || "";
    const bankAcc = bi.bankAccount || bi.account || "";

    // 身分證 10 格 — 每格 8% 寬
    const idCells = Array.from({length:10}, (_,i) =>
      `<td width="8%" align="center" style="${B}height:36px;font-size:14pt;font-family:Courier New;padding:2px">${idNum[i] || "&nbsp;"}</td>`
    ).join("");

    // 整張表格用 20 欄結構：
    // 欄 1-2 = 標題 (width 10% each = 20%)
    // 欄 3-20 = 內容 (每欄 ~4.4%, 身分證行用 2 欄合併 = ~8% × 10 格 = 80%)
    // 但這太複雜。改用簡單方式：
    // 整張表格 11 欄，第 1 欄固定 12%，欄 2-11 各 8.8%
    // 一般行用 colspan 合併
    // 身分證行剛好 10 格

    pages.push(`
<p align="center" style="font-size:16pt;font-weight:bold;font-family:DFKai-SB,標楷體;margin-bottom:4px">社團法人台北市醫師公會  領據（健康台灣深耕計畫）</p>
<table border="1" cellpadding="5" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:DFKai-SB,標楷體;font-size:12pt">
  <tr>
    <td ${SL} width="12%">領款人姓名</td>
    <td ${S} colspan="4">${pName}</td>
    <td ${SL} colspan="2">事由或會議名稱</td>
    <td ${S} colspan="4">${latest.eventName || ""}</td>
  </tr>
  <tr>
    <td ${SL}>費用別</td>
    <td ${S} colspan="10">${feeStr}</td>
  </tr>
  <tr>
    <td ${SL}>金額</td>
    <td ${S} colspan="10">新臺幣______萬______仟______佰______拾______元整（＄____________）</td>
  </tr>
  <tr>
    <td ${SL} rowspan="4">領款方式</td>
    <td ${S} colspan="10">${pm === "現金" ? "☑" : "□"}現金</td>
  </tr>
  <tr><td ${S} colspan="10">${pm === "匯款" ? "☑" : "□"}匯款</td></tr>
  <tr><td ${S} colspan="10">受款銀行名稱及分行：${bankName}</td></tr>
  <tr>
    <td ${S} colspan="5">戶名：${bankAccName}</td>
    <td ${S} colspan="5">帳號：${bankAcc}</td>
  </tr>
  <tr>
    <td ${SL}>領款日期</td>
    <td ${S} colspan="5">中華民國______年____月____日</td>
    <td ${SL} colspan="2">領款人簽章</td>
    <td ${S} colspan="3" height="50">&nbsp;</td>
  </tr>
  <tr>
    <td ${SL}>身分證號碼</td>
    ${idCells}
  </tr>
  <tr>
    <td ${SL}>戶籍地址</td>
    <td ${S} colspan="10">${addr}</td>
  </tr>
  <tr>
    <td ${SL}>居住地址</td>
    <td ${S} colspan="10">${sameAddr ? "☑同戶籍地址" : "□同戶籍地址 ☑請另填：" + la}</td>
  </tr>
  <tr>
    <td ${SL}>連絡電話</td>
    <td ${S} colspan="10">${phone}</td>
  </tr>
</table>`);
  }

  const body = pages.join('\n<p style="page-break-before:always">&nbsp;</p>\n');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 2cm 1.5cm; }
  body { font-family: "DFKai-SB","標楷體","Microsoft JhengHei",sans-serif; }
</style></head>
<body>${body}</body></html>`;
}

module.exports = { buildExportFullHtml };

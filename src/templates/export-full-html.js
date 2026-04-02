function buildExportFullHtml(grouped) {
  const allFeeTypes = ["稿費","審查費","講座鐘點費","臨時人員費","出席費","交通差旅費","其他"];
  const bd = 'border:1px solid #000;';
  const pd = 'padding:5px 6px;font-size:12pt;vertical-align:middle;';
  const S = `style="${bd}${pd}"`;
  const SL = `style="${bd}${pd}font-weight:bold;text-align:center"`;

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

    // 身分證 10 格
    const idCells = Array.from({length:10}, (_,i) =>
      `<td align="center" ${S} style="${bd}padding:4px;font-size:14pt;font-family:Courier New;height:32px">${idNum[i] || "&nbsp;"}</td>`
    ).join("");

    // 隱藏首行定義 11 欄等寬（1 標題欄 12% + 10 資料欄各 8.8%）
    const hiddenRow = '<tr style="height:0;overflow:hidden;mso-hide:all">' +
      '<td width="12%" style="border:none;padding:0;height:0;font-size:0;line-height:0">&nbsp;</td>' +
      Array.from({length:10}, () =>
        '<td width="8%" style="border:none;padding:0;height:0;font-size:0;line-height:0">&nbsp;</td>'
      ).join("") + '</tr>';

    pages.push(`
<p align="center" style="font-size:15pt;font-weight:bold;font-family:DFKai-SB,標楷體;margin-bottom:4px">社團法人台北市醫師公會  領據（健康台灣深耕計畫）</p>
<table border="1" cellpadding="5" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:DFKai-SB,標楷體;font-size:12pt">
  ${hiddenRow}
  <tr>
    <td ${SL}>領款人姓名</td>
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
    <td ${S} colspan="5">中華民國&nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;月&nbsp;&nbsp;日</td>
    <td ${SL} colspan="2">領款人簽章</td>
    <td ${S} colspan="3" height="50">&nbsp;</td>
  </tr>
  <tr>
    <td ${SL}>身分證號碼</td>
    ${idCells}
  </tr>
  <tr>
    <td ${SL} rowspan="2">戶籍地址</td>
    <td ${S} colspan="2">&nbsp;&nbsp;市縣</td>
    <td ${S} colspan="2">區市鄉鎮</td>
    <td ${S} colspan="2">里村</td>
    <td ${S}>鄰</td>
    <td ${S} colspan="3">路街</td>
  </tr>
  <tr>
    <td ${S} colspan="2">段</td>
    <td ${S}>巷</td>
    <td ${S}>弄</td>
    <td ${S} colspan="2">號</td>
    <td ${S}>樓</td>
    <td ${S} colspan="3">之</td>
  </tr>
  <tr>
    <td ${SL}>居住地址</td>
    <td ${S} colspan="10">${sameAddr ? "☑" : "□"}同上 ${sameAddr ? "□" : "☑"}請另填：</td>
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
<!--[if gte mso 9]><xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
</w:WordDocument>
</xml><![endif]-->
<style>
  @page { size: A4; margin: 1.27cm 1.27cm 1.27cm 1.27cm; mso-header-margin:0; mso-footer-margin:0; mso-paper-source:0; }
  div.Section1 { page:Section1; }
  body { font-family: "DFKai-SB","標楷體","Microsoft JhengHei",sans-serif; margin:0; }
</style></head>
<body><div class="Section1">${body}</div></body></html>`;
}

module.exports = { buildExportFullHtml };

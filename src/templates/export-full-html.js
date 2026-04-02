function buildExportFullHtml(grouped) {
  const allFeeTypes = ["稿費","審查費","講座鐘點費","臨時人員費","出席費","交通差旅費","其他"];
  const S = 'style="border:1px solid #000;padding:5px 8px;font-size:12pt;vertical-align:middle"';
  const SL = 'style="border:1px solid #000;padding:5px 8px;font-size:12pt;vertical-align:middle;font-weight:bold;text-align:center;width:80px"';

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

    pages.push(`
<p align="center" style="font-size:16pt;font-weight:bold;font-family:DFKai-SB,標楷體;margin-bottom:6px">社團法人台北市醫師公會  領據（健康台灣深耕計畫）</p>
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:DFKai-SB,標楷體">
  <tr>
    <td ${SL}>領款人姓名</td>
    <td ${S} width="35%">${pName}</td>
    <td ${SL}>事由或會議名稱</td>
    <td ${S}>${latest.eventName || ""}</td>
  </tr>
  <tr>
    <td ${SL}>費用別</td>
    <td ${S} colspan="3">${feeStr}</td>
  </tr>
  <tr>
    <td ${SL}>金額</td>
    <td ${S} colspan="3">新臺幣______萬______仟______佰______拾______元整（＄____________）</td>
  </tr>
  <tr>
    <td ${SL} rowspan="4">領款方式</td>
    <td ${S} colspan="3">${pm === "現金" ? "☑" : "□"}現金</td>
  </tr>
  <tr>
    <td ${S} colspan="3">${pm === "匯款" ? "☑" : "□"}匯款</td>
  </tr>
  <tr>
    <td ${S} colspan="3">受款銀行名稱及分行：${bankName}</td>
  </tr>
  <tr>
    <td ${S} colspan="1">戶名：${bankAccName}</td>
    <td ${S} colspan="2">帳號：${bankAcc}</td>
  </tr>
  <tr>
    <td ${SL}>領款日期</td>
    <td ${S}>中華民國______年____月____日</td>
    <td ${SL}>領款人簽章</td>
    <td ${S} height="50">&nbsp;</td>
  </tr>
</table>
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:DFKai-SB,標楷體">
  <tr>
    <td ${SL} width="80">身分證號碼</td>
    ${Array.from({length:10}, (_,i) =>
      `<td width="9%" align="center" style="border:1px solid #000;height:40px;font-size:14pt;font-family:Courier New">${idNum[i] || "&nbsp;"}</td>`
    ).join("")}
  </tr>
</table>
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:DFKai-SB,標楷體">
  <tr>
    <td ${SL} width="80">戶籍地址</td>
    <td ${S}>${addr}</td>
  </tr>
  <tr>
    <td ${SL}>居住地址</td>
    <td ${S}>${sameAddr ? "☑同戶籍地址" : "□同戶籍地址 ☑請另填：" + la}</td>
  </tr>
  <tr>
    <td ${SL}>連絡電話</td>
    <td ${S}>${phone}</td>
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

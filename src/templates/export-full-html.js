function buildExportFullHtml(grouped) {
  const allFeeTypes = ["稿費","審查費","講座鐘點費","臨時人員費","出席費","交通差旅費","其他"];
  const B = 'border:1px solid #000;';
  const P = 'padding:6px 8px;font-size:12pt;vertical-align:middle;';
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

    // 身分證：用等寬字型，每個字元用底線框住
    const idDisplay = Array.from({length:10}, (_,i) => {
      const ch = idNum[i] || " ";
      return `<span style="display:inline-block;width:30px;height:30px;border:1px solid #000;text-align:center;line-height:30px;font-size:14pt;font-family:Courier New;mso-char-type:symbol">${ch}</span>`;
    }).join("&#8203;");

    // 簡單 4 欄表格，不會互相干擾
    pages.push(`
<p align="center" style="font-size:16pt;font-weight:bold;font-family:DFKai-SB,標楷體;margin-bottom:4px">社團法人台北市醫師公會  領據（健康台灣深耕計畫）</p>
<table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:DFKai-SB,標楷體;font-size:12pt">
  <tr>
    <td ${SL} width="14%">領款人姓名</td>
    <td ${S} width="36%">${pName}</td>
    <td ${SL} width="14%">事由或會議名稱</td>
    <td ${S} width="36%">${latest.eventName || ""}</td>
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
  <tr><td ${S} colspan="3">${pm === "匯款" ? "☑" : "□"}匯款</td></tr>
  <tr><td ${S} colspan="3">受款銀行名稱及分行：${bankName}</td></tr>
  <tr>
    <td ${S}>戶名：${bankAccName}</td>
    <td ${S} colspan="2">帳號：${bankAcc}</td>
  </tr>
  <tr>
    <td ${SL}>領款日期</td>
    <td ${S}>中華民國______年____月____日</td>
    <td ${SL}>領款人簽章</td>
    <td ${S} height="50">&nbsp;</td>
  </tr>
  <tr>
    <td ${SL}>身分證號碼</td>
    <td ${S} colspan="3" style="${B}padding:8px;font-size:12pt;vertical-align:middle">${idDisplay}</td>
  </tr>
  <tr>
    <td ${SL}>戶籍地址</td>
    <td ${S} colspan="3">${addr}</td>
  </tr>
  <tr>
    <td ${SL}>居住地址</td>
    <td ${S} colspan="3">${sameAddr ? "☑同戶籍地址" : "□同戶籍地址 ☑請另填：" + la}</td>
  </tr>
  <tr>
    <td ${SL}>連絡電話</td>
    <td ${S} colspan="3">${phone}</td>
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

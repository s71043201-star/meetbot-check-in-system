function buildExportFullHtml(grouped) {
  const allFeeTypes = ["稿費","審查費","講座鐘點費","臨時人員費","出席費","交通差旅費","其他"];

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

    // 身分證號碼：巢狀表格 10 格
    const idInnerTable = `<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0"><tr>${
      Array.from({length:10}, (_,i) =>
        `<td width="32" height="30" align="center" style="border:1px solid #000;font-size:14pt;font-family:Courier New">${idNum[i] || "&nbsp;"}</td>`
      ).join("")
    }</tr></table>`;

    pages.push(`
<p align="center" style="font-size:16pt;font-weight:bold;font-family:DFKai-SB,標楷體">社團法人台北市醫師公會&emsp;領據（健康台灣深耕計畫）</p>
<table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:DFKai-SB,標楷體;font-size:12pt">
  <tr>
    <td width="80" align="center"><b>領款人姓名</b></td>
    <td width="180">${pName}</td>
    <td width="80" align="center"><b>事由或會議名稱</b></td>
    <td>${latest.eventName || ""}</td>
  </tr>
  <tr>
    <td align="center"><b>費用別</b></td>
    <td colspan="3">${feeStr}</td>
  </tr>
  <tr>
    <td align="center"><b>金額</b></td>
    <td colspan="3">新臺幣______萬______仟______佰______拾______元整（＄____________）</td>
  </tr>
  <tr>
    <td rowspan="4" align="center"><b>領款方式</b></td>
    <td colspan="3">${pm === "現金" ? "☑" : "□"}現金</td>
  </tr>
  <tr>
    <td colspan="3">${pm === "匯款" ? "☑" : "□"}匯款</td>
  </tr>
  <tr>
    <td colspan="3">受款銀行名稱及分行：${bankName}</td>
  </tr>
  <tr>
    <td>戶名：${bankAccName}</td>
    <td colspan="2">帳號：${bankAcc}</td>
  </tr>
  <tr>
    <td align="center"><b>領款日期</b></td>
    <td>中華民國______年____月____日</td>
    <td align="center"><b>領款人簽章</b></td>
    <td height="50">&nbsp;</td>
  </tr>
  <tr>
    <td align="center"><b>身分證號碼</b></td>
    <td colspan="3">${idInnerTable}</td>
  </tr>
  <tr>
    <td align="center"><b>戶籍地址</b></td>
    <td colspan="3">${addr}</td>
  </tr>
  <tr>
    <td align="center"><b>居住地址</b></td>
    <td colspan="3">${sameAddr ? "☑同戶籍地址" : "□同戶籍地址 ☑請另填：" + la}</td>
  </tr>
  <tr>
    <td align="center"><b>連絡電話</b></td>
    <td colspan="3">${phone}</td>
  </tr>
</table>`);
  }

  // 多人時用分頁符號隔開
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

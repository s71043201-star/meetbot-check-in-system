function buildExportFullHtml(grouped) {
  const allFeeTypes = ["稿費","審查費","講座鐘點費","臨時人員費","出席費","交通差旅費","其他"];

  let pages = "";
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

    pages += `
      <div class="page">
        <p class="title">社團法人台北市醫師公會　領據（健康台灣深耕計畫）</p>
        <table>
          <tr>
            <td class="lbl" width="80">領款人姓名</td>
            <td width="200">${pName}</td>
            <td class="lbl" width="80">事由或會議名稱</td>
            <td>${latest.eventName || ""}</td>
          </tr>
          <tr>
            <td class="lbl">費用別</td>
            <td colspan="3">${feeStr}</td>
          </tr>
          <tr>
            <td class="lbl">金額</td>
            <td colspan="3">新臺幣______萬______仟______佰______拾______元整（＄____________）</td>
          </tr>
          <tr>
            <td class="lbl" rowspan="4">領款方式</td>
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
            <td class="lbl">領款日期</td>
            <td>中華民國______年____月____日</td>
            <td class="lbl">領款人簽章</td>
            <td style="height:50px"></td>
          </tr>
        </table>
        <table class="id-table">
          <tr>
            <td class="lbl" width="80" rowspan="2">身分證號碼</td>
            ${Array.from({length:10}, (_,i) => `<td class="id-cell">${idNum[i] || ""}</td>`).join("")}
          </tr>
          <tr>
            ${Array.from({length:10}, () => `<td class="id-cell-empty"></td>`).join("")}
          </tr>
        </table>
        <table>
          <tr>
            <td class="lbl" width="80">戶籍地址</td>
            <td colspan="3">${addr}</td>
          </tr>
          <tr>
            <td class="lbl">居住地址</td>
            <td colspan="3">${sameAddr ? "☑同戶籍地址" : "□同戶籍地址　☑請另填：" + la}</td>
          </tr>
          <tr>
            <td class="lbl">連絡電話</td>
            <td colspan="3">${phone}</td>
          </tr>
        </table>
      </div>`;
  }

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="urn:schemas-microsoft-com:office:word"
  xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 2cm 1.5cm; }
  body { font-family: "DFKai-SB","標楷體","Microsoft JhengHei",sans-serif; color: #000; font-size: 12pt; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  .title { font-size: 16pt; text-align: center; margin-bottom: 10px; font-weight: bold; letter-spacing: 2pt; }
  table { border-collapse: collapse; width: 100%; margin: 0; }
  td { border: 1px solid #000; padding: 6px 8px; font-size: 12pt; vertical-align: middle; }
  td.lbl { font-weight: bold; text-align: center; width: 80px; }
  .id-table { margin: 0; }
  .id-cell { text-align: center; font-size: 14pt; font-family: "Courier New", monospace; height: 35px; width: 9%; }
  .id-cell-empty { height: 8px; border-top: none; }
</style></head>
<body>${pages}</body></html>`;

  return html;
}

module.exports = { buildExportFullHtml };

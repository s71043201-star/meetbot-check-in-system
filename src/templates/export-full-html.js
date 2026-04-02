function buildExportFullHtml(grouped) {
  const allFeeTypes = ["稿費","審查費","講座鐘點費","臨時人員費","出席費","交通差旅費","其他"];

  let pages = "";
  for (const [pName, pRecs] of Object.entries(grouped)) {
    const latest = pRecs.find(r => r.idNumber) || pRecs[0];
    const fa = Array.isArray(latest.feeTypes) ? latest.feeTypes : [];
    const feeStr = allFeeTypes.map(ft => `□${ft}`).join("");
    const pm = latest.payMethod || "";
    const bi = latest.bankInfo || {};
    const idNum = latest.idNumber || "";
    const idCells = Array.from({length:10}, (_,i) =>
      `<td class="id-cell">${idNum[i] || ""}</td>`
    ).join("");
    const addr = latest.address || "";
    const la = latest.liveAddress || "";
    const sameAddr = !la || la === addr;

    pages += `
      <div class="page">
        <h2>社團法人台北市醫師公會　領據（健康台灣深耕計畫）</h2>
        <table>
          <tr>
            <th class="lbl">領款人姓名</th>
            <td class="val">${pName}</td>
            <th class="lbl" colspan="3">事由或會議名稱</th>
            <td class="val" colspan="5">${latest.eventName || ""}</td>
          </tr>
          <tr>
            <th class="lbl">費用別</th>
            <td colspan="9">${feeStr}</td>
          </tr>
          <tr>
            <th class="lbl">金額</th>
            <td colspan="9">新臺幣＿＿＿萬＿＿＿仟＿＿＿佰＿＿＿拾＿＿＿元整（＄＿＿＿＿＿＿）</td>
          </tr>
          <tr>
            <th class="lbl" rowspan="4">領款方式</th>
            <td colspan="9">□現金</td>
          </tr>
          <tr>
            <td colspan="9">□匯款</td>
          </tr>
          <tr>
            <td colspan="9">受款銀行名稱:${bi.bankName || ""}</td>
          </tr>
          <tr>
            <td colspan="4">戶名:${bi.accountName || ""}</td>
            <td colspan="5">帳號:${bi.account || ""}</td>
          </tr>
          <tr>
            <th class="lbl">領款日期</th>
            <td colspan="4" style="text-align:center;">中華民國＿＿＿年＿＿月＿＿日</td>
            <td colspan="2" style="text-align:center;font-weight:bold;">領款人簽章</td>
            <td colspan="3" style="height:50px;"></td>
          </tr>
          <tr>
            <th class="lbl">身分證號碼</th>
            ${idCells}
          </tr>
          <tr>
            <th class="lbl" rowspan="2">戶籍地址</th>
            <td colspan="2">${addr ? addr : ""}市縣</td>
            <td colspan="2">區市鄉鎮</td>
            <td colspan="2">里村</td>
            <td>鄰</td>
            <td colspan="2">路街</td>
          </tr>
          <tr>
            <td colspan="2">段</td>
            <td>巷</td>
            <td>弄</td>
            <td colspan="2">號</td>
            <td>樓</td>
            <td colspan="2">之</td>
          </tr>
          <tr>
            <th class="lbl" rowspan="2">居住地址</th>
            <td colspan="9">${sameAddr ? "☑" : "□"}同上　${sameAddr ? "□" : "☑"}請另填：${sameAddr ? "" : la}</td>
          </tr>
          <tr>
            <td colspan="9" style="height:24px;"></td>
          </tr>
          <tr>
            <th class="lbl">連絡電話</th>
            <td colspan="9">${latest.phone || ""}</td>
          </tr>
        </table>
      </div>`;
  }

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="urn:schemas-microsoft-com:office:word"
  xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 2cm 1.5cm 2cm 1.5cm; }
  body { font-family: "DFKai-SB","標楷體","Microsoft JhengHei",sans-serif; color: #000; font-size: 12pt; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  h2 { font-size: 15pt; text-align: center; margin-bottom: 12px; font-weight: bold; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #000; padding: 6px 8px; font-size: 11pt; vertical-align: middle; }
  th.lbl { background: #fff; font-weight: bold; text-align: center; width: 90px; }
  td { text-align: left; }
  .id-cell { width: 30px; height: 30px; text-align: center; font-size: 14pt; font-family: "Courier New", monospace; }
</style></head>
<body>${pages}</body></html>`;

  return html;
}

module.exports = { buildExportFullHtml };

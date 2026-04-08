/* ============================================
   qa-query.js  --  Public QA Query Page Logic
   ============================================ */
(function () {
  "use strict";

  var STATUS_CLASS = { "待處理": "badge-pending", "處理中": "badge-processing", "已回覆": "badge-answered", "已結案": "badge-closed" };

  async function search() {
    var input = document.getElementById("searchInput").value.trim();
    if (!input) {
      showToast("請輸入 Email 或電話號碼", "warning");
      return;
    }

    var container = document.getElementById("results");
    container.innerHTML = '<div class="empty">查詢中…</div>';

    try {
      var results = await fetchJSON("/api/questions/public/search?contactInfo=" + encodeURIComponent(input));

      if (results.length === 0) {
        container.innerHTML = '<div class="empty">沒有找到相關問題，請確認輸入的聯絡方式是否正確</div>';
        return;
      }

      container.innerHTML = results.map(function (q) {
        var statusCls = STATUS_CLASS[q.status] || "badge-pending";
        var dateStr = q.createdAt ? q.createdAt.slice(0, 16).replace("T", " ") : "";

        var answerHtml = "";
        if (q.status === "已回覆" || q.status === "已結案") {
          if (q.answer) {
            answerHtml = '<div class="result-card-answer">' +
              '<h4>回覆內容</h4>' +
              '<p>' + escapeHtml(q.answer) + '</p>' +
              (q.answeredAt ? '<div class="meta">回覆時間：' + q.answeredAt.slice(0, 16).replace("T", " ") + '</div>' : '') +
              '</div>';
          }
        } else {
          answerHtml = '<div class="result-card-pending">您的問題正在處理中，請耐心等候</div>';
        }

        return '<div class="result-card">' +
          '<div class="result-card-header">' +
            '<span class="badge badge-unit">' + escapeHtml(q.unit) + '</span>' +
            '<span class="badge ' + statusCls + '">' + escapeHtml(q.status) + '</span>' +
            (q.category ? '<span class="badge badge-category">' + escapeHtml(q.category) + '</span>' : '') +
          '</div>' +
          '<div class="result-card-content">' + escapeHtml(q.content) + '</div>' +
          answerHtml +
          '<div class="result-date">提問時間：' + dateStr + '</div>' +
        '</div>';
      }).join("");

    } catch (e) {
      container.innerHTML = '<div class="empty">查詢失敗：' + escapeHtml(e.message) + '</div>';
    }
  }

  document.getElementById("btn-search").addEventListener("click", search);

  document.getElementById("searchInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") search();
  });

})();

/* ============================================
   qa-app.js  --  Unified QA App Logic
   ============================================ */
(function () {
  "use strict";

  var STATUSES = ["待處理", "處理中", "已回覆", "已結案"];
  var STATUS_CLASS = { "待處理": "badge-pending", "處理中": "badge-processing", "已回覆": "badge-answered", "已結案": "badge-closed" };

  // ═══════════════════════════════════════════════
  //  Tab Navigation
  // ═══════════════════════════════════════════════
  var navTabs = document.querySelectorAll(".nav-tab");
  var tabPanels = document.querySelectorAll(".tab-panel");
  var adminInitialized = false;

  navTabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-tab");
      navTabs.forEach(function (b) { b.classList.remove("active"); });
      tabPanels.forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("tab-" + target).classList.add("active");

      // Lazy-load admin data on first visit
      if (target === "admin" && !adminInitialized) {
        adminInitialized = true;
        loadQuestions();
      }
    });
  });

  function switchToTab(tabName) {
    navTabs.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tabName);
    });
    tabPanels.forEach(function (p) { p.classList.remove("active"); });
    document.getElementById("tab-" + tabName).classList.add("active");
    if (tabName === "admin" && !adminInitialized) {
      adminInitialized = true;
      loadQuestions();
    }
  }

  // ── Admin sub-tabs ──
  var subTabs = document.querySelectorAll(".sub-tab");
  var subContents = document.querySelectorAll(".sub-tab-content");

  subTabs.forEach(function (btn, i) {
    btn.addEventListener("click", function () {
      subTabs.forEach(function (b) { b.classList.remove("active"); });
      subContents.forEach(function (c) { c.classList.remove("active"); });
      btn.classList.add("active");
      subContents[i].classList.add("active");
      if (i === 1) loadStats();
    });
  });

  // ── Hash routing ──
  function handleHash() {
    var hash = location.hash.replace("#", "");
    if (hash && document.getElementById("tab-" + hash)) {
      switchToTab(hash);
    }
  }
  handleHash();
  window.addEventListener("hashchange", handleHash);

  // ═══════════════════════════════════════════════
  //  Submit Tab
  // ═══════════════════════════════════════════════
  var fields = [
    { id: "unit",        errId: "err-unit",        msg: "請選擇提問單位" },
    { id: "contactName", errId: "err-contactName",  msg: "請填寫聯絡人姓名" },
    { id: "contactInfo", errId: "err-contactInfo",  msg: "請填寫聯絡方式" },
    { id: "category",    errId: "err-category",     msg: "請選擇問題類別" },
    { id: "content",     errId: "err-content",      msg: "請填寫問題內容" },
  ];

  function validate() {
    var ok = true;
    fields.forEach(function (f) {
      var el = document.getElementById(f.id);
      var err = document.getElementById(f.errId);
      var val = el.value.trim();
      if (!val) {
        err.classList.remove("hidden");
        ok = false;
      } else {
        err.classList.add("hidden");
      }
    });
    return ok;
  }

  // Clear errors on input
  fields.forEach(function (f) {
    var el = document.getElementById(f.id);
    el.addEventListener("input", function () {
      document.getElementById(f.errId).classList.add("hidden");
    });
    el.addEventListener("change", function () {
      document.getElementById(f.errId).classList.add("hidden");
    });
  });

  async function submitForm() {
    if (!validate()) {
      showToast("請填寫所有必填欄位", "warning");
      return;
    }

    var btn = document.getElementById("btn-submit");
    btn.disabled = true;
    btn.textContent = "提交中…";

    var priority = "一般";
    var radios = document.querySelectorAll('input[name="priority"]');
    radios.forEach(function (r) { if (r.checked) priority = r.value; });

    var payload = {
      unit:        document.getElementById("unit").value,
      contactName: document.getElementById("contactName").value.trim(),
      contactInfo: document.getElementById("contactInfo").value.trim(),
      category:    document.getElementById("category").value,
      content:     document.getElementById("content").value.trim(),
      priority:    priority,
    };

    try {
      await fetchJSON("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      document.getElementById("sec-form").classList.add("hidden");
      document.getElementById("sec-success").classList.remove("hidden");
      showToast("問題已成功提交", "success");
    } catch (e) {
      showToast("提交失敗：" + e.message, "error");
      btn.disabled = false;
      btn.textContent = "提交問題";
    }
  }

  document.getElementById("btn-submit").addEventListener("click", submitForm);

  document.getElementById("btn-go-query").addEventListener("click", function () {
    switchToTab("query");
  });

  document.getElementById("btn-new").addEventListener("click", function () {
    document.getElementById("sec-success").classList.add("hidden");
    document.getElementById("sec-form").classList.remove("hidden");

    // Reset form
    document.getElementById("unit").value = "";
    document.getElementById("contactName").value = "";
    document.getElementById("contactInfo").value = "";
    document.getElementById("category").value = "";
    document.getElementById("content").value = "";
    document.querySelectorAll('input[name="priority"]')[0].checked = true;

    var btn = document.getElementById("btn-submit");
    btn.disabled = false;
    btn.textContent = "提交問題";
  });

  // ═══════════════════════════════════════════════
  //  Query Tab
  // ═══════════════════════════════════════════════
  var cachedQueryResults = [];

  async function querySearch() {
    var input = document.getElementById("searchInput").value.trim();
    if (!input) {
      showToast("請輸入 Email 或電話號碼", "warning");
      return;
    }

    var container = document.getElementById("query-results");
    container.innerHTML = '<div class="empty">查詢中…</div>';
    document.getElementById("query-filter-row").style.display = "none";
    document.getElementById("queryFilterCategory").value = "";

    try {
      cachedQueryResults = await fetchJSON("/api/questions/public/search?contactInfo=" + encodeURIComponent(input));

      if (cachedQueryResults.length === 0) {
        container.innerHTML = '<div class="empty">沒有找到相關問題，請確認輸入的聯絡方式是否正確</div>';
        return;
      }

      document.getElementById("query-filter-row").style.display = "block";
      renderQueryResults(cachedQueryResults);

    } catch (e) {
      container.innerHTML = '<div class="empty">查詢失敗：' + escapeHtml(e.message) + '</div>';
    }
  }

  function renderQueryResults(results) {
    var container = document.getElementById("query-results");
    if (results.length === 0) {
      container.innerHTML = '<div class="empty">沒有符合條件的問題</div>';
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
  }

  document.getElementById("queryFilterCategory").addEventListener("change", function () {
    var cat = this.value;
    if (!cat) {
      renderQueryResults(cachedQueryResults);
    } else {
      renderQueryResults(cachedQueryResults.filter(function (q) { return q.category === cat; }));
    }
  });

  document.getElementById("btn-query-search").addEventListener("click", querySearch);

  document.getElementById("searchInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") querySearch();
  });

  // ═══════════════════════════════════════════════
  //  Admin Tab
  // ═══════════════════════════════════════════════
  var cachedQuestions = [];
  var selectedIds = new Set();

  // ── Unit button bar ──
  var activeUnit = "";
  var unitBtns = document.querySelectorAll(".unit-btn");
  unitBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      unitBtns.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      activeUnit = btn.getAttribute("data-unit");
      loadQuestions();
    });
  });

  // ── Filters ──
  function getFilterParams() {
    var params = new URLSearchParams();
    var unit = activeUnit;
    var status = document.getElementById("filterStatus").value;
    var category = document.getElementById("filterCategory").value;
    var dateFrom = document.getElementById("filterDateFrom").value;
    var dateTo = document.getElementById("filterDateTo").value;
    var keyword = document.getElementById("filterKeyword").value.trim();
    if (unit) params.set("unit", unit);
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (keyword) params.set("keyword", keyword);
    return params;
  }

  // ── Load questions ──
  async function loadQuestions() {
    try {
      var params = getFilterParams();
      cachedQuestions = await fetchJSON("/api/questions?" + params.toString());
      selectedIds.clear();
      updateBatchBar();
      renderQuestions();
      updateStatCards();
      updateCategoryFilter();
    } catch (e) {
      showToast("載入失敗：" + e.message, "error");
    }
  }

  function updateStatCards() {
    var total = cachedQuestions.length;
    var pending = cachedQuestions.filter(function (q) { return q.status === "待處理"; }).length;
    var answered = cachedQuestions.filter(function (q) { return q.status === "已回覆"; }).length;
    var closed = cachedQuestions.filter(function (q) { return q.status === "已結案"; }).length;
    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-pending").textContent = pending;
    document.getElementById("stat-answered").textContent = answered;
    document.getElementById("stat-closed").textContent = closed;
  }

  function updateCategoryFilter() {
    var sel = document.getElementById("filterCategory");
    var current = sel.value;
    var cats = {};
    cachedQuestions.forEach(function (q) { if (q.category) cats[q.category] = true; });
    var opts = '<option value="">全部</option>';
    Object.keys(cats).sort().forEach(function (c) {
      opts += '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>';
    });
    sel.innerHTML = opts;
    sel.value = current;
  }

  // ── Render question cards ──
  function renderQuestions() {
    var container = document.getElementById("question-list");
    if (cachedQuestions.length === 0) {
      container.innerHTML = '<div class="empty">沒有符合條件的問題</div>';
      return;
    }

    var html = cachedQuestions.map(function (q) {
      var statusCls = STATUS_CLASS[q.status] || "badge-pending";
      var priorityCls = q.priority === "緊急" ? "badge-priority-urgent" : "badge-priority-normal";
      var dateStr = q.createdAt ? q.createdAt.slice(0, 10) : "";

      var answerHtml = "";
      if (q.answer) {
        answerHtml = '<div class="answer-section">' +
          '<h4>回覆</h4>' +
          '<p>' + escapeHtml(q.answer) + '</p>' +
          '<div class="answer-meta">' + escapeHtml(q.answeredBy || "") +
          (q.answeredAt ? " · " + q.answeredAt.slice(0, 16).replace("T", " ") : "") +
          '</div></div>';
      }

      return '<div class="question-card" data-id="' + q.id + '">' +
        '<div class="question-card-header">' +
          '<input type="checkbox" class="question-card-check" data-id="' + q.id + '"' +
            (selectedIds.has(q.id) ? " checked" : "") + '>' +
          '<div class="question-card-meta">' +
            '<span class="badge badge-unit">' + escapeHtml(q.unit) + '</span>' +
            '<span class="badge ' + statusCls + '">' + escapeHtml(q.status) + '</span>' +
            '<span class="badge ' + priorityCls + '">' + escapeHtml(q.priority) + '</span>' +
            (q.category ? '<span class="badge badge-category">' + escapeHtml(q.category) + '</span>' : '') +
            '<span style="font-size:13px;color:var(--color-text);font-weight:500;">' + escapeHtml(q.contactName) + '</span>' +
          '</div>' +
          '<span class="question-card-date">' + dateStr + '</span>' +
        '</div>' +
        '<div class="question-card-body open">' +
          '<div class="question-contact">' +
            '聯絡人：' + escapeHtml(q.contactName) + ' ｜ 聯絡方式：' + escapeHtml(q.contactInfo) +
          '</div>' +
          '<div class="question-content">' + escapeHtml(q.content) + '</div>' +
          answerHtml +
          '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
            '<select class="status-select" data-id="' + q.id + '">' +
              STATUSES.map(function (s) {
                return '<option value="' + s + '"' + (q.status === s ? ' selected' : '') + '>' + s + '</option>';
              }).join("") +
            '</select>' +
            '<button class="btn btn-primary btn-sm btn-reply" data-id="' + q.id + '">' +
              (q.answer ? '編輯回覆' : '回覆') +
            '</button>' +
            '<button class="btn btn-danger btn-sm btn-delete" data-id="' + q.id + '">刪除</button>' +
          '</div>' +
          '<div class="answer-editor-container" data-id="' + q.id + '"></div>' +
        '</div>' +
      '</div>';
    }).join("");

    container.innerHTML = html;
  }

  // ── Event delegation ──
  document.getElementById("question-list").addEventListener("click", function (e) {
    var target = e.target;

    // Toggle card body
    var header = target.closest(".question-card-header");
    if (header && !target.classList.contains("question-card-check")) {
      var body = header.nextElementSibling;
      body.classList.toggle("open");
      return;
    }

    // Checkbox
    if (target.classList.contains("question-card-check")) {
      var id = target.getAttribute("data-id");
      if (target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      updateBatchBar();
      return;
    }

    // Reply button
    if (target.classList.contains("btn-reply")) {
      var qid = target.getAttribute("data-id");
      openAnswerEditor(qid);
      return;
    }

    // Delete button
    if (target.classList.contains("btn-delete")) {
      var did = target.getAttribute("data-id");
      deleteQuestion(did);
      return;
    }

    // Save answer
    if (target.classList.contains("btn-save-answer")) {
      var sid = target.getAttribute("data-id");
      saveAnswer(sid);
      return;
    }

    // Cancel answer
    if (target.classList.contains("btn-cancel-answer")) {
      var cid = target.getAttribute("data-id");
      var cont = document.querySelector('.answer-editor-container[data-id="' + cid + '"]');
      if (cont) cont.innerHTML = "";
      return;
    }
  });

  // Status change
  document.getElementById("question-list").addEventListener("change", function (e) {
    if (e.target.classList.contains("status-select")) {
      var id = e.target.getAttribute("data-id");
      var newStatus = e.target.value;
      updateStatus(id, newStatus);
    }
  });

  // ── Answer editor ──
  function openAnswerEditor(id) {
    var cont = document.querySelector('.answer-editor-container[data-id="' + id + '"]');
    if (!cont) return;
    var q = cachedQuestions.find(function (q) { return q.id === id; });
    cont.innerHTML =
      '<div class="answer-editor">' +
        '<textarea placeholder="輸入回覆內容…">' + escapeHtml(q && q.answer || "") + '</textarea>' +
        '<div class="answer-editor-row">' +
          '<input type="text" placeholder="回覆人姓名" value="' + escapeHtml(q && q.answeredBy || "") + '">' +
          '<button class="btn btn-success btn-sm btn-save-answer" data-id="' + id + '">儲存回覆</button>' +
          '<button class="btn btn-outline btn-sm btn-cancel-answer" data-id="' + id + '">取消</button>' +
        '</div>' +
      '</div>';
    cont.querySelector("textarea").focus();
  }

  async function saveAnswer(id) {
    var cont = document.querySelector('.answer-editor-container[data-id="' + id + '"]');
    var answer = cont.querySelector("textarea").value.trim();
    var answeredBy = cont.querySelector("input").value.trim();
    if (!answer) { showToast("請輸入回覆內容", "warning"); return; }

    try {
      await fetchJSON("/api/questions/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: answer, answeredBy: answeredBy, status: "已回覆" })
      });
      showToast("回覆已儲存", "success");
      loadQuestions();
    } catch (e) {
      showToast("儲存失敗：" + e.message, "error");
    }
  }

  async function updateStatus(id, newStatus) {
    try {
      await fetchJSON("/api/questions/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      showToast("狀態已更新為「" + newStatus + "」", "success");
      loadQuestions();
    } catch (e) {
      showToast("更新失敗：" + e.message, "error");
    }
  }

  async function deleteQuestion(id) {
    if (!confirm("確定要刪除這個問題嗎？")) return;
    try {
      await fetchJSON("/api/questions/" + id, { method: "DELETE" });
      showToast("已刪除", "success");
      loadQuestions();
    } catch (e) {
      showToast("刪除失敗：" + e.message, "error");
    }
  }

  // ── Batch operations ──
  function updateBatchBar() {
    var bar = document.getElementById("batch-bar");
    var count = document.getElementById("batch-count");
    count.textContent = selectedIds.size;
    if (selectedIds.size > 0) bar.classList.remove("hidden");
    else bar.classList.add("hidden");
  }

  document.getElementById("btn-batch-update").addEventListener("click", async function () {
    if (selectedIds.size === 0) return;
    var status = document.getElementById("batch-status").value;
    try {
      await fetchJSON("/api/questions/batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), status: status })
      });
      showToast("已批量更新 " + selectedIds.size + " 筆為「" + status + "」", "success");
      loadQuestions();
    } catch (e) {
      showToast("批量更新失敗：" + e.message, "error");
    }
  });

  // ── Export ──
  document.getElementById("btn-export").addEventListener("click", function () {
    var params = getFilterParams();
    window.location.href = "/api/questions/export?" + params.toString();
  });

  // ── Stats ──
  async function loadStats() {
    try {
      var stats = await fetchJSON("/api/questions/stats");
      renderStats(stats);
    } catch (e) {
      document.getElementById("stats-container").innerHTML =
        '<div class="empty">載入統計失敗：' + escapeHtml(e.message) + '</div>';
    }
  }

  function renderStats(stats) {
    var maxUnit = Math.max.apply(null, Object.values(stats.byUnit).concat([1]));
    var maxCat = Math.max.apply(null, Object.values(stats.byCategory).concat([1]));

    var html = '<div class="stats-section"><h3>依狀態分布</h3><div class="stats-row">';
    STATUSES.forEach(function (s) {
      var cls = s === "待處理" ? "warn" : s === "已回覆" ? "ok" : s === "已結案" ? "mute" : "";
      html += '<div class="stat-card"><div class="stat-num ' + cls + '">' + (stats.byStatus[s] || 0) +
        '</div><div class="stat-label">' + s + '</div></div>';
    });
    html += '</div></div>';

    html += '<div class="stats-section"><h3>依單位分布</h3><div class="bar-chart">';
    Object.entries(stats.byUnit).filter(function (entry) { return entry[1] > 0; }).forEach(function (entry) {
      var pct = Math.round(entry[1] / maxUnit * 100);
      html += '<div class="bar-row"><span class="bar-label">' + escapeHtml(entry[0]) + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="bar-value">' + entry[1] + '</span></div>';
    });
    html += '</div></div>';

    if (Object.keys(stats.byCategory).length > 0) {
      html += '<div class="stats-section"><h3>依類別分布</h3><div class="bar-chart">';
      Object.entries(stats.byCategory).filter(function (entry) { return entry[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (entry) {
        var pct = Math.round(entry[1] / maxCat * 100);
        html += '<div class="bar-row"><span class="bar-label">' + escapeHtml(entry[0]) + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:#7c3aed"></div></div>' +
          '<span class="bar-value">' + entry[1] + '</span></div>';
      });
      html += '</div></div>';
    }

    document.getElementById("stats-container").innerHTML = html;
  }

  // ── Admin search button ──
  document.getElementById("btn-admin-search").addEventListener("click", loadQuestions);

  document.getElementById("filterKeyword").addEventListener("keydown", function (e) {
    if (e.key === "Enter") loadQuestions();
  });

})();

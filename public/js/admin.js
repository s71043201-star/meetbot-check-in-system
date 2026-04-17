/* ============================================
   admin.js  --  Admin Dashboard Logic
   ============================================ */
(function () {
  "use strict";

  var ALL_FEE_TYPES = ["\u7A3F\u8CBB", "\u5BE9\u67E5\u8CBB", "\u8B1B\u5EA7\u9418\u9EDE\u8CBB", "\u81E8\u6642\u4EBA\u54E1\u8CBB", "\u51FA\u5E2D\u8CBB", "\u4EA4\u901A\u5DEE\u65C5\u8CBB", "\u5176\u4ED6"];
  var cachedRecords = [];
  var cachedReceiptUsers = [];
  var cachedReceiptRecords = [];
  var confirmingDelete = false;
  var refreshTimer = null;

  function fmt(isoStr) {
    if (!isoStr) return "-";
    return new Date(isoStr).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  }

  function maskId(id) {
    if (!id || id.length < 4) return id || "-";
    return id.substring(0, 3) + "****" + id.substring(7);
  }

  // ── Export Loading Helper ──
  function exportWithLoading(btn, fn) {
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "\u532F\u51FA\u4E2D...";
    btn.style.opacity = "0.6";
    fn();
    setTimeout(function () {
      btn.disabled = false;
      btn.textContent = originalText;
      btn.style.opacity = "";
    }, 3000);
  }

  // ── Tabs ──
  var TAB_MAP = { attendance: 0, receipt: 1, users: 2, "custom-export": 3 };
  var TAB_IDS = ["tab-attendance", "tab-receipt", "tab-users", "tab-custom-export"];

  function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-content").forEach(function (c) { c.classList.remove("active"); });

    var idx = TAB_MAP[tab] || 0;
    document.querySelectorAll(".tab-btn")[idx].classList.add("active");
    document.getElementById(TAB_IDS[idx]).classList.add("active");

    if (tab === "receipt") loadReceipts();
    if (tab === "users") loadUsers();
    if (tab === "custom-export") loadCustomExport();
  }

  // ═══════════════════════════════════════════
  // Tab 1: Attendance Records
  // ═══════════════════════════════════════════
  var currentPage = 1;
  var PAGE_SIZE = 50;

  async function loadRecords(page) {
    if (page) currentPage = page;
    var year  = document.getElementById("filterYear").value;
    var month = document.getElementById("filterMonth").value;
    var name  = document.getElementById("filterName").value.trim();

    try {
      // 取得完整記錄（用於統計和已刪除區塊）
      var res = await fetch("/records");
      var allRecords = await res.json();
      cachedRecords = allRecords;

      // 分離已刪除和正常記錄
      var deletedRecords = allRecords.filter(function (r) { return r.attendanceDeleted; });
      var records = allRecords.filter(function (r) { return !r.attendanceDeleted; });

      if (year)  records = records.filter(function (r) { return r.year  === parseInt(year); });
      if (month) records = records.filter(function (r) { return r.month === parseInt(month); });
      if (name)  records = records.filter(function (r) { return r.name && r.name.includes(name); });

      // 更新已刪除區塊
      renderDeletedRecords(deletedRecords);

      records.sort(function (a, b) { return new Date(a.checkinTime) - new Date(b.checkinTime); });

      var completed  = records.filter(function (r) { return r.status === "checked-out"; });
      var totalHours = completed.reduce(function (s, r) { return s + (r.hours || 0); }, 0);
      var people     = new Set(records.map(function (r) { return r.name; })).size;

      document.getElementById("stat-count").textContent  = records.length;
      document.getElementById("stat-hours").textContent  = Math.round(totalHours * 10) / 10;
      document.getElementById("stat-people").textContent = people;

      // 分頁
      var totalPages = Math.ceil(records.length / PAGE_SIZE) || 1;
      if (currentPage > totalPages) currentPage = totalPages;
      var start = (currentPage - 1) * PAGE_SIZE;
      var pageRecords = records.slice(start, start + PAGE_SIZE);

      // 更新分頁控制
      var pagBar = document.getElementById("pagination-bar");
      if (records.length > PAGE_SIZE) {
        pagBar.classList.remove("hidden");
        pagBar.style.display = "flex";
        document.getElementById("page-current").textContent = currentPage;
        document.getElementById("page-total").textContent = totalPages;
        document.getElementById("page-record-total").textContent = records.length;
        document.getElementById("btn-page-prev").disabled = currentPage <= 1;
        document.getElementById("btn-page-next").disabled = currentPage >= totalPages;
      } else {
        pagBar.classList.add("hidden");
        pagBar.style.display = "";
      }

      var tbody = document.getElementById("tbody");
      if (pageRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" class="empty">\u67E5\u7121\u8A18\u9304</td></tr>';
        return;
      }

      tbody.innerHTML = pageRecords.map(function (r, i) {
        var dateStr   = r.year ? r.year + "/" + r.month + "/" + r.day : "-";
        var content   = Array.isArray(r.workContent) ? r.workContent.join("\u3001") : (r.workContent || "-");
        var typeLabel = r.checkinType === "prescription" ? "\u8655\u65B9\u65E5" : "\u4E00\u822C";
        var courseStr = Array.isArray(r.courses) && r.courses.length > 0
          ? r.courses.join("\u3001") : (r.course || "-");
        var tag = r.status === "checked-out"
          ? '<span class="tag tag-done">\u5B8C\u6210</span>'
          : '<span class="tag tag-in">\u7C3D\u5230\u4E2D</span>';
        return '<tr data-id="' + r.id + '">' +
          '<td><input type="checkbox" class="row-check" data-id="' + r.id + '"></td>' +
          '<td>' + (start + i + 1) + '</td>' +
          '<td>' + escapeHtml(r.name || "-") + '</td>' +
          '<td>' + escapeHtml(typeLabel) + '</td>' +
          '<td class="cell-course">' + escapeHtml(courseStr) + '</td>' +
          '<td>' + escapeHtml(dateStr) + '</td>' +
          '<td>' + fmt(r.checkinTime) + '</td>' +
          '<td>' + fmt(r.checkoutTime) + '</td>' +
          '<td class="cell-hours">' + (r.hours != null ? r.hours + " \u6642" : "-") + '</td>' +
          '<td class="cell-shift">' + escapeHtml(r.shift || "-") + '</td>' +
          '<td class="cell-workContent" style="text-align:left">' + escapeHtml(content) + '</td>' +
          '<td class="cell-note" style="text-align:left">' + escapeHtml(r.note || "-") + '</td>' +
          '<td>' + tag + '</td>' +
          '<td class="action-cell" style="white-space:nowrap">' +
            '<button class="btn-edit" data-id="' + r.id + '">\u7DE8\u8F2F</button> ' +
            '<button class="btn-row-delete" data-id="' + r.id + '">\u522A\u9664</button>' +
          '</td>' +
        '</tr>';
      }).join("");

      // Reset select-all checkbox and batch bar after reload
      var selectAll = document.getElementById("select-all");
      if (selectAll) selectAll.checked = false;
      updateBatchBar();
    } catch (e) {
      document.getElementById("tbody").innerHTML =
        '<tr><td colspan="14" style="color:red;text-align:center;padding:20px">\u8F09\u5165\u5931\u6557\uFF1A' + escapeHtml(e.message) + '</td></tr>';
    }
  }

  function exportExcel() {
    var params = new URLSearchParams();
    var year  = document.getElementById("filterYear").value;
    var month = document.getElementById("filterMonth").value;
    var name  = document.getElementById("filterName").value.trim();
    if (year)  params.set("year",  year);
    if (month) params.set("month", month);
    if (name)  params.set("name",  name);
    window.location.href = "/export?" + params.toString();
  }

  // ═══════════════════════════════════════════
  // Tab 2: Receipt Management
  // ═══════════════════════════════════════════
  async function loadReceipts() {
    var year  = document.getElementById("receiptFilterYear").value;
    var month = document.getElementById("receiptFilterMonth").value;
    var name  = document.getElementById("receiptFilterName").value.trim();

    try {
      var [resRecords, resUsers] = await Promise.all([fetch("/records"), fetch("/users")]);
      var records = await resRecords.json();
      var users = await resUsers.json();

      // Cache for receipt editing
      cachedReceiptUsers = users;
      cachedReceiptRecords = records;

      // Build user lookup by name
      var userByName = {};
      users.forEach(function (u) { if (u.name) userByName[u.name] = u; });

      records = records.filter(function (r) { return !r.attendanceDeleted; });
      if (year)  records = records.filter(function (r) { return r.year  === parseInt(year); });
      if (month) records = records.filter(function (r) { return r.month === parseInt(month); });
      if (name)  records = records.filter(function (r) { return r.name && r.name.includes(name); });

      // Group by name
      var grouped = {};
      records.forEach(function (r) {
        if (!r.name) return;
        if (!grouped[r.name]) grouped[r.name] = [];
        grouped[r.name].push(r);
      });

      // Add registered users who have no attendance records
      users.forEach(function (u) {
        if (!u.name) return;
        if (name && !u.name.includes(name)) return;
        if (!grouped[u.name]) grouped[u.name] = [];
      });

      var container = document.getElementById("receipt-list");

      if (Object.keys(grouped).length === 0) {
        container.innerHTML = '<div class="empty" style="background:var(--color-surface);border-radius:var(--radius-lg);padding:32px;box-shadow:var(--shadow-sm);border:1px solid var(--color-border);">\u67E5\u7121\u9818\u64DA\u8CC7\u6599</div>';
        return;
      }

      container.innerHTML = Object.entries(grouped).map(function (entry) {
        var personName = entry[0];
        var recs = entry[1];
        // Get latest record with receipt data, fallback to registered user data
        var latest = recs.find(function (r) { return r.idNumber; }) || recs[0] || {};
        // Merge registered user data (user data takes priority for personal info)
        var regUser = userByName[personName];
        if (regUser) {
          if (!latest.idNumber && regUser.idNumber) latest.idNumber = regUser.idNumber;
          if (!latest.eventName && regUser.eventName) latest.eventName = regUser.eventName;
          if (!latest.feeTypes && regUser.feeTypes) latest.feeTypes = regUser.feeTypes;
          if (!latest.payMethod && regUser.payMethod) latest.payMethod = regUser.payMethod;
          if (!latest.bankInfo && regUser.bankInfo) latest.bankInfo = regUser.bankInfo;
          if (!latest.address && regUser.address) latest.address = regUser.address;
          if (!latest.liveAddress && regUser.liveAddress) latest.liveAddress = regUser.liveAddress;
          if (!latest.phone && regUser.phone) latest.phone = regUser.phone;
        }
        var completedRecs = recs.filter(function (r) { return r.status === "checked-out"; });
        var totalHours = completedRecs.reduce(function (s, r) { return s + (r.hours || 0); }, 0);

        var feeTypes = Array.isArray(latest.feeTypes) ? latest.feeTypes : [];
        var feeHtml = ALL_FEE_TYPES.map(function (ft) {
          var active = feeTypes.includes(ft);
          return '<span class="fee-tag ' + (active ? 'fee-tag-active' : 'fee-tag-inactive') + '">' + (active ? '\u2611' : '\u2610') + ' ' + escapeHtml(ft) + '</span>';
        }).join("");

        var bankHtml = latest.payMethod === "\u532F\u6B3E" && latest.bankInfo
          ? "<br>\u53D7\u6B3E\u9280\u884C\uFF1A" + escapeHtml(latest.bankInfo.bankName || "-") + "<br>\u6236\u540D\uFF1A" + escapeHtml(latest.bankInfo.accountName || "-") + "<br>\u5E33\u865F\uFF1A" + escapeHtml(latest.bankInfo.account || "-")
          : "";

        var qp = new URLSearchParams();
        qp.set("name", personName);
        if (year)  qp.set("year", year);
        if (month) qp.set("month", month);

        var userId = regUser ? regUser.id : "";
        var recIds = recs.map(function (r) { return r.id || ""; }).filter(Boolean).join(",");

        return '<div class="receipt-card" data-name="' + escapeHtml(personName) + '" data-user-id="' + userId + '" data-rec-ids="' + recIds + '">' +
          '<div class="receipt-card-header">' +
            '<h3>' + escapeHtml(personName) + '\uFF08\u5171 ' + recs.length + ' \u7B46\uFF0C' + (Math.round(totalHours * 10) / 10) + ' \u5C0F\u6642\uFF09</h3>' +
            '<div style="display:flex;gap:8px;">' +
              '<button class="btn btn-sm btn-receipt-edit" style="background:#fff;color:#f59e0b;font-weight:600;border:1px solid #f59e0b;">✏️ \u7DE8\u8F2F</button>' +
              '<button class="btn btn-sm" style="background:#fff;color:#2563eb;font-weight:600;" data-action="export-receipt" data-params="' + escapeHtml(qp.toString()) + '">' +
                '\u532F\u51FA\u9818\u64DA Word' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="receipt-card-body">' +
            '<div class="receipt-title">\u793E\u5718\u6CD5\u4EBA\u53F0\u5317\u5E02\u91AB\u5E2B\u516C\u6703 \u00B7 \u9818\u64DA\uFF08\u5065\u5EB7\u53F0\u7063\u6DF1\u8015\u8A08\u756B\uFF09</div>' +
            '<table class="receipt-table">' +
              '<tr><th>\u9818\u6B3E\u4EBA\u59D3\u540D</th><td>' + escapeHtml(personName) + '</td><th>\u4E8B\u7531\u6216\u6703\u8B70\u540D\u7A31</th><td>' + escapeHtml(latest.eventName || "-") + '</td></tr>' +
              '<tr><th>\u8CBB\u7528\u5225</th><td colspan="3">' + feeHtml + '</td></tr>' +
              '<tr><th>\u91D1\u984D</th><td colspan="3" style="color:var(--color-text-muted);">\uFF08\u5F85\u586B\u5BEB\uFF09</td></tr>' +
              '<tr><th>\u9818\u6B3E\u65B9\u5F0F</th><td colspan="3">' +
                '<span class="fee-tag ' + (latest.payMethod === '\u73FE\u91D1' ? 'fee-tag-active' : 'fee-tag-inactive') + '">\u2610 \u73FE\u91D1</span>' +
                '<span class="fee-tag ' + (latest.payMethod === '\u532F\u6B3E' ? 'fee-tag-active' : 'fee-tag-inactive') + '">\u2610 \u532F\u6B3E</span>' +
                bankHtml +
              '</td></tr>' +
              '<tr><th>\u8EAB\u5206\u8B49\u865F\u78BC</th><td colspan="3"><span class="id-display">' + escapeHtml(latest.idNumber || "-") + '</span></td></tr>' +
              '<tr><th>\u6236\u7C4D\u5730\u5740</th><td colspan="3">' + escapeHtml(latest.address || "-") + '</td></tr>' +
              '<tr><th>\u5C45\u4F4F\u5730\u5740</th><td colspan="3">' + escapeHtml(latest.liveAddress || "-") + '</td></tr>' +
              '<tr><th>\u9023\u7D61\u96FB\u8A71</th><td colspan="3">' + escapeHtml(latest.phone || "-") + '</td></tr>' +
            '</table>' +
          '</div>' +
        '</div>';
      }).join("");

    } catch (e) {
      document.getElementById("receipt-list").innerHTML =
        '<div style="color:red;text-align:center;padding:20px;background:var(--color-surface);border-radius:var(--radius-lg);border:1px solid var(--color-border);">\u8F09\u5165\u5931\u6557\uFF1A' + escapeHtml(e.message) + '</div>';
    }
  }

  // ── Receipt Edit ──
  function startReceiptEdit(card) {
    var personName = card.dataset.name;
    var userId = card.dataset.userId;
    var recIds = card.dataset.recIds;

    // Find current data
    var regUser = cachedReceiptUsers.find(function (u) { return u.name === personName; }) || {};
    var recs = cachedReceiptRecords.filter(function (r) { return r.name === personName; });
    var latest = recs.find(function (r) { return r.idNumber; }) || recs[0] || {};

    // Merge
    var data = {
      eventName: regUser.eventName || latest.eventName || "",
      workDescription: regUser.workDescription || latest.workDescription || "",
      idNumber: regUser.idNumber || latest.idNumber || "",
      feeTypes: regUser.feeTypes || latest.feeTypes || [],
      payMethod: regUser.payMethod || latest.payMethod || "",
      bankName: (regUser.bankInfo || latest.bankInfo || {}).bankName || "",
      bankAccountName: (regUser.bankInfo || latest.bankInfo || {}).accountName || "",
      bankAccount: (regUser.bankInfo || latest.bankInfo || {}).account || "",
      address: regUser.address || latest.address || "",
      liveAddress: regUser.liveAddress || latest.liveAddress || "",
      phone: regUser.phone || latest.phone || ""
    };

    var feeCheckboxes = ALL_FEE_TYPES.map(function (ft) {
      var checked = Array.isArray(data.feeTypes) && data.feeTypes.includes(ft) ? "checked" : "";
      return '<label style="display:inline-flex;align-items:center;gap:4px;margin:4px 8px 4px 0;font-size:13px;"><input type="checkbox" class="edit-fee-type" value="' + escapeHtml(ft) + '" ' + checked + '> ' + escapeHtml(ft) + '</label>';
    }).join("");

    var body = card.querySelector(".receipt-card-body");
    body.innerHTML =
      '<table class="receipt-table">' +
        '<tr><th>\u9818\u6B3E\u4EBA\u59D3\u540D</th><td>' + escapeHtml(personName) + '</td>' +
            '<th>\u4E8B\u7531\u6216\u6703\u8B70\u540D\u7A31</th><td><input type="text" class="edit-eventName" value="' + escapeHtml(data.eventName) + '" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;"></td></tr>' +
        '<tr><th>\u5DE5\u4F5C\u5167\u5BB9</th><td colspan="3"><input type="text" class="edit-workDescription" value="' + escapeHtml(data.workDescription) + '" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;"></td></tr>' +
        '<tr><th>\u8CBB\u7528\u5225</th><td colspan="3">' + feeCheckboxes + '</td></tr>' +
        '<tr><th>\u9818\u6B3E\u65B9\u5F0F</th><td colspan="3">' +
          '<label style="margin-right:16px;"><input type="radio" name="edit-payMethod" value="\u73FE\u91D1"' + (data.payMethod === "\u73FE\u91D1" ? " checked" : "") + '> \u73FE\u91D1</label>' +
          '<label><input type="radio" name="edit-payMethod" value="\u532F\u6B3E"' + (data.payMethod === "\u532F\u6B3E" ? " checked" : "") + '> \u532F\u6B3E</label>' +
          '<div class="edit-bank-fields" style="margin-top:8px;' + (data.payMethod !== "\u532F\u6B3E" ? "display:none;" : "") + '">' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<input type="text" class="edit-bankName" placeholder="\u53D7\u6B3E\u9280\u884C" value="' + escapeHtml(data.bankName) + '" style="flex:1;min-width:120px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;">' +
              '<input type="text" class="edit-bankAccountName" placeholder="\u6236\u540D" value="' + escapeHtml(data.bankAccountName) + '" style="flex:1;min-width:100px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;">' +
              '<input type="text" class="edit-bankAccount" placeholder="\u5E33\u865F" value="' + escapeHtml(data.bankAccount) + '" style="flex:1;min-width:140px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;">' +
            '</div>' +
          '</div>' +
        '</td></tr>' +
        '<tr><th>\u8EAB\u5206\u8B49\u865F\u78BC</th><td colspan="3"><input type="text" class="edit-idNumber" value="' + escapeHtml(data.idNumber) + '" maxlength="10" style="width:200px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;letter-spacing:2px;font-family:monospace;"></td></tr>' +
        '<tr><th>\u6236\u7C4D\u5730\u5740</th><td colspan="3"><input type="text" class="edit-address" value="' + escapeHtml(data.address) + '" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;"></td></tr>' +
        '<tr><th>\u5C45\u4F4F\u5730\u5740</th><td colspan="3"><input type="text" class="edit-liveAddress" value="' + escapeHtml(data.liveAddress) + '" style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;"></td></tr>' +
        '<tr><th>\u9023\u7D61\u96FB\u8A71</th><td colspan="3"><input type="text" class="edit-phone" value="' + escapeHtml(data.phone) + '" style="width:200px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;"></td></tr>' +
      '</table>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
        '<button class="btn btn-sm btn-receipt-cancel" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;">\u53D6\u6D88</button>' +
        '<button class="btn btn-sm btn-receipt-save" style="background:#10b981;color:#fff;font-weight:600;">\u5132\u5B58</button>' +
      '</div>';

    // Toggle bank fields on pay method change
    body.querySelectorAll('input[name="edit-payMethod"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        body.querySelector(".edit-bank-fields").style.display = this.value === "\u532F\u6B3E" ? "" : "none";
      });
    });
  }

  async function saveReceiptEdit(card) {
    var personName = card.dataset.name;
    var userId = card.dataset.userId;
    var recIds = (card.dataset.recIds || "").split(",").filter(Boolean);
    var body = card.querySelector(".receipt-card-body");

    var eventName = body.querySelector(".edit-eventName").value.trim();
    var workDescription = body.querySelector(".edit-workDescription").value.trim();
    var idNumber = body.querySelector(".edit-idNumber").value.trim().toUpperCase();
    var feeTypes = [].slice.call(body.querySelectorAll(".edit-fee-type:checked")).map(function (cb) { return cb.value; });
    var payMethodEl = body.querySelector('input[name="edit-payMethod"]:checked');
    var payMethod = payMethodEl ? payMethodEl.value : "";
    var bankInfo = null;
    if (payMethod === "\u532F\u6B3E") {
      bankInfo = {
        bankName: body.querySelector(".edit-bankName").value.trim(),
        accountName: body.querySelector(".edit-bankAccountName").value.trim(),
        account: body.querySelector(".edit-bankAccount").value.trim()
      };
    }
    var address = body.querySelector(".edit-address").value.trim();
    var liveAddress = body.querySelector(".edit-liveAddress").value.trim();
    var phone = body.querySelector(".edit-phone").value.trim();

    var updatedData = {
      eventName: eventName, workDescription: workDescription,
      idNumber: idNumber, feeTypes: feeTypes,
      payMethod: payMethod, bankInfo: bankInfo,
      address: address, liveAddress: liveAddress, phone: phone
    };

    try {
      // Update user record if exists
      if (userId) {
        await fetch("/users/" + userId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedData)
        });
      }

      // Update all related attendance records
      for (var i = 0; i < recIds.length; i++) {
        await fetch("/records/" + recIds[i], {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedData)
        });
      }

      showToast("\u5DF2\u5132\u5B58 " + personName + " \u7684\u9818\u64DA\u8CC7\u6599", "success");
      loadReceipts();
    } catch (e) {
      showToast("\u5132\u5B58\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  function exportAllReceipts() {
    var params = new URLSearchParams();
    var year  = document.getElementById("receiptFilterYear").value;
    var month = document.getElementById("receiptFilterMonth").value;
    if (year)  params.set("year", year);
    if (month) params.set("month", month);
    window.location.href = "/export-full?" + params.toString();
  }

  // ── Auto refresh (paused during delete confirmation) ──
  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (!confirmingDelete) loadRecords();
    }, 30000);
  }

  // ── Batch selection ──
  function updateBatchBar() {
    var checked = document.querySelectorAll(".row-check:checked");
    var bar = document.getElementById("batch-bar");
    var count = document.getElementById("batch-count");
    if (checked.length > 0) {
      bar.classList.remove("hidden");
      count.textContent = checked.length;
    } else {
      bar.classList.add("hidden");
    }
  }

  // ── 已刪除記錄顯示與還原 ──
  function renderDeletedRecords(deletedRecords) {
    var container = document.getElementById("deleted-section");
    if (!container) return;
    if (deletedRecords.length === 0) {
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");
    var count = container.querySelector(".deleted-count");
    if (count) count.textContent = deletedRecords.length;
    var list = container.querySelector(".deleted-list");
    if (!list) return;
    list.innerHTML = deletedRecords.map(function (r) {
      var dateStr = r.year ? r.year + "/" + r.month + "/" + r.day : "-";
      return '<div class="deleted-item">' +
        '<span><b>' + escapeHtml(r.name || "-") + '</b> — ' + dateStr + ' — ' + escapeHtml(r.course || "-") + '</span>' +
        '<button class="btn-restore" data-id="' + r.id + '">還原</button>' +
        '</div>';
    }).join("");
  }

  async function restoreRecord(id) {
    try {
      var res = await fetch("/records/" + id + "/restore", { method: "POST" });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);
      showToast("記錄已還原", "success");
      loadRecords();
    } catch (e) {
      showToast("還原失敗：" + e.message, "error");
    }
  }

  // ── Inline edit helpers ──
  // 將 ISO 時間轉為台北時間的 datetime-local 格式 (yyyy-MM-ddTHH:mm)
  function isoToDatetimeLocal(isoStr) {
    if (!isoStr) return "";
    var d = new Date(isoStr);
    var taipei = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    var y = taipei.getFullYear();
    var m = String(taipei.getMonth() + 1).padStart(2, "0");
    var day = String(taipei.getDate()).padStart(2, "0");
    var h = String(taipei.getHours()).padStart(2, "0");
    var min = String(taipei.getMinutes()).padStart(2, "0");
    return y + "-" + m + "-" + day + "T" + h + ":" + min;
  }

  // 將 datetime-local 值（台北時間）轉為 ISO 字串
  function datetimeLocalToISO(dtLocal) {
    if (!dtLocal) return "";
    // dtLocal 格式: "2026-04-02T12:00"，視為台北時間
    var parts = dtLocal.split("T");
    var dateParts = parts[0].split("-");
    var timeParts = parts[1].split(":");
    // 建立台北時間的 Date（UTC+8）
    var utc = new Date(Date.UTC(
      parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]),
      parseInt(timeParts[0]) - 8, parseInt(timeParts[1]), 0
    ));
    return utc.toISOString();
  }

  function startEdit(id, row) {
    confirmingDelete = true; // pause auto-refresh
    row.dataset.editing = "true";

    // 找到原始記錄
    var record = cachedRecords.find(function (r) { return r.id === id; });

    // cells index: 0=checkbox, 1=#, 2=name, 3=type, 4=course, 5=date, 6=checkin, 7=checkout,
    //              8=hours, 9=shift, 10=workContent, 11=note, 12=status, 13=action
    var cells = row.querySelectorAll("td");
    var checkinCell = cells[6];
    var checkoutCell = cells[7];
    var hoursCell = row.querySelector(".cell-hours");
    var courseCell = row.querySelector(".cell-course");
    var shiftCell = row.querySelector(".cell-shift");
    var workContentCell = row.querySelector(".cell-workContent");
    var noteCell = row.querySelector(".cell-note");

    var origCheckin = record ? isoToDatetimeLocal(record.checkinTime) : "";
    var origCheckout = record ? isoToDatetimeLocal(record.checkoutTime) : "";
    var origHours = (hoursCell.textContent || "").replace(/\s*\u6642$/, "").trim();
    var origCourse = courseCell.textContent.trim();
    var origShift = shiftCell.textContent.trim();
    var origWorkContent = workContentCell.textContent.trim();
    var origNote = noteCell.textContent.trim();

    if (origCourse === "-") origCourse = "";
    if (origShift === "-") origShift = "";
    if (origWorkContent === "-") origWorkContent = "";
    if (origNote === "-") origNote = "";

    checkinCell.innerHTML = '<input type="datetime-local" class="edit-input" data-field="checkinTime" value="' + origCheckin + '" style="width:155px;font-size:12px">';
    checkoutCell.innerHTML = '<input type="datetime-local" class="edit-input" data-field="checkoutTime" value="' + origCheckout + '" style="width:155px;font-size:12px">';
    hoursCell.innerHTML = '<input type="number" class="edit-input" data-field="hours" value="' + escapeHtml(origHours) + '" step="0.5" style="width:60px" readonly title="\u6642\u6578\u5C07\u81EA\u52D5\u8A08\u7B97">';
    courseCell.innerHTML = '<input type="text" class="edit-input" data-field="course" value="' + escapeHtml(origCourse) + '" style="width:100px">';
    shiftCell.innerHTML = '<input type="text" class="edit-input" data-field="shift" value="' + escapeHtml(origShift) + '" style="width:80px">';
    workContentCell.innerHTML = '<input type="text" class="edit-input" data-field="workContent" value="' + escapeHtml(origWorkContent) + '" style="width:120px">';
    noteCell.innerHTML = '<input type="text" class="edit-input" data-field="note" value="' + escapeHtml(origNote) + '" style="width:120px">';

    // 簽到/簽退時間變更時自動計算時數
    var checkinInput = checkinCell.querySelector("input");
    var checkoutInput = checkoutCell.querySelector("input");
    var hoursInput = hoursCell.querySelector("input");

    function recalcHours() {
      var ci = checkinInput.value;
      var co = checkoutInput.value;
      if (ci && co) {
        var diff = (new Date(co) - new Date(ci)) / 3600000;
        if (diff > 0) {
          hoursInput.value = Math.ceil(diff * 2) / 2;
        }
      }
    }
    checkinInput.addEventListener("change", recalcHours);
    checkoutInput.addEventListener("change", recalcHours);

    var actionCell = row.querySelector(".action-cell");
    actionCell.innerHTML = '<button class="btn-save" data-id="' + id + '">\u5132\u5B58</button> <button class="btn-edit-cancel">\u53D6\u6D88</button>';
  }

  async function saveEdit(id, row) {
    var inputs = row.querySelectorAll(".edit-input");
    var payload = {};
    inputs.forEach(function (inp) {
      var field = inp.dataset.field;
      var val = inp.value.trim();
      if (field === "hours") {
        payload[field] = val ? parseFloat(val) : 0;
      } else if (field === "checkinTime" || field === "checkoutTime") {
        if (val) payload[field] = datetimeLocalToISO(val);
      } else {
        payload[field] = val;
      }
    });

    // 如果簽到時間有更新，同步更新 year/month/day
    if (payload.checkinTime) {
      var taipei = new Date(new Date(payload.checkinTime).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      payload.year = taipei.getFullYear() - 1911;
      payload.month = taipei.getMonth() + 1;
      payload.day = taipei.getDate();
    }

    // 如果簽到簽退都有，自動重算時數
    if (payload.checkinTime && payload.checkoutTime) {
      var diff = (new Date(payload.checkoutTime) - new Date(payload.checkinTime)) / 3600000;
      if (diff > 0) {
        payload.hours = Math.ceil(diff * 2) / 2;
      }
      payload.status = "checked-out";
    }

    try {
      var res = await fetch("/records/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);
      showToast("\u5DF2\u5132\u5B58\u8B8A\u66F4", "success");
      confirmingDelete = false;
      loadRecords();
    } catch (e) {
      showToast("\u5132\u5B58\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  function cancelEdit() {
    confirmingDelete = false;
    loadRecords();
  }

  async function deleteRecord(id) {
    confirmingDelete = true;
    if (!confirm("\u78BA\u5B9A\u8981\u522A\u9664\u6B64\u7B46\u8A18\u9304\uFF1F")) {
      confirmingDelete = false;
      return;
    }
    try {
      var res = await fetch("/records/" + id, { method: "DELETE" });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "delete failed");
      showToast("\u5DF2\u522A\u9664\u8A18\u9304", "success");
      confirmingDelete = false;
      loadRecords();
    } catch (e) {
      showToast("\u522A\u9664\u5931\u6557\uFF1A" + e.message, "error");
      confirmingDelete = false;
    }
  }

  // ═══════════════════════════════════════════
  // Tab 3: User Management
  // ═══════════════════════════════════════════
  var cachedUsers = [];

  async function loadUsers() {
    var nameFilter = (document.getElementById("userFilterName").value || "").trim();
    try {
      var res = await fetch("/users");
      var users = await res.json();
      cachedUsers = users;

      if (nameFilter) {
        users = users.filter(function (u) { return u.name.includes(nameFilter); });
      }

      users.sort(function (a, b) { return new Date(b.registeredAt) - new Date(a.registeredAt); });

      document.getElementById("stat-user-count").textContent = users.length;

      var tbody = document.getElementById("user-tbody");
      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:#999;padding:40px 0">尚無註冊使用者</td></tr>';
        return;
      }

      tbody.innerHTML = users.map(function (u, i) {
        var regDate = u.registeredAt ? new Date(u.registeredAt).toLocaleDateString("zh-TW") : "-";
        var feeTypes = Array.isArray(u.feeTypes) ? u.feeTypes.join("\u3001") : "-";
        var bankStr = "-";
        if (u.payMethod === "\u532F\u6B3E" && u.bankInfo) {
          bankStr = (u.bankInfo.bankName || "") + " / " + (u.bankInfo.accountName || "") + " / " + (u.bankInfo.account || "");
        }
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + (u.name || "-") + '</td>' +
          '<td>' + (u.idNumber || "-") + '</td>' +
          '<td>' + (u.phone || "-") + '</td>' +
          '<td style="max-width:150px;">' + (u.eventName || "-") + '</td>' +
          '<td style="max-width:150px;">' + (u.workDescription || "-") + '</td>' +
          '<td style="max-width:120px;">' + feeTypes + '</td>' +
          '<td>' + (u.payMethod || "-") + '</td>' +
          '<td style="max-width:200px;font-size:12px;">' + bankStr + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (u.address || "-") + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (u.liveAddress || "-") + '</td>' +
          '<td>' + regDate + '</td>' +
          '<td><button class="btn btn-danger-sm btn-user-delete" data-id="' + u.id + '">刪除</button></td>' +
          '</tr>';
      }).join("");
    } catch (e) {
      showToast("\u8F09\u5165\u4F7F\u7528\u8005\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  async function deleteUser(id) {
    if (!confirm("\u78BA\u5B9A\u8981\u522A\u9664\u6B64\u4F7F\u7528\u8005\uFF1F\u522A\u9664\u5F8C\u8A72\u4F7F\u7528\u8005\u5C07\u7121\u6CD5\u767B\u5165\u3002")) return;
    try {
      var res = await fetch("/users/" + id, { method: "DELETE" });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "delete failed");
      showToast("\u5DF2\u522A\u9664\u4F7F\u7528\u8005", "success");
      loadUsers();
    } catch (e) {
      showToast("\u522A\u9664\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  // ═══════════════════════════════════════════
  // Tab 4: 臨時人員費領取單
  // ═══════════════════════════════════════════
  async function loadCustomExport() {
    try {
      var res = await fetch("/users");
      var users = await res.json();
      users.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });

      var tbody = document.getElementById("custom-export-tbody");
      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:40px 0">\u5C1A\u7121\u8A3B\u518A\u4F7F\u7528\u8005</td></tr>';
        return;
      }

      tbody.innerHTML = users.map(function (u) {
        return '<tr>' +
          '<td style="text-align:center;"><input type="checkbox" class="custom-check" data-name="' + escapeHtml(u.name || "") + '"></td>' +
          '<td>' + escapeHtml(u.name || "-") + '</td>' +
          '<td>\u81E8\u6642\u4EBA\u54E1</td>' +
          '<td><input type="number" class="custom-individual-amount" data-name="' + escapeHtml(u.name || "") + '" placeholder="\u91D1\u984D" style="width:120px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;"></td>' +
          '</tr>';
      }).join("");

      updateCustomSelectedCount();
    } catch (e) {
      showToast("\u8F09\u5165\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  function updateCustomSelectedCount() {
    var checked = document.querySelectorAll(".custom-check:checked").length;
    document.getElementById("custom-selected-count").textContent = "\u5DF2\u9078 " + checked + " \u4EBA";
  }

  function applyAmountToSelected() {
    var amount = document.getElementById("custom-amount").value;
    if (!amount) { showToast("\u8ACB\u5148\u8F38\u5165\u7D71\u4E00\u91D1\u984D", "warning"); return; }
    document.querySelectorAll(".custom-check:checked").forEach(function (cb) {
      var name = cb.dataset.name;
      var input = document.querySelector('.custom-individual-amount[data-name="' + name + '"]');
      if (input) input.value = amount;
    });
    showToast("\u5DF2\u5957\u7528\u91D1\u984D " + amount + " \u5143\u5230 " + document.querySelectorAll(".custom-check:checked").length + " \u4EBA", "success");
  }

  function doCustomExport() {
    var reason = document.getElementById("custom-reason").value.trim();
    var year = document.getElementById("custom-year").value.trim();
    var month = document.getElementById("custom-month").value.trim();
    var day = document.getElementById("custom-day").value.trim();

    if (!reason) { showToast("\u8ACB\u586B\u5BEB\u4E8B\u7531", "warning"); return; }
    if (!year || !month || !day) { showToast("\u8ACB\u586B\u5BEB\u65E5\u671F", "warning"); return; }

    var selected = [];
    document.querySelectorAll(".custom-check:checked").forEach(function (cb) {
      var name = cb.dataset.name;
      var amountInput = document.querySelector('.custom-individual-amount[data-name="' + name + '"]');
      var amount = amountInput ? parseInt(amountInput.value) || 0 : 0;
      if (amount > 0) {
        selected.push({ name: name, amount: amount });
      }
    });

    if (selected.length === 0) { showToast("\u8ACB\u52FE\u9078\u4EBA\u54E1\u4E26\u586B\u5BEB\u91D1\u984D", "warning"); return; }

    var dateStr = year + "\u5E74" + month.padStart(2, "0") + "\u6708" + day.padStart(2, "0") + "\u65E5";
    var totalAmount = selected.reduce(function (s, p) { return s + p.amount; }, 0);

    // Word XML styles
    var F = 'font-family:DFKai-SB,\u6A19\u6977\u9AD4;';
    var B1 = 'border:1px solid #000;';
    var P1 = 'padding:4px 6px;font-size:11pt;' + F;
    var TC = B1 + P1 + 'text-align:center;vertical-align:middle;';
    var TL = B1 + P1 + 'vertical-align:middle;';

    // Build person rows - reason spans all rows as one merged cell
    var totalRows = selected.length;
    var allRows = totalRows;

    var rows = selected.map(function (p, idx) {
      var amountStr = p.amount.toLocaleString() + " \u5143";
      var reasonCell = '';
      if (idx === 0) {
        reasonCell = '<td style="' + TL + 'font-size:11pt;" rowspan="' + allRows + '">' + escapeHtml(reason) + '</td>';
      }
      return '<tr style="height:60pt;">' +
        '<td style="' + TC + '">\u81E8\u6642\u4EBA\u54E1</td>' +
        '<td style="' + TC + '">' + escapeHtml(p.name) + '</td>' +
        reasonCell +
        '<td style="' + TC + '">' + amountStr + '</td>' +
        '<td style="' + TC + '"> </td>' +
      '</tr>';
    }).join("");


    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="UTF-8">' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>' +
      '@page Section1 { size:A4; margin:0.5cm 2cm 1cm 2cm; }' +
      'body { ' + F + ' font-size:12pt; margin:0; }' +
      'div.Section1 { page:Section1; }' +
      'table { border-collapse:collapse; }' +
      '</style></head><body><div class="Section1">' +
      '<p align="center" style="' + F + 'font-size:18pt;font-weight:bold;margin:0 0 4pt 0;">\u53F0\u5317\u5E02\u91AB\u5E2B\u516C\u6703</p>' +
      '<p align="center" style="' + F + 'font-size:13pt;font-weight:bold;margin:0 0 4pt 0;">\u5065\u5EB7\u53F0\u7063\u6DF1\u8015\u8A08\u756B \u81FA\u5317\u5E02\u6162\u6027\u75C5\u9632\u6CBB\u5168\u4EBA\u5065\u5EB7\u667A\u6167\u6574\u5408\u7167\u8B77\u8A08\u756B</p>' +
      '<p align="center" style="' + F + 'font-size:16pt;font-weight:bold;margin:0 0 8pt 0;">\u81E8\u6642\u4EBA\u54E1\u8CBB\u7533\u8ACB\u55AE</p>' +
      '<p align="right" style="' + F + 'font-size:12pt;margin:0 0 4pt 0;">' + dateStr + '</p>' +
      '<table border="1" cellpadding="4" cellspacing="0" width="100%" style="border-collapse:collapse;' + F + 'font-size:11pt;">' +
      '<tr>' +
        '<td style="' + TC + 'font-weight:bold;" width="10%">\u8077\u0020\u0020\u52D9</td>' +
        '<td style="' + TC + 'font-weight:bold;" width="8%">\u59D3\u540D</td>' +
        '<td style="' + TC + 'font-weight:bold;">\u4E8B\u0020\u0020\u7531</td>' +
        '<td style="' + TC + 'font-weight:bold;" width="10%">\u91D1\u0020\u0020\u984D</td>' +
        '<td style="' + TC + 'font-weight:bold;" width="8%">\u7C3D\u0020\u0020\u7AE0</td>' +
      '</tr>' +
      rows +
      '<tr style="height:24pt;">' +
        '<td style="' + TC + 'font-weight:bold;" colspan="3">\u5408\u0020\u0020\u8A08</td>' +
        '<td style="' + TC + '">' + totalAmount.toLocaleString() + ' \u5143</td>' +
        '<td style="' + TC + '"> </td>' +
      '</tr>' +
      '</table>' +
      '<br/>' +
      '<table border="1" cellpadding="4" cellspacing="0" width="100%" style="border-collapse:collapse;' + F + 'font-size:11pt;">' +
      '<tr>' +
        '<td style="' + TL + '" colspan="7">\u6C7A\u884C</td>' +
      '</tr>' +
      '<tr>' +
        '<td style="' + TC + '">\u7406\u4E8B\u9577\uFF0D\u8A08\u756B\u4E3B\u6301\u4EBA</td>' +
        '<td style="' + TC + '">\u516C\u6703\u57F7\u884C\u9577</td>' +
        '<td style="' + TC + '">\u7E3D\u5E79\u4E8B</td>' +
        '<td style="' + TC + '">\u8A08\u756B\u57F7\u884C\u9577</td>' +
        '<td style="' + TC + '">\u7D44\u9577</td>' +
        '<td style="' + TC + '">\u51FA\u7D0D</td>' +
        '<td style="' + TC + '">\u627F\u8FA6\u4EBA</td>' +
      '</tr>' +
      '<tr style="height:50pt;">' +
        '<td style="' + TC + '"> </td><td style="' + TC + '"> </td><td style="' + TC + '"> </td>' +
        '<td style="' + TC + '"> </td><td style="' + TC + '"> </td><td style="' + TC + '"> </td>' +
        '<td style="' + TC + '"> </td>' +
      '</tr>' +
      '</table>' +
      '</div></body></html>';

    // Download as .doc
    var blob = new Blob(["\uFEFF" + html], { type: "application/msword;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "\u81E8\u6642\u4EBA\u54E1\u8CBB\u7533\u8ACB\u55AE_" + year + month.padStart(2, "0") + day.padStart(2, "0") + ".doc";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("\u5DF2\u532F\u51FA\u7533\u8ACB\u55AE", "success");
  }

  async function doCustomExportAttendance() {
    var reason = document.getElementById("custom-reason").value.trim();
    var year = document.getElementById("custom-year").value.trim();
    var month = document.getElementById("custom-month").value.trim();
    var day = document.getElementById("custom-day").value.trim();

    if (!reason) { showToast("\u8ACB\u586B\u5BEB\u4E8B\u7531", "warning"); return; }
    if (!year || !month || !day) { showToast("\u8ACB\u586B\u5BEB\u65E5\u671F", "warning"); return; }

    var selected = [];
    document.querySelectorAll(".custom-check:checked").forEach(function (cb) {
      selected.push(cb.dataset.name);
    });

    if (selected.length === 0) { showToast("\u8ACB\u52FE\u9078\u4EBA\u54E1", "warning"); return; }

    // Fetch attendance records to fill in times
    var allRecords = [];
    try {
      var res = await fetch("/records");
      allRecords = await res.json();
      allRecords = allRecords.filter(function (r) { return !r.attendanceDeleted && r.status === "checked-out"; });
    } catch (e) {
      console.error("Failed to fetch records for attendance sheet:", e);
    }

    var dateStr = year + "\u5E74" + month.padStart(2, "0") + "\u6708" + day.padStart(2, "0") + "\u65E5";
    var shortDate = month.padStart(2, "0") + "/" + day.padStart(2, "0");
    var iYear = parseInt(year);
    var iMonth = parseInt(month);
    var iDay = parseInt(day);

    // Word XML styles
    var F = 'font-family:DFKai-SB,\u6A19\u6977\u9AD4;';
    var B1 = 'border:1px solid #000;';
    var P1 = 'padding:4px 6px;font-size:12pt;' + F;
    var TC = B1 + P1 + 'text-align:center;vertical-align:middle;';
    var TL = B1 + P1 + 'vertical-align:middle;';
    var TH = B1 + P1 + 'text-align:center;vertical-align:middle;font-weight:bold;';

    var pages = selected.map(function (name) {
      // Find matching records for this person on this date
      var personRecords = allRecords.filter(function (r) {
        return r.name === name && r.year === iYear && r.month === iMonth && r.day === iDay;
      });
      personRecords.sort(function (a, b) { return new Date(a.checkinTime) - new Date(b.checkinTime); });

      // Build attendance time rows
      var timeRows = '';
      if (personRecords.length > 0) {
        personRecords.forEach(function (rec) {
          var ciTime = rec.checkinTime ? new Date(rec.checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : '';
          var coTime = rec.checkoutTime ? new Date(rec.checkoutTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : '';
          var hrs = rec.hours != null ? rec.hours + " \u6642" : '';
          timeRows += '<tr style="height:30pt;">' +
            '<td style="' + TC + '">' + shortDate + '</td>' +
            '<td style="' + TC + '">' + ciTime + '</td>' +
            '<td style="' + TC + '">' + escapeHtml(name) + '</td>' +
            '<td style="' + TC + '">' + coTime + '</td>' +
            '<td style="' + TC + '">' + escapeHtml(name) + '</td>' +
            '<td style="' + TC + '">' + hrs + '</td>' +
          '</tr>';
        });
      } else {
        timeRows = '<tr style="height:30pt;">' +
          '<td style="' + TC + '">' + shortDate + '</td>' +
          '<td style="' + TC + '"> </td>' +
          '<td style="' + TC + '"> </td>' +
          '<td style="' + TC + '"> </td>' +
          '<td style="' + TC + '"> </td>' +
          '<td style="' + TC + '"> </td>' +
        '</tr>';
      }

      return '<p align="center" style="' + F + 'font-size:16pt;font-weight:bold;margin:0 0 6pt 0;">\u53F0\u5317\u5E02\u91AB\u5E2B\u516C\u6703 \u5065\u5EB7\u53F0\u7063\u6DF1\u8015\u8A08\u756B</p>' +
        '<p align="center" style="' + F + 'font-size:14pt;font-weight:bold;margin:0 0 6pt 0;">\u81FA\u5317\u5E02\u6162\u6027\u75C5\u9632\u6CBB\u5168\u4EBA\u5065\u5EB7\u667A\u6167\u6574\u5408\u7167\u8B77\u8A08\u756B</p>' +
        '<p align="center" style="' + F + 'font-size:18pt;font-weight:bold;margin:0 0 10pt 0;">\u81E8\u6642\u4EBA\u54E1\u51FA\u52E4\u8A18\u9304\u8207\u5DE5\u4F5C\u5167\u5BB9\u8AAA\u660E</p>' +
        '<table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse:collapse;' + F + 'font-size:12pt;">' +
        '<tr>' +
          '<td style="' + TH + '" width="20%">\u59D3\u0020\u0020\u540D</td>' +
          '<td style="' + TH + '" colspan="5">\u6D3B\u52D5\u540D\u7A31 / \u5DE5\u4F5C\u5167\u5BB9</td>' +
        '</tr>' +
        '<tr style="height:30pt;">' +
          '<td style="' + TC + '">' + escapeHtml(name) + '</td>' +
          '<td style="' + TL + '" colspan="5">' + dateStr + '\u8655\u65B9\u5151\u63DB\u65E5\u81E8\u6642\u4EBA\u54E1</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="' + TL + '" colspan="6">' + escapeHtml(reason) + '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="' + TH + '" rowspan="2">\u65E5\u671F</td>' +
          '<td style="' + TH + '" colspan="2">\u4E0A\u73ED\u7C3D\u5230</td>' +
          '<td style="' + TH + '" colspan="2">\u4E0B\u73ED\u7C3D\u9000</td>' +
          '<td style="' + TH + '" rowspan="2">\u5DE5\u4F5C\u6642\u6578</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="' + TH + '">\u6642\u9593</td>' +
          '<td style="' + TH + '">\u59D3\u540D</td>' +
          '<td style="' + TH + '">\u6642\u9593</td>' +
          '<td style="' + TH + '">\u59D3\u540D</td>' +
        '</tr>' +
        timeRows +
        '</table>';
    });

    var body = pages.join('\n<br clear="all" style="page-break-before:always;" />\n');

    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="UTF-8">' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>' +
      '@page Section1 { size:A4; margin:2cm 2cm 2cm 2cm; }' +
      'body { ' + F + ' font-size:12pt; margin:0; }' +
      'div.Section1 { page:Section1; }' +
      'table { border-collapse:collapse; }' +
      '</style></head><body><div class="Section1">' + body + '</div></body></html>';

    var blob = new Blob(["\uFEFF" + html], { type: "application/msword;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "\u5DE5\u4F5C\u8AAA\u660E\u53CA\u7C3D\u5230\u7C3F_" + year + month.padStart(2, "0") + day.padStart(2, "0") + ".doc";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("\u5DF2\u532F\u51FA\u5DE5\u4F5C\u8AAA\u660E\u53CA\u7C3D\u5230\u7C3F", "success");
  }

  // ── Wire up event listeners ──
  document.addEventListener("DOMContentLoaded", function () {
    // Tab buttons
    var TAB_NAMES = ["attendance", "receipt", "users", "custom-export"];
    var PROTECTED_TABS = ["receipt", "users"];

    function promptAdminPassword() {
      return new Promise(function (resolve) {
        var pw = prompt("\u8ACB\u8F38\u5165\u7BA1\u7406\u5BC6\u78BC\uFF1A");
        if (!pw) { resolve(false); return; }
        fetch("/admin/verify-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw })
        })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          if (r.ok && r.data.ok) {
            sessionStorage.setItem("adminAuth", "true");
            resolve(true);
          } else {
            showToast("\u5BC6\u78BC\u932F\u8AA4", "error");
            resolve(false);
          }
        })
        .catch(function () { showToast("\u9A57\u8B49\u5931\u6557", "error"); resolve(false); });
      });
    }

    document.querySelectorAll(".tab-btn").forEach(function (btn, idx) {
      btn.addEventListener("click", async function () {
        var tabName = TAB_NAMES[idx];
        if (PROTECTED_TABS.includes(tabName) && !sessionStorage.getItem("adminAuth")) {
          var ok = await promptAdminPassword();
          if (!ok) return;
        }
        switchTab(tabName);
      });
    });

    // Attendance filter buttons
    var searchBtn = document.getElementById("btn-search");
    if (searchBtn) searchBtn.addEventListener("click", function () { currentPage = 1; loadRecords(); });

    // Pagination buttons
    var prevBtn = document.getElementById("btn-page-prev");
    var nextBtn = document.getElementById("btn-page-next");
    if (prevBtn) prevBtn.addEventListener("click", function () { if (currentPage > 1) loadRecords(currentPage - 1); });
    if (nextBtn) nextBtn.addEventListener("click", function () { loadRecords(currentPage + 1); });

    var exportBtn = document.getElementById("btn-export-excel");
    if (exportBtn) exportBtn.addEventListener("click", function () { exportWithLoading(exportBtn, exportExcel); });

    // Receipt filter buttons
    var receiptSearchBtn = document.getElementById("btn-receipt-search");
    if (receiptSearchBtn) receiptSearchBtn.addEventListener("click", loadReceipts);

    var exportAllBtn = document.getElementById("btn-export-all-receipts");
    if (exportAllBtn) exportAllBtn.addEventListener("click", function () { exportWithLoading(exportAllBtn, exportAllReceipts); });

    // Delegated click for receipt card actions (edit, save, cancel, export)
    document.addEventListener("click", function (e) {
      var editBtn = e.target.closest(".btn-receipt-edit");
      if (editBtn) {
        var card = editBtn.closest(".receipt-card");
        startReceiptEdit(card);
        return;
      }

      var saveBtn = e.target.closest(".btn-receipt-save");
      if (saveBtn) {
        var card = saveBtn.closest(".receipt-card");
        saveReceiptEdit(card);
        return;
      }

      var cancelBtn = e.target.closest(".btn-receipt-cancel");
      if (cancelBtn) {
        loadReceipts();
        return;
      }

      var target = e.target.closest('[data-action="export-receipt"]');
      if (target) {
        exportWithLoading(target, function () {
          window.location.href = "/export-full?" + target.getAttribute("data-params");
        });
      }
    });

    // ── Select all checkbox ──
    document.getElementById("select-all").addEventListener("change", function () {
      var checked = this.checked;
      document.querySelectorAll(".row-check").forEach(function (cb) { cb.checked = checked; });
      updateBatchBar();
    });

    // ── Delegate for individual checkboxes ──
    document.addEventListener("change", function (e) {
      if (e.target.classList.contains("row-check")) updateBatchBar();
    });

    // ── Batch delete ──
    document.getElementById("btn-batch-delete").addEventListener("click", async function () {
      var ids = [].slice.call(document.querySelectorAll(".row-check:checked")).map(function (cb) { return cb.dataset.id; });
      if (ids.length === 0) return;
      if (!confirm("\u78BA\u5B9A\u8981\u522A\u9664 " + ids.length + " \u7B46\u8A18\u9304\uFF1F")) return;
      try {
        var res = await fetch("/records/batch-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ids })
        });
        var data = await res.json();
        if (!data.ok) throw new Error(data.error);
        showToast("\u5DF2\u522A\u9664 " + ids.length + " \u7B46\u8A18\u9304", "success");
        loadRecords();
      } catch (e) {
        showToast("\u6279\u91CF\u522A\u9664\u5931\u6557\uFF1A" + e.message, "error");
      }
    });

    // ── Delegated clicks for edit, save, cancel, delete buttons ──
    document.addEventListener("click", function (e) {
      var editBtn = e.target.closest(".btn-edit");
      if (editBtn) {
        var id = editBtn.dataset.id;
        var row = editBtn.closest("tr");
        startEdit(id, row);
        return;
      }

      var saveBtn = e.target.closest(".btn-save");
      if (saveBtn) {
        var id = saveBtn.dataset.id;
        var row = saveBtn.closest("tr");
        saveEdit(id, row);
        return;
      }

      var cancelBtn = e.target.closest(".btn-edit-cancel");
      if (cancelBtn) {
        cancelEdit();
        return;
      }

      var deleteBtn = e.target.closest(".btn-row-delete");
      if (deleteBtn) {
        var id = deleteBtn.dataset.id;
        deleteRecord(id);
        return;
      }

      var restoreBtn = e.target.closest(".btn-restore");
      if (restoreBtn) {
        restoreRecord(restoreBtn.dataset.id);
        return;
      }
    });

    // User management
    var userSearchBtn = document.getElementById("btn-user-search");
    if (userSearchBtn) userSearchBtn.addEventListener("click", loadUsers);

    document.addEventListener("click", function (e) {
      var userDelBtn = e.target.closest(".btn-user-delete");
      if (userDelBtn) {
        deleteUser(userDelBtn.dataset.id);
        return;
      }
    });

    // Custom export tab
    var applyAmountBtn = document.getElementById("btn-apply-amount");
    if (applyAmountBtn) applyAmountBtn.addEventListener("click", applyAmountToSelected);

    var customExportBtn = document.getElementById("btn-custom-export");
    if (customExportBtn) customExportBtn.addEventListener("click", async function () {
      var originalText = customExportBtn.textContent;
      customExportBtn.disabled = true;
      customExportBtn.textContent = "\u532F\u51FA\u4E2D...";
      customExportBtn.style.opacity = "0.6";
      try { await doCustomExport(); } finally {
        customExportBtn.disabled = false;
        customExportBtn.textContent = originalText;
        customExportBtn.style.opacity = "";
      }
    });

    var customExportAttBtn = document.getElementById("btn-custom-export-attendance");
    if (customExportAttBtn) customExportAttBtn.addEventListener("click", async function () {
      var originalText = customExportAttBtn.textContent;
      customExportAttBtn.disabled = true;
      customExportAttBtn.textContent = "\u532F\u51FA\u4E2D...";
      customExportAttBtn.style.opacity = "0.6";
      try { await doCustomExportAttendance(); } finally {
        customExportAttBtn.disabled = false;
        customExportAttBtn.textContent = originalText;
        customExportAttBtn.style.opacity = "";
      }
    });

    var customSelectAll = document.getElementById("custom-select-all");
    if (customSelectAll) customSelectAll.addEventListener("change", function () {
      var checked = this.checked;
      document.querySelectorAll(".custom-check").forEach(function (cb) {
        var row = cb.closest("tr");
        if (row && row.style.display !== "none") cb.checked = checked;
      });
      updateCustomSelectedCount();
    });

    document.addEventListener("change", function (e) {
      if (e.target.classList.contains("custom-check")) updateCustomSelectedCount();
    });

    var customSearchName = document.getElementById("custom-search-name");
    if (customSearchName) customSearchName.addEventListener("input", function () {
      var keyword = this.value.trim().toLowerCase();
      document.querySelectorAll("#custom-export-tbody tr").forEach(function (row) {
        var name = (row.querySelector("td:nth-child(2)") || {}).textContent || "";
        row.style.display = name.toLowerCase().includes(keyword) ? "" : "none";
      });
    });

    // Initial load
    loadRecords();
    startAutoRefresh();
  });

})();

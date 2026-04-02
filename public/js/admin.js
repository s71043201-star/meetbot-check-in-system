/* ============================================
   admin.js  --  Admin Dashboard Logic
   ============================================ */
(function () {
  "use strict";

  var ALL_FEE_TYPES = ["\u7A3F\u8CBB", "\u5BE9\u67E5\u8CBB", "\u8B1B\u5EA7\u9418\u9EDE\u8CBB", "\u81E8\u6642\u4EBA\u54E1\u8CBB", "\u51FA\u5E2D\u8CBB", "\u4EA4\u901A\u5DEE\u65C5\u8CBB", "\u5176\u4ED6"];
  var cachedRecords = [];
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

  // ── Tabs ──
  function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-content").forEach(function (c) { c.classList.remove("active"); });

    if (tab === "attendance") {
      document.querySelectorAll(".tab-btn")[0].classList.add("active");
      document.getElementById("tab-attendance").classList.add("active");
    } else {
      document.querySelectorAll(".tab-btn")[1].classList.add("active");
      document.getElementById("tab-receipt").classList.add("active");
      loadReceipts();
    }
  }

  // ═══════════════════════════════════════════
  // Tab 1: Attendance Records
  // ═══════════════════════════════════════════
  async function loadRecords() {
    var year  = document.getElementById("filterYear").value;
    var month = document.getElementById("filterMonth").value;
    var name  = document.getElementById("filterName").value.trim();

    try {
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

      var tbody = document.getElementById("tbody");
      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" class="empty">\u67E5\u7121\u8A18\u9304</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(function (r, i) {
        var dateStr   = r.year ? r.year + "/" + r.month + "/" + r.day : "-";
        var content   = Array.isArray(r.workContent) ? r.workContent.join("\u3001") : "-";
        var typeLabel = r.checkinType === "prescription" ? "\u8655\u65B9\u65E5" : "\u4E00\u822C";
        var courseStr = Array.isArray(r.courses) && r.courses.length > 0
          ? r.courses.join("\u3001") : (r.course || "-");
        var tag = r.status === "checked-out"
          ? '<span class="tag tag-done">\u5B8C\u6210</span>'
          : '<span class="tag tag-in">\u7C3D\u5230\u4E2D</span>';
        return '<tr data-id="' + r.id + '">' +
          '<td><input type="checkbox" class="row-check" data-id="' + r.id + '"></td>' +
          '<td>' + (i + 1) + '</td>' +
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
      var res = await fetch("/records");
      var records = await res.json();

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

      var container = document.getElementById("receipt-list");

      if (Object.keys(grouped).length === 0) {
        container.innerHTML = '<div class="empty" style="background:var(--color-surface);border-radius:var(--radius-lg);padding:32px;box-shadow:var(--shadow-sm);border:1px solid var(--color-border);">\u67E5\u7121\u9818\u64DA\u8CC7\u6599</div>';
        return;
      }

      container.innerHTML = Object.entries(grouped).map(function (entry) {
        var personName = entry[0];
        var recs = entry[1];
        // Get latest record with receipt data
        var latest = recs.find(function (r) { return r.idNumber; }) || recs[0];
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

        return '<div class="receipt-card">' +
          '<div class="receipt-card-header">' +
            '<h3>' + escapeHtml(personName) + '\uFF08\u5171 ' + recs.length + ' \u7B46\uFF0C' + (Math.round(totalHours * 10) / 10) + ' \u5C0F\u6642\uFF09</h3>' +
            '<button class="btn btn-outline btn-sm" style="color:#fff;border-color:#fff;" data-action="export-receipt" data-params="' + escapeHtml(qp.toString()) + '">' +
              '\u532F\u51FA\u9818\u64DA Word' +
            '</button>' +
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
              '<tr><th>\u8EAB\u5206\u8B49\u865F\u78BC</th><td colspan="3"><span class="id-display">' + maskId(latest.idNumber) + '</span></td></tr>' +
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
  function startEdit(id, row) {
    confirmingDelete = true; // pause auto-refresh
    row.dataset.editing = "true";
    var cells = row.querySelectorAll("td");

    // cells index: 0=checkbox, 1=#, 2=name, 3=type, 4=course, 5=date, 6=checkin, 7=checkout,
    //              8=hours, 9=shift, 10=workContent, 11=note, 12=status, 13=action
    var hoursCell = row.querySelector(".cell-hours");
    var courseCell = row.querySelector(".cell-course");
    var shiftCell = row.querySelector(".cell-shift");
    var workContentCell = row.querySelector(".cell-workContent");
    var noteCell = row.querySelector(".cell-note");

    var origHours = (hoursCell.textContent || "").replace(/\s*\u6642$/, "").trim();
    var origCourse = courseCell.textContent.trim();
    var origShift = shiftCell.textContent.trim();
    var origWorkContent = workContentCell.textContent.trim();
    var origNote = noteCell.textContent.trim();

    if (origCourse === "-") origCourse = "";
    if (origShift === "-") origShift = "";
    if (origWorkContent === "-") origWorkContent = "";
    if (origNote === "-") origNote = "";

    hoursCell.innerHTML = '<input type="number" class="edit-input" data-field="hours" value="' + escapeHtml(origHours) + '" step="0.5" style="width:60px">';
    courseCell.innerHTML = '<input type="text" class="edit-input" data-field="course" value="' + escapeHtml(origCourse) + '" style="width:100px">';
    shiftCell.innerHTML = '<input type="text" class="edit-input" data-field="shift" value="' + escapeHtml(origShift) + '" style="width:80px">';
    workContentCell.innerHTML = '<input type="text" class="edit-input" data-field="workContent" value="' + escapeHtml(origWorkContent) + '" style="width:120px">';
    noteCell.innerHTML = '<input type="text" class="edit-input" data-field="note" value="' + escapeHtml(origNote) + '" style="width:120px">';

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
      } else {
        payload[field] = val;
      }
    });

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

  // ── Wire up event listeners ──
  document.addEventListener("DOMContentLoaded", function () {
    // Tab buttons
    document.querySelectorAll(".tab-btn").forEach(function (btn, idx) {
      btn.addEventListener("click", function () {
        switchTab(idx === 0 ? "attendance" : "receipt");
      });
    });

    // Attendance filter buttons
    var searchBtn = document.getElementById("btn-search");
    if (searchBtn) searchBtn.addEventListener("click", loadRecords);

    var exportBtn = document.getElementById("btn-export-excel");
    if (exportBtn) exportBtn.addEventListener("click", exportExcel);

    // Receipt filter buttons
    var receiptSearchBtn = document.getElementById("btn-receipt-search");
    if (receiptSearchBtn) receiptSearchBtn.addEventListener("click", loadReceipts);

    var exportAllBtn = document.getElementById("btn-export-all-receipts");
    if (exportAllBtn) exportAllBtn.addEventListener("click", exportAllReceipts);

    // Delegated click for export-receipt buttons inside receipt cards
    document.addEventListener("click", function (e) {
      var target = e.target.closest('[data-action="export-receipt"]');
      if (target) {
        window.location.href = "/export-full?" + target.getAttribute("data-params");
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

    // Initial load
    loadRecords();
    startAutoRefresh();
  });

})();

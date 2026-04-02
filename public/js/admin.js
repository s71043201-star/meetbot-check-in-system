(function () {
  "use strict";
  const { escapeHtml, formatTime, showToast } = window.SharedUtils;

  // ── DOM 參考 ──
  const els = {
    filterYear:  document.getElementById("filterYear"),
    filterMonth: document.getElementById("filterMonth"),
    filterName:  document.getElementById("filterName"),
    btnSearch:   document.getElementById("btn-search"),
    btnExport:   document.getElementById("btn-export"),
    tbody:       document.getElementById("tbody"),
    statCount:   document.getElementById("stat-count"),
    statHours:   document.getElementById("stat-hours"),
    statPeople:  document.getElementById("stat-people"),
    statActive:  document.getElementById("stat-active"),
    lastUpdate:  document.getElementById("last-update"),
  };

  // ── 相容舊資料：統一轉為 courses 陣列格式 ──
  function normalizeCourses(r) {
    if (r.courses && Array.isArray(r.courses)) return r.courses;
    return [{
      course: r.course || "-",
      courseType: r.courseType || "-",
      teacher: r.teacher || "-",
      plannedHours: r.plannedHours || "-",
      registeredCount: r.registeredCount,
      actualCount: r.actualCount,
      walkInCount: r.walkInCount,
      summary: r.summary || "-",
    }];
  }

  // ── 載入記錄 ──
  async function loadRecords() {
    if (confirmingDelete) return;
    const year  = els.filterYear.value;
    const month = els.filterMonth.value;
    const name  = els.filterName.value.trim();

    try {
      const res = await fetch("/records");
      let all = await res.json();

      let records = all;
      if (year)  records = records.filter(r => r.year  === parseInt(year));
      if (month) records = records.filter(r => r.month === parseInt(month));
      if (name)  records = records.filter(r => r.name && r.name.includes(name));
      records.sort((a, b) => new Date(b.checkinTime) - new Date(a.checkinTime));

      const done   = records.filter(r => r.status === "checked-out");
      const active = records.filter(r => r.status === "checked-in");
      const total  = done.reduce((s, r) => s + (r.hours || 0), 0);
      const people = new Set(records.map(r => r.name)).size;

      els.statCount.textContent  = records.length;
      els.statHours.textContent  = Math.round(total * 10) / 10;
      els.statPeople.textContent = people;
      els.statActive.textContent = active.length;
      els.lastUpdate.textContent =
        "更新：" + new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

      if (records.length === 0) {
        els.tbody.innerHTML = '<tr><td colspan="15" class="empty">查無記錄</td></tr>';
        return;
      }

      els.tbody.innerHTML = records.map((r, i) => {
        const dateStr = r.year ? `${r.year}/${r.month}/${r.day}` : "-";
        const courses = normalizeCourses(r);
        const firstCourse = courses[0];
        const hasMultiple = courses.length > 1;

        const courseDisplay = hasMultiple
          ? `${escapeHtml(firstCourse.course)} <button class="courses-toggle" data-id="${r.id}">(+${courses.length - 1})</button>`
          : escapeHtml(firstCourse.course);

        const tag = r.status === "checked-out"
          ? '<span class="tag tag-done">已完成</span>'
          : '<span class="tag tag-in">簽到中</span>';

        const totalReg = courses.reduce((s, c) => s + (parseInt(c.registeredCount) || 0), 0);
        const totalAct = courses.reduce((s, c) => s + (parseInt(c.actualCount) || 0), 0);
        const totalWalk = courses.reduce((s, c) => s + (parseInt(c.walkInCount) || 0), 0);

        let mainRow = `<tr data-record-id="${r.id}">
          <td>${i + 1}</td>
          <td><b>${escapeHtml(r.name || "-")}</b></td>
          <td style="text-align:left;max-width:160px">${courseDisplay}</td>
          <td>${escapeHtml(firstCourse.courseType || "-")}</td>
          <td style="white-space:nowrap">${dateStr}</td>
          <td>${formatTime(r.checkinTime)}</td>
          <td>${formatTime(r.checkoutTime)}</td>
          <td>${r.hours != null ? r.hours + " 時" : "-"}</td>
          <td>${escapeHtml(firstCourse.teacher || "-")}</td>
          <td>${totalReg || "-"}</td>
          <td>${totalAct || "-"}</td>
          <td>${totalWalk || "-"}</td>
          <td style="text-align:left;max-width:180px">${escapeHtml(firstCourse.summary || "-")}</td>
          <td>${tag}</td>
          <td class="action-cell" data-id="${r.id}">
            <button class="btn-danger-sm btn-delete">刪除</button>
          </td>
        </tr>`;

        // 多課程展開行（預設隱藏）
        if (hasMultiple) {
          courses.slice(1).forEach((c, ci) => {
            mainRow += `<tr class="course-detail-row hidden" data-parent="${r.id}">
              <td></td>
              <td></td>
              <td style="text-align:left">└ ${escapeHtml(c.course || "-")}</td>
              <td>${escapeHtml(c.courseType || "-")}</td>
              <td colspan="4"></td>
              <td>${escapeHtml(c.teacher || "-")}</td>
              <td>${c.registeredCount ?? "-"}</td>
              <td>${c.actualCount ?? "-"}</td>
              <td>${c.walkInCount ?? "-"}</td>
              <td style="text-align:left;max-width:180px">${escapeHtml(c.summary || "-")}</td>
              <td colspan="2"></td>
            </tr>`;
          });
        }

        return mainRow;
      }).join("");
    } catch (e) {
      els.tbody.innerHTML =
        `<tr><td colspan="15" style="color:var(--color-danger);text-align:center;padding:var(--space-6)">載入失敗：${escapeHtml(e.message)}</td></tr>`;
    }
  }

  // ── 匯出 Excel ──
  function exportExcel() {
    const params = new URLSearchParams();
    const year   = els.filterYear.value;
    const month  = els.filterMonth.value;
    const name   = els.filterName.value.trim();
    if (year)  params.set("year",  year);
    if (month) params.set("month", month);
    if (name)  params.set("name",  name);
    window.location.href = "/export?" + params.toString();
  }

  // ── 刪除記錄（行內確認） ──
  let confirmingDelete = false;

  async function deleteRecord(id) {
    try {
      const res = await fetch(`/records/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      showToast("記錄已刪除", "success");
      confirmingDelete = false;
      loadRecords();
    } catch (e) {
      showToast("刪除失敗：" + e.message, "error");
      confirmingDelete = false;
    }
  }

  // ── 事件委派 ──
  document.addEventListener("click", (e) => {
    // 多課程展開/收合
    const toggle = e.target.closest(".courses-toggle");
    if (toggle) {
      const id = toggle.dataset.id;
      const rows = document.querySelectorAll(`tr.course-detail-row[data-parent="${id}"]`);
      const isHidden = rows[0]?.classList.contains("hidden");
      rows.forEach(r => r.classList.toggle("hidden", !isHidden));
      return;
    }

    // 刪除按鈕 → 顯示行內確認
    const deleteBtn = e.target.closest(".btn-delete");
    if (deleteBtn) {
      const cell = deleteBtn.closest(".action-cell");
      const id = cell.dataset.id;
      confirmingDelete = true;
      cell.innerHTML = `<div class="confirm-delete">
        <span>確定？</span>
        <button class="btn-confirm" data-id="${id}">刪除</button>
        <button class="btn-cancel">取消</button>
      </div>`;
      return;
    }

    // 確認刪除
    const confirmBtn = e.target.closest(".btn-confirm");
    if (confirmBtn) {
      deleteRecord(confirmBtn.dataset.id, confirmBtn.closest(".action-cell"));
      return;
    }

    // 取消刪除
    const cancelBtn = e.target.closest(".btn-cancel");
    if (cancelBtn) {
      confirmingDelete = false;
      const cell = cancelBtn.closest(".action-cell");
      cell.innerHTML = '<button class="btn-danger-sm btn-delete">刪除</button>';
      return;
    }
  });

  els.btnSearch.addEventListener("click", loadRecords);
  els.btnExport.addEventListener("click", exportExcel);

  // ── 頁面可見度感知輪詢 ──
  let pollInterval = null;

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    const interval = document.hidden ? 30000 : 5000;
    pollInterval = setInterval(loadRecords, interval);
  }

  document.addEventListener("visibilitychange", startPolling);

  // ── 初始化 ──
  loadRecords();
  startPolling();
})();

(function () {
  "use strict";
  const { showToast, fetchJSON } = window.SharedUtils;

  // ── DOM 參考 ──
  const els = {
    recoverBar:   document.getElementById("recover-bar"),
    recoverInfo:  document.getElementById("recover-info"),
    btnRestore:   document.getElementById("btn-restore"),
    btnDiscard:   document.getElementById("btn-discard"),
    secCheckin:   document.getElementById("sec-checkin"),
    secForm:      document.getElementById("sec-form"),
    secDone:      document.getElementById("sec-done"),
    name:         document.getElementById("name"),
    errName:      document.getElementById("err-name"),
    clock:        document.getElementById("clock"),
    checkinBtn:   document.getElementById("checkin-btn"),
    checkinInfo:  document.getElementById("checkin-info"),
    coursesContainer: document.getElementById("courses-container"),
    addCourseBtn: document.getElementById("add-course-btn"),
    submitBtn:    document.getElementById("submit-btn"),
    doneName:     document.getElementById("done-name"),
    doneHours:    document.getElementById("done-hours"),
  };

  // ── 時鐘 ──
  (function tick() {
    const now = new Date();
    els.clock.textContent = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    setTimeout(tick, 1000);
  })();

  // ── 課程計數器 ──
  let courseCounter = 0;

  // ── 課程模板 ──
  function createCourseBlock(index) {
    courseCounter++;
    const id = courseCounter;
    const isFirst = index === 0;

    const block = document.createElement("div");
    block.className = "course-block";
    block.dataset.courseId = id;
    block.innerHTML = `
      <div class="course-header">
        <div class="course-header-left">
          <span class="chevron">&#9660;</span>
          <span class="course-label">課程 ${index + 1}</span>
          <span class="course-summary"></span>
        </div>
        ${isFirst ? "" : '<button type="button" class="course-remove">✕ 移除</button>'}
      </div>
      <div class="course-body">
        <div class="field-group">
          <div class="q-title required">課程名稱</div>
          <input type="text" class="input course-name" placeholder="請輸入課程名稱">
          <div class="err" data-err="course">請填寫課程名稱</div>
        </div>
        <div class="field-group">
          <div class="q-title required">課程預計時數</div>
          <div class="radio-group">
            <label class="radio-opt"><input type="radio" name="plannedHours_${id}" value="1小時（50-60分鐘）"> 1 小時（50-60 分鐘）</label>
            <label class="radio-opt"><input type="radio" name="plannedHours_${id}" value="1.5小時"> 1.5 小時</label>
            <label class="radio-opt"><input type="radio" name="plannedHours_${id}" value="2小時"> 2 小時</label>
            <label class="radio-opt"><input type="radio" name="plannedHours_${id}" value="其他"> 其他</label>
          </div>
          <div class="err" data-err="plannedHours">請選擇課程預計時數</div>
        </div>
        <div class="field-group">
          <div class="q-title required">課程屬性</div>
          <div class="radio-group">
            <label class="radio-opt"><input type="radio" name="courseType_${id}" value="A.運動處方"> A. 運動處方</label>
            <label class="radio-opt"><input type="radio" name="courseType_${id}" value="B.營養處方"> B. 營養處方</label>
            <label class="radio-opt"><input type="radio" name="courseType_${id}" value="C.社會處方"> C. 社會處方</label>
            <label class="radio-opt"><input type="radio" name="courseType_${id}" value="D.情緒調適處方"> D. 情緒調適處方</label>
          </div>
          <div class="err" data-err="courseType">請選擇課程屬性</div>
        </div>
        <div class="field-group">
          <div class="q-title">課程老師</div>
          <input type="text" class="input course-teacher" placeholder="請輸入課程老師姓名（非必填）">
        </div>
        <div class="field-group">
          <div class="q-title required">出席人數</div>
          <div class="row-2">
            <div class="field-group">
              <div class="q-title required" style="font-size:var(--text-xs)">系統報名人數</div>
              <input type="number" class="input course-registered" placeholder="請輸入數字" min="0">
              <div class="err" data-err="registered">請填寫</div>
            </div>
            <div class="field-group">
              <div class="q-title required" style="font-size:var(--text-xs)">線上報名實到人數</div>
              <input type="number" class="input course-actual" placeholder="請輸入數字" min="0">
              <div class="err" data-err="actual">請填寫</div>
            </div>
          </div>
          <div class="field-group" style="margin-top:var(--space-4)">
            <div class="q-title required" style="font-size:var(--text-xs)">無報名現場候補人數</div>
            <input type="number" class="input course-walkin" placeholder="請輸入數字" min="0">
            <div class="err" data-err="walkin">請填寫</div>
          </div>
        </div>
        <div class="field-group">
          <div class="q-title required">簡述上課內容或回報狀況</div>
          <textarea class="input course-summary" placeholder="請簡述今日上課內容或狀況（100字內）" maxlength="100"></textarea>
          <div class="hint"><span class="char-count">0</span>/100 字</div>
          <div class="err" data-err="summary">請填寫上課內容</div>
        </div>
      </div>
    `;

    // 字數計算
    const textarea = block.querySelector(".course-summary");
    const charCount = block.querySelector(".char-count");
    textarea.addEventListener("input", () => {
      charCount.textContent = textarea.value.length;
    });

    // 收合/展開
    const header = block.querySelector(".course-header");
    header.addEventListener("click", (e) => {
      if (e.target.closest(".course-remove")) return;
      block.classList.toggle("collapsed");
      updateCourseSummary(block);
    });

    // 移除按鈕
    const removeBtn = block.querySelector(".course-remove");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        block.style.opacity = "0";
        block.style.transform = "scale(0.95)";
        block.style.transition = "all 0.2s ease";
        setTimeout(() => {
          block.remove();
          renumberCourses();
        }, 200);
      });
    }

    // 當課程名稱或屬性變更時更新摘要
    const nameInput = block.querySelector(".course-name");
    const typeRadios = block.querySelectorAll(`input[name="courseType_${id}"]`);
    nameInput.addEventListener("input", () => updateCourseSummary(block));
    typeRadios.forEach(r => r.addEventListener("change", () => updateCourseSummary(block)));

    return block;
  }

  function updateCourseSummary(block) {
    const summary = block.querySelector(".course-summary-text") || block.querySelector(".course-summary");
    const nameVal = block.querySelector(".course-name").value.trim();
    const typeVal = block.querySelector(`input[name^="courseType_"]:checked`);
    const summaryEl = block.querySelector(".course-header .course-summary");
    const parts = [];
    if (nameVal) parts.push(nameVal);
    if (typeVal) parts.push(typeVal.value);
    summaryEl.textContent = parts.length ? `— ${parts.join(" / ")}` : "";
  }

  function renumberCourses() {
    const blocks = els.coursesContainer.querySelectorAll(".course-block");
    blocks.forEach((block, i) => {
      block.querySelector(".course-label").textContent = `課程 ${i + 1}`;
    });
  }

  // ── 新增初始課程 ──
  function addCourse() {
    const index = els.coursesContainer.querySelectorAll(".course-block").length;
    const block = createCourseBlock(index);
    els.coursesContainer.appendChild(block);
  }

  els.addCourseBtn.addEventListener("click", addCourse);

  // ── 錯誤顯示 ──
  function showErr(el, show) {
    el.classList.toggle("show", show);
  }

  // ── 回復機制 ──
  async function checkRecover() {
    const savedId = localStorage.getItem("sessionId");
    if (!savedId) return;
    try {
      const res = await fetch("/session/" + savedId);
      if (!res.ok) { localStorage.clear(); return; }
      const data = await res.json();
      if (!data.record || data.record.status !== "checked-in") { localStorage.clear(); return; }
      const r = data.record;
      const t = new Date(r.checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
      els.recoverInfo.textContent = `姓名：${r.name}　簽到時間：${t}`;
      els.recoverBar.classList.remove("hidden");
    } catch { localStorage.clear(); }
  }

  // 姓名欄失焦：查詢是否有進行中的簽到
  els.name.addEventListener("blur", async function () {
    const name = this.value.trim();
    if (!name || localStorage.getItem("sessionId")) return;
    try {
      const res = await fetch("/active-session?name=" + encodeURIComponent(name));
      const data = await res.json();
      if (!data.found) return;
      const r = data.record;
      const t = new Date(r.checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
      localStorage.setItem("sessionId", data.sessionId);
      localStorage.setItem("name", r.name);
      els.recoverInfo.textContent = `姓名：${r.name}　簽到時間：${t}`;
      els.recoverBar.classList.remove("hidden");
    } catch {}
  });

  function showFormSection(name) {
    const sessionId = localStorage.getItem("sessionId");
    if (!sessionId) return;
    fetch("/session/" + sessionId).then(r => r.json()).then(data => {
      if (!data.record || data.record.status !== "checked-in") {
        showToast("此簽到記錄已完成或不存在，請重新簽到", "error");
        localStorage.clear();
        els.recoverBar.classList.add("hidden");
        return;
      }
      const r = data.record;
      const t = new Date(r.checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
      els.checkinInfo.textContent = `${r.name}・開始時間：${t}`;
      els.recoverBar.classList.add("hidden");
      els.secCheckin.classList.add("hidden");
      els.secForm.classList.remove("hidden");
      // 新增第一堂課程
      if (els.coursesContainer.children.length === 0) addCourse();
    }).catch(() => showToast("回復失敗，請重新簽到", "error"));
  }

  els.btnRestore.addEventListener("click", () => showFormSection());
  els.btnDiscard.addEventListener("click", () => {
    localStorage.clear();
    els.recoverBar.classList.add("hidden");
  });

  // ── 簽到 ──
  els.checkinBtn.addEventListener("click", async () => {
    const name = els.name.value.trim();
    showErr(els.errName, !name);
    if (!name) return;

    const btn = els.checkinBtn;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 簽到中…';

    try {
      const data = await fetchJSON("/checkin", {
        method: "POST",
        body: JSON.stringify({ name })
      });

      localStorage.setItem("sessionId", data.sessionId);
      localStorage.setItem("name", name);

      const now = new Date();
      els.checkinInfo.textContent = `${name}・開始時間：${now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`;

      els.recoverBar.classList.add("hidden");
      els.secCheckin.classList.add("hidden");
      els.secForm.classList.remove("hidden");

      // 新增第一堂課程
      addCourse();
      showToast("簽到成功！", "success");
    } catch (e) {
      showToast("簽到失敗：" + e.message, "error");
      btn.disabled = false;
      btn.textContent = "簽到・開始上課";
    }
  });

  // ── 簽退（收集所有課程） ──
  els.submitBtn.addEventListener("click", async () => {
    const sessionId = localStorage.getItem("sessionId");
    const name = localStorage.getItem("name");
    if (!sessionId) { showToast("找不到簽到記錄，請重新整理頁面後簽到", "error"); return; }

    const blocks = els.coursesContainer.querySelectorAll(".course-block");
    if (blocks.length === 0) { showToast("請至少填寫一堂課程", "error"); return; }

    let allValid = true;
    const courses = [];

    blocks.forEach((block) => {
      // 展開收合的區塊以顯示錯誤
      const courseName     = block.querySelector(".course-name").value.trim();
      const courseId        = block.dataset.courseId;
      const plannedHours   = block.querySelector(`input[name="plannedHours_${courseId}"]:checked`);
      const courseType      = block.querySelector(`input[name="courseType_${courseId}"]:checked`);
      const teacher        = block.querySelector(".course-teacher").value.trim();
      const registered     = block.querySelector(".course-registered").value;
      const actual         = block.querySelector(".course-actual").value;
      const walkin         = block.querySelector(".course-walkin").value;
      const summary        = block.querySelector("textarea.course-summary").value.trim();

      // 驗證
      let valid = true;
      const errMap = {
        course: !courseName,
        plannedHours: !plannedHours,
        courseType: !courseType,
        registered: registered === "",
        actual: actual === "",
        walkin: walkin === "",
        summary: !summary,
      };

      Object.entries(errMap).forEach(([key, hasError]) => {
        const errEl = block.querySelector(`.err[data-err="${key}"]`);
        if (errEl) showErr(errEl, hasError);
        if (hasError) valid = false;
      });

      if (!valid) {
        block.classList.remove("collapsed");
        allValid = false;
      }

      courses.push({
        course: courseName,
        plannedHours: plannedHours?.value || "",
        courseType: courseType?.value || "",
        teacher,
        registeredCount: parseInt(registered) || 0,
        actualCount: parseInt(actual) || 0,
        walkInCount: parseInt(walkin) || 0,
        summary,
      });
    });

    if (!allValid) {
      showToast("請完成所有必填欄位", "warning");
      return;
    }

    const btn = els.submitBtn;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 送出中…';

    try {
      const data = await fetchJSON("/checkout", {
        method: "POST",
        body: JSON.stringify({ sessionId, courses })
      });

      els.doneName.textContent = `謝謝 ${name}！`;
      els.doneHours.textContent = `今日工作時數：${data.hours} 小時`;
      els.secForm.classList.add("hidden");
      els.secDone.classList.remove("hidden");
      localStorage.clear();
      showToast("簽退完成！", "success");
    } catch (e) {
      showToast("送出失敗：" + e.message, "error");
      btn.disabled = false;
      btn.textContent = "送出並簽退";
    }
  });

  // ── 初始化 ──
  checkRecover();
})();

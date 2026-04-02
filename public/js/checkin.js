/* ============================================
   checkin.js  --  Check-in Page Logic
   ============================================ */
(function () {
  "use strict";

  // ── Clock ──
  function updateClock() {
    var now = new Date();
    document.getElementById("clock").textContent =
      now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ── UI Helpers ──
  function showErr(id, show) {
    document.getElementById(id).classList.toggle("hidden", !show);
  }

  function showSection(id) {
    ["sec-info", "sec-type", "sec-form-regular", "sec-form-prescription", "sec-form-admin", "sec-done"]
      .forEach(function (s) { document.getElementById(s).classList.add("hidden"); });
    document.getElementById(id).classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleBank(show) {
    document.getElementById("bank-fields").classList.toggle("hidden", !show);
  }

  function toggleSameAddr() {
    var same = document.getElementById("sameAddr").checked;
    document.getElementById("live-addr-fields").classList.toggle("hidden", same);
  }

  // ── Load History ──
  async function loadHistory() {
    var name = document.getElementById("name").value.trim();
    var msgEl = document.getElementById("load-msg");
    msgEl.classList.remove("hidden", "success", "fail");

    if (!name) {
      msgEl.textContent = "\u8ACB\u5148\u8F38\u5165\u59D3\u540D\u518D\u67E5\u8A62";
      msgEl.classList.add("fail");
      return;
    }

    try {
      var res = await fetch("/receipt-data?name=" + encodeURIComponent(name));
      var data = await res.json();

      if (!data.found) {
        msgEl.textContent = "\u67E5\u7121\u300C" + name + "\u300D\u7684\u6B77\u53F2\u8CC7\u6599\uFF0C\u8ACB\u624B\u52D5\u586B\u5BEB";
        msgEl.classList.add("fail");
        return;
      }

      var r = data.record;

      // Populate fields
      if (r.eventName) document.getElementById("eventName").value = r.eventName;
      if (r.workDescription) {
        var items = r.workDescription.split("、");
        document.querySelectorAll('#workDescOptions input[type="checkbox"]').forEach(function (cb) {
          if (items.includes(cb.value)) cb.checked = true;
        });
        var knownValues = [].slice.call(document.querySelectorAll('#workDescOptions input[type="checkbox"]')).map(function (cb) { return cb.value; });
        var otherItems = items.filter(function (v) { return !knownValues.includes(v); });
        if (otherItems.length > 0) {
          document.getElementById("workDesc-other-cb").checked = true;
          document.getElementById("workDesc-other-text").classList.remove("hidden");
          document.getElementById("workDesc-other-text").value = otherItems.join("、");
        }
      }

      // Fee types
      if (Array.isArray(r.feeTypes)) {
        document.querySelectorAll('input[name="feeType"]').forEach(function (cb) {
          cb.checked = r.feeTypes.includes(cb.value);
        });
      }

      // Pay method
      if (r.payMethod) {
        var radio = document.querySelector('input[name="payMethod"][value="' + r.payMethod + '"]');
        if (radio) { radio.checked = true; toggleBank(r.payMethod === "\u532F\u6B3E"); }
      }

      // Bank info
      if (r.bankInfo) {
        if (r.bankInfo.bankName) document.getElementById("bankName").value = r.bankInfo.bankName;
        if (r.bankInfo.accountName) document.getElementById("bankAccountName").value = r.bankInfo.accountName;
        if (r.bankInfo.account) document.getElementById("bankAccount").value = r.bankInfo.account;
      }

      // ID number
      if (r.idNumber) document.getElementById("idNumber").value = r.idNumber;

      // Addresses
      if (r.address) document.getElementById("address").value = r.address;
      if (r.liveAddress && r.liveAddress !== r.address) {
        document.getElementById("sameAddr").checked = false;
        toggleSameAddr();
        document.getElementById("liveAddress").value = r.liveAddress;
      }

      // Phone
      if (r.phone) document.getElementById("phone").value = r.phone;

      msgEl.textContent = "\u2705 \u5DF2\u5E36\u5165\u300C" + name + "\u300D\u7684\u6B77\u53F2\u8CC7\u6599\uFF0C\u8ACB\u78BA\u8A8D\u5F8C\u7C3D\u5230";
      msgEl.classList.add("success");
    } catch (e) {
      msgEl.textContent = "\u67E5\u8A62\u5931\u6557\uFF1A" + e.message;
      msgEl.classList.add("fail");
    }
  }

  // ── Step 1: Check-in ──
  async function doCheckin() {
    var name      = document.getElementById("name").value.trim();
    var eventName = document.getElementById("eventName").value.trim();
    var workDescChecked = [].slice.call(document.querySelectorAll('#workDescOptions input[type="checkbox"]:checked')).map(function (el) { return el.value; });
    var workDescOther = document.getElementById("workDesc-other-text").value.trim();
    if (workDescChecked.includes("其他") && workDescOther) {
      workDescChecked = workDescChecked.filter(function (v) { return v !== "其他"; });
      workDescChecked.push(workDescOther);
    } else {
      workDescChecked = workDescChecked.filter(function (v) { return v !== "其他"; });
    }
    var workDesc = workDescChecked.join("、");
    var feeTypes  = [].slice.call(document.querySelectorAll('input[name="feeType"]:checked')).map(function (el) { return el.value; });
    var payMethod = document.querySelector('input[name="payMethod"]:checked');
    var idNumber  = document.getElementById("idNumber").value.trim().toUpperCase();
    var address   = document.getElementById("address").value.trim();
    var phone     = document.getElementById("phone").value.trim();

    // Validation
    var valid = true;
    showErr("err-name",      !name);      if (!name) valid = false;
    showErr("err-eventName", !eventName); if (!eventName) valid = false;
    showErr("err-workDesc",  workDescChecked.length === 0);  if (workDescChecked.length === 0) valid = false;
    showErr("err-feeType",   feeTypes.length === 0); if (feeTypes.length === 0) valid = false;
    showErr("err-payMethod", !payMethod); if (!payMethod) valid = false;
    showErr("err-idNumber",  idNumber.length !== 10); if (idNumber.length !== 10) valid = false;
    showErr("err-address",   !address);   if (!address) valid = false;
    showErr("err-phone",     !phone);     if (!phone) valid = false;

    if (!valid) return;

    // Bank info
    var bankInfo = null;
    if (payMethod.value === "\u532F\u6B3E") {
      bankInfo = {
        bankName:    document.getElementById("bankName").value.trim(),
        accountName: document.getElementById("bankAccountName").value.trim(),
        account:     document.getElementById("bankAccount").value.trim()
      };
    }

    // Live address
    var sameAddr    = document.getElementById("sameAddr").checked;
    var liveAddress = sameAddr ? address : document.getElementById("liveAddress").value.trim();

    var receipt = {
      name: name,
      eventName: eventName,
      workDescription: workDesc,
      feeTypes: feeTypes,
      payMethod: payMethod.value,
      bankInfo: bankInfo,
      idNumber: idNumber,
      address: address,
      liveAddress: liveAddress,
      phone: phone
    };

    try {
      var res  = await fetch("/checkin", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(receipt)
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);

      sessionStorage.setItem("sessionId", data.sessionId);
      sessionStorage.setItem("name", name);

      var now     = new Date();
      var timeStr = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
      var infoText = name + " \u5DF2\u65BC " + timeStr + " \u7C3D\u5230";

      document.getElementById("checkin-info").textContent        = infoText;
      document.getElementById("regular-info").textContent        = infoText;
      document.getElementById("prescription-info").textContent   = infoText;
      document.getElementById("admin-checkin-info").textContent   = infoText;

      showSection("sec-type");
    } catch (e) {
      showToast("\u7C3D\u5230\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  // ── Step 2: Select type ──
  function selectType(type) {
    sessionStorage.setItem("checkinType", type);
    if (type === "prescription") {
      var container = document.getElementById("prescription-courses");
      if (container.querySelectorAll(".course-item").length === 0) {
        addCourse();
      }
    }
    if (type === "admin-tasks") {
      showSection("sec-form-admin");
    } else {
      showSection(type === "regular" ? "sec-form-regular" : "sec-form-prescription");
    }
  }

  // ── Prescription: Add / Remove Course (完整表單) ──
  var courseCount = 0;

  function createCourseBlock(isFirst) {
    courseCount++;
    var id = courseCount;
    var div = document.createElement("div");
    div.className = "course-item";
    div.dataset.courseId = id;
    var removeBtn = isFirst ? '' : '<button class="course-remove" data-action="remove-course">\u2715 \u79FB\u9664</button>';
    div.innerHTML =
      '<div class="course-item-header">' +
      '  <span class="course-label">\u8AB2\u7A0B ' + (document.querySelectorAll("#prescription-courses .course-item").length + 1) + '</span>' +
      removeBtn +
      '</div>' +
      '<div class="course-body">' +
      '  <div class="q-title required">\u8AB2\u7A0B\u540D\u7A31</div>' +
      '  <input type="text" class="p-course-name" placeholder="\u8ACB\u8F38\u5165\u8AB2\u7A0B\u540D\u7A31">' +
      '  <div class="q-title required" style="margin-top:16px">\u8AB2\u7A0B\u5C6C\u6027</div>' +
      '  <div class="radio-group">' +
      '    <label class="opt"><input type="radio" name="pCourseType_' + id + '" value="A.\u904B\u52D5\u8655\u65B9"> A. \u904B\u52D5\u8655\u65B9</label>' +
      '    <label class="opt"><input type="radio" name="pCourseType_' + id + '" value="B.\u71DF\u990A\u8655\u65B9"> B. \u71DF\u990A\u8655\u65B9</label>' +
      '    <label class="opt"><input type="radio" name="pCourseType_' + id + '" value="C.\u793E\u6703\u8655\u65B9"> C. \u793E\u6703\u8655\u65B9</label>' +
      '    <label class="opt"><input type="radio" name="pCourseType_' + id + '" value="D.\u60C5\u7DD2\u8ABF\u9069\u8655\u65B9"> D. \u60C5\u7DD2\u8ABF\u9069\u8655\u65B9</label>' +
      '  </div>' +
      '  <div class="q-title" style="margin-top:16px">\u8AB2\u7A0B\u8001\u5E2B</div>' +
      '  <input type="text" class="p-teacher" placeholder="\u8ACB\u8F38\u5165\u8AB2\u7A0B\u8001\u5E2B\u59D3\u540D\uFF08\u975E\u5FC5\u586B\uFF09">' +
      '  <div class="q-title required" style="margin-top:16px">\u51FA\u5E2D\u4EBA\u6578</div>' +
      '  <div class="row-2">' +
      '    <div><div class="q-title required" style="font-size:13px;margin-bottom:8px">\u7CFB\u7D71\u5831\u540D\u4EBA\u6578</div>' +
      '      <input type="number" class="p-registered" placeholder="\u8ACB\u8F38\u5165\u6578\u5B57" min="0"></div>' +
      '    <div><div class="q-title required" style="font-size:13px;margin-bottom:8px">\u7DDA\u4E0A\u5831\u540D\u5BE6\u5230\u4EBA\u6578</div>' +
      '      <input type="number" class="p-actual" placeholder="\u8ACB\u8F38\u5165\u6578\u5B57" min="0"></div>' +
      '  </div>' +
      '  <div style="margin-top:12px"><div class="q-title required" style="font-size:13px;margin-bottom:8px">\u7121\u5831\u540D\u73FE\u5834\u5019\u88DC\u4EBA\u6578</div>' +
      '    <input type="number" class="p-walkin" placeholder="\u8ACB\u8F38\u5165\u6578\u5B57" min="0"></div>' +
      '  <div class="q-title required" style="margin-top:16px">\u7C21\u8FF0\u4E0A\u8AB2\u5167\u5BB9\u6216\u56DE\u5831\u72C0\u6CC1</div>' +
      '  <textarea class="p-summary" rows="3" placeholder="\u8ACB\u7C21\u8FF0\u4ECA\u65E5\u4E0A\u8AB2\u5167\u5BB9\u6216\u72C0\u6CC1\uFF08100\u5B57\u5167\uFF09" maxlength="100"></textarea>' +
      '  <div class="hint"><span class="p-char-count">0</span>/100 \u5B57</div>' +
      '</div>';
    // char count
    div.querySelector(".p-summary").addEventListener("input", function () {
      div.querySelector(".p-char-count").textContent = this.value.length;
    });
    return div;
  }

  function addCourse() {
    var container = document.getElementById("prescription-courses");
    var isFirst = container.querySelectorAll(".course-item").length === 0;
    var block = createCourseBlock(isFirst);
    container.appendChild(block);
  }

  function removeCourse(btn) {
    btn.closest(".course-item").remove();
    document.querySelectorAll("#prescription-courses .course-item").forEach(function (el, i) {
      el.querySelector(".course-label").textContent = "\u8AB2\u7A0B " + (i + 1);
    });
  }

  // ── Character count (regular only) ──
  document.addEventListener("input", function (e) {
    if (e.target.id === "regular-summary")
      document.getElementById("regular-char-count").textContent = e.target.value.length;
  });

  // ── Step 3: Check-out ──
  async function doCheckout(type) {
    var sessionId = sessionStorage.getItem("sessionId");
    var name      = sessionStorage.getItem("name");
    if (!sessionId) { showToast("\u627E\u4E0D\u5230\u7C3D\u5230\u8A18\u9304\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\u5F8C\u7C3D\u5230", "error"); return; }

    var course, courses, plannedHours, courseType, teacher,
        registeredCount, actualCount, walkInCount, summary;

    if (type === "regular") {
      course = document.getElementById("regular-course").value.trim();
      var ph = document.querySelector('input[name="regular-plannedHours"]:checked');
      var ct = document.querySelector('input[name="regular-courseType"]:checked');
      teacher = document.getElementById("regular-teacher").value.trim();
      registeredCount = document.getElementById("regular-registeredCount").value;
      actualCount     = document.getElementById("regular-actualCount").value;
      walkInCount     = document.getElementById("regular-walkInCount").value;
      summary         = document.getElementById("regular-summary").value.trim();

      var valid = true;
      showErr("err-regular-course",       !course);         if (!course) valid = false;
      showErr("err-regular-plannedHours", !ph);             if (!ph) valid = false;
      showErr("err-regular-courseType",    !ct);             if (!ct) valid = false;
      showErr("err-regular-reg",          registeredCount === ""); if (registeredCount === "") valid = false;
      showErr("err-regular-act",          actualCount === "");     if (actualCount === "") valid = false;
      showErr("err-regular-walk",         walkInCount === "");     if (walkInCount === "") valid = false;
      showErr("err-regular-summary",      !summary);        if (!summary) valid = false;
      if (!valid) return;

      plannedHours = ph.value;
      courseType   = ct.value;
    } else {
      // 處方日：收集每堂課程的完整資料
      var blocks = document.querySelectorAll("#prescription-courses .course-item");
      if (blocks.length === 0) {
        showErr("err-prescription-course", true);
        return;
      }
      showErr("err-prescription-course", false);

      var coursesData = [];
      var valid2 = true;
      blocks.forEach(function (block) {
        var cId = block.dataset.courseId;
        var cName = block.querySelector(".p-course-name").value.trim();
        var cType = block.querySelector('input[name="pCourseType_' + cId + '"]:checked');
        var cTeacher = block.querySelector(".p-teacher").value.trim();
        var cReg = block.querySelector(".p-registered").value;
        var cAct = block.querySelector(".p-actual").value;
        var cWalk = block.querySelector(".p-walkin").value;
        var cSummary = block.querySelector(".p-summary").value.trim();

        if (!cName || !cType || cReg === "" || cAct === "" || cWalk === "" || !cSummary) {
          valid2 = false;
        }

        coursesData.push({
          course: cName,
          courseType: cType ? cType.value : "",
          teacher: cTeacher,
          registeredCount: parseInt(cReg) || 0,
          actualCount: parseInt(cAct) || 0,
          walkInCount: parseInt(cWalk) || 0,
          summary: cSummary
        });
      });

      if (!valid2) {
        showToast("\u8ACB\u5B8C\u6210\u6240\u6709\u8AB2\u7A0B\u7684\u5FC5\u586B\u6B04\u4F4D", "warning");
        return;
      }

      courses = coursesData.map(function (c) { return c.course; });
      course = courses.join("\u3001");
      courseType = coursesData[0].courseType;
      teacher = coursesData[0].teacher;
      registeredCount = coursesData.reduce(function (s, c) { return s + c.registeredCount; }, 0);
      actualCount = coursesData.reduce(function (s, c) { return s + c.actualCount; }, 0);
      walkInCount = coursesData.reduce(function (s, c) { return s + c.walkInCount; }, 0);
      summary = coursesData.map(function (c) { return c.course + "：" + c.summary; }).join("；");
    }

    try {
      var res = await fetch("/checkout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          sessionId:       sessionId,
          checkinType:     type,
          course:          course,
          courses:         courses || [course],
          plannedHours:    plannedHours || "",
          courseType:       courseType,
          teacher:         teacher,
          registeredCount: parseInt(registeredCount),
          actualCount:     parseInt(actualCount),
          walkInCount:     parseInt(walkInCount),
          summary:         summary
        })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);

      document.getElementById("done-name").textContent  = "\u8B1D\u8B1D " + name + "\uFF01";
      document.getElementById("done-hours").textContent = "\u4ECA\u65E5\u5DE5\u4F5C\u6642\u6578\uFF1A" + data.hours + " \u5C0F\u6642";

      showSection("sec-done");
      sessionStorage.clear();
    } catch (e) {
      showToast("\u7C3D\u9000\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  // ── Step 3b: Check-out (Admin Tasks) ──
  async function doCheckoutAdmin() {
    var sessionId = sessionStorage.getItem("sessionId");
    if (!sessionId) { showToast("\u627E\u4E0D\u5230\u7C3D\u5230\u8A18\u9304", "error"); return; }

    var workNameSelect = document.getElementById("admin-workName").value;
    var workNameOther = document.getElementById("admin-workNameOther").value.trim();
    var workName = workNameSelect === "\u5176\u4ED6" ? workNameOther : workNameSelect;
    var workItems = document.getElementById("admin-workItems").value.trim();
    var feedback = document.getElementById("admin-feedback").value.trim();

    // Validation
    if (!workName) { showErr("err-admin-workName", true); return; }
    showErr("err-admin-workName", false);
    if (!workItems) { showErr("err-admin-workItems", true); return; }
    showErr("err-admin-workItems", false);

    // File upload - collect file names
    var fileInput = document.getElementById("admin-files");
    var fileNames = [];
    if (fileInput.files.length > 0) {
      fileNames = Array.from(fileInput.files).map(function (f) { return f.name; });
    }

    try {
      // Upload files if any
      var uploadedFiles = [];
      if (fileInput.files.length > 0) {
        var formData = new FormData();
        for (var i = 0; i < fileInput.files.length; i++) {
          formData.append("files", fileInput.files[i]);
        }
        formData.append("sessionId", sessionId);
        var uploadRes = await fetch("/upload-files", { method: "POST", body: formData });
        var uploadData = await uploadRes.json();
        if (uploadData.ok) uploadedFiles = uploadData.files;
      }

      var res = await fetch("/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId,
          checkinType: "\u884C\u653F\u5EB6\u52D9",
          course: workName,
          workContent: workItems,
          note: feedback,
          uploadedFiles: uploadedFiles
        })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);

      document.getElementById("done-name").textContent = "\u8B1D\u8B1D " + sessionStorage.getItem("name") + "\uFF01";
      document.getElementById("done-hours").textContent = "\u4ECA\u65E5\u5DE5\u4F5C\u6642\u6578\uFF1A" + data.hours + " \u5C0F\u6642";
      showSection("sec-done");
      sessionStorage.clear();
    } catch (e) {
      showToast("\u7C3D\u9000\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  // ── Wire up event listeners (replacing inline onclick) ──
  document.addEventListener("DOMContentLoaded", function () {
    // Load history button
    var loadHistoryBtn = document.getElementById("btn-load-history");
    if (loadHistoryBtn) loadHistoryBtn.addEventListener("click", loadHistory);

    // Pay method radio buttons
    document.querySelectorAll('input[name="payMethod"]').forEach(function (radio) {
      radio.addEventListener("click", function () {
        toggleBank(this.value === "\u532F\u6B3E");
      });
    });

    // Same address checkbox
    var sameAddrCb = document.getElementById("sameAddr");
    if (sameAddrCb) sameAddrCb.addEventListener("change", toggleSameAddr);

    // 工作內容「其他」toggle
    var workDescOtherCb = document.getElementById("workDesc-other-cb");
    if (workDescOtherCb) workDescOtherCb.addEventListener("change", function () {
      document.getElementById("workDesc-other-text").classList.toggle("hidden", !this.checked);
    });

    // Check-in button
    var checkinBtn = document.getElementById("btn-checkin");
    if (checkinBtn) checkinBtn.addEventListener("click", doCheckin);

    // Type selection buttons
    var regularBtn = document.getElementById("btn-type-regular");
    if (regularBtn) regularBtn.addEventListener("click", function () { selectType("regular"); });

    var prescriptionBtn = document.getElementById("btn-type-prescription");
    if (prescriptionBtn) prescriptionBtn.addEventListener("click", function () { selectType("prescription"); });

    // Add course button
    var addCourseBtn = document.getElementById("btn-add-course");
    if (addCourseBtn) addCourseBtn.addEventListener("click", addCourse);

    // Remove course (delegated)
    document.addEventListener("click", function (e) {
      if (e.target.matches('[data-action="remove-course"]') || e.target.closest('[data-action="remove-course"]')) {
        var btn = e.target.closest('[data-action="remove-course"]') || e.target;
        removeCourse(btn);
      }
    });

    // Checkout buttons
    var checkoutRegularBtn = document.getElementById("btn-checkout-regular");
    if (checkoutRegularBtn) checkoutRegularBtn.addEventListener("click", function () { doCheckout("regular"); });

    var checkoutPrescriptionBtn = document.getElementById("btn-checkout-prescription");
    if (checkoutPrescriptionBtn) checkoutPrescriptionBtn.addEventListener("click", function () { doCheckout("prescription"); });

    // Admin tasks type button
    var adminBtn = document.getElementById("btn-type-admin");
    if (adminBtn) adminBtn.addEventListener("click", function () { selectType("admin-tasks"); });

    // Admin work name select - show/hide "other" input
    var workNameSelect = document.getElementById("admin-workName");
    if (workNameSelect) workNameSelect.addEventListener("change", function () {
      document.getElementById("admin-workNameOther").classList.toggle("hidden", this.value !== "\u5176\u4ED6");
    });

    // File input - show file list
    var fileInput = document.getElementById("admin-files");
    if (fileInput) fileInput.addEventListener("change", function () {
      var list = document.getElementById("file-list");
      list.innerHTML = Array.from(this.files).map(function (f) {
        return '<div class="file-item"><span>\uD83D\uDCC4 ' + f.name + ' (' + (f.size / 1024).toFixed(1) + ' KB)</span></div>';
      }).join("");
    });

    // Admin checkout button
    var adminCheckoutBtn = document.getElementById("btn-checkout-admin");
    if (adminCheckoutBtn) adminCheckoutBtn.addEventListener("click", doCheckoutAdmin);
  });

})();

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

  var ALL_SECTIONS = ["sec-login", "sec-register", "sec-info", "sec-type", "sec-form-regular", "sec-form-prescription", "sec-form-admin", "sec-done"];

  var SECTION_STEP = {
    "sec-login": 1, "sec-info": 2, "sec-type": 3,
    "sec-form-regular": 4, "sec-form-prescription": 4, "sec-form-admin": 4,
    "sec-done": 5
  };

  function updateProgressBar(sectionId) {
    var bar = document.getElementById("progress-bar");
    var step = SECTION_STEP[sectionId];
    if (!step) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    var steps = bar.querySelectorAll(".progress-step");
    var lines = bar.querySelectorAll(".progress-line");
    steps.forEach(function (el, i) {
      var s = i + 1;
      el.classList.remove("active", "done");
      if (s < step) el.classList.add("done");
      else if (s === step) el.classList.add("active");
    });
    lines.forEach(function (el, i) {
      el.classList.toggle("done", i + 1 < step);
    });
  }

  function showSection(id) {
    ALL_SECTIONS.forEach(function (s) { document.getElementById(s).classList.add("hidden"); });
    document.getElementById(id).classList.remove("hidden");
    updateProgressBar(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleBank(show) {
    document.getElementById("bank-fields").classList.toggle("hidden", !show);
  }

  function toggleSameAddr() {
    var same = document.getElementById("sameAddr").checked;
    document.getElementById("live-addr-fields").classList.toggle("hidden", same);
  }

  // ── Fill sec-info from user profile ──
  function fillInfoFromUser(user) {
    document.getElementById("name").value = user.name || "";
    document.getElementById("idNumber").value = user.idNumber || "";

    if (user.eventName) document.getElementById("eventName").value = user.eventName;
    if (user.workDescription) {
      var items = user.workDescription.split("\u3001");
      document.querySelectorAll('#workDescOptions input[type="checkbox"]').forEach(function (cb) {
        if (items.includes(cb.value)) cb.checked = true;
      });
      var knownValues = [].slice.call(document.querySelectorAll('#workDescOptions input[type="checkbox"]')).map(function (cb) { return cb.value; });
      var otherItems = items.filter(function (v) { return !knownValues.includes(v); });
      if (otherItems.length > 0) {
        document.getElementById("workDesc-other-cb").checked = true;
        document.getElementById("workDesc-other-text").classList.remove("hidden");
        document.getElementById("workDesc-other-text").value = otherItems.join("\u3001");
      }
    }

    if (Array.isArray(user.feeTypes)) {
      document.querySelectorAll('input[name="feeType"]').forEach(function (cb) {
        cb.checked = user.feeTypes.includes(cb.value);
      });
    }

    if (user.payMethod) {
      var radio = document.querySelector('input[name="payMethod"][value="' + user.payMethod + '"]');
      if (radio) { radio.checked = true; toggleBank(user.payMethod === "\u532F\u6B3E"); }
    }

    if (user.bankInfo) {
      if (user.bankInfo.bankName) document.getElementById("bankName").value = user.bankInfo.bankName;
      if (user.bankInfo.accountName) document.getElementById("bankAccountName").value = user.bankInfo.accountName;
      if (user.bankInfo.account) document.getElementById("bankAccount").value = user.bankInfo.account;
    }

    if (user.address) document.getElementById("address").value = user.address;
    if (user.liveAddress && user.liveAddress !== user.address) {
      document.getElementById("sameAddr").checked = false;
      toggleSameAddr();
      document.getElementById("liveAddress").value = user.liveAddress;
    }
    if (user.phone) document.getElementById("phone").value = user.phone;

    document.getElementById("logged-in-info").textContent = "\u2705 \u5DF2\u767B\u5165\uFF1A" + user.name;
  }

  // ── Login ──
  async function doLogin() {
    var name = document.getElementById("login-name").value.trim();
    var idLast4 = document.getElementById("login-id4").value.trim();
    var msgEl = document.getElementById("login-msg");

    var valid = true;
    showErr("err-login-name", !name); if (!name) valid = false;
    showErr("err-login-id4", idLast4.length !== 4); if (idLast4.length !== 4) valid = false;
    if (!valid) return;

    msgEl.classList.add("hidden");

    try {
      var res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, idLast4: idLast4 })
      });
      var data = await res.json();

      if (!data.ok) {
        msgEl.textContent = data.error || "\u767B\u5165\u5931\u6557";
        msgEl.classList.remove("hidden");
        return;
      }

      // 儲存登入資訊
      localStorage.setItem("loginName", data.user.name);
      localStorage.setItem("loginId4", idLast4);
      localStorage.setItem("userId", data.userId);

      // 檢查是否有進行中的簽到
      if (data.sessions && data.sessions.length > 0) {
        var session = data.sessions[0];
        localStorage.setItem("sessionId", session.sessionId);
        localStorage.setItem("name", data.user.name);

        var timeStr = new Date(session.checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
        var infoText = data.user.name + " \u5DF2\u65BC " + timeStr + " \u7C3D\u5230";

        document.getElementById("checkin-info").textContent = infoText;
        document.getElementById("regular-info").textContent = infoText;
        document.getElementById("prescription-info").textContent = infoText;
        document.getElementById("admin-checkin-info").textContent = infoText;

        var checkinType = localStorage.getItem("checkinType");
        if (checkinType) {
          selectType(checkinType);
        } else {
          showSection("sec-type");
        }
        showToast("\u5DF2\u6062\u5FA9\u60A8\u7684\u7C3D\u5230\u4F5C\u696D\uFF08" + timeStr + " \u7C3D\u5230\uFF09", "success");
      } else {
        // 無進行中簽到，帶入資料進入簽到流程
        fillInfoFromUser(data.user);
        showSection("sec-info");
        showToast("\u6B61\u8FCE\u56DE\u4F86\uFF0C" + data.user.name, "success");
      }
    } catch (e) {
      msgEl.textContent = "\u767B\u5165\u5931\u6557\uFF1A" + e.message;
      msgEl.classList.remove("hidden");
    }
  }

  // ── Auto login on page load ──
  async function autoLogin() {
    var loginName = localStorage.getItem("loginName");
    var loginId4 = localStorage.getItem("loginId4");
    if (!loginName || !loginId4) return false;

    try {
      var res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: loginName, idLast4: loginId4 })
      });
      var data = await res.json();
      if (!data.ok) {
        localStorage.removeItem("loginName");
        localStorage.removeItem("loginId4");
        localStorage.removeItem("userId");
        return false;
      }

      localStorage.setItem("userId", data.userId);

      // 檢查進行中的簽到
      if (data.sessions && data.sessions.length > 0) {
        var session = data.sessions[0];
        localStorage.setItem("sessionId", session.sessionId);
        localStorage.setItem("name", data.user.name);

        var timeStr = new Date(session.checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
        var infoText = data.user.name + " \u5DF2\u65BC " + timeStr + " \u7C3D\u5230";

        document.getElementById("checkin-info").textContent = infoText;
        document.getElementById("regular-info").textContent = infoText;
        document.getElementById("prescription-info").textContent = infoText;
        document.getElementById("admin-checkin-info").textContent = infoText;

        var checkinType = localStorage.getItem("checkinType");
        if (checkinType) {
          selectType(checkinType);
        } else {
          showSection("sec-type");
        }
        showToast("\u5DF2\u6062\u5FA9\u60A8\u7684\u7C3D\u5230\u4F5C\u696D\uFF08" + timeStr + " \u7C3D\u5230\uFF09", "success");
      } else {
        fillInfoFromUser(data.user);
        showSection("sec-info");
      }
      return true;
    } catch (e) {
      console.error("autoLogin:", e.message);
      return false;
    }
  }

  // ── Logout ──
  function doLogout() {
    localStorage.removeItem("loginName");
    localStorage.removeItem("loginId4");
    localStorage.removeItem("userId");
    localStorage.removeItem("sessionId");
    localStorage.removeItem("name");
    localStorage.removeItem("checkinType");
    showSection("sec-login");
    showToast("\u5DF2\u767B\u51FA", "success");
  }

  // ── Register ──
  async function doRegister() {
    var name = document.getElementById("reg-name").value.trim();
    var idNumber = document.getElementById("reg-idNumber").value.trim().toUpperCase();
    var eventName = document.getElementById("reg-eventName").value.trim();

    var workDescChecked = [].slice.call(document.querySelectorAll('#regWorkDescOptions input[type="checkbox"]:checked')).map(function (el) { return el.value; });
    var workDescOther = document.getElementById("regWorkDesc-other-text").value.trim();
    if (workDescChecked.includes("\u5176\u4ED6") && workDescOther) {
      workDescChecked = workDescChecked.filter(function (v) { return v !== "\u5176\u4ED6"; });
      workDescChecked.push(workDescOther);
    } else {
      workDescChecked = workDescChecked.filter(function (v) { return v !== "\u5176\u4ED6"; });
    }
    var workDesc = workDescChecked.join("\u3001");

    var feeTypes = [].slice.call(document.querySelectorAll('input[name="regFeeType"]:checked')).map(function (el) { return el.value; });
    var payMethod = document.querySelector('input[name="regPayMethod"]:checked');
    var address = document.getElementById("reg-address").value.trim();
    var phone = document.getElementById("reg-phone").value.trim();

    // Validation
    var valid = true;
    showErr("err-reg-name", !name); if (!name) valid = false;
    showErr("err-reg-idNumber", idNumber.length !== 10); if (idNumber.length !== 10) valid = false;
    showErr("err-reg-eventName", !eventName); if (!eventName) valid = false;
    showErr("err-reg-workDesc", workDescChecked.length === 0); if (workDescChecked.length === 0) valid = false;
    showErr("err-reg-feeType", feeTypes.length === 0); if (feeTypes.length === 0) valid = false;
    showErr("err-reg-payMethod", !payMethod); if (!payMethod) valid = false;
    showErr("err-reg-address", !address); if (!address) valid = false;
    showErr("err-reg-phone", !phone); if (!phone) valid = false;
    if (!valid) return;

    var bankInfo = null;
    if (payMethod.value === "\u532F\u6B3E") {
      bankInfo = {
        bankName: document.getElementById("reg-bankName").value.trim(),
        accountName: document.getElementById("reg-bankAccountName").value.trim(),
        account: document.getElementById("reg-bankAccount").value.trim()
      };
    }

    var sameAddr = document.getElementById("reg-sameAddr").checked;
    var liveAddress = sameAddr ? address : document.getElementById("reg-liveAddress").value.trim();

    try {
      var res = await fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name, idNumber: idNumber, eventName: eventName,
          workDescription: workDesc, feeTypes: feeTypes,
          payMethod: payMethod.value, bankInfo: bankInfo,
          address: address, liveAddress: liveAddress, phone: phone
        })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);

      // 自動登入
      localStorage.setItem("loginName", name);
      localStorage.setItem("loginId4", idNumber.slice(-4));
      localStorage.setItem("userId", data.userId);

      fillInfoFromUser(data.user);
      showSection("sec-info");
      showToast("\u8A3B\u518A\u6210\u529F\uFF01\u8ACB\u78BA\u8A8D\u8CC7\u6599\u5F8C\u6309\u7C3D\u5230", "success");
    } catch (e) {
      showToast("\u8A3B\u518A\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  // ── Step 1: Check-in ──
  async function doCheckin() {
    var name      = document.getElementById("name").value.trim();
    var eventName = document.getElementById("eventName").value.trim();
    var workDescChecked = [].slice.call(document.querySelectorAll('#workDescOptions input[type="checkbox"]:checked')).map(function (el) { return el.value; });
    var workDescOther = document.getElementById("workDesc-other-text").value.trim();
    if (workDescChecked.includes("\u5176\u4ED6") && workDescOther) {
      workDescChecked = workDescChecked.filter(function (v) { return v !== "\u5176\u4ED6"; });
      workDescChecked.push(workDescOther);
    } else {
      workDescChecked = workDescChecked.filter(function (v) { return v !== "\u5176\u4ED6"; });
    }
    var workDesc = workDescChecked.join("\u3001");
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
      name: name, eventName: eventName, workDescription: workDesc,
      feeTypes: feeTypes, payMethod: payMethod.value, bankInfo: bankInfo,
      idNumber: idNumber, address: address, liveAddress: liveAddress, phone: phone
    };

    try {
      var res  = await fetch("/checkin", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(receipt)
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);

      localStorage.setItem("sessionId", data.sessionId);
      localStorage.setItem("name", name);

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
    localStorage.setItem("checkinType", type);
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

  // ── Prescription: Add / Remove Course ──
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
    var sessionId = localStorage.getItem("sessionId");
    var name      = localStorage.getItem("name");
    if (!sessionId) { showToast("\u627E\u4E0D\u5230\u7C3D\u5230\u8A18\u9304\uFF0C\u8ACB\u91CD\u65B0\u767B\u5165", "error"); return; }

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
      var blocks = document.querySelectorAll("#prescription-courses .course-item");
      if (blocks.length === 0) { showErr("err-prescription-course", true); return; }
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

        if (!cName || !cType || cReg === "" || cAct === "" || cWalk === "" || !cSummary) valid2 = false;

        coursesData.push({
          course: cName, courseType: cType ? cType.value : "",
          teacher: cTeacher, registeredCount: parseInt(cReg) || 0,
          actualCount: parseInt(cAct) || 0, walkInCount: parseInt(cWalk) || 0,
          summary: cSummary
        });
      });

      if (!valid2) { showToast("\u8ACB\u5B8C\u6210\u6240\u6709\u8AB2\u7A0B\u7684\u5FC5\u586B\u6B04\u4F4D", "warning"); return; }

      courses = coursesData.map(function (c) { return c.course; });
      course = courses.join("\u3001");
      courseType = coursesData[0].courseType;
      teacher = coursesData[0].teacher;
      registeredCount = coursesData.reduce(function (s, c) { return s + c.registeredCount; }, 0);
      actualCount = coursesData.reduce(function (s, c) { return s + c.actualCount; }, 0);
      walkInCount = coursesData.reduce(function (s, c) { return s + c.walkInCount; }, 0);
      summary = coursesData.map(function (c) { return c.course + "\uFF1A" + c.summary; }).join("\uFF1B");
    }

    try {
      var res = await fetch("/checkout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          sessionId: sessionId, checkinType: type, course: course,
          courses: courses || [course], plannedHours: plannedHours || "",
          courseType: courseType, teacher: teacher,
          registeredCount: parseInt(registeredCount), actualCount: parseInt(actualCount),
          walkInCount: parseInt(walkInCount), summary: summary
        })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);

      document.getElementById("done-name").textContent  = "\u8B1D\u8B1D " + name + "\uFF01";
      document.getElementById("done-hours").textContent = "\u4ECA\u65E5\u5DE5\u4F5C\u6642\u6578\uFF1A" + data.hours + " \u5C0F\u6642";

      showSection("sec-done");
      localStorage.removeItem("sessionId");
      localStorage.removeItem("checkinType");
    } catch (e) {
      showToast("\u7C3D\u9000\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  // ── Step 3b: Check-out (Admin Tasks) ──
  async function doCheckoutAdmin() {
    var sessionId = localStorage.getItem("sessionId");
    if (!sessionId) { showToast("\u627E\u4E0D\u5230\u7C3D\u5230\u8A18\u9304", "error"); return; }

    var workNameSelect = document.getElementById("admin-workName").value;
    var workNameOther = document.getElementById("admin-workNameOther").value.trim();
    var workName = workNameSelect === "\u5176\u4ED6" ? workNameOther : workNameSelect;
    var workItems = document.getElementById("admin-workItems").value.trim();
    var feedback = document.getElementById("admin-feedback").value.trim();

    if (!workName) { showErr("err-admin-workName", true); return; }
    showErr("err-admin-workName", false);
    if (!workItems) { showErr("err-admin-workItems", true); return; }
    showErr("err-admin-workItems", false);

    var fileInput = document.getElementById("admin-files");

    try {
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
          sessionId: sessionId, checkinType: "\u884C\u653F\u5EB6\u52D9",
          course: workName, workContent: workItems,
          note: feedback, uploadedFiles: uploadedFiles
        })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error);

      document.getElementById("done-name").textContent = "\u8B1D\u8B1D " + localStorage.getItem("name") + "\uFF01";
      document.getElementById("done-hours").textContent = "\u4ECA\u65E5\u5DE5\u4F5C\u6642\u6578\uFF1A" + data.hours + " \u5C0F\u6642";
      showSection("sec-done");
      localStorage.removeItem("sessionId");
      localStorage.removeItem("checkinType");
    } catch (e) {
      showToast("\u7C3D\u9000\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  // ── Wire up event listeners ──
  document.addEventListener("DOMContentLoaded", async function () {
    // Try auto login
    var loggedIn = await autoLogin();
    if (!loggedIn) {
      showSection("sec-login");
    }

    // Login button
    var loginBtn = document.getElementById("btn-login");
    if (loginBtn) loginBtn.addEventListener("click", doLogin);

    // Login form enter key
    document.getElementById("login-id4").addEventListener("keydown", function (e) {
      if (e.key === "Enter") doLogin();
    });

    // Switch to register
    var gotoRegBtn = document.getElementById("btn-goto-register");
    if (gotoRegBtn) gotoRegBtn.addEventListener("click", function (e) {
      e.preventDefault();
      showSection("sec-register");
    });

    // Switch to login
    var gotoLoginBtn = document.getElementById("btn-goto-login");
    if (gotoLoginBtn) gotoLoginBtn.addEventListener("click", function (e) {
      e.preventDefault();
      showSection("sec-login");
    });

    // Register button
    var registerBtn = document.getElementById("btn-register");
    if (registerBtn) registerBtn.addEventListener("click", doRegister);

    // Register: pay method toggle bank fields
    document.querySelectorAll('input[name="regPayMethod"]').forEach(function (radio) {
      radio.addEventListener("click", function () {
        document.getElementById("reg-bank-fields").classList.toggle("hidden", this.value !== "\u532F\u6B3E");
      });
    });

    // Register: same address toggle
    var regSameAddr = document.getElementById("reg-sameAddr");
    if (regSameAddr) regSameAddr.addEventListener("change", function () {
      document.getElementById("reg-live-addr-fields").classList.toggle("hidden", this.checked);
    });

    // Register: work desc other toggle
    var regWorkDescOther = document.getElementById("regWorkDesc-other-cb");
    if (regWorkDescOther) regWorkDescOther.addEventListener("change", function () {
      document.getElementById("regWorkDesc-other-text").classList.toggle("hidden", !this.checked);
    });

    // Logout button
    var logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) logoutBtn.addEventListener("click", doLogout);

    // Pay method radio buttons (sec-info)
    document.querySelectorAll('input[name="payMethod"]').forEach(function (radio) {
      radio.addEventListener("click", function () {
        toggleBank(this.value === "\u532F\u6B3E");
      });
    });

    // Same address checkbox (sec-info)
    var sameAddrCb = document.getElementById("sameAddr");
    if (sameAddrCb) sameAddrCb.addEventListener("change", toggleSameAddr);

    // 工作內容「其他」toggle (sec-info)
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

    // Admin work name select
    var workNameSelect = document.getElementById("admin-workName");
    if (workNameSelect) workNameSelect.addEventListener("change", function () {
      document.getElementById("admin-workNameOther").classList.toggle("hidden", this.value !== "\u5176\u4ED6");
    });

    // File input
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

    // Back to type selection buttons
    ["btn-back-type-regular", "btn-back-type-prescription", "btn-back-type-admin"].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener("click", function () {
        localStorage.removeItem("checkinType");
        showSection("sec-type");
      });
    });
  });

})();

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
    ["sec-info", "sec-type", "sec-form-regular", "sec-form-prescription", "sec-done"]
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
      if (r.workDescription) document.getElementById("workDesc").value = r.workDescription;

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
    var workDesc  = document.getElementById("workDesc").value.trim();
    var feeTypes  = [].slice.call(document.querySelectorAll('input[name="feeType"]:checked')).map(function (el) { return el.value; });
    var payMethod = document.querySelector('input[name="payMethod"]:checked');
    var idNumber  = document.getElementById("idNumber").value.trim().toUpperCase();
    var address   = document.getElementById("address").value.trim();
    var phone     = document.getElementById("phone").value.trim();

    // Validation
    var valid = true;
    showErr("err-name",      !name);      if (!name) valid = false;
    showErr("err-eventName", !eventName); if (!eventName) valid = false;
    showErr("err-workDesc",  !workDesc);  if (!workDesc) valid = false;
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

      document.getElementById("checkin-info").textContent      = infoText;
      document.getElementById("regular-info").textContent      = infoText;
      document.getElementById("prescription-info").textContent = infoText;

      showSection("sec-type");
    } catch (e) {
      showToast("\u7C3D\u5230\u5931\u6557\uFF1A" + e.message, "error");
    }
  }

  // ── Step 2: Select type ──
  function selectType(type) {
    sessionStorage.setItem("checkinType", type);
    showSection(type === "regular" ? "sec-form-regular" : "sec-form-prescription");
  }

  // ── Prescription: Add / Remove Course ──
  var courseCount = 1;

  function addCourse() {
    courseCount++;
    var container = document.getElementById("prescription-courses");
    var div = document.createElement("div");
    div.className = "course-item";
    div.dataset.index = courseCount;
    div.innerHTML =
      '<div class="course-item-header">' +
      '  <span>\u8AB2\u7A0B ' + courseCount + '</span>' +
      '  <button class="course-remove" data-action="remove-course">\u2715 \u79FB\u9664</button>' +
      '</div>' +
      '<input type="text" class="prescription-course-name" placeholder="\u8ACB\u8F38\u5165\u8AB2\u7A0B\u540D\u7A31">';
    container.appendChild(div);
  }

  function removeCourse(btn) {
    btn.closest(".course-item").remove();
    document.querySelectorAll("#prescription-courses .course-item").forEach(function (el, i) {
      el.querySelector(".course-item-header span").textContent = "\u8AB2\u7A0B " + (i + 1);
    });
  }

  // ── Character count ──
  document.addEventListener("input", function (e) {
    if (e.target.id === "regular-summary")
      document.getElementById("regular-char-count").textContent = e.target.value.length;
    if (e.target.id === "prescription-summary")
      document.getElementById("prescription-char-count").textContent = e.target.value.length;
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
      courses = [].slice.call(document.querySelectorAll(".prescription-course-name"))
                  .map(function (el) { return el.value.trim(); }).filter(function (v) { return v; });
      var ct2 = document.querySelector('input[name="prescription-courseType"]:checked');
      teacher = document.getElementById("prescription-teacher").value.trim();
      registeredCount = document.getElementById("prescription-registeredCount").value;
      actualCount     = document.getElementById("prescription-actualCount").value;
      walkInCount     = document.getElementById("prescription-walkInCount").value;
      summary         = document.getElementById("prescription-summary").value.trim();

      var valid2 = true;
      showErr("err-prescription-course",    courses.length === 0); if (courses.length === 0) valid2 = false;
      showErr("err-prescription-courseType", !ct2);                  if (!ct2) valid2 = false;
      showErr("err-prescription-reg",       registeredCount === ""); if (registeredCount === "") valid2 = false;
      showErr("err-prescription-act",       actualCount === "");     if (actualCount === "") valid2 = false;
      showErr("err-prescription-walk",      walkInCount === "");     if (walkInCount === "") valid2 = false;
      showErr("err-prescription-summary",   !summary);               if (!summary) valid2 = false;
      if (!valid2) return;

      course     = courses.join("\u3001");
      courseType  = ct2.value;
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
  });

})();

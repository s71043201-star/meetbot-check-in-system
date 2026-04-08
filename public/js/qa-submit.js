/* ============================================
   qa-submit.js  --  QA Submit Form Logic
   ============================================ */
(function () {
  "use strict";

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

  async function submit() {
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

  document.getElementById("btn-submit").addEventListener("click", submit);

  document.getElementById("btn-new").addEventListener("click", function (e) {
    e.preventDefault();
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

})();

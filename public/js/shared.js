(function () {
  "use strict";

  // ── XSS 防護 ──
  function escapeHtml(str) {
    if (!str) return "";
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(str).replace(/[&<>"']/g, c => map[c]);
  }

  // ── 時間格式化 ──
  function formatTime(iso) {
    if (!iso) return "-";
    return new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  }

  // ── Toast 通知 ──
  let toastContainer = null;

  function showToast(message, type = "info", duration = 3000) {
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.className = "toast-container";
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("toast--out");
      toast.addEventListener("animationend", () => toast.remove());
    }, duration);
  }

  // ── Fetch 包裝 ──
  async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // 匯出至全域
  window.SharedUtils = { escapeHtml, formatTime, showToast, fetchJSON };
})();

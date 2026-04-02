/* ============================================
   shared.js  --  Shared Utilities
   ============================================ */

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return "";
  var div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/**
 * Format an ISO date string to HH:MM locale time.
 */
function formatTime(isoStr) {
  if (!isoStr) return "-";
  return new Date(isoStr).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Show a toast notification.
 * @param {string} message - The message to display.
 * @param {"success"|"error"|"warning"|"info"} type - Toast variant.
 * @param {number} duration - Auto-dismiss time in ms (default 3500).
 */
function showToast(message, type, duration) {
  type = type || "info";
  duration = duration || 3500;

  var container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  var icons = {
    success: "\u2705",
    error:   "\u274C",
    warning: "\u26A0\uFE0F",
    info:    "\u2139\uFE0F"
  };

  var toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.innerHTML =
    '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>' +
    '<span class="toast-message">' + escapeHtml(message) + '</span>' +
    '<button class="toast-close" aria-label="close">&times;</button>';

  container.appendChild(toast);

  var closeBtn = toast.querySelector(".toast-close");
  closeBtn.addEventListener("click", function () { dismiss(); });

  var timer = setTimeout(function () { dismiss(); }, duration);

  function dismiss() {
    clearTimeout(timer);
    toast.classList.add("toast-exit");
    toast.addEventListener("animationend", function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
  }
}

/**
 * Fetch JSON helper with error handling.
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<any>}
 */
async function fetchJSON(url, options) {
  var res = await fetch(url, options);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed (" + res.status + ")");
  }
  return data;
}

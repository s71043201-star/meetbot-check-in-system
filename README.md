# MeetBot 臨時人員出缺勤打卡系統

健康台灣深耕計畫的整合型行政平台：以 LINE 官方帳號為核心，整合臨時人員線上簽到簽退、出勤後台管理、問題回報（QA）、會議與任務進度提醒，並串接 Slack 通知與 Firebase 即時資料庫，部署於 Render。

---

## 主要功能

### 1. 臨時人員出缺勤（`/checkin.html`、`/admin.html`）
- **線上註冊／登入**：臨時人員以姓名 + 身分證號碼註冊，並以「姓名 + 身分證後 4 碼」登入。
- **簽到 / 簽退**：記錄簽到、簽退時間，自動計算工時（民國年、月、日），支援「一般／處方日／行政庶務」多種打卡類型與多課程記錄。
- **課程記錄頁**：簽退後自動產生可列印／另存 PDF 的課程記錄頁（暫存於 Firebase，7 天後自動清除）。
- **檔案上傳**：行政庶務類型可上傳檔案（最多 10 個、每個上限 10MB），透過 Firebase Storage 儲存。
- **後台管理**：出勤記錄查詢（支援分頁）、編輯、軟刪除、批次刪除、還原，以及使用者資料管理；操作會寫入審計日誌（audit log）。後台以密碼驗證。
- **領據／報表匯出**：匯出 Excel 出勤記錄（依姓名／月／年）、匯出 Word 領據檔。

### 2. 問題回報管理（QA，`/qa.html`）
- 民眾／單位線上提問（提問單位、聯絡人、聯絡方式、類別、優先等級）。
- 後台回覆、改狀態（待處理／處理中／已回覆／已結案）、批次更新狀態、軟刪除、封存。
- 統計（依狀態／單位／類別）、Excel 匯出，以及依聯絡方式的公開查詢。

### 3. LINE 官方帳號機器人（Webhook）
- LINE 訊息 Webhook（`/webhook`），支援文字指令互動：
  - `工作`：查詢個人待辦任務
  - `進度`：查看全團隊任務進度報告
  - `下載`：取得任務進度報告（PDF）連結
  - `提醒 [姓名]`：向指定成員發出工作提醒（LINE + Slack）
  - `臨時人員 [月份]`：查詢某月臨時人員出勤統計
  - 系統關鍵字（週報、會議、歷次列管、簽到、後台、問題回報）：回傳對應系統網址，部分附 QR Code
  - `指令` / `說明`：列出可用指令
- **圖文選單（Rich Menu）**：提供一般使用者、管理員（6 格）、特定使用者三種圖文選單的建立與綁定（`/setup-richmenu` 等，需密碼）。
- **LINE 額度查詢**：`/line-quota` 查詢本月訊息用量。

### 4. 任務 / 會議排程與通知（`src/scheduler.js`）
- 內建排程器（每分鐘輪詢，以台北時區運作，僅平日）：
  - 例行任務（routine task）每週指定時間提醒（透過 Slack 私訊）。
  - 會議提醒：於會議前 7 / 3 / 1 天自動發送 Slack 通知（每日 8:00–20:00 整點檢查）。
  - 下午工作進度提醒（16:30 / 16:50）目前以開關關閉，保留程式碼。
- 提供 API 供前端任務系統呼叫：`/check-reminders`、`/notify-new-task`、`/notify-task-done`、`/check-meeting-reminders`、`/send-slack`。

### 5. AI 會議記錄解析（`src/routes/meetbot.js`）
- `/parse-meeting`：以 Google Gemini 解析會議紀錄文字，自動抽取任務（負責人、描述、截止日）並回傳 JSON。
- `/gemini-proxy`：Gemini API 代理。
- `/export-pdf`：產生全團隊任務進度報告 HTML（可另存 PDF）。

### 6. 維運輔助
- 健康檢查：`/health`、`/ping`。
- 自我 ping（每 14 分鐘）以避免 Render 免費方案休眠。
- CORS 白名單與 API 速率限制（一般 100 次／15 分鐘；登入、註冊 10 次／15 分鐘）。

---

## 技術棧

- **執行環境**：Node.js
- **Web 框架**：Express 4
- **資料庫**：Firebase Realtime Database（透過 REST API 存取）
- **檔案儲存**：Firebase Storage（firebase-admin）
- **HTTP 客戶端**：axios
- **檔案上傳**：multer
- **Excel 產生**：exceljs
- **速率限制**：express-rate-limit
- **AI**：Google Gemini API（會議記錄解析）
- **外部整合**：LINE Messaging API、Slack（Incoming Webhook + Bot Token）
- **部署平台**：Render

---

## 專案結構

```
.
├── server.js                  # Express 進入點：中介層、CORS、速率限制、掛載路由、啟動排程器
├── setup-richmenu.js          # 圖文選單建立工具腳本
├── package.json
├── public/                    # 前端靜態頁面
│   ├── checkin.html           # 臨時人員出缺勤系統（簽到/簽退/註冊）
│   ├── admin.html             # 出缺勤後台管理
│   ├── qa.html                # 問題回報管理系統
│   ├── wake.html              # 喚醒頁
│   ├── richmenu-*.jpg/png     # 圖文選單圖片
│   ├── css/ 、 js/            # 前端樣式與腳本
└── src/
    ├── config.js              # 成員名單、權限、Firebase/Slack 端點、各類設定
    ├── firebase.js            # Firebase Realtime DB 存取（任務、出勤、使用者、QA、審計）
    ├── line.js                # LINE 訊息發送（push / reply / quick reply）
    ├── slack.js               # Slack 頻道與私訊發送
    ├── scheduler.js           # 排程器（例行任務、會議提醒）
    ├── storage.js             # Firebase Storage 檔案上傳
    ├── utils.js               # 課程記錄暫存、時區/民國年換算、過期清理等工具
    ├── routes/
    │   ├── webhook.js         # LINE Webhook 與指令處理
    │   ├── attendance.js      # 註冊/登入/簽到/簽退/記錄管理/檔案上傳
    │   ├── meetbot.js         # AI 解析、任務/會議提醒 API、PDF 報告
    │   ├── questions.js       # 問題回報（QA）API 與 Excel 匯出
    │   ├── richmenu.js        # 圖文選單建立/綁定、LINE 額度、Slack 測試
    │   └── export.js          # Excel/Word 匯出、課程記錄下載
    └── templates/
        ├── excel-builder.js   # 出勤 Excel 工作表
        ├── export-full-html.js# 領據 Word HTML
        ├── export-word-html.js# 任務報告 Word HTML
        └── record-html.js     # 課程記錄頁 HTML
```

---

## 本機安裝與啟動

需求：Node.js（建議 18 以上）。

```bash
# 1. 取得原始碼
git clone https://github.com/s71043201-star/meetbot-check-in-system.git
cd meetbot-check-in-system

# 2. 安裝相依套件
npm install

# 3. 設定環境變數（見下方清單，可使用 .env 或於 shell 匯出）

# 4. 啟動服務
npm start
```

啟動後預設監聽 `PORT`（未設定時為 `3000`），根路徑 `/` 會導向 `/checkin.html`。

主要頁面：
- 簽到系統：`http://localhost:3000/checkin.html`
- 後台管理：`http://localhost:3000/admin.html`
- 問題回報：`http://localhost:3000/qa.html`

> 注意：出勤、QA、任務等資料皆存於 Firebase Realtime Database，本機啟動仍會連線至 `config.js` 中設定的 Firebase 端點。若需獨立環境，請另行設定對應的 Firebase 環境變數。

---

## 環境變數

以下為程式碼中實際使用（`process.env.XXX`）的環境變數：

| 變數 | 用途 | 備註 |
| --- | --- | --- |
| `PORT` | 服務監聽埠 | 預設 `3000` |
| `LINE_TOKEN` | LINE Messaging API Channel Access Token | LINE 訊息發送與圖文選單必填 |
| `GEMINI_API_KEY` | Google Gemini API 金鑰 | AI 會議記錄解析 `/parse-meeting`、`/gemini-proxy` 用 |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase 服務帳戶 JSON（字串） | 檔案上傳（Firebase Storage）用 |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | 頻道通知用 |
| `SLACK_BOT_TOKEN` | Slack Bot Token | 私訊（DM）通知用 |
| `ADMIN_PASSWORD` | 後台管理密碼 | 預設 `Tpma` |
| `SETUP_SECRET` | 圖文選單設定端點的存取密鑰 | 預設 `meetbot2024` |
| `ALLOWED_ORIGINS` | CORS 允許來源（逗號分隔） | 有預設清單 |
| `BASE_URL` | 課程記錄下載連結的網址前綴 | 預設 Render 網址 |
| `RENDER_EXTERNAL_URL` | 自我 ping 用的對外網址 | 由 Render 提供；未設定時用本機 |
| `TASKS_FB` | 任務 Firebase 端點 | 有預設值 |
| `ROUTINE_TASKS_FB` | 例行任務 Firebase 端點 | 有預設值 |
| `ATT_FB` | 出勤 Firebase 端點 | 有預設值 |
| `USERS_FB` | 使用者 Firebase 端點 | 有預設值 |
| `QA_FB` | 問題回報 Firebase 端點 | 有預設值 |
| `MEETINGS_FB` | 會議 Firebase 端點 | 有預設值 |

> 凡標註「有預設值／預設」者，未設定時程式會採用程式碼內建值；正式環境建議明確設定金鑰類與密碼類變數（`LINE_TOKEN`、`GEMINI_API_KEY`、`FIREBASE_SERVICE_ACCOUNT`、`SLACK_*`、`ADMIN_PASSWORD`、`SETUP_SECRET`）。

---

## 部署（Render）

本系統設計部署於 [Render](https://render.com)。

1. 於 Render 建立 **Web Service**，連結此 GitHub repository。
2. 設定：
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`（即 `node server.js`）
3. 在 Render 的 **Environment** 設定上述環境變數（至少 `LINE_TOKEN`、`GEMINI_API_KEY`、`FIREBASE_SERVICE_ACCOUNT`、`SLACK_WEBHOOK_URL`、`SLACK_BOT_TOKEN`、`ADMIN_PASSWORD`、`SETUP_SECRET`）。Render 會自動提供 `PORT` 與 `RENDER_EXTERNAL_URL`。
4. 部署完成後：
   - 將 LINE 官方帳號的 Webhook URL 設為 `https://<你的網域>/webhook`。
   - 首次需建立／綁定圖文選單時，造訪 `https://<你的網域>/setup-richmenu?secret=<SETUP_SECRET>`（以及 `/setup-admin-menu`、`/setup-huifang-menu` 等）。

> 系統內建每 14 分鐘對自身 `/ping` 一次，以避免 Render 免費方案因閒置而休眠；首次冷啟動約需數秒。

---

## 授權與用途

本專案為「健康台灣深耕計畫」內部行政自動化使用，包含特定團隊成員名單與權限設定（見 `src/config.js`）。

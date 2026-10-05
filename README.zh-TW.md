# Slides Agent

讓 **Codex 透過你已登入的 Chrome 操作 Google Slides** 的本機 MCP 開源工具。提供截圖、無障礙資訊、點擊、拖曳、文字輸入、快捷鍵、圖片上傳及匯出下載追蹤；由 Codex 判斷下一步並檢查結果。

[English](README.md) · [驗證狀態](docs/VALIDATION.md) · [工具介面](docs/TOOLS.md) · [真實簡報驗收](docs/ACCEPTANCE.md)

**目前是實驗版本。** 隔離瀏覽器中的工具整合測試，不能證明 Google Slides 原生動畫、轉場和保存流程已通過。請先使用測試簡報，依驗收文件檢查。功能覆蓋與穩定性逐項累積。

## 安裝

需要 Windows、Node.js **24 以上**、Chrome **125 以上**、支援本機 MCP 的 Codex 桌面版，以及有簡報編輯權限的 Google 帳戶。

```powershell
git clone https://github.com/MatthewMung/slides-agent.git
cd slides-agent
npm ci
npm run build
npm run setup
```

也可下載 GitHub ZIP 解壓後執行。發佈 ZIP 附帶建置成果，CLI 的依賴仍需 `npm ci` 安裝。

1. 開啟 `chrome://extensions`，啟用「開發人員模式」，選擇「載入未封裝項目」，指定專案的 `dist/extension` 資料夾。擴充功能專用 ZIP 則選擇解壓後含有 `manifest.json` 的資料夾。
2. 在終端機執行 `npm run bridge`，保持它運行。
3. 在另一個終端機執行 `npm run setup -- --show-token`，取得本機配對憑證。
4. 點開 Slides Agent 擴充功能，填入連接埠與憑證，再按「Connect／連接」，確認顯示 Connected。
5. `npm run setup` 會印出使用正確絕對路徑的 Codex MCP 設定。將設定加入 Codex，或在 MCP 設定介面登記相同指令：

   ```toml
   [mcp_servers.slides-agent]
   command = "node"
   args = ["C:/你的路徑/slides-agent/dist/src/cli.js", "mcp"]
   ```

   TOML 路徑使用 `/`，或將 `\` 寫成 `\\`。重新連接 MCP 或開啟新的聊天。MCP 指令直接使用 `node`，避免 npm 標頭文字干擾 stdio。

6. 可將專案的 `skills/slides-agent` 資料夾複製到個人 Codex skills 目錄，提供「觀察 → 操作 → 驗證」的操作指引。
7. 在 Chrome 開啟測試簡報，執行 `npm run doctor` 檢查橋接和擴充功能是否已連接。

Google 登入保留在你自己的 Chrome。工具無需另設 OpenAI API 金鑰、Google OAuth 或雲端服務；模型使用由你的 Codex 帳戶提供。

## 使用範例

> 使用 Slides Agent 操作我開啟的測試簡報。把第 3 頁的要點設定為按一下逐段淡入，查看動畫面板並播放確認。告訴我實際驗證到的結果，完成後釋放控制。

工具回傳「操作已送出」，Codex 應根據更新畫面確認效果。手動操作、切換分頁、改變視窗尺寸或遇到不明結果後，先重新觀察。舊快照與座標不能重用。

## 停止與重新配對

- 擴充功能的「立即停止操作」會解除控制；橋接仍可接受新工作階段。
- 「斷開連線」也會停止自動重連。
- MCP 客戶端關閉或擴充功能斷線時停止操作；重新連接不會重送舊操作。
- 撤銷配對：關閉橋接 → `npm run setup -- --rotate` → 重啟橋接和 MCP → 在本機顯示新憑證並重新配對。更換連接埠可加 `--port 32146`。

憑證儲存在 `%APPDATA%/slides-agent/config.json` 與 Chrome 擴充功能本機儲存空間。保留在本機，不要放進 GitHub、聊天或截圖。測試可使用 `SLIDES_AGENT_CONFIG` 指定其他本機設定檔。

Chrome 會在控制時顯示偵錯通知，企業政策可能禁止連接。Chrome 的 debugger／downloads 權限範圍較廣，程式會限制操作所選簡報。截圖及可見文字傳給 MCP 客戶端，可能由其模型服務處理；上傳圖片會傳到 Google。登入、帳戶設定和作業系統對話框由使用者處理。

PDF／PPTX 匯出只有在下載完成、檔案存在且標頭符合時才算確認成功。若 Chrome 啟用「下載前詢問每個檔案的儲存位置」，需手動完成另存新檔對話框；全自動匯出則需自行關閉該設定。

## 開發與打包

```powershell
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run package
```

瀏覽器測試使用真正的擴充功能、橋接和 MCP 程式，搭配隔離 Chromium 與本機測試頁面，不會修改 Google 簡報。測試紀錄放在 `artifacts/`；發佈 ZIP 放在 `release/`。兩者均不納入 Git。真實簡報測試請依 [驗收流程](docs/ACCEPTANCE.md) 執行。

遇到 `STALE_SNAPSHOT` 應重新觀察；`ACTION_RESULT_UNKNOWN` 應先檢查結果，避免重複編輯。若無法連接，先跑 `npm run doctor`，再檢查連接埠、配對憑證或其他占用偵錯介面的工具。

GitHub 發佈與 ChatGPT／Chrome 商店上架是不同流程。首版提供原始碼與本機安裝方式；Edge、macOS 和 ChatGPT 網頁版尚未驗證。MIT 授權。

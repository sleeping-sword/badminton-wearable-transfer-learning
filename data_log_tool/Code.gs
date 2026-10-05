/**
 * 受試資料紀錄工具（Google Apps Script，建議綁定在「2026受試紀錄」試算表上）
 *
 * 功能：
 *   - 每隔 CONFIG.POLL_MINUTES 分鐘掃描「2026」資料夾，把新增的 json 檔登記到試算表
 *   - 資料夾結構：2026 / 2026_10_01 / 20261001_挑 / garmin_20261001_205712.json
 *   - 每個 json 一列：日期｜檔名+球種（連到該檔案）｜影片上傳空間（連到「2026_10_01影片」資料夾）｜影片檔名
 *   - 影片檔名（例：20261001_195336高）給上傳影片的同學複製，當作影片的檔名
 *   - 偵測到新的日期資料夾時，自動在裡面建立「2026_10_01影片」資料夾（與球種資料夾同層）
 *   - 以檔案 ID 判斷是否登記過，重複執行不會產生重複列
 *
 * 安裝：執行一次 installTrigger()（或試算表選單「受試紀錄 → 啟用自動偵測」）並同意授權。
 * Apps Script 沒有「資料夾新增檔案」的即時觸發器，所以用定時掃描。
 */

const CONFIG = {
  ROOT_FOLDER_ID: '1AQdJD98awENszc-wcyAhL1Ny-w4QARrx', // 「2026」資料夾
  SPREADSHEET_ID: '1iG5-k18BCcz0fScDL-FeRJq0CMWkeRkC3Oeonm46bMw',
  SHEET_GID: 0,

  HEADERS: ['日期', '檔案', '影片上傳空間', '影片檔名'],
  DATE_FOLDER_PATTERN: /^\d{4}_\d{2}_\d{2}$/, // 2026_10_01
  STROKES: ['高', '推', '挑'],
  VIDEO_FOLDER_SUFFIX: '影片',
  POLL_MINUTES: 5, // 只能是 1、5、10、15、30
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('受試紀錄')
    .addItem('立即同步', 'syncNewFiles')
    .addItem('啟用自動偵測', 'installTrigger')
    .addItem('停用自動偵測', 'removeTrigger')
    .addToUi();
}

function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('syncNewFiles').timeBased().everyMinutes(CONFIG.POLL_MINUTES).create();
  syncNewFiles();
}

function removeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncNewFiles')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** 掃描 2026 資料夾，把尚未登記的 json 檔新增到試算表。 */
function syncNewFiles() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // 上一次掃描還沒跑完
  try {
    const sheet = getSheet_();
    fillMissingVideoNames_(sheet);
    const known = getRegisteredFileIds_(sheet);
    const rows = [];

    const dateFolders = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID).getFolders();
    while (dateFolders.hasNext()) {
      const dateFolder = dateFolders.next();
      const date = dateFolder.getName().trim();
      if (!CONFIG.DATE_FOLDER_PATTERN.test(date)) continue;

      const videoName = date + CONFIG.VIDEO_FOLDER_SUFFIX;
      const videoFolder = getOrCreateFolder_(dateFolder, videoName);

      const strokeFolders = dateFolder.getFolders();
      while (strokeFolders.hasNext()) {
        const strokeFolder = strokeFolders.next();
        const stroke = getStroke_(strokeFolder.getName());
        if (!stroke) continue;

        const files = strokeFolder.getFiles();
        while (files.hasNext()) {
          const file = files.next();
          if (!/\.json$/i.test(file.getName()) || known.has(file.getId())) continue;
          rows.push({
            date: date,
            label: buildLabel_(file.getName(), stroke),
            fileUrl: file.getUrl(),
            videoName: videoName,
            videoUrl: videoFolder.getUrl(),
          });
        }
      }
    }

    if (!rows.length) return;
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
    const values = rows.map(r => [
      richText_(r.date),
      richText_(r.label, r.fileUrl),
      richText_(r.videoName, r.videoUrl),
      richText_(buildVideoName_(r.label)),
    ]);
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, CONFIG.HEADERS.length).setRichTextValues(values);
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === CONFIG.SHEET_GID);
  if (!sheet) throw new Error('找不到 gid=' + CONFIG.SHEET_GID + ' 的分頁');
  const header = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length);
  // 第一次執行，或舊版建立的表頭少了後來新增的欄位
  if (header.getDisplayValues()[0].join('|') !== CONFIG.HEADERS.join('|')) {
    sheet.getRange(1, 1, sheet.getMaxRows(), CONFIG.HEADERS.length).setNumberFormat('@'); // 純文字，避免日期被自動轉換
    header.setValues([CONFIG.HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 補上舊資料列缺少的「影片檔名」（由「檔案」欄的檔名推得）。 */
function fillMissingVideoNames_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const labels = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
  const range = sheet.getRange(2, 4, lastRow - 1, 1);
  const names = range.getDisplayValues();
  let changed = false;
  names.forEach((row, i) => {
    const label = labels[i][0].trim();
    if (row[0].trim() || !label) return;
    row[0] = buildVideoName_(label);
    changed = true;
  });
  if (changed) range.setValues(names);
}

/** 從「檔案」欄的超連結取出已登記的檔案 ID。 */
function getRegisteredFileIds_(sheet) {
  const ids = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return ids;
  sheet.getRange(2, 2, lastRow - 1, 1).getRichTextValues().forEach(row => {
    const cell = row[0];
    const url = cell.getLinkUrl() || cell.getRuns().map(r => r.getLinkUrl()).find(Boolean);
    const match = url && url.match(/[-\w]{25,}/);
    if (match) ids.add(match[0]);
  });
  return ids;
}

function getOrCreateFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

/** 20261001_挑 → 挑；影片資料夾或其他資料夾回傳 null。 */
function getStroke_(folderName) {
  if (folderName.endsWith(CONFIG.VIDEO_FOLDER_SUFFIX)) return null;
  const suffix = folderName.split('_').pop();
  return CONFIG.STROKES.find(s => suffix.indexOf(s) !== -1) || null;
}

/** garmin_20261001_205712.json + 挑 → garmin_20261001_205712挑.json */
function buildLabel_(fileName, stroke) {
  return fileName.replace(/\.json$/i, '') + stroke + '.json';
}

/** garmin_20261001_205712挑.json → 20261001_205712挑 */
function buildVideoName_(label) {
  return label.replace(/^garmin_/i, '').replace(/\.json$/i, '');
}

function richText_(text, url) {
  const builder = SpreadsheetApp.newRichTextValue().setText(text);
  if (url) builder.setLinkUrl(url);
  return builder.build();
}

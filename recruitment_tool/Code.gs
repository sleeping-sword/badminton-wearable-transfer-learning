/**
 * 受試者招募表單工具（Google Apps Script，綁定在「表單回覆」試算表上）
 *
 * 功能：
 *   - 網頁版（手機可用）與試算表內面板共用同一個介面，皆需帳號密碼登入
 *   - 即時讀取所有表單回覆，每位受試者一顆按鈕，點開可看全部欄位
 *   - 「time table」分頁：依 CONFIG.SESSIONS 切成每 20 分鐘一場的時段
 *   - 選時段後寄出邀請信 / 建立草稿，time table 自動填入受試者，已排的時段不會再出現在選單
 *   - 時段表可進入編輯模式手動移動受試者、勾選受試者已回覆確認
 *   - 讀取 Gmail 中受試者對邀請信的回覆（只看主旨含 REPLY_SUBJECT_KEYWORD 的信）
 *   - 報名人數上限：回覆數達上限時自動關閉表單
 *   - 標記受試者退出：釋出時段、從名單與統計中隱藏（資料保留，可恢復）
 *   - 特殊情況信件：資料有誤或時段已額滿時，先寄信與受試者確認（不排時段）
 *   - 「收支表」分頁：登記收入與支出（受試者費 / 教練費 / 其他）；登記受試者費會自動勾選「受測完畢」
 *   - 更正收件人 Email：受試者填錯時可在面板更正（存在「更正 Email」欄，表單原始回覆不變）
 *   - 測驗前提醒信：測驗開始前 REMINDER_MINUTES 分鐘自動寄出，文字與附加圖片可在面板修改
 *
 * 帳密不寫在程式碼中：由試算表選單「受試者工具 → 設定登入帳密」設定，
 * 以加鹽 SHA-256 存在 Script Properties。
 */

const CONFIG = {
  SHEET_NAME: '表單回覆 1',
  STATUS_HEADER: '邀請信狀態',
  WITHDRAWN_HEADER: '退出',
  TESTED_HEADER: '受測完畢',
  SPECIAL_HEADER: '特殊信件',
  EMAIL_FIX_HEADER: '更正 Email', // 有填時取代表單填寫的 Email
  TIMETABLE_SHEET: 'time table',
  FINANCE_SHEET: '收支表',

  // 測驗場次：每場 SLOT_MINUTES 分鐘，場與場之間留 BUFFER_MINUTES 分鐘
  // 修改後需刪除「time table」分頁，下次開啟面板時會依新設定重建
  SESSIONS: [
    { date: '2026/10/01（四）', start: '19:40', end: '21:00' },
    { date: '2026/10/06（二）', start: '19:40', end: '21:00' },
    { date: '2026/10/13（二）', start: '19:40', end: '21:00' },
    { date: '2026/10/15（四）', start: '19:40', end: '21:00' },
    { date: '2026/10/17（六）', start: '11:00', end: '17:00' },
  ],
  SLOT_MINUTES: 20,
  BUFFER_MINUTES: 0, // 每場之間的緩衝，0 = 時段連續排

  // 邀請信內容設定（可直接在面板中再修改每封信）
  SUBJECT: '【羽球揮拍動作分析研究】測驗時間邀請',
  SPECIAL_SUBJECT: '【羽球揮拍動作分析研究】報名資料確認', // 特殊情況信件主旨（需含 REPLY_SUBJECT_KEYWORD 才讀得到回覆）
  LOCATION: '政大體育館內一樓',
  DURATION: '約 20 分鐘',
  SENDER: '政大資科系羽球揮拍動作分析團隊', // 寄件者顯示名稱
  SIGNATURE: [                               // 信件結尾署名
    '政大資科系羽球揮拍動作分析團隊',
    '負責人：112703026 蔡芝帆',
  ],
  NOTES: [
    '請穿著方便運動的服裝與運動鞋。',
    '若有慣用球拍，歡迎自行攜帶。',
    '若當天身體不適或臨時無法出席，請提前回信告知。',
  ],

  // 測驗前提醒信（主旨、內容、附加圖片在面板「提醒信」中修改，這裡只是預設值）
  REMINDER_MINUTES: 10, // 測驗開始前幾分鐘寄出
  REMINDER_SUBJECT: '【羽球揮拍動作分析研究】測驗即將開始提醒',
  REMINDER_MAX_IMAGES: 5,
  REMINDER_MAX_IMAGE_MB: 5,
  REMINDER_FOLDER_NAME: '受試者工具－提醒信附件', // 附加圖片存放的雲端硬碟資料夾

  // 讀取受試者回覆：只看主旨包含此關鍵字、且是受試者寄來的信（其他私人信件不會被讀取）
  REPLY_SUBJECT_KEYWORD: '羽球揮拍動作分析研究',
  REPLY_SEARCH_DAYS: 90,

  FORM_CLOSED_MESSAGE: '報名人數已額滿，感謝您的關注！',

  SESSION_SECONDS: 6 * 60 * 60, // 登入有效時間（CacheService 上限 6 小時）
  MAX_FAILED_LOGINS: 10,        // 連續失敗次數達上限即暫停登入
  LOCKOUT_SECONDS: 15 * 60,
};

// 用表頭關鍵字對應欄位，表單題目順序變動也不受影響
const FIELD_KEYWORDS = {
  timestamp: '時間戳記',
  name: '姓名',
  studentId: '學號',
  dept: '系級',
  email: 'Email',
  experience: '接觸羽球',
  level: '程度',
  dates: '哪些日期',
  saturday: '週六',
  preferred: '最希望',
};

const TIMETABLE_HEADERS = ['日期', '時間', '姓名', 'Email', '回覆列號', '更新時間', '已確認', '提醒信'];
const CONFIRMED_MARK = '已確認';
const EMPTY_ASSIGNMENT = ['', '', '', '', '', '']; // 姓名～提醒信（C:H）
const REMINDER_COLUMN = TIMETABLE_HEADERS.length;
const REMINDER_HANDLER = 'sendDueReminders';

const MODE_LABELS = { send: '已寄出', draft: '已建立草稿', assign: '已安排（未寄信）' };

const FINANCE_HEADERS = ['編號', '日期', '收支', '類別', '金額', '受試者', '回覆列號', '來源／用途', '備註', '登記時間'];
const FINANCE_FORMATS = ['@', '@', '@', '@', '#,##0', '@', '0', '@', '@', '@'];
const FINANCE_CATEGORIES = {
  income: { type: '收入', label: '收入' },
  subjectFee: { type: '支出', label: '受試者費' },
  coachFee: { type: '支出', label: '教練費' },
  other: { type: '支出', label: '其他' },
};

// ───────────────────────── 入口 ─────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('受試者工具')
    .addItem('開啟受試者面板', 'showDialog')
    .addItem('設定登入帳密', 'setupCredentials')
    .addItem('設定報名人數上限', 'setupResponseLimit')
    .addToUi();
}

function showDialog() {
  SpreadsheetApp.getUi().showModalDialog(buildPage_().setWidth(1200).setHeight(780), '受試者資料與邀請信');
}

/** 網頁版入口（部署為網頁應用程式） */
function doGet() {
  return buildPage_()
    .setTitle('受試者資料與邀請信')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function buildPage_() {
  return HtmlService.createHtmlOutputFromFile('Index');
}

// ───────────────────────── 登入 ─────────────────────────

/** 試算表選單：設定帳密（只有能編輯此試算表的人能執行） */
function setupCredentials() {
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt('設定登入帳密', '帳號：', ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK || !u.getResponseText().trim()) return;
  const p = ui.prompt('設定登入帳密', '密碼：', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK || !p.getResponseText()) return;

  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    AUTH_USER: u.getResponseText().trim(),
    AUTH_SALT: salt,
    AUTH_HASH: hash_(salt, p.getResponseText()),
    // 網頁版沒有「目前開啟的試算表」，記下 ID 供 doGet 使用
    SPREADSHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(),
  });
  ui.alert('已設定完成。更改帳密後，所有已登入的裝置會在登入時效到期後需重新登入。');
}

function hash_(salt, password) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

/** 前端呼叫：登入成功回傳 token */
function login(username, password) {
  const props = PropertiesService.getScriptProperties().getProperties();
  if (!props.AUTH_HASH) throw new Error('尚未設定帳密，請在試算表選單「受試者工具 → 設定登入帳密」設定');

  const cache = CacheService.getScriptCache();
  const failed = Number(cache.get('failedLogins') || 0);
  if (failed >= CONFIG.MAX_FAILED_LOGINS) throw new Error('登入失敗次數過多，請 15 分鐘後再試');

  if (String(username).trim() !== props.AUTH_USER || hash_(props.AUTH_SALT, String(password)) !== props.AUTH_HASH) {
    cache.put('failedLogins', String(failed + 1), CONFIG.LOCKOUT_SECONDS);
    throw new Error('帳號或密碼錯誤');
  }
  cache.remove('failedLogins');
  const token = Utilities.getUuid();
  cache.put('session_' + token, '1', CONFIG.SESSION_SECONDS);
  return token;
}

function logout(token) {
  CacheService.getScriptCache().remove('session_' + token);
}

/** 所有資料 / 寄信相關的公開函式都必須先通過這裡 */
function requireSession_(token) {
  if (!token || !CacheService.getScriptCache().get('session_' + token)) {
    throw new Error('SESSION_EXPIRED');
  }
}

// ───────────────────────── 報名人數上限 ─────────────────────────

/** 試算表選單：設定報名人數上限，並建立「提交表單時」觸發條件 */
function setupResponseLimit() {
  const ui = SpreadsheetApp.getUi();
  const form = getForm_();
  if (!form) { ui.alert('這份試算表沒有連結 Google 表單'); return; }

  const props = PropertiesService.getScriptProperties();
  const count = countResponses_();
  const current = Number(props.getProperty('MAX_RESPONSES') || 0);
  const res = ui.prompt('設定報名人數上限',
    '目前回覆數：' + count + '\n目前上限：' + (current || '未設定') + '\n\n請輸入上限人數（輸入 0 取消限制）：',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const max = parseInt(res.getResponseText(), 10);
  if (!(max >= 0)) { ui.alert('請輸入數字'); return; }
  props.setProperty('MAX_RESPONSES', String(max));

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hasTrigger = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'enforceResponseLimit';
  });
  if (!hasTrigger) ScriptApp.newTrigger('enforceResponseLimit').forSpreadsheet(ss).onFormSubmit().create();

  if (max && count >= max) {
    closeForm_(form);
    ui.alert('目前已有 ' + count + ' 份回覆，已達上限，表單已關閉。');
  } else if (!form.isAcceptingResponses()) {
    const reopen = ui.alert('已設定上限 ' + (max || '（無）') + '。表單目前是關閉的，要重新開放報名嗎？', ui.ButtonSet.YES_NO);
    if (reopen === ui.Button.YES) form.setAcceptingResponses(true);
  } else {
    ui.alert(max ? '已設定上限 ' + max + ' 人，目前 ' + count + ' 人，還剩 ' + (max - count) + ' 個名額。' : '已取消報名人數限制。');
  }
}

/** 觸發條件：每次有人提交表單時檢查，達上限就關閉表單（重複呼叫也無副作用） */
function enforceResponseLimit() {
  const max = Number(PropertiesService.getScriptProperties().getProperty('MAX_RESPONSES') || 0);
  if (!max || countResponses_() < max) return;
  const form = getForm_();
  if (form && form.isAcceptingResponses()) closeForm_(form);
}

function closeForm_(form) {
  form.setCustomClosedFormMessage(CONFIG.FORM_CLOSED_MESSAGE);
  form.setAcceptingResponses(false);
}

function getForm_() {
  const url = getSpreadsheet_().getFormUrl();
  return url ? FormApp.openByUrl(url) : null;
}

/** 回覆試算表中有資料且未退出的列數（刪掉重複回覆的列或標記退出後，名額會釋出） */
function countResponses_() {
  const values = getSheet_().getDataRange().getDisplayValues();
  const wCol = (values[0] || []).indexOf(CONFIG.WITHDRAWN_HEADER);
  return values.slice(1).filter(function (r) {
    return String(r[0]).trim() && !(wCol >= 0 && String(r[wCol]).trim());
  }).length;
}

// ───────────────────────── 試算表存取 ─────────────────────────

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
}

function getSheet_() {
  const ss = getSpreadsheet_();
  return ss.getSheetByName(CONFIG.SHEET_NAME) || ss.getSheets()[0];
}

/** 取得 time table 分頁，不存在時依 CONFIG.SESSIONS 建立 */
function getTimetableSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.TIMETABLE_SHEET);
  if (sheet) {
    // 舊版建立的分頁沒有「已確認」「提醒信」欄，補上表頭
    const headers = sheet.getRange(1, 1, 1, TIMETABLE_HEADERS.length).getDisplayValues()[0];
    for (let c = 6; c < TIMETABLE_HEADERS.length; c++) {
      if (headers[c] !== TIMETABLE_HEADERS[c]) {
        sheet.getRange(1, c + 1).setValue(TIMETABLE_HEADERS[c]).setFontWeight('bold').setBackground('#f3f3f3');
      }
    }
    return sheet;
  }

  sheet = ss.insertSheet(CONFIG.TIMETABLE_SHEET);
  const rows = [TIMETABLE_HEADERS].concat(generateSlots_().map(function (s) { return [s.date, s.time].concat(EMPTY_ASSIGNMENT); }));
  sheet.getRange(1, 1, rows.length, TIMETABLE_HEADERS.length).setNumberFormat('@').setValues(rows);
  sheet.getRange(1, 1, 1, TIMETABLE_HEADERS.length).setFontWeight('bold').setBackground('#f3f3f3');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 2, 150);
  sheet.setColumnWidth(4, 240);
  sheet.setColumnWidth(6, 140);
  return sheet;
}

/** 取得收支表分頁，不存在時建立 */
function getFinanceSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.FINANCE_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(CONFIG.FINANCE_SHEET);
  sheet.getRange(1, 1, 1, FINANCE_HEADERS.length).setValues([FINANCE_HEADERS]).setFontWeight('bold').setBackground('#f3f3f3');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(8, 220);
  sheet.setColumnWidth(10, 140);
  return sheet;
}

/** 解析收支表（getValues 的結果）：[{id, date, type, category, amount, name, row, purpose, note, created, sheetRow}] */
function parseFinance_(values) {
  const tz = Session.getScriptTimeZone();
  const text = function (v) {
    return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy/MM/dd') : String(v == null ? '' : v).trim();
  };
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const amount = Number(String(r[4]).replace(/[,\s]/g, ''));
    if (!text(r[2]) || !(amount > 0)) continue;
    out.push({
      id: text(r[0]),
      date: dateKey_(text(r[1])) || text(r[1]),
      type: text(r[2]),
      category: text(r[3]),
      amount: amount,
      name: text(r[5]),
      row: Number(r[6]) || null,
      purpose: text(r[7]),
      note: text(r[8]),
      created: text(r[9]),
      sheetRow: i + 1,
    });
  }
  return out;
}

/** 依場次切出時段：[{date, time: '19:40–20:00'}] */
function generateSlots_() {
  const out = [];
  CONFIG.SESSIONS.forEach(function (s) {
    const end = toMinutes_(s.end);
    for (let t = toMinutes_(s.start); t + CONFIG.SLOT_MINUTES <= end; t += CONFIG.SLOT_MINUTES + CONFIG.BUFFER_MINUTES) {
      out.push({ date: s.date, time: fromMinutes_(t) + '–' + fromMinutes_(t + CONFIG.SLOT_MINUTES) });
    }
  });
  return out;
}

function toMinutes_(hhmm) {
  const m = String(hhmm).match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function fromMinutes_(min) {
  return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2);
}

/** 解析時段表：[{id, date, time, row, name, email, updated, confirmed, reminded, sheetRow}] */
function parseTimetable_(values) {
  const slots = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const date = String(r[0] || '').trim();
    const time = String(r[1] || '').trim();
    if (!date || !time) continue;
    slots.push({
      id: date + ' ' + time,
      date: date,
      time: time,
      name: String(r[2] || '').trim(),
      email: String(r[3] || '').trim(),
      row: Number(r[4]) || null,
      updated: String(r[5] || '').trim(),
      confirmed: isConfirmed_(r[6]),
      reminded: String(r[7] || '').trim(),
      sheetRow: i + 1,
    });
  }
  return slots;
}

/** 「已確認」欄：有填任何非否定的內容即視為已確認（手動在試算表打勾或輸入也可以） */
function isConfirmed_(v) {
  v = String(v || '').trim();
  return !!v && !/^(false|0|否|no)$/i.test(v);
}

/** 取得（必要時建立）指定表頭的欄位（邀請信狀態、退出），回傳 1-based 欄號 */
function getHeaderColumn_(sheet, header) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const idx = headers.indexOf(header);
  if (idx >= 0) return idx + 1;
  sheet.getRange(1, lastCol + 1).setValue(header);
  return lastCol + 1;
}

/** 讀取回覆列的姓名與 Email（有更正過則用更正後的），並驗證列號 */
function getResponse_(row) {
  row = Number(row);
  const sheet = getSheet_();
  if (!(row >= 2 && row <= sheet.getLastRow())) throw new Error('無效的列號：' + row);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const values = sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0];
  const pick = function (key) {
    const c = headers.findIndex(function (h) { return h.indexOf(FIELD_KEYWORDS[key]) >= 0; });
    return c >= 0 ? String(values[c]).trim() : '';
  };
  const wCol = headers.indexOf(CONFIG.WITHDRAWN_HEADER);
  const fCol = headers.indexOf(CONFIG.EMAIL_FIX_HEADER);
  const originalEmail = pick('email');
  return {
    row: row,
    name: pick('name'),
    email: (fCol >= 0 && String(values[fCol]).trim()) || originalEmail,
    originalEmail: originalEmail,
    withdrawn: wCol >= 0 && !!String(values[wCol]).trim(),
  };
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────── 資料 ─────────────────────────

/** 前端呼叫：回傳所有受試者資料與時段表 */
function getData(token) {
  requireSession_(token);
  const ttValues = getTimetableSheet_().getDataRange().getDisplayValues();
  const finance = parseFinance_(getFinanceSheet_().getDataRange().getValues());
  const data = buildData_(getSheet_().getDataRange().getDisplayValues(), ttValues, finance);
  data.reminder = getReminderSettings_();
  return data;
}

/** 純資料處理（不碰 SpreadsheetApp，方便本機測試） */
function buildData_(values, ttValues, finance) {
  finance = finance || [];
  const headers = values[0] || [];
  const col = {};
  Object.keys(FIELD_KEYWORDS).forEach(function (key) {
    col[key] = headers.findIndex(function (h) { return h.indexOf(FIELD_KEYWORDS[key]) >= 0; });
  });
  col.status = headers.indexOf(CONFIG.STATUS_HEADER);
  col.withdrawn = headers.indexOf(CONFIG.WITHDRAWN_HEADER);
  col.tested = headers.indexOf(CONFIG.TESTED_HEADER);
  col.special = headers.indexOf(CONFIG.SPECIAL_HEADER);
  col.emailFix = headers.indexOf(CONFIG.EMAIL_FIX_HEADER);

  const get = function (row, key) { return col[key] >= 0 ? String(row[col[key]] || '').trim() : ''; };
  const timetable = parseTimetable_(ttValues);

  const participants = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row.some(function (v) { return String(v).trim(); })) continue;

    const dates = get(row, 'dates');
    const saturday = get(row, 'saturday');
    const preferred = get(row, 'preferred');
    const status = get(row, 'status');
    const withdrawn = get(row, 'withdrawn');
    const warnings = [];

    const availableDates = splitMulti_(dates).filter(function (d) { return dateKey_(d); });
    const dateKeys = availableDates.map(dateKey_);
    // 最希望日期不在勾選日期中時，仍視為可配合並提醒
    const prefKey = dateKey_(preferred);
    if (prefKey && dateKeys.indexOf(prefKey) < 0) {
      dateKeys.push(prefKey);
      warnings.push('最希望日期（' + preferred + '）不在勾選的可配合日期中');
    }

    const compatibleSlots = timetable.filter(function (s) {
      return isCompatible_(s, dateKeys, saturday);
    }).map(function (s) { return s.id; });
    if (!compatibleSlots.length && !withdrawn) warnings.push('時段表中沒有符合此受試者可配合時間的時段');

    const originalEmail = get(row, 'email');
    const email = get(row, 'emailFix') || originalEmail;
    const studentId = get(row, 'studentId');
    const emailId = (email.match(/^(\d+)@(g\.)?nccu\.edu\.tw$/i) || [])[1];
    if (emailId && /^\d+$/.test(studentId) && emailId !== studentId) {
      warnings.push('Email 中的學號（' + emailId + '）與填寫學號（' + studentId + '）不符，寄信前請確認');
    }

    const assigned = timetable.filter(function (s) { return s.row === i + 1; });
    if (assigned.length > 1) {
      warnings.push('在時段表中被排了 ' + assigned.length + ' 個時段，請編輯時段表修正');
    }
    const assignedSlot = assigned.length ? assigned[0].id : '';
    // 符合可配合時間的時段都已排給其他人
    const slotsFull = !withdrawn && !assignedSlot && compatibleSlots.length > 0 && timetable.every(function (s) {
      return compatibleSlots.indexOf(s.id) < 0 || (s.row && s.row !== i + 1);
    });
    if (slotsFull) warnings.push('時段已額滿：符合可配合時間的 ' + compatibleSlots.length + ' 個時段都已排給其他人');
    const statusSlot = status.split('｜')[1] || '';
    if (withdrawn && assignedSlot) {
      warnings.push('已標記退出，但仍排在時段表「' + assignedSlot + '」，請編輯時段表移除');
    } else if (status && statusSlot !== assignedSlot && !withdrawn) {
      warnings.push(assignedSlot
        ? '時段表已改為「' + assignedSlot + '」，但上次通知的時段是「' + statusSlot + '」，記得寄更改通知'
        : '已通知時段「' + statusSlot + '」，但目前沒有排在時段表中');
    }

    participants.push({
      row: i + 1,
      values: headers.map(function (_, c) { return row[c] || ''; }),
      name: get(row, 'name'),
      dept: get(row, 'dept'),
      email: email,
      originalEmail: originalEmail,
      studentId: studentId,
      preferred: preferred,
      preferredKey: prefKey,
      availableDates: availableDates,
      compatibleSlots: compatibleSlots,
      assignedSlot: assignedSlot,
      confirmed: assigned.length ? assigned[0].confirmed : false,
      status: status,
      withdrawn: withdrawn,
      slotsFull: slotsFull,
      tested: isConfirmed_(get(row, 'tested')),
      special: get(row, 'special'),
      fees: finance.filter(function (e) { return e.category === FINANCE_CATEGORIES.subjectFee.label && e.row === i + 1; })
        .map(function (e) { return e.amount; }),
      warnings: warnings,
    });
  }

  // 重複填寫（相同 Email 或姓名）
  ['email', 'name'].forEach(function (key) {
    const seen = {};
    participants.forEach(function (p) {
      const k = p[key].toLowerCase();
      if (k) (seen[k] = seen[k] || []).push(p);
    });
    Object.keys(seen).forEach(function (k) {
      if (seen[k].length > 1) {
        seen[k].forEach(function (p) {
          p.warnings.push('與其他回覆的' + (key === 'email' ? ' Email ' : '姓名') + '重複（第 ' +
            seen[k].map(function (q) { return q.row; }).join('、') + ' 列）');
        });
      }
    });
  });

  return {
    headers: headers,
    participants: participants,
    timetable: timetable.map(function (s) {
      return { id: s.id, date: s.date, time: s.time, row: s.row, name: s.name, email: s.email, updated: s.updated, confirmed: s.confirmed, reminded: s.reminded };
    }),
    finance: finance.map(function (e) {
      const c = Object.assign({}, e);
      delete c.sheetRow;
      return c;
    }),
    config: CONFIG,
  };
}

/**
 * 時段是否符合受試者可配合時間：
 * 日期需在可配合日期中；週六另需完整落在所勾選的時段內（相鄰時段會合併，未勾或「整天皆可」視為全天）
 */
function isCompatible_(slot, dateKeys, saturdayAnswer) {
  if (dateKeys.indexOf(dateKey_(slot.date)) < 0) return false;
  if (slot.date.indexOf('（六）') < 0) return true;

  const answer = String(saturdayAnswer || '');
  if (!answer || answer.indexOf('整天') >= 0) return true;
  const ranges = parseRanges_(answer);
  if (!ranges.length) return true;

  const t = parseRanges_(slot.time)[0];
  if (!t) return false;
  return ranges.some(function (r) { return r[0] <= t[0] && t[1] <= r[1]; });
}

/** 解析 "09:00–12:00, 12:00–14:00" 成 [[540, 840]]（排序並合併相鄰區間） */
function parseRanges_(s) {
  const re = /(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/g;
  const ranges = [];
  let m;
  while ((m = re.exec(s))) ranges.push([toMinutes_(m[1]), toMinutes_(m[2])]);
  ranges.sort(function (a, b) { return a[0] - b[0]; });
  const merged = [];
  ranges.forEach(function (r) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r.slice());
  });
  return merged;
}

/** Google 表單多選題以「, 」串接 */
function splitMulti_(s) {
  return String(s || '').split(/,\s*/).map(function (x) { return x.trim(); }).filter(String);
}

/** 取出 "2026/10/06" 形式的日期鍵；非日期回傳空字串 */
function dateKey_(s) {
  const m = String(s || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return '';
  return m[1] + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2);
}

// ───────────────────────── 受試者回覆 ─────────────────────────

/** 政大信箱 xxx@nccu.edu.tw 與 xxx@g.nccu.edu.tw 視為同一人 */
function emailAliases_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@"()<>]+@[^\s@"()<>]+\.[^\s@"()<>]+$/.test(email)) return [];
  const m = email.match(/^([^@]+)@(g\.)?nccu\.edu\.tw$/);
  return m ? [m[1] + '@nccu.edu.tw', m[1] + '@g.nccu.edu.tw'] : [email];
}

function normEmail_(email) {
  return emailAliases_(email)[0] || '';
}

function senderEmail_(from) {
  const m = String(from).match(/<([^>]+)>/);
  return normEmail_(m ? m[1] : from);
}

/**
 * 搜尋受試者寄來、主旨含關鍵字的信。
 * fromAliases 有給時只搜尋這些寄件者；回傳 [{from, message, thread}]
 */
function searchReplies_(fromAliases) {
  const keyword = CONFIG.REPLY_SUBJECT_KEYWORD;
  let query = 'subject:"' + keyword + '" -from:me newer_than:' + CONFIG.REPLY_SEARCH_DAYS + 'd';
  if (fromAliases) query += ' from:(' + fromAliases.join(' OR ') + ')';
  const me = normEmail_(Session.getEffectiveUser().getEmail());

  const out = [];
  GmailApp.search(query, 0, 200).forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (message.isInTrash() || message.getSubject().indexOf(keyword) < 0) return;
      const from = senderEmail_(message.getFrom());
      if (!from || from === me) return;
      if (fromAliases && fromAliases.indexOf(from) < 0) return;
      out.push({ from: from, message: message, thread: thread });
    });
  });
  return out;
}

/** 前端呼叫：各受試者（以回覆列號為 key）的回信數 */
function getReplyCounts(token) {
  requireSession_(token);
  const byEmail = {};
  searchReplies_(null).forEach(function (r) { byEmail[r.from] = (byEmail[r.from] || 0) + 1; });

  const values = getSheet_().getDataRange().getDisplayValues();
  const emailCol = (values[0] || []).findIndex(function (h) { return h.indexOf(FIELD_KEYWORDS.email) >= 0; });
  const fixCol = (values[0] || []).indexOf(CONFIG.EMAIL_FIX_HEADER);
  const counts = {};
  if (emailCol < 0) return counts;
  for (let i = 1; i < values.length; i++) {
    const fixed = fixCol >= 0 ? String(values[i][fixCol]).trim() : '';
    const n = byEmail[normEmail_(fixed || values[i][emailCol])];
    if (n) counts[i + 1] = n;
  }
  return counts;
}

/** 前端呼叫：某位受試者的所有回信（由舊到新） */
function getReplies(token, row) {
  requireSession_(token);
  const aliases = emailAliases_(getResponse_(row).email);
  if (!aliases.length) throw new Error('此受試者的 Email 格式不正確');
  const tz = Session.getScriptTimeZone();
  return searchReplies_(aliases)
    .sort(function (a, b) { return a.message.getDate() - b.message.getDate(); })
    .map(function (r) {
      return {
        date: Utilities.formatDate(r.message.getDate(), tz, 'yyyy/MM/dd HH:mm'),
        subject: r.message.getSubject(),
        body: stripQuoted_(r.message.getPlainBody()),
        link: 'https://mail.google.com/mail/#all/' + r.thread.getId(),
      };
    });
}

/** 去掉回信中引用的原信（「> 」開頭、「於 … 寫道：」、「On … wrote:」之後） */
function stripQuoted_(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(On .*wrote:|.*於.*寫道[：:]?|-{2,}\s*Original Message|-{2,}\s*原始郵件|寄件者[：:]|From:\s)/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  const body = out.join('\n').trim();
  return body.length > 3000 ? body.slice(0, 3000) + '\n…（內容過長，請到 Gmail 查看）' : body;
}

// ───────────────────────── 邀請信與排時段 ─────────────────────────

/**
 * 前端呼叫：為受試者安排時段並寄信。
 * mode: 'send' 直接寄出 / 'draft' 建立 Gmail 草稿 / 'assign' 只排時段不寄信
 * 收件人一律用試算表中該列的 Email（有更正過則用「更正 Email」欄），不接受前端在寄信時指定。
 * 時段若已被其他人佔用會拒絕，且在寄信前檢查，避免寄出錯誤時間。
 */
function sendInvite(token, row, slotId, subject, body, mode) {
  requireSession_(token);
  if (!MODE_LABELS[mode]) throw new Error('未知的動作');

  return withLock_(function () {
    const person = getResponse_(row);
    if (person.withdrawn) throw new Error('此受試者已標記退出，請先恢復');
    if (mode !== 'assign' && !person.email) throw new Error('此受試者沒有 Email');

    const ttSheet = getTimetableSheet_();
    const slots = parseTimetable_(ttSheet.getDataRange().getDisplayValues());
    const target = slots.find(function (s) { return s.id === slotId; });
    if (!target) throw new Error('時段不存在，請重新整理');
    if (target.row && target.row !== person.row) {
      throw new Error('此時段已排給 ' + target.name + '，請重新整理後選擇其他時段');
    }

    if (mode === 'send') GmailApp.sendEmail(person.email, String(subject), String(body), { name: CONFIG.SENDER });
    if (mode === 'draft') GmailApp.createDraft(person.email, String(subject), String(body), { name: CONFIG.SENDER });

    const stamp = now_();
    slots.forEach(function (s) {
      if (s.row === person.row && s.id !== slotId) {
        ttSheet.getRange(s.sheetRow, 3, 1, EMPTY_ASSIGNMENT.length).setValues([EMPTY_ASSIGNMENT]);
      }
    });
    // 同一時段重寄保留確認狀態；換到新時段需重新確認
    const keepConfirmed = target.row === person.row && target.confirmed;
    ttSheet.getRange(target.sheetRow, 3, 1, EMPTY_ASSIGNMENT.length)
      .setValues([[person.name, person.email, person.row, stamp, keepConfirmed ? CONFIRMED_MARK : '',
        target.row === person.row ? target.reminded : '']]);

    const sheet = getSheet_();
    sheet.getRange(person.row, getHeaderColumn_(sheet, CONFIG.STATUS_HEADER)).setValue(MODE_LABELS[mode] + ' ' + stamp + '｜' + slotId);
    return true;
  });
}

/**
 * 前端呼叫：儲存手動編輯後的時段表。
 * assignments: [{id: 時段, row: 回覆列號或 null, confirmed: 是否已確認}]，只更新有變動的時段；不會寄信。
 */
function saveTimetable(token, assignments) {
  requireSession_(token);
  return withLock_(function () {
    const ttSheet = getTimetableSheet_();
    const slots = parseTimetable_(ttSheet.getDataRange().getDisplayValues());
    const byId = {};
    slots.forEach(function (s) { byId[s.id] = s; });

    const seen = {};
    const changes = [];
    (assignments || []).forEach(function (a) {
      const slot = byId[a.id];
      if (!slot) throw new Error('時段不存在：' + a.id + '，請重新整理');
      const row = a.row ? Number(a.row) : null;
      if (row) {
        if (seen[row]) throw new Error('同一位受試者不能排在兩個時段（第 ' + row + ' 列）');
        seen[row] = true;
      }
      const confirmed = !!(row && a.confirmed);
      if (row !== slot.row || confirmed !== slot.confirmed) changes.push({ slot: slot, row: row, confirmed: confirmed });
    });
    // 未送出的時段維持原狀，也要檢查是否與新安排重複
    slots.forEach(function (s) {
      const sent = (assignments || []).some(function (a) { return a.id === s.id; });
      if (!sent && s.row && seen[s.row]) throw new Error('同一位受試者不能排在兩個時段（第 ' + s.row + ' 列）');
    });

    const stamp = now_();
    changes.forEach(function (c) {
      let values = EMPTY_ASSIGNMENT;
      if (c.row) {
        const p = getResponse_(c.row);
        if (p.withdrawn) throw new Error(p.name + ' 已標記退出，不能排入時段');
        // 只改確認狀態時保留提醒信紀錄；換人後需重新提醒
        values = [p.name, p.email, p.row, stamp, c.confirmed ? CONFIRMED_MARK : '', c.row === c.slot.row ? c.slot.reminded : ''];
      }
      ttSheet.getRange(c.slot.sheetRow, 3, 1, EMPTY_ASSIGNMENT.length).setValues([values]);
    });
    return changes.length;
  });
}

// ───────────────────────── 退出 ─────────────────────────

/**
 * 前端呼叫：標記受試者退出（或恢復）。
 * 退出時會清空其在時段表的時段，並在「退出」欄記下時間與原因；表單回覆本身不刪除（列號不會跑掉），不會寄信。
 * 回傳被釋出的時段。
 */
function setWithdrawn(token, row, withdrawn, reason) {
  requireSession_(token);
  return withLock_(function () {
    const person = getResponse_(row);
    const freed = [];
    if (withdrawn) {
      const ttSheet = getTimetableSheet_();
      parseTimetable_(ttSheet.getDataRange().getDisplayValues()).forEach(function (s) {
        if (s.row === person.row) {
          ttSheet.getRange(s.sheetRow, 3, 1, EMPTY_ASSIGNMENT.length).setValues([EMPTY_ASSIGNMENT]);
          freed.push(s.id);
        }
      });
    }
    const sheet = getSheet_();
    reason = String(reason || '').trim();
    sheet.getRange(person.row, getHeaderColumn_(sheet, CONFIG.WITHDRAWN_HEADER))
      .setValue(withdrawn ? '已退出 ' + now_() + (reason ? '｜' + reason : '') : '');
    return freed;
  });
}

// ───────────────────────── 特殊情況信件 ─────────────────────────

/**
 * 前端呼叫：寄出特殊情況信件（資料有誤、時段已額滿等，先與受試者確認）。
 * mode: 'send' 直接寄出 / 'draft' 建立 Gmail 草稿。不會排時段，只在「特殊信件」欄記下時間。
 */
function sendSpecial(token, row, subject, body, mode) {
  requireSession_(token);
  if (mode !== 'send' && mode !== 'draft') throw new Error('未知的動作');
  return withLock_(function () {
    const person = getResponse_(row);
    if (!person.email) throw new Error('此受試者沒有 Email');
    if (mode === 'send') GmailApp.sendEmail(person.email, String(subject), String(body), { name: CONFIG.SENDER });
    else GmailApp.createDraft(person.email, String(subject), String(body), { name: CONFIG.SENDER });
    const sheet = getSheet_();
    sheet.getRange(person.row, getHeaderColumn_(sheet, CONFIG.SPECIAL_HEADER)).setValue(MODE_LABELS[mode] + ' ' + now_());
    return true;
  });
}

// ───────────────────────── 更正 Email ─────────────────────────

/**
 * 前端呼叫：更正受試者的收件 Email（填錯時手動修正）。
 * 寫在「更正 Email」欄，表單原始回覆不變；填空白或與原本相同則取消更正。
 * 時段表中的 Email 會同步更新。回傳更正後實際使用的 Email。
 */
function setEmail(token, row, email) {
  requireSession_(token);
  email = String(email || '').trim();
  if (email && !emailAliases_(email).length) throw new Error('Email 格式不正確');
  return withLock_(function () {
    const person = getResponse_(row);
    const fix = email && email !== person.originalEmail ? email : '';
    const sheet = getSheet_();
    sheet.getRange(person.row, getHeaderColumn_(sheet, CONFIG.EMAIL_FIX_HEADER)).setNumberFormat('@').setValue(fix);

    const effective = fix || person.originalEmail;
    const ttSheet = getTimetableSheet_();
    parseTimetable_(ttSheet.getDataRange().getDisplayValues()).forEach(function (s) {
      if (s.row === person.row) ttSheet.getRange(s.sheetRow, 4).setValue(effective);
    });
    return effective;
  });
}

// ───────────────────────── 測驗前提醒信 ─────────────────────────

function defaultReminderBody_() {
  return [
    '{姓名} 您好：',
    '',
    '提醒您，「羽球揮拍動作分析研究」的測驗即將在 ' + CONFIG.REMINDER_MINUTES + ' 分鐘後開始：',
    '',
    '・測驗時間：{日期} {時間}',
    '・測驗地點：{地點}',
    '',
    '請準時抵達，到場後直接向工作人員報到即可。',
    '若臨時無法出席，請直接回覆此信告知。',
    '',
  ].concat(CONFIG.SIGNATURE).join('\n');
}

/** 提醒信設定（存在 Script Properties）：{enabled, subject, body, images: [{id, name}], minutes, triggerActive} */
function getReminderSettings_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  let images = [];
  try { images = JSON.parse(props.REMINDER_IMAGES || '[]'); } catch (e) {}
  return {
    enabled: props.REMINDER_ENABLED === '1',
    subject: props.REMINDER_SUBJECT || CONFIG.REMINDER_SUBJECT,
    body: props.REMINDER_BODY || defaultReminderBody_(),
    images: images,
    minutes: CONFIG.REMINDER_MINUTES,
    triggerActive: hasReminderTrigger_(),
  };
}

function hasReminderTrigger_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === REMINDER_HANDLER; });
}

function checkReminderText_(subject, body) {
  subject = String(subject || '').trim();
  body = String(body || '');
  if (!subject) throw new Error('請填寫主旨');
  if (!body.trim()) throw new Error('請填寫內容');
  if (body.length > 2500) throw new Error('內容過長（上限 2500 字）');
  return { subject: subject, body: body };
}

/** 前端呼叫：儲存提醒信主旨、內容與是否啟用；啟用時建立每分鐘檢查一次的觸發條件 */
function saveReminder(token, settings) {
  requireSession_(token);
  settings = settings || {};
  const text = checkReminderText_(settings.subject, settings.body);
  return withLock_(function () {
    PropertiesService.getScriptProperties().setProperties({
      REMINDER_ENABLED: settings.enabled ? '1' : '0',
      REMINDER_SUBJECT: text.subject,
      REMINDER_BODY: text.body,
    });
    if (settings.enabled) {
      if (!hasReminderTrigger_()) ScriptApp.newTrigger(REMINDER_HANDLER).timeBased().everyMinutes(1).create();
    } else {
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === REMINDER_HANDLER) ScriptApp.deleteTrigger(t);
      });
    }
    return true;
  });
}

function getReminderFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('REMINDER_FOLDER_ID');
  if (id) {
    try {
      const folder = DriveApp.getFolderById(id);
      if (!folder.isTrashed()) return folder;
    } catch (e) {}
  }
  const created = DriveApp.createFolder(CONFIG.REMINDER_FOLDER_NAME);
  props.setProperty('REMINDER_FOLDER_ID', created.getId());
  return created;
}

/** 前端呼叫：新增一張提醒信附加圖片（存到雲端硬碟），回傳更新後的圖片清單 */
function addReminderImage(token, name, mimeType, base64) {
  requireSession_(token);
  if (!/^image\//.test(String(mimeType))) throw new Error('只能附加圖片檔');
  const bytes = Utilities.base64Decode(String(base64));
  if (bytes.length > CONFIG.REMINDER_MAX_IMAGE_MB * 1024 * 1024) throw new Error('圖片不能超過 ' + CONFIG.REMINDER_MAX_IMAGE_MB + ' MB');
  name = String(name || 'image').replace(/[\\/]/g, '_').slice(0, 100);
  return withLock_(function () {
    const images = getReminderSettings_().images;
    if (images.length >= CONFIG.REMINDER_MAX_IMAGES) throw new Error('最多只能附加 ' + CONFIG.REMINDER_MAX_IMAGES + ' 張圖片');
    const file = getReminderFolder_().createFile(Utilities.newBlob(bytes, mimeType, name));
    images.push({ id: file.getId(), name: name });
    PropertiesService.getScriptProperties().setProperty('REMINDER_IMAGES', JSON.stringify(images));
    return images;
  });
}

/** 前端呼叫：移除一張附加圖片（只能移除清單中的檔案），回傳更新後的圖片清單 */
function removeReminderImage(token, id) {
  requireSession_(token);
  return withLock_(function () {
    const images = getReminderSettings_().images;
    const kept = images.filter(function (img) { return img.id !== String(id); });
    if (kept.length === images.length) throw new Error('找不到這張圖片，請重新整理');
    try { DriveApp.getFileById(String(id)).setTrashed(true); } catch (e) {}
    PropertiesService.getScriptProperties().setProperty('REMINDER_IMAGES', JSON.stringify(kept));
    return kept;
  });
}

/** 寄出一封提醒信；{姓名} {日期} {時間} {地點} 會代換成實際內容 */
function sendReminder_(to, vars, subject, body, images) {
  const fill = function (text) {
    return String(text).replace(/\{(姓名|日期|時間|地點)\}/g, function (_, key) { return vars[key] || ''; });
  };
  const options = { name: CONFIG.SENDER };
  const blobs = [];
  images.forEach(function (img) {
    try {
      blobs.push(DriveApp.getFileById(img.id).getBlob().setName(img.name));
    } catch (e) {
      console.error('提醒信附加圖片讀取失敗：' + img.name + '｜' + e.message);
    }
  });
  if (blobs.length) options.attachments = blobs;
  GmailApp.sendEmail(to, fill(subject), fill(body), options);
}

/** 前端呼叫：用目前畫面上的主旨與內容（不需先儲存）寄一封測試信給自己，回傳收件信箱 */
function sendReminderTest(token, subject, body) {
  requireSession_(token);
  const text = checkReminderText_(subject, body);
  const to = Session.getEffectiveUser().getEmail();
  const slot = generateSlots_()[0] || { date: '2026/10/13（二）', time: '19:40–20:00' };
  sendReminder_(to, { 姓名: '測試受試者', 日期: slot.date, 時間: slot.time, 地點: CONFIG.LOCATION },
    '【測試】' + text.subject, text.body, getReminderSettings_().images);
  return to;
}

/** 時段開始時間（Date）；格式不對回傳 null */
function slotStart_(slot) {
  const key = dateKey_(slot.date);
  const minutes = toMinutes_(slot.time);
  if (!key || isNaN(minutes)) return null;
  return Utilities.parseDate(key + ' ' + fromMinutes_(minutes), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
}

/** 已排人、還沒寄過提醒信、且在 REMINDER_MINUTES 分鐘內開始的時段 */
function dueReminderSlots_(ttSheet) {
  const now = Date.now();
  return parseTimetable_(ttSheet.getDataRange().getDisplayValues()).filter(function (s) {
    if (!s.row || s.reminded) return false;
    const start = slotStart_(s);
    return !!start && start.getTime() > now && start.getTime() - now <= CONFIG.REMINDER_MINUTES * 60 * 1000;
  });
}

/**
 * 觸發條件（每分鐘）：寄出即將開始時段的提醒信，並在時段表「提醒信」欄記下時間，每個時段只寄一次。
 * 已退出或沒有 Email 的受試者不寄；單一封寄送失敗不影響其他人，下一分鐘會再試。
 */
function sendDueReminders() {
  if (PropertiesService.getScriptProperties().getProperty('REMINDER_ENABLED') !== '1') return;
  if (!dueReminderSlots_(getTimetableSheet_()).length) return;

  withLock_(function () {
    const ttSheet = getTimetableSheet_();
    const settings = getReminderSettings_();
    dueReminderSlots_(ttSheet).forEach(function (s) {
      try {
        const person = getResponse_(s.row);
        if (person.withdrawn || !person.email) return;
        sendReminder_(person.email, { 姓名: person.name, 日期: s.date, 時間: s.time, 地點: CONFIG.LOCATION },
          settings.subject, settings.body, settings.images);
        ttSheet.getRange(s.sheetRow, REMINDER_COLUMN).setValue('已寄出 ' + now_());
        SpreadsheetApp.flush();
      } catch (e) {
        console.error('提醒信寄送失敗：' + s.id + '｜' + e.message);
      }
    });
  });
}

// ───────────────────────── 受測完畢 ─────────────────────────

function setTested_(row, tested) {
  const sheet = getSheet_();
  sheet.getRange(row, getHeaderColumn_(sheet, CONFIG.TESTED_HEADER)).insertCheckboxes().setValue(!!tested);
}

/** 前端呼叫：手動勾選 / 取消受測完畢 */
function setTested(token, row, tested) {
  requireSession_(token);
  return withLock_(function () {
    setTested_(getResponse_(row).row, tested);
    return true;
  });
}

// ───────────────────────── 收支表 ─────────────────────────

/**
 * 前端呼叫：新增一筆收支。
 * entry: {category: income|subjectFee|coachFee|other, date: 'yyyy-mm-dd', amount, row（受試者費）, purpose（收入來源 / 其他用途）, note}
 * 受試者費會自動把該受試者勾選為受測完畢。
 */
function addFinance(token, entry) {
  requireSession_(token);
  entry = entry || {};
  const cat = FINANCE_CATEGORIES[entry.category];
  if (!cat) throw new Error('未知的類別');
  const date = dateKey_(String(entry.date || '').replace(/-/g, '/'));
  if (!date) throw new Error('請填寫日期');
  const amount = Math.round(Number(entry.amount));
  if (!(amount > 0)) throw new Error('金額需大於 0');
  const purpose = String(entry.purpose || '').trim();
  if (entry.category === 'income' && !purpose) throw new Error('請填寫收入來源');
  if (entry.category === 'other' && !purpose) throw new Error('請填寫用途');

  return withLock_(function () {
    let person = null;
    if (entry.category === 'subjectFee') {
      if (!entry.row) throw new Error('請選擇受試者');
      person = getResponse_(entry.row);
    }
    const sheet = getFinanceSheet_();
    const r = sheet.getLastRow() + 1;
    sheet.getRange(r, 1, 1, FINANCE_HEADERS.length)
      .setNumberFormats([FINANCE_FORMATS])
      .setValues([[
        Utilities.getUuid().slice(0, 8), date, cat.type, cat.label, amount,
        person ? person.name : '', person ? person.row : '',
        purpose, String(entry.note || '').trim(), now_(),
      ]]);
    if (person) setTested_(person.row, true);
    return true;
  });
}

/** 前端呼叫：刪除一筆收支（不會取消受測完畢的勾選） */
function deleteFinance(token, id) {
  requireSession_(token);
  return withLock_(function () {
    const sheet = getFinanceSheet_();
    const entry = parseFinance_(sheet.getDataRange().getValues()).find(function (e) { return e.id && e.id === String(id); });
    if (!entry) throw new Error('找不到這筆紀錄，請重新整理');
    sheet.deleteRow(entry.sheetRow);
    return true;
  });
}

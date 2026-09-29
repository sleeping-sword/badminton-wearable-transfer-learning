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
 *
 * 帳密不寫在程式碼中：由試算表選單「受試者工具 → 設定登入帳密」設定，
 * 以加鹽 SHA-256 存在 Script Properties。
 */

const CONFIG = {
  SHEET_NAME: '表單回覆 1',
  STATUS_HEADER: '邀請信狀態',
  TIMETABLE_SHEET: 'time table',

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

const TIMETABLE_HEADERS = ['日期', '時間', '姓名', 'Email', '回覆列號', '更新時間', '已確認'];
const CONFIRMED_MARK = '已確認';
const EMPTY_ASSIGNMENT = ['', '', '', '', '']; // 姓名～已確認（C:G）

const MODE_LABELS = { send: '已寄出', draft: '已建立草稿', assign: '已安排（未寄信）' };

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

/** 回覆試算表中有資料的列數（刪掉重複回覆的列後，名額會釋出） */
function countResponses_() {
  const values = getSheet_().getDataRange().getDisplayValues();
  return values.slice(1).filter(function (r) { return String(r[0]).trim(); }).length;
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
    // 舊版建立的分頁沒有「已確認」欄，補上表頭
    const last = TIMETABLE_HEADERS.length;
    if (sheet.getRange(1, last).getDisplayValue() !== TIMETABLE_HEADERS[last - 1]) {
      sheet.getRange(1, last).setValue(TIMETABLE_HEADERS[last - 1]).setFontWeight('bold').setBackground('#f3f3f3');
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

/** 解析時段表：[{id, date, time, row, name, email, updated, sheetRow}] */
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

/** 取得（必要時建立）邀請信狀態欄，回傳 1-based 欄號 */
function getStatusColumn_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const idx = headers.indexOf(CONFIG.STATUS_HEADER);
  if (idx >= 0) return idx + 1;
  sheet.getRange(1, lastCol + 1).setValue(CONFIG.STATUS_HEADER);
  return lastCol + 1;
}

/** 讀取回覆列的姓名與 Email，並驗證列號 */
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
  return { row: row, name: pick('name'), email: pick('email') };
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
  return buildData_(getSheet_().getDataRange().getDisplayValues(), ttValues);
}

/** 純資料處理（不碰 SpreadsheetApp，方便本機測試） */
function buildData_(values, ttValues) {
  const headers = values[0] || [];
  const col = {};
  Object.keys(FIELD_KEYWORDS).forEach(function (key) {
    col[key] = headers.findIndex(function (h) { return h.indexOf(FIELD_KEYWORDS[key]) >= 0; });
  });
  col.status = headers.indexOf(CONFIG.STATUS_HEADER);

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
    if (!compatibleSlots.length) warnings.push('時段表中沒有符合此受試者可配合時間的時段');

    const email = get(row, 'email');
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
    const statusSlot = status.split('｜')[1] || '';
    if (status && statusSlot !== assignedSlot) {
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
      studentId: studentId,
      preferred: preferred,
      preferredKey: prefKey,
      availableDates: availableDates,
      compatibleSlots: compatibleSlots,
      assignedSlot: assignedSlot,
      confirmed: assigned.length ? assigned[0].confirmed : false,
      status: status,
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
      return { id: s.id, date: s.date, time: s.time, row: s.row, name: s.name, email: s.email, updated: s.updated, confirmed: s.confirmed };
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
  const counts = {};
  if (emailCol < 0) return counts;
  for (let i = 1; i < values.length; i++) {
    const n = byEmail[normEmail_(values[i][emailCol])];
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
 * 收件人一律用試算表中該列的 Email，不接受前端指定。
 * 時段若已被其他人佔用會拒絕，且在寄信前檢查，避免寄出錯誤時間。
 */
function sendInvite(token, row, slotId, subject, body, mode) {
  requireSession_(token);
  if (!MODE_LABELS[mode]) throw new Error('未知的動作');

  return withLock_(function () {
    const person = getResponse_(row);
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
      .setValues([[person.name, person.email, person.row, stamp, keepConfirmed ? CONFIRMED_MARK : '']]);

    const sheet = getSheet_();
    sheet.getRange(person.row, getStatusColumn_(sheet)).setValue(MODE_LABELS[mode] + ' ' + stamp + '｜' + slotId);
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
        values = [p.name, p.email, p.row, stamp, c.confirmed ? CONFIRMED_MARK : ''];
      }
      ttSheet.getRange(c.slot.sheetRow, 3, 1, EMPTY_ASSIGNMENT.length).setValues([values]);
    });
    return changes.length;
  });
}

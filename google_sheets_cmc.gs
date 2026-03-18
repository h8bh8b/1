/**
 * CoinMarketCap Top 20 Daily Rankings → Google Sheets
 * 기간: 2013/04/28 ~ 2026/03/18 (약 4,708일)
 *
 * 사용법:
 *   1. Google Sheets → 확장 프로그램 → Apps Script
 *   2. 이 코드를 붙여넣기
 *   3. 메뉴 "CMC Data" → "데이터 수집 시작" 클릭
 *   4. Apps Script 6분 제한으로 자동 중단 → 타이머 트리거가 자동 이어서 실행
 *   5. 완료 시 트리거 자동 삭제
 *
 * 시트 구조:
 *   [Rankings] 시트: Date, Rank, Project, Symbol, MarketCap, FDV, Price,
 *                    Volume24h, CirculatingSupply, TotalSupply, MaxSupply,
 *                    NumMarketPairs
 *   [Progress] 시트: 마지막 수집 날짜 기록 (자동 이어하기용)
 *   [Summary]  시트: 수집 완료 후 자동 생성 - 프로젝트별 등장 횟수 통계
 */

// ── 설정 ──────────────────────────────────────────────────────────────────────
var CONFIG = {
  START_DATE: '2013-04-28',
  END_DATE:   '2026-03-18',
  TOP_N:      20,
  API_URL:    'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listings/historical',
  DELAY_MS:   1500,           // API 호출 간 대기 (ms)
  MAX_RUNTIME_MS: 300000,     // 5분 (6분 제한 전에 안전하게 중단)
  RANKINGS_SHEET: 'Rankings',
  PROGRESS_SHEET: 'Progress',
  SUMMARY_SHEET:  'Summary',
};

// ── 메뉴 ──────────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CMC Data')
    .addItem('데이터 수집 시작', 'startCollection')
    .addItem('수집 재개 (중단된 경우)', 'resumeCollection')
    .addItem('통계 요약 생성', 'generateSummary')
    .addItem('자동 트리거 삭제', 'deleteTriggers')
    .addToUi();
}

// ── 시작 ──────────────────────────────────────────────────────────────────────
function startCollection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Rankings 시트 초기화
  var rankSheet = getOrCreateSheet(ss, CONFIG.RANKINGS_SHEET);
  rankSheet.clear();
  rankSheet.appendRow([
    'Date', 'Rank', 'Project', 'Symbol', 'MarketCap', 'FDV', 'Price',
    'Volume24h', 'CirculatingSupply', 'TotalSupply', 'MaxSupply', 'NumMarketPairs'
  ]);
  rankSheet.getRange('1:1').setFontWeight('bold');
  rankSheet.setFrozenRows(1);

  // Progress 시트 초기화
  var progSheet = getOrCreateSheet(ss, CONFIG.PROGRESS_SHEET);
  progSheet.clear();
  progSheet.appendRow(['last_date', 'status', 'total_fetched', 'started_at']);
  progSheet.appendRow(['', 'running', 0, new Date().toISOString()]);

  SpreadsheetApp.getUi().alert(
    '수집을 시작합니다.\n' +
    '기간: ' + CONFIG.START_DATE + ' ~ ' + CONFIG.END_DATE + '\n' +
    '약 4,708일 분량이므로 여러 차례 자동 실행됩니다.\n' +
    'Progress 시트에서 진행 상황을 확인하세요.'
  );

  resumeCollection();
}

// ── 이어서 수집 ───────────────────────────────────────────────────────────────
function resumeCollection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var progSheet = getOrCreateSheet(ss, CONFIG.PROGRESS_SHEET);
  var rankSheet = getOrCreateSheet(ss, CONFIG.RANKINGS_SHEET);

  // 마지막 수집 날짜 읽기
  var lastDate = progSheet.getRange('A2').getValue();
  var totalFetched = progSheet.getRange('C2').getValue() || 0;

  var startDate = lastDate ? nextDay(lastDate) : CONFIG.START_DATE;
  var endDate = CONFIG.END_DATE;

  // 날짜 목록 생성
  var dates = getDateRange(startDate, endDate);
  if (dates.length === 0) {
    progSheet.getRange('B2').setValue('completed');
    deleteTriggers();
    SpreadsheetApp.getUi().alert('모든 데이터 수집이 완료되었습니다! (' + totalFetched + '일)');
    generateSummary();
    return;
  }

  var startTime = new Date().getTime();
  var batchRows = [];
  var fetchedCount = 0;

  for (var i = 0; i < dates.length; i++) {
    // 시간 제한 체크
    if (new Date().getTime() - startTime > CONFIG.MAX_RUNTIME_MS) {
      break;
    }

    var dateStr = dates[i];
    var data = fetchTopN(dateStr);

    if (data && data.length > 0) {
      for (var j = 0; j < data.length; j++) {
        var d = data[j];
        batchRows.push([
          dateStr,
          d.rank, d.name, d.symbol, d.marketCap, d.fdv, d.price,
          d.volume24h, d.circulatingSupply, d.totalSupply, d.maxSupply, d.numMarketPairs
        ]);
      }
      fetchedCount++;
      totalFetched++;

      // 진행 상황 업데이트
      progSheet.getRange('A2').setValue(dateStr);
      progSheet.getRange('C2').setValue(totalFetched);
    }

    // 50일치마다 시트에 일괄 쓰기 (성능 최적화)
    if (batchRows.length >= 50 * CONFIG.TOP_N || i === dates.length - 1) {
      if (batchRows.length > 0) {
        var lastRow = rankSheet.getLastRow();
        rankSheet.getRange(lastRow + 1, 1, batchRows.length, 12).setValues(batchRows);
        batchRows = [];
      }
    }

    Utilities.sleep(CONFIG.DELAY_MS);
  }

  // 남은 행 쓰기
  if (batchRows.length > 0) {
    var lastRow = rankSheet.getLastRow();
    rankSheet.getRange(lastRow + 1, 1, batchRows.length, 12).setValues(batchRows);
  }

  // 완료 여부 확인
  var lastFetchedDate = progSheet.getRange('A2').getValue();
  if (lastFetchedDate >= CONFIG.END_DATE) {
    progSheet.getRange('B2').setValue('completed');
    deleteTriggers();
    generateSummary();
    Logger.log('수집 완료! 총 ' + totalFetched + '일');
  } else {
    // 아직 남았으면 1분 후 자동 재개 트리거 설정
    progSheet.getRange('B2').setValue('paused - will resume in 1 min');
    setResumeTrigger();
    Logger.log('시간 제한으로 일시 중단. ' + fetchedCount + '일 수집 (' + totalFetched + '일 누적). 마지막: ' + lastFetchedDate);
  }
}

// ── API 호출 ──────────────────────────────────────────────────────────────────
function fetchTopN(dateStr) {
  var url = CONFIG.API_URL + '?date=' + dateStr + '&start=1&limit=' + CONFIG.TOP_N + '&convert=USD';

  var options = {
    method: 'get',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    muteHttpExceptions: true
  };

  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();

      if (code === 200) {
        var json = JSON.parse(response.getContentText());
        var list = json.data || [];
        var result = [];

        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          var quotes = item.quotes || [{}];
          var q = quotes[0] || {};
          var price = q.price || 0;
          var maxSup = item.maxSupply || item.totalSupply || 0;
          result.push({
            rank:              item.cmcRank || (i + 1),
            symbol:            item.symbol || '',
            name:              item.name || '',
            marketCap:         q.marketCap || 0,
            fdv:               price * maxSup,
            price:             price,
            volume24h:         q.volume24h || 0,
            circulatingSupply: item.circulatingSupply || 0,
            totalSupply:       item.totalSupply || 0,
            maxSupply:         item.maxSupply || '',
            numMarketPairs:    item.numMarketPairs || 0
          });
        }
        return result;
      } else if (code === 429) {
        // Rate limited - wait longer
        Utilities.sleep(5000);
      } else {
        Logger.log('API error for ' + dateStr + ': HTTP ' + code);
        return null;
      }
    } catch (e) {
      Logger.log('Fetch error for ' + dateStr + ' (attempt ' + (attempt+1) + '): ' + e);
      Utilities.sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

// ── 통계 요약 생성 ────────────────────────────────────────────────────────────
function generateSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rankSheet = ss.getSheetByName(CONFIG.RANKINGS_SHEET);
  if (!rankSheet) return;

  var data = rankSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  // 프로젝트별 등장 일수 계산
  var projectDays = {};  // symbol -> {name, dates: Set}
  var allDates = {};

  for (var i = 1; i < data.length; i++) {
    var date   = data[i][0];
    var name   = data[i][2];
    var symbol = data[i][3];

    if (!symbol) continue;
    allDates[date] = true;

    if (!projectDays[symbol]) {
      projectDays[symbol] = { name: name, count: 0, dates: {} };
    }
    if (!projectDays[symbol].dates[date]) {
      projectDays[symbol].dates[date] = true;
      projectDays[symbol].count++;
    }
  }

  var totalDays = Object.keys(allDates).length;

  // 정렬
  var sorted = Object.keys(projectDays).map(function(sym) {
    return {
      symbol: sym,
      name: projectDays[sym].name,
      count: projectDays[sym].count,
      pct: (projectDays[sym].count / totalDays * 100).toFixed(1)
    };
  }).sort(function(a, b) { return b.count - a.count; });

  // Summary 시트 작성
  var sumSheet = getOrCreateSheet(ss, CONFIG.SUMMARY_SHEET);
  sumSheet.clear();

  sumSheet.appendRow(['CoinMarketCap Top 20 Rankings Summary']);
  sumSheet.appendRow(['기간: ' + CONFIG.START_DATE + ' ~ ' + CONFIG.END_DATE]);
  sumSheet.appendRow(['총 수집일: ' + totalDays + '일']);
  sumSheet.appendRow(['Top 20 진입 프로젝트 수: ' + sorted.length + '개']);
  sumSheet.appendRow([]);
  sumSheet.appendRow(['Rank', 'Symbol', 'Name', 'Days in Top 20', 'Percentage']);
  sumSheet.getRange('6:6').setFontWeight('bold');

  var rows = [];
  for (var i = 0; i < sorted.length; i++) {
    rows.push([i + 1, sorted[i].symbol, sorted[i].name, sorted[i].count, sorted[i].pct + '%']);
  }
  if (rows.length > 0) {
    sumSheet.getRange(7, 1, rows.length, 5).setValues(rows);
  }

  // 서식
  sumSheet.getRange('1:1').setFontSize(14).setFontWeight('bold');
  sumSheet.autoResizeColumns(1, 5);

  Logger.log('Summary 생성 완료: ' + sorted.length + '개 프로젝트');
}

// ── 유틸리티 ──────────────────────────────────────────────────────────────────
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function getDateRange(startStr, endStr) {
  var dates = [];
  var current = new Date(startStr + 'T00:00:00Z');
  var end = new Date(endStr + 'T00:00:00Z');

  while (current <= end) {
    dates.push(formatDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function nextDay(dateStr) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return formatDate(d);
}

function formatDate(d) {
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// ── 트리거 관리 ───────────────────────────────────────────────────────────────
function setResumeTrigger() {
  deleteTriggers();
  ScriptApp.newTrigger('resumeCollection')
    .timeBased()
    .after(60 * 1000)  // 1분 후
    .create();
}

function deleteTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'resumeCollection') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

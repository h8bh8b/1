/**
 * GMGN API - Google Sheets Integration
 * A열에 컨트랙트 주소 입력 시 토큰 정보를 자동으로 조회합니다.
 *
 * 컬럼 구조:
 * A: Contract Address
 * B: 프로젝트 이름
 * C: 토큰 티커
 * D: MC (시가총액)
 * E: FDV
 * F: 24시간 거래량 ($)
 * G: 홀더
 * H: 유동성
 * I: 신규 홀딩 %
 * J: 체인
 * K: 조회 시각
 */

// ─── 설정 ──────────────────────────────────────────────────────────────────
const HEADER_ROW    = 1;   // 헤더가 있는 행 번호
const DATA_START_ROW = 2;  // 데이터 시작 행 번호
const CONTRACT_COL  = 1;   // A열 = 1

const COLUMNS = {
  CONTRACT   : 1,  // A
  NAME       : 2,  // B
  SYMBOL     : 3,  // C
  MARKET_CAP : 4,  // D
  FDV        : 5,  // E
  VOLUME_24H : 6,  // F
  HOLDERS    : 7,  // G
  LIQUIDITY  : 8,  // H
  NEW_HOLDING: 9,  // I
  CHAIN      : 10, // J
  UPDATED_AT : 11  // K
};

// GMGN이 지원하는 체인
const CHAIN_MAP = {
  sol  : "sol",
  eth  : "eth",
  bsc  : "bsc",
  base : "base",
  tron : "tron"
};

// ─── 트리거: 셀 수정 시 자동 실행 ────────────────────────────────────────
function onEdit(e) {
  const range = e.range;
  const sheet = range.getSheet();

  // A열, 데이터 시작 행 이상인지 확인
  if (range.getColumn() !== CONTRACT_COL || range.getRow() < DATA_START_ROW) return;

  const contractAddress = range.getValue().toString().trim();
  if (!contractAddress) {
    clearRow_(sheet, range.getRow());
    return;
  }

  fetchAndFill_(sheet, range.getRow(), contractAddress);
}

// ─── 수동 실행: 선택된 행들을 일괄 조회 ─────────────────────────────────
function refreshSelected() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const selection = sheet.getActiveRange();
  const startRow  = Math.max(selection.getRow(), DATA_START_ROW);
  const endRow    = selection.getLastRow();

  for (let row = startRow; row <= endRow; row++) {
    const contract = sheet.getRange(row, CONTRACT_COL).getValue().toString().trim();
    if (!contract) continue;
    fetchAndFill_(sheet, row, contract);
    Utilities.sleep(500); // API 과부하 방지
  }
}

// ─── 수동 실행: 시트 전체 새로고침 ───────────────────────────────────────
function refreshAll() {
  const sheet     = SpreadsheetApp.getActiveSheet();
  const lastRow   = sheet.getLastRow();

  for (let row = DATA_START_ROW; row <= lastRow; row++) {
    const contract = sheet.getRange(row, CONTRACT_COL).getValue().toString().trim();
    if (!contract) continue;
    fetchAndFill_(sheet, row, contract);
    Utilities.sleep(600);
  }
}

// ─── 헤더 초기화 ─────────────────────────────────────────────────────────
function setupHeaders() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const headers = [
    "Contract Address",
    "프로젝트 이름",
    "토큰 티커",
    "MC ($)",
    "FDV ($)",
    "24h 거래량 ($)",
    "홀더",
    "유동성 ($)",
    "신규 홀딩 %",
    "체인",
    "조회 시각"
  ];

  const headerRange = sheet.getRange(HEADER_ROW, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#1a1a2e");
  headerRange.setFontColor("#e0e0e0");
  sheet.setFrozenRows(1);

  // 열 너비 조정
  sheet.setColumnWidth(1, 360);  // Contract
  sheet.setColumnWidth(2, 150);  // 이름
  sheet.setColumnWidth(3, 90);   // 티커
  sheet.setColumnWidth(4, 120);  // MC
  sheet.setColumnWidth(5, 120);  // FDV
  sheet.setColumnWidth(6, 130);  // Volume
  sheet.setColumnWidth(7, 80);   // 홀더
  sheet.setColumnWidth(8, 120);  // 유동성
  sheet.setColumnWidth(9, 110);  // 신규홀딩
  sheet.setColumnWidth(10, 70);  // 체인
  sheet.setColumnWidth(11, 160); // 시각

  SpreadsheetApp.getUi().alert("헤더 설정이 완료되었습니다.");
}

// ─── 메뉴 등록 ────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔍 GMGN 조회")
    .addItem("헤더 초기화", "setupHeaders")
    .addSeparator()
    .addItem("선택 행 새로고침", "refreshSelected")
    .addItem("전체 새로고침", "refreshAll")
    .addToUi();
}

// ─── 내부: API 호출 및 셀 기입 ───────────────────────────────────────────
function fetchAndFill_(sheet, row, contractAddress) {
  try {
    // 로딩 표시
    sheet.getRange(row, COLUMNS.NAME).setValue("조회 중...");
    SpreadsheetApp.flush();

    const chain    = detectChain_(contractAddress);
    const tokenData = fetchTokenInfo_(chain, contractAddress);

    if (!tokenData) {
      sheet.getRange(row, COLUMNS.NAME).setValue("⚠️ 데이터 없음");
      return;
    }

    writeRowData_(sheet, row, chain, tokenData);

  } catch (err) {
    sheet.getRange(row, COLUMNS.NAME).setValue("❌ 오류: " + err.message);
    Logger.log("Error row " + row + ": " + err.message);
  }
}

// ─── 내부: 체인 자동 감지 ────────────────────────────────────────────────
function detectChain_(address) {
  // EVM 계열 (0x 시작, 42자)
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return "eth"; // 기본 EVM → ETH (BSC/Base는 수동 지정 불가, 동일 포맷)
  }
  // Tron (T 시작, 34자)
  if (/^T[0-9a-zA-Z]{33}$/.test(address)) {
    return "tron";
  }
  // Solana (Base58, 32~44자)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return "sol";
  }
  return "sol"; // 기본값
}

// ─── 내부: GMGN API 호출 ─────────────────────────────────────────────────
function fetchTokenInfo_(chain, address) {
  const endpoints = buildEndpoints_(chain, address);

  for (const url of endpoints) {
    try {
      Logger.log("Trying: " + url);
      const response = UrlFetchApp.fetch(url, {
        method: "GET",
        muteHttpExceptions: true,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://gmgn.ai/",
          "Origin": "https://gmgn.ai"
        },
        followRedirects: true
      });

      const code = response.getResponseCode();
      if (code !== 200) {
        Logger.log("HTTP " + code + " for " + url);
        continue;
      }

      const raw = response.getContentText();
      const json = JSON.parse(raw);

      const data = extractTokenData_(json);
      if (data) return data;

    } catch (err) {
      Logger.log("Fetch error for " + url + ": " + err.message);
    }
  }

  return null;
}

// ─── 내부: 시도할 엔드포인트 목록 ────────────────────────────────────────
function buildEndpoints_(chain, address) {
  return [
    // GMGN 공식 quotation API (토큰 상세)
    "https://gmgn.ai/defi/quotation/v1/tokens/" + chain + "/" + address,
    // GMGN 공식 rank API (스왑 데이터 포함)
    "https://gmgn.ai/defi/quotation/v1/token_info/" + chain + "/" + address,
    // 커뮤니티 문서화 엔드포인트
    "https://gmgn.ai/api/v1/token_stat/" + chain + "/" + address
  ];
}

// ─── 내부: 응답 JSON에서 데이터 추출 ─────────────────────────────────────
function extractTokenData_(json) {
  // 응답 구조 후보: json.data.token, json.data, json.token, json 자체
  const candidates = [
    json && json.data && json.data.token,
    json && json.data,
    json && json.token,
    json
  ];

  for (const obj of candidates) {
    if (!obj || typeof obj !== "object") continue;

    // 최소 필드 존재 여부로 유효성 확인
    const hasBasic = obj.symbol || obj.name || obj.market_cap || obj.holder_count;
    if (!hasBasic) continue;

    return {
      name        : obj.name        || obj.token_name  || "",
      symbol      : obj.symbol      || obj.token_symbol || "",
      marketCap   : parseNum_(obj.market_cap   || obj.marketCap   || obj.mc),
      fdv         : parseNum_(obj.fdv           || obj.fully_diluted_valuation || obj.market_cap),
      volume24h   : parseNum_(obj.volume        || obj.volume_24h  || obj.volume24h || obj.swap_volume_24h),
      holders     : parseNum_(obj.holder_count  || obj.holders     || obj.holder),
      liquidity   : parseNum_(obj.liquidity     || obj.liq),
      newHolding  : extractNewHolding_(obj)
    };
  }

  return null;
}

// ─── 내부: 신규 홀딩 % 추출 ──────────────────────────────────────────────
function extractNewHolding_(obj) {
  // 필드명 후보들
  const candidates = [
    obj.new_holder_ratio,
    obj.new_holder_6h_ratio,
    obj.new_holder_1h_ratio,
    obj.smart_buy_ratio_24h,
    obj.new_holder_count && obj.holder_count
      ? obj.new_holder_count / obj.holder_count
      : null
  ];

  for (const v of candidates) {
    if (v !== null && v !== undefined && !isNaN(v)) {
      const n = parseFloat(v);
      // 이미 % 단위인 경우(> 1) vs 소수 비율(< 1) 구분
      return n > 1 ? n : n * 100;
    }
  }
  return null;
}

// ─── 내부: 행에 데이터 기입 ──────────────────────────────────────────────
function writeRowData_(sheet, row, chain, d) {
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  sheet.getRange(row, COLUMNS.NAME      ).setValue(d.name);
  sheet.getRange(row, COLUMNS.SYMBOL    ).setValue(d.symbol);
  sheet.getRange(row, COLUMNS.MARKET_CAP).setValue(d.marketCap  !== null ? d.marketCap  : "N/A");
  sheet.getRange(row, COLUMNS.FDV       ).setValue(d.fdv        !== null ? d.fdv        : "N/A");
  sheet.getRange(row, COLUMNS.VOLUME_24H).setValue(d.volume24h  !== null ? d.volume24h  : "N/A");
  sheet.getRange(row, COLUMNS.HOLDERS   ).setValue(d.holders    !== null ? d.holders    : "N/A");
  sheet.getRange(row, COLUMNS.LIQUIDITY ).setValue(d.liquidity  !== null ? d.liquidity  : "N/A");
  sheet.getRange(row, COLUMNS.NEW_HOLDING).setValue(
    d.newHolding !== null ? (d.newHolding.toFixed(2) + "%") : "N/A"
  );
  sheet.getRange(row, COLUMNS.CHAIN     ).setValue(chain.toUpperCase());
  sheet.getRange(row, COLUMNS.UPDATED_AT).setValue(now);

  // 숫자 포맷 적용
  applyNumberFormats_(sheet, row);
}

// ─── 내부: 숫자 포맷 ─────────────────────────────────────────────────────
function applyNumberFormats_(sheet, row) {
  const usdFmt    = '"$"#,##0.00';
  const countFmt  = "#,##0";

  sheet.getRange(row, COLUMNS.MARKET_CAP).setNumberFormat(usdFmt);
  sheet.getRange(row, COLUMNS.FDV       ).setNumberFormat(usdFmt);
  sheet.getRange(row, COLUMNS.VOLUME_24H).setNumberFormat(usdFmt);
  sheet.getRange(row, COLUMNS.LIQUIDITY ).setNumberFormat(usdFmt);
  sheet.getRange(row, COLUMNS.HOLDERS   ).setNumberFormat(countFmt);
}

// ─── 내부: 행 초기화 ─────────────────────────────────────────────────────
function clearRow_(sheet, row) {
  sheet.getRange(row, COLUMNS.NAME, 1, COLUMNS.UPDATED_AT - COLUMNS.NAME + 1).clearContent();
}

// ─── 내부: 숫자 파싱 ─────────────────────────────────────────────────────
function parseNum_(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

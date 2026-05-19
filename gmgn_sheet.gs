/**
 * GMGN Agent API - Google Sheets Integration
 * A열에 컨트랙트 주소 입력 시 토큰 정보를 자동으로 조회합니다.
 *
 * ★ 최초 1회 설정 ★
 *   1. https://gmgn.ai/ai 에서 API Key 발급
 *   2. 아래 GMGN_API_KEY 에 붙여넣기
 *
 * 컬럼 구조:
 * A: Contract Address
 * B: 프로젝트 이름
 * C: 토큰 티커
 * D: MC ($)
 * E: FDV ($)
 * F: 24h 거래량 ($)
 * G: 홀더
 * H: 유동성 ($)
 * I: 신규 홀딩 %
 * J: Token Age
 * K: 체인
 * L: 조회 시각
 */

// ─── ★ API KEY 설정 (여기만 수정) ────────────────────────────────────────
const GMGN_API_KEY = "여기에_API_KEY_붙여넣기";

// ─── 컬럼 인덱스 ─────────────────────────────────────────────────────────
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
  TOKEN_AGE  : 10, // J
  CHAIN      : 11, // K
  UPDATED_AT : 12  // L
};

const HEADER_ROW     = 1;
const DATA_START_ROW = 2;
const CONTRACT_COL   = 1;

// GMGN API 베이스 URL 후보 (순서대로 시도)
const BASE_URLS = [
  "https://gmgn.ai/api",
  "https://gmgn.ai"
];

// ─── 트리거: 셀 수정 시 자동 실행 ────────────────────────────────────────
function onEdit(e) {
  const range = e.range;
  const sheet = range.getSheet();
  if (range.getColumn() !== CONTRACT_COL || range.getRow() < DATA_START_ROW) return;

  const address = range.getValue().toString().trim();
  if (!address) {
    clearRow_(sheet, range.getRow());
    return;
  }
  fetchAndFill_(sheet, range.getRow(), address);
}

// ─── 수동: 선택 행 새로고침 ──────────────────────────────────────────────
function refreshSelected() {
  const sheet    = SpreadsheetApp.getActiveSheet();
  const sel      = sheet.getActiveRange();
  const startRow = Math.max(sel.getRow(), DATA_START_ROW);
  const endRow   = sel.getLastRow();
  for (let row = startRow; row <= endRow; row++) {
    const addr = sheet.getRange(row, CONTRACT_COL).getValue().toString().trim();
    if (!addr) continue;
    fetchAndFill_(sheet, row, addr);
    Utilities.sleep(500);
  }
}

// ─── 수동: 전체 새로고침 ─────────────────────────────────────────────────
function refreshAll() {
  const sheet   = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  for (let row = DATA_START_ROW; row <= lastRow; row++) {
    const addr = sheet.getRange(row, CONTRACT_COL).getValue().toString().trim();
    if (!addr) continue;
    fetchAndFill_(sheet, row, addr);
    Utilities.sleep(600);
  }
}

// ─── 헤더 초기화 ─────────────────────────────────────────────────────────
function setupHeaders() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const headers = [
    "Contract Address", "프로젝트 이름", "토큰 티커",
    "MC ($)", "FDV ($)", "24h 거래량 ($)",
    "홀더", "유동성 ($)", "신규 홀딩 %",
    "Token Age", "체인", "조회 시각"
  ];
  const r = sheet.getRange(HEADER_ROW, 1, 1, headers.length);
  r.setValues([headers]);
  r.setFontWeight("bold");
  r.setBackground("#1a1a2e");
  r.setFontColor("#e0e0e0");
  sheet.setFrozenRows(1);

  const widths = [360, 150, 90, 120, 120, 130, 80, 120, 110, 100, 70, 160];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  SpreadsheetApp.getUi().alert("헤더 설정 완료!");
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

// ─── 핵심: API 호출 → 셀 기입 ────────────────────────────────────────────
function fetchAndFill_(sheet, row, address) {
  try {
    sheet.getRange(row, COLUMNS.NAME).setValue("조회 중...");
    SpreadsheetApp.flush();

    const chains = detectChains_(address);
    const result = fetchAllData_(chains, address);

    if (!result) {
      sheet.getRange(row, COLUMNS.NAME).setValue("⚠️ 데이터 없음");
      return;
    }
    writeRow_(sheet, row, result.chain, result.data);
  } catch (err) {
    sheet.getRange(row, COLUMNS.NAME).setValue("❌ " + err.message);
    Logger.log("Row " + row + " error: " + err.message);
  }
}

// ─── 체인 후보 목록 ──────────────────────────────────────────────────────
function detectChains_(address) {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return ["eth", "bsc", "base"];
  if (/^T[0-9a-zA-Z]{33}$/.test(address))  return ["tron"];
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return ["sol"];
  return ["sol"];
}

// ─── 토큰 데이터 통합 조회 ───────────────────────────────────────────────
function fetchAllData_(chains, address) {
  for (const chain of chains) {
    // 1차: /v1/token/info (공식 Agent API)
    const info = callGmgn_("/v1/token/info", { chain: chain, address: address });
    if (info) {
      // volume, market_cap 은 token/info에 없을 수 있으므로 market/rank도 시도
      const mkt = callGmgn_("/v1/market/token_stat", { chain: chain, address: address })
               || callGmgn_("/defi/quotation/v1/tokens/" + chain + "/" + address, null);

      return { chain: chain, data: mergeData_(info, mkt) };
    }

    // 2차: defi quotation (협력사 API, IP 허용 시 동작)
    const quot = callGmgn_("/defi/quotation/v1/tokens/" + chain + "/" + address, null);
    if (quot) return { chain: chain, data: mergeData_(quot, null) };
  }
  return null;
}

// ─── GMGN API 공통 호출 ──────────────────────────────────────────────────
function callGmgn_(path, params) {
  const qstr = params
    ? "?" + Object.entries(params).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&")
    : "";

  for (const base of BASE_URLS) {
    const url = base + path + qstr;
    try {
      Logger.log("GET " + url);
      const res = UrlFetchApp.fetch(url, {
        method: "GET",
        muteHttpExceptions: true,
        headers: {
          "x-route-key"    : GMGN_API_KEY,
          "Authorization"  : "Bearer " + GMGN_API_KEY,
          "User-Agent"     : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept"         : "application/json",
          "Referer"        : "https://gmgn.ai/",
          "Origin"         : "https://gmgn.ai"
        },
        followRedirects: true
      });

      const code = res.getResponseCode();
      const body = res.getContentText();
      Logger.log("HTTP " + code + " | " + body.substring(0, 200));

      if (code !== 200) continue;

      let json;
      try { json = JSON.parse(body); } catch(e) { continue; }

      // code:0 = 성공 (GMGN 규격)
      if (json.code !== undefined && json.code !== 0) continue;

      const obj = extractObj_(json);
      if (obj) return obj;

    } catch (err) {
      Logger.log("Fetch error " + url + ": " + err.message);
    }
  }
  return null;
}

// ─── JSON 응답에서 토큰 객체 추출 ────────────────────────────────────────
function extractObj_(json) {
  const candidates = [
    json?.data?.token,
    json?.data,
    json?.token,
    json?.result,
    json
  ];
  for (const obj of candidates) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    if (obj.symbol || obj.name || obj.holder_count || obj.market_cap || obj.liquidity) {
      return obj;
    }
  }
  return null;
}

// ─── 두 응답 객체 병합 ───────────────────────────────────────────────────
function mergeData_(primary, secondary) {
  const s = secondary || {};
  const p = primary  || {};

  const price    = parseNum_(p.price?.price ?? p.price ?? p.priceUsd);
  const circSupply = parseNum_(p.circulating_supply ?? p.circulatingSupply);
  const totalSupply = parseNum_(p.total_supply ?? p.totalSupply);

  // market cap: 직접 제공되거나 price × circulatingSupply로 계산
  const mc  = parseNum_(p.market_cap ?? s.market_cap)
           ?? (price && circSupply ? price * circSupply : null);
  // fdv: price × totalSupply
  const fdv = parseNum_(p.fdv ?? s.fdv)
           ?? (price && totalSupply ? price * totalSupply : mc);

  const volume = parseNum_(
    p.volume_24h ?? p.volume ?? s.volume_24h ?? s.volume
  );

  const holders   = parseNum_(p.holder_count  ?? s.holder_count  ?? p.holders);
  const liquidity = parseNum_(p.liquidity     ?? s.liquidity);

  const newHolding = calcNewHolding_(p) ?? calcNewHolding_(s);

  // Token age: open_timestamp 또는 creation_timestamp (Unix초)
  const ts = parseNum_(
    p.open_timestamp ?? p.creation_timestamp ?? p.created_timestamp
    ?? s.open_timestamp ?? s.creation_timestamp
  );
  const tokenAge = ts ? formatAge_(ts) : null;

  return {
    name       : p.name       || p.token_name  || s.name   || "",
    symbol     : p.symbol     || p.token_symbol || s.symbol || "",
    marketCap  : mc,
    fdv        : fdv,
    volume24h  : volume,
    holders    : holders,
    liquidity  : liquidity,
    newHolding : newHolding,
    tokenAge   : tokenAge
  };
}

// ─── 신규 홀딩 % 계산 ────────────────────────────────────────────────────
function calcNewHolding_(obj) {
  if (!obj) return null;
  const fields = [
    obj.new_holder_ratio, obj.new_holder_6h_ratio,
    obj.new_holder_1h_ratio, obj.smart_buy_ratio_24h
  ];
  for (const v of fields) {
    if (v !== null && v !== undefined && !isNaN(parseFloat(v))) {
      const n = parseFloat(v);
      return n > 1 ? n : n * 100;
    }
  }
  // new_holder_count / holder_count
  if (obj.new_holder_count && obj.holder_count) {
    return (obj.new_holder_count / obj.holder_count) * 100;
  }
  return null;
}

// ─── Token Age 포맷 (Unix초 → "3d 2h" 형식) ──────────────────────────────
function formatAge_(unixSec) {
  const ms      = Date.now() - unixSec * 1000;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60)  return minutes + "m";
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return hours + "h " + (minutes % 60) + "m";
  const days  = Math.floor(hours / 24);
  if (days < 30)     return days + "d " + (hours % 24) + "h";
  const months = Math.floor(days / 30);
  return months + "mo " + (days % 30) + "d";
}

// ─── 행 데이터 기입 ──────────────────────────────────────────────────────
function writeRow_(sheet, row, chain, d) {
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  sheet.getRange(row, COLUMNS.NAME      ).setValue(d.name);
  sheet.getRange(row, COLUMNS.SYMBOL    ).setValue(d.symbol);
  sheet.getRange(row, COLUMNS.MARKET_CAP).setValue(d.marketCap  ?? "N/A");
  sheet.getRange(row, COLUMNS.FDV       ).setValue(d.fdv        ?? "N/A");
  sheet.getRange(row, COLUMNS.VOLUME_24H).setValue(d.volume24h  ?? "N/A");
  sheet.getRange(row, COLUMNS.HOLDERS   ).setValue(d.holders    ?? "N/A");
  sheet.getRange(row, COLUMNS.LIQUIDITY ).setValue(d.liquidity  ?? "N/A");
  sheet.getRange(row, COLUMNS.NEW_HOLDING).setValue(
    d.newHolding != null ? d.newHolding.toFixed(2) + "%" : "N/A"
  );
  sheet.getRange(row, COLUMNS.TOKEN_AGE ).setValue(d.tokenAge   ?? "N/A");
  sheet.getRange(row, COLUMNS.CHAIN     ).setValue(chain.toUpperCase());
  sheet.getRange(row, COLUMNS.UPDATED_AT).setValue(now);

  applyFormats_(sheet, row);
}

// ─── 숫자 포맷 ───────────────────────────────────────────────────────────
function applyFormats_(sheet, row) {
  sheet.getRange(row, COLUMNS.MARKET_CAP).setNumberFormat('"$"#,##0.00');
  sheet.getRange(row, COLUMNS.FDV       ).setNumberFormat('"$"#,##0.00');
  sheet.getRange(row, COLUMNS.VOLUME_24H).setNumberFormat('"$"#,##0.00');
  sheet.getRange(row, COLUMNS.LIQUIDITY ).setNumberFormat('"$"#,##0.00');
  sheet.getRange(row, COLUMNS.HOLDERS   ).setNumberFormat('#,##0');
}

// ─── 행 초기화 ───────────────────────────────────────────────────────────
function clearRow_(sheet, row) {
  sheet.getRange(row, COLUMNS.NAME, 1, COLUMNS.UPDATED_AT - COLUMNS.NAME + 1).clearContent();
}

// ─── 숫자 파싱 ───────────────────────────────────────────────────────────
function parseNum_(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

/**
 * GMGN Official OpenAPI - Google Sheets Integration
 *
 * ★ API KEY는 Config.gs 파일에서 설정하세요 ★
 *
 * 컬럼: A=Contract | B=이름 | C=티커 | D=MC | E=FDV
 *       F=24h거래량 | G=홀더 | H=유동성 | I=신규홀딩% | J=Token Age | K=체인 | L=시각
 */

// ─── 공식 API 설정 ────────────────────────────────────────────────────────
const GMGN_BASE = "https://openapi.gmgn.ai";  // 공식 OpenAPI 도메인

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

// ─── 트리거: A열 입력 시 자동 실행 ───────────────────────────────────────
function onEdit(e) {
  const range = e.range;
  const sheet = range.getSheet();
  if (range.getColumn() !== 1 || range.getRow() < DATA_START_ROW) return;

  const address = range.getValue().toString().trim();
  if (!address) { clearRow_(sheet, range.getRow()); return; }
  fetchAndFill_(sheet, range.getRow(), address);
}

// ─── 수동: 선택 행 새로고침 ──────────────────────────────────────────────
function refreshSelected() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const sel   = sheet.getActiveRange();
  for (let row = Math.max(sel.getRow(), DATA_START_ROW); row <= sel.getLastRow(); row++) {
    const addr = sheet.getRange(row, 1).getValue().toString().trim();
    if (addr) { fetchAndFill_(sheet, row, addr); Utilities.sleep(1200); }
  }
}

// ─── 수동: 전체 새로고침 ─────────────────────────────────────────────────
function refreshAll() {
  const sheet = SpreadsheetApp.getActiveSheet();
  for (let row = DATA_START_ROW; row <= sheet.getLastRow(); row++) {
    const addr = sheet.getRange(row, 1).getValue().toString().trim();
    if (addr) { fetchAndFill_(sheet, row, addr); Utilities.sleep(1200); }
  }
}

// ─── 헤더 초기화 ─────────────────────────────────────────────────────────
function setupHeaders() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const h = ["Contract Address","프로젝트 이름","토큰 티커","MC ($)","FDV ($)",
             "24h 거래량 ($)","홀더","유동성 ($)","신규 홀딩 %","Token Age","체인","조회 시각"];
  const r = sheet.getRange(1, 1, 1, h.length);
  r.setValues([h]).setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#e0e0e0");
  sheet.setFrozenRows(1);
  SpreadsheetApp.getUi().alert("헤더 설정 완료!");
}

// ─── 메뉴 등록 ────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi().createMenu("🔍 GMGN 조회")
    .addItem("헤더 초기화","setupHeaders").addSeparator()
    .addItem("선택 행 새로고침","refreshSelected")
    .addItem("전체 새로고침","refreshAll").addToUi();
}

// ─── 핵심: 조회 → 기입 ───────────────────────────────────────────────────
function fetchAndFill_(sheet, row, address) {
  try {
    sheet.getRange(row, COLUMNS.NAME).setValue("조회 중...");
    SpreadsheetApp.flush();

    const chains = detectChains_(address);
    const result = tryAllChains_(chains, address);

    if (!result) {
      sheet.getRange(row, COLUMNS.NAME).setValue("⚠️ 데이터 없음");
      return;
    }
    writeRow_(sheet, row, result.chain, result.data);
  } catch (err) {
    sheet.getRange(row, COLUMNS.NAME).setValue("❌ " + err.message);
    Logger.log("Row " + row + ": " + err.message);
  }
}

// ─── 체인 후보 목록 ──────────────────────────────────────────────────────
function detectChains_(address) {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return ["eth","bsc","base"];
  if (/^T[0-9a-zA-Z]{33}$/.test(address))  return ["tron"];
  return ["sol"];
}

// ─── 체인 순회 조회 ──────────────────────────────────────────────────────
function tryAllChains_(chains, address) {
  for (const chain of chains) {
    // 1. /v1/token/info — 기본 정보 (price, holder_count, liquidity, supply, open_timestamp)
    const info = gmgnGet_("/v1/token/info", { chain, address });
    if (!info) continue;

    // 2. /v1/token/pool_info — 풀 정보 (volume_24h 포함 가능)
    const pool = gmgnGet_("/v1/token/pool_info", { chain, address });

    const data = buildData_(info, pool);
    if (data.name || data.symbol) return { chain, data };
  }
  return null;
}

// ─── GMGN OpenAPI GET 요청 ────────────────────────────────────────────────
function gmgnGet_(path, params) {
  // 인증: X-APIKEY 헤더 + timestamp(Unix초) + client_id(UUID) 쿼리 파라미터
  const timestamp = Math.floor(Date.now() / 1000);
  const client_id = Utilities.getUuid();
  const query = Object.assign({}, params, { timestamp, client_id });
  const qs = Object.entries(query)
    .map(([k, v]) => k + "=" + encodeURIComponent(v))
    .join("&");
  const url = GMGN_BASE + path + "?" + qs;

  try {
    Logger.log("GET " + url);
    const res = UrlFetchApp.fetch(url, {
      method: "GET",
      muteHttpExceptions: true,
      headers: {
        "X-APIKEY"      : GMGN_API_KEY,
        "Content-Type"  : "application/json",
        "User-Agent"    : "gmgn-cli/1.3.2"
      }
    });

    const code = res.getResponseCode();
    const body = res.getContentText();
    Logger.log("HTTP " + code + " | " + body.substring(0, 300));

    if (code !== 200) return null;
    const json = JSON.parse(body);

    // GMGN 응답: { code: 0, data: { ... } }
    if (json.code !== 0 && json.code !== undefined) {
      Logger.log("API error code " + json.code + ": " + json.msg);
      return null;
    }

    return json.data || json;
  } catch (err) {
    Logger.log("Fetch error " + path + ": " + err.message);
    return null;
  }
}

// ─── 응답 데이터 조합 ────────────────────────────────────────────────────
function buildData_(info, pool) {
  // token/info 응답 구조 (공식 SDK 기준)
  // info.price.price, info.circulating_supply, info.total_supply,
  // info.holder_count, info.liquidity, info.open_timestamp
  const price  = parseNum_(info?.price?.price ?? info?.price);
  const csupply = parseNum_(info?.circulating_supply);
  const tsupply = parseNum_(info?.total_supply);

  const mc  = parseNum_(info?.market_cap)
           ?? (price && csupply ? price * csupply : null);
  const fdv = parseNum_(info?.fdv)
           ?? (price && tsupply ? price * tsupply : mc);

  // pool_info에 volume이 있을 수 있음
  const vol = parseNum_(
    pool?.volume_24h ?? pool?.volume ?? info?.volume_24h ?? info?.volume
  );

  const holders   = parseNum_(info?.holder_count ?? info?.holders);
  const liquidity = parseNum_(info?.liquidity ?? pool?.liquidity);

  // 신규 홀딩 % — fresh_wallet_rate: 신규(fresh) 지갑이 보유한 비율 (0~1 소수)
  let newHolding = null;
  const nhFields = [
    info?.fresh_wallet_rate, pool?.fresh_wallet_rate,
    info?.new_holder_ratio, info?.new_holder_6h_ratio,
    info?.new_holder_1h_ratio, info?.smart_buy_ratio_24h
  ];
  for (const v of nhFields) {
    if (v != null && !isNaN(parseFloat(v))) {
      const n = parseFloat(v);
      newHolding = n > 1 ? n : n * 100;
      break;
    }
  }
  if (newHolding === null && info?.new_holder_count && info?.holder_count) {
    newHolding = (info.new_holder_count / info.holder_count) * 100;
  }

  // Token Age
  const ts = parseNum_(
    info?.open_timestamp ?? info?.creation_timestamp ?? info?.created_timestamp
  );
  const tokenAge = ts ? formatAge_(ts) : null;

  return {
    name      : info?.name       || info?.token_name  || "",
    symbol    : info?.symbol     || info?.token_symbol || "",
    marketCap : mc,
    fdv       : fdv,
    volume24h : vol,
    holders   : holders,
    liquidity : liquidity,
    newHolding: newHolding,
    tokenAge  : tokenAge
  };
}

// ─── Token Age 포맷 ───────────────────────────────────────────────────────
function formatAge_(unixSec) {
  const mins = Math.floor((Date.now() - unixSec * 1000) / 60000);
  if (mins < 60)   return mins + "m";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return hrs + "h " + (mins % 60) + "m";
  const days = Math.floor(hrs / 24);
  if (days < 30)   return days + "d " + (hrs % 24) + "h";
  return Math.floor(days / 30) + "mo " + (days % 30) + "d";
}

// ─── 행 기입 ─────────────────────────────────────────────────────────────
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
    d.newHolding != null ? d.newHolding.toFixed(2) + "%" : "N/A");
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

// ─── 행 초기화 / 숫자 파싱 ───────────────────────────────────────────────
function clearRow_(sheet, row) {
  sheet.getRange(row, 2, 1, 11).clearContent();
}
function parseNum_(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

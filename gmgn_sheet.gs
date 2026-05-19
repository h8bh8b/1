/**
 * GMGN Official OpenAPI - Google Sheets Integration
 *
 * ★ API KEY는 Config.gs 파일에서 설정하세요 ★
 *
 * 컬럼: A=Contract | B=이름 | C=티커 | D=MC | E=FDV
 *       F=24h거래량 | G=홀더 | H=유동성 | I=신규홀딩% | J=Token Age | K=체인 | L=시각
 */

const GMGN_BASE    = "https://openapi.gmgn.ai";
const BATCH_SIZE   = 50;   // fetchAll 1회 최대 요청 수
const TOTAL_COLS   = 11;   // B~L

const COLUMNS = {
  CONTRACT   : 1,
  NAME       : 2,
  SYMBOL     : 3,
  MARKET_CAP : 4,
  FDV        : 5,
  VOLUME_24H : 6,
  HOLDERS    : 7,
  LIQUIDITY  : 8,
  NEW_HOLDING: 9,
  TOKEN_AGE  : 10,
  CHAIN      : 11,
  UPDATED_AT : 12
};
const HEADER_ROW     = 1;
const DATA_START_ROW = 2;

// ─── 트리거: A열 단일 셀 입력 ────────────────────────────────────────────
function onEdit(e) {
  const range = e.range;
  const sheet = range.getSheet();
  if (range.getColumn() !== 1 || range.getRow() < DATA_START_ROW) return;

  const address = range.getValue().toString().trim();
  if (!address) { clearRow_(sheet, range.getRow()); return; }

  sheet.getRange(range.getRow(), COLUMNS.NAME).setValue("조회 중...");
  SpreadsheetApp.flush();

  const result = querySingle_(address);
  if (!result) {
    sheet.getRange(range.getRow(), COLUMNS.NAME).setValue("⚠️ 데이터 없음");
    return;
  }
  const row = buildRowArray_(result.chain, result.data);
  sheet.getRange(range.getRow(), COLUMNS.NAME, 1, TOTAL_COLS).setValues([row]);
  applyFormats_(sheet, range.getRow());
}

// ─── 수동: 선택 행 새로고침 ──────────────────────────────────────────────
function refreshSelected() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const sel   = sheet.getActiveRange();
  const start = Math.max(sel.getRow(), DATA_START_ROW);
  const end   = sel.getLastRow();
  batchRefresh_(sheet, start, end);
}

// ─── 수동: 전체 새로고침 ─────────────────────────────────────────────────
function refreshAll() {
  const sheet = SpreadsheetApp.getActiveSheet();
  batchRefresh_(sheet, DATA_START_ROW, sheet.getLastRow());
}

// ─── 일괄 처리 핵심 ──────────────────────────────────────────────────────
function batchRefresh_(sheet, startRow, endRow) {
  if (endRow < startRow) return;
  const count = endRow - startRow + 1;

  // 주소 일괄 읽기
  const addresses = sheet.getRange(startRow, 1, count, 1)
    .getValues().map(r => r[0].toString().trim());

  // 로딩 상태 한 번에 표시
  const loadingCol = COLUMNS.NAME;
  const loadingData = addresses.map(a => [a ? "조회 중..." : ""]);
  sheet.getRange(startRow, loadingCol, count, 1).setValues(loadingData);
  SpreadsheetApp.flush();

  // 50개 단위 청크로 병렬 처리
  const resultRows = new Array(count).fill(null);

  for (let i = 0; i < count; i += BATCH_SIZE) {
    const chunk        = addresses.slice(i, i + BATCH_SIZE);
    const chunkResults = fetchBatch_(chunk);
    chunkResults.forEach((r, j) => resultRows[i + j] = r);
  }

  // 결과 일괄 쓰기
  const outputValues = resultRows.map((r, i) => {
    if (!addresses[i]) return new Array(TOTAL_COLS).fill("");
    if (!r) return ["⚠️ 데이터 없음", ...new Array(TOTAL_COLS - 1).fill("")];
    return buildRowArray_(r.chain, r.data);
  });

  sheet.getRange(startRow, COLUMNS.NAME, count, TOTAL_COLS).setValues(outputValues);

  // 숫자 포맷 일괄 적용
  for (let row = startRow; row <= endRow; row++) {
    if (addresses[row - startRow]) applyFormats_(sheet, row);
  }
}

// ─── 50개 병렬 fetchAll ───────────────────────────────────────────────────
function fetchBatch_(addresses) {
  // 각 주소 → 체인별 요청 생성
  const allRequests = [];
  const reqMeta     = []; // { addrIdx, chain }

  addresses.forEach((addr, addrIdx) => {
    if (!addr) return;
    detectChains_(addr).forEach(chain => {
      const ts  = Math.floor(Date.now() / 1000);
      const cid = Utilities.getUuid();
      const qs  = `chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(addr)}&timestamp=${ts}&client_id=${cid}`;
      allRequests.push({
        url            : `${GMGN_BASE}/v1/token/info?${qs}`,
        method         : "GET",
        muteHttpExceptions: true,
        headers        : {
          "X-APIKEY"    : GMGN_API_KEY,
          "Content-Type": "application/json",
          "User-Agent"  : "gmgn-cli/1.3.2"
        }
      });
      reqMeta.push({ addrIdx, chain });
    });
  });

  if (!allRequests.length) return new Array(addresses.length).fill(null);

  // 병렬 실행
  const responses = UrlFetchApp.fetchAll(allRequests);
  const results   = new Array(addresses.length).fill(null);

  responses.forEach((res, i) => {
    const { addrIdx, chain } = reqMeta[i];
    if (results[addrIdx]) return; // 이미 성공한 체인 있음

    if (res.getResponseCode() !== 200) return;
    let json;
    try { json = JSON.parse(res.getContentText()); } catch(e) { return; }
    if (json.code !== undefined && json.code !== 0) return;

    const obj = json.data || json;
    if (obj && typeof obj === "object" && (obj.name || obj.symbol || obj.holder_count || obj.liquidity)) {
      results[addrIdx] = { chain, data: buildData_(obj, null) };
    }
  });

  return results;
}

// ─── 단일 주소 조회 (onEdit용) ────────────────────────────────────────────
function querySingle_(address) {
  const chains = detectChains_(address);
  const requests = chains.map(chain => {
    const ts  = Math.floor(Date.now() / 1000);
    const cid = Utilities.getUuid();
    const qs  = `chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}&timestamp=${ts}&client_id=${cid}`;
    return {
      url: `${GMGN_BASE}/v1/token/info?${qs}`,
      method: "GET",
      muteHttpExceptions: true,
      headers: {
        "X-APIKEY"    : GMGN_API_KEY,
        "Content-Type": "application/json",
        "User-Agent"  : "gmgn-cli/1.3.2"
      }
    };
  });

  const responses = UrlFetchApp.fetchAll(requests);
  for (let i = 0; i < responses.length; i++) {
    const res = responses[i];
    if (res.getResponseCode() !== 200) continue;
    let json;
    try { json = JSON.parse(res.getContentText()); } catch(e) { continue; }
    if (json.code !== undefined && json.code !== 0) continue;
    const obj = json.data || json;
    if (obj && (obj.name || obj.symbol || obj.holder_count || obj.liquidity)) {
      return { chain: chains[i], data: buildData_(obj, null) };
    }
  }
  return null;
}

// ─── 체인 후보 목록 ──────────────────────────────────────────────────────
function detectChains_(address) {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return ["eth", "bsc", "base"];
  if (/^T[0-9a-zA-Z]{33}$/.test(address))  return ["tron"];
  return ["sol"];
}

// ─── 응답 데이터 조합 ────────────────────────────────────────────────────
function buildData_(info, pool) {
  const price   = parseNum_(info?.price?.price ?? info?.price);
  const csupply = parseNum_(info?.circulating_supply);
  const tsupply = parseNum_(info?.total_supply);

  const mc  = parseNum_(info?.market_cap)
           ?? (price && csupply ? price * csupply : null);
  const fdv = parseNum_(info?.fdv)
           ?? (price && tsupply ? price * tsupply : mc);

  const vol = parseNum_(
    pool?.volume_24h ?? pool?.volume ?? info?.volume_24h ?? info?.volume
  );

  const holders   = parseNum_(info?.holder_count ?? info?.holders);
  const liquidity = parseNum_(info?.liquidity ?? pool?.liquidity);

  // 신규 홀딩 %: fresh_wallet_rate (공식 필드)
  let newHolding = null;
  for (const v of [info?.fresh_wallet_rate, pool?.fresh_wallet_rate,
                   info?.new_holder_ratio, info?.new_holder_6h_ratio,
                   info?.new_holder_1h_ratio]) {
    if (v != null && !isNaN(parseFloat(v))) {
      const n = parseFloat(v);
      newHolding = n > 1 ? n : n * 100;
      break;
    }
  }
  if (newHolding === null && info?.new_holder_count && info?.holder_count) {
    newHolding = (info.new_holder_count / info.holder_count) * 100;
  }

  const ts = parseNum_(info?.open_timestamp ?? info?.creation_timestamp ?? info?.created_timestamp);

  return {
    name      : info?.name   || info?.token_name  || "",
    symbol    : info?.symbol || info?.token_symbol || "",
    marketCap : mc,
    fdv,
    volume24h : vol,
    holders,
    liquidity,
    newHolding,
    tokenAge  : ts ? formatAge_(ts) : null
  };
}

// ─── 행 배열 생성 ─────────────────────────────────────────────────────────
function buildRowArray_(chain, d) {
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  return [
    d.name,
    d.symbol,
    d.marketCap  ?? "N/A",
    d.fdv        ?? "N/A",
    d.volume24h  ?? "N/A",
    d.holders    ?? "N/A",
    d.liquidity  ?? "N/A",
    d.newHolding != null ? d.newHolding.toFixed(2) + "%" : "N/A",
    d.tokenAge   ?? "N/A",
    chain.toUpperCase(),
    now
  ];
}

// ─── Token Age 포맷 ───────────────────────────────────────────────────────
function formatAge_(unixSec) {
  const mins = Math.floor((Date.now() - unixSec * 1000) / 60000);
  if (mins < 60)  return mins + "m";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return hrs + "h " + (mins % 60) + "m";
  const days = Math.floor(hrs / 24);
  if (days < 30)  return days + "d " + (hrs % 24) + "h";
  return Math.floor(days / 30) + "mo " + (days % 30) + "d";
}

// ─── 숫자 포맷 ───────────────────────────────────────────────────────────
function applyFormats_(sheet, row) {
  sheet.getRange(row, COLUMNS.MARKET_CAP).setNumberFormat('"$"#,##0.00');
  sheet.getRange(row, COLUMNS.FDV       ).setNumberFormat('"$"#,##0.00');
  sheet.getRange(row, COLUMNS.VOLUME_24H).setNumberFormat('"$"#,##0.00');
  sheet.getRange(row, COLUMNS.LIQUIDITY ).setNumberFormat('"$"#,##0.00');
  sheet.getRange(row, COLUMNS.HOLDERS   ).setNumberFormat('#,##0');
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
    .addItem("헤더 초기화", "setupHeaders").addSeparator()
    .addItem("선택 행 새로고침", "refreshSelected")
    .addItem("전체 새로고침", "refreshAll").addToUi();
}

// ─── 행 초기화 / 유틸 ────────────────────────────────────────────────────
function clearRow_(sheet, row) {
  sheet.getRange(row, 2, 1, TOTAL_COLS).clearContent();
}
function parseNum_(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

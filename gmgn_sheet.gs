/**
 * GMGN Official OpenAPI - Google Sheets Integration
 *
 * ★ API KEY는 Config.gs 파일에서 설정하세요 ★
 *
 * 컬럼: A=Contract | B=이름 | C=티커 | D=MC | E=FDV | F=24h거래량
 *       G=홀더 | H=유동성 | I=Fresh Wallet | J=Token Age | K=체인 | L=Buy Tax | M=Sell Tax | N=DEX Tax | O=조회 시각
 */

const GMGN_BASE  = "https://openapi.gmgn.ai";
const BATCH_SIZE = 50;
const TOTAL_COLS = 14;   // B~O

const COLUMNS = {
  CONTRACT    : 1,
  NAME        : 2,
  SYMBOL      : 3,
  MARKET_CAP  : 4,
  FDV         : 5,
  VOLUME_24H  : 6,
  HOLDERS     : 7,
  LIQUIDITY   : 8,
  FRESH_WALLET: 9,
  TOKEN_AGE   : 10,
  CHAIN       : 11,
  BUY_TAX     : 12,
  SELL_TAX    : 13,
  DEX_TAX     : 14,
  UPDATED_AT  : 15
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
  batchRefresh_(sheet, Math.max(sel.getRow(), DATA_START_ROW), sel.getLastRow());
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

  const addresses = sheet.getRange(startRow, 1, count, 1)
    .getValues().map(r => r[0].toString().trim());

  const loadingData = addresses.map(a => [a ? "조회 중..." : ""]);
  sheet.getRange(startRow, COLUMNS.NAME, count, 1).setValues(loadingData);
  SpreadsheetApp.flush();

  const resultRows = new Array(count).fill(null);
  for (let i = 0; i < count; i += BATCH_SIZE) {
    const chunk        = addresses.slice(i, i + BATCH_SIZE);
    const chunkResults = fetchBatch_(chunk);
    chunkResults.forEach((r, j) => resultRows[i + j] = r);
  }

  const outputValues = resultRows.map((r, i) => {
    if (!addresses[i]) return new Array(TOTAL_COLS).fill("");
    if (!r) return ["⚠️ 데이터 없음", ...new Array(TOTAL_COLS - 1).fill("")];
    return buildRowArray_(r.chain, r.data);
  });

  sheet.getRange(startRow, COLUMNS.NAME, count, TOTAL_COLS).setValues(outputValues);

  for (let row = startRow; row <= endRow; row++) {
    if (addresses[row - startRow]) applyFormats_(sheet, row);
  }
}

// ─── 50개 병렬 fetchAll (2라운드) ────────────────────────────────────────
function fetchBatch_(addresses) {
  // ── Round 1: token/info (모든 체인 동시 요청) ──────────────────────────
  const infoReqs = [];
  const infoMeta = [];

  addresses.forEach((addr, addrIdx) => {
    if (!addr) return;
    const normAddr = normalizeAddress_(addr);
    detectChains_(addr).forEach(chain => {
      infoReqs.push(buildReq_("/v1/token/info", { chain, address: normAddr }));
      infoMeta.push({ addrIdx, chain });
    });
  });

  const infoObjs      = new Array(addresses.length).fill(null);
  const winningChains = new Array(addresses.length).fill(null);

  if (infoReqs.length) {
    UrlFetchApp.fetchAll(infoReqs).forEach((res, i) => {
      const { addrIdx, chain } = infoMeta[i];
      if (infoObjs[addrIdx]) return;
      const obj = parseRes_(res);
      if (obj) { infoObjs[addrIdx] = obj; winningChains[addrIdx] = chain; }
    });
  }

  // ── Round 2: pool_info + kline + security (성공 체인만, 동시 요청) ────
  const r2Reqs = [];
  const r2Meta = [];
  const now24hAgo = Math.floor(Date.now() / 1000) - 86400;
  const nowTs     = Math.floor(Date.now() / 1000);

  addresses.forEach((addr, addrIdx) => {
    const chain = winningChains[addrIdx];
    if (!addr || !chain) return;
    const normAddr = normalizeAddress_(addr);
    r2Reqs.push(buildReq_("/v1/token/pool_info", { chain, address: normAddr }));
    r2Meta.push({ addrIdx, type: "pool" });
    r2Reqs.push(buildReq_("/v1/market/token_kline", { chain, address: normAddr, resolution: "1h", from: now24hAgo * 1000, to: nowTs * 1000 }));
    r2Meta.push({ addrIdx, type: "kline" });
    r2Reqs.push(buildReq_("/v1/token/security", { chain, address: normAddr }));
    r2Meta.push({ addrIdx, type: "sec" });
    r2Reqs.push(buildReq_("/v1/market/token_top_holders", { chain, address: normAddr, tag: "fresh_wallet" }));
    r2Meta.push({ addrIdx, type: "fresh" });
  });

  const poolObjs    = new Array(addresses.length).fill(null);
  const vol24hArr   = new Array(addresses.length).fill(null);
  const secObjs     = new Array(addresses.length).fill(undefined); // undefined: 미조회, null: 실패
  const freshPctArr = new Array(addresses.length).fill(null);

  if (r2Reqs.length) {
    UrlFetchApp.fetchAll(r2Reqs).forEach((res, i) => {
      const { addrIdx, type } = r2Meta[i];
      if (res.getResponseCode() !== 200) {
        if (type === "sec") secObjs[addrIdx] = null;
        return;
      }
      let json;
      try { json = JSON.parse(res.getContentText()); } catch(e) {
        if (type === "sec") secObjs[addrIdx] = null;
        return;
      }
      if (json.code !== undefined && json.code !== 0) {
        if (type === "sec") secObjs[addrIdx] = null;
        return;
      }

      if (type === "pool") {
        const obj = json.data || json;
        if (obj && typeof obj === "object") poolObjs[addrIdx] = obj;

      } else if (type === "kline") {
        const d = json.data ?? json;
        let candles = null;
        if (Array.isArray(d))               candles = d;
        else if (Array.isArray(d?.list))    candles = d.list;
        else if (Array.isArray(d?.candles)) candles = d.candles;
        else if (Array.isArray(d?.kline))   candles = d.kline;
        else if (Array.isArray(d?.klines))  candles = d.klines;
        if (candles && candles.length) {
          vol24hArr[addrIdx] = candles.reduce((sum, c) => {
            const v = parseFloat(c.volume ?? c.vol ?? c.volume_usd ?? 0);
            return sum + (isNaN(v) ? 0 : v);
          }, 0);
        }

      } else if (type === "sec") {
        const obj = json.data || json;
        if (obj && typeof obj === "object") secObjs[addrIdx] = obj;
        else                                 secObjs[addrIdx] = null;

      } else if (type === "fresh") {
        const d = json.data ?? json;
        const holders = Array.isArray(d) ? d : (Array.isArray(d?.holders) ? d.holders : (Array.isArray(d?.list) ? d.list : null));
        if (holders && holders.length) {
          const total = holders.reduce((sum, h) => {
            const pct = parseFloat(h.amount_percentage ?? h.percentage ?? h.pct ?? 0);
            return sum + (isNaN(pct) ? 0 : pct);
          }, 0);
          freshPctArr[addrIdx] = total;
        }
      }
    });
  }

  return addresses.map((addr, addrIdx) => {
    if (!addr || !infoObjs[addrIdx]) return null;
    return {
      chain: winningChains[addrIdx],
      data : buildData_(infoObjs[addrIdx], poolObjs[addrIdx], vol24hArr[addrIdx], secObjs[addrIdx], freshPctArr[addrIdx])
    };
  });
}

// ─── 단일 주소 조회 (onEdit용) ────────────────────────────────────────────
function querySingle_(address) {
  const chains    = detectChains_(address);
  const normAddr  = normalizeAddress_(address);

  const infoResps = UrlFetchApp.fetchAll(chains.map(c => buildReq_("/v1/token/info", { chain: c, address: normAddr })));
  let winChain = null, infoObj = null;
  for (let i = 0; i < infoResps.length; i++) {
    const obj = parseRes_(infoResps[i]);
    if (obj) { infoObj = obj; winChain = chains[i]; break; }
  }
  if (!infoObj) return null;

  const now24hAgo = Math.floor(Date.now() / 1000) - 86400;
  const nowTs     = Math.floor(Date.now() / 1000);
  const r2Resps = UrlFetchApp.fetchAll([
    buildReq_("/v1/token/pool_info", { chain: winChain, address: normAddr }),
    buildReq_("/v1/market/token_kline", { chain: winChain, address: normAddr, resolution: "1h", from: now24hAgo * 1000, to: nowTs * 1000 }),
    buildReq_("/v1/token/security", { chain: winChain, address: normAddr }),
    buildReq_("/v1/market/token_top_holders", { chain: winChain, address: normAddr, tag: "fresh_wallet" })
  ]);

  const poolObj = parseRes_(r2Resps[0]);

  let vol24h = null;
  try {
    const kj = JSON.parse(r2Resps[1].getContentText());
    const d  = kj.data ?? kj;
    const candles = Array.isArray(d) ? d : (d?.list || d?.candles || d?.kline || d?.klines);
    if (Array.isArray(candles) && candles.length) {
      vol24h = candles.reduce((s, c) => s + (parseFloat(c.volume ?? c.vol ?? 0) || 0), 0);
    }
  } catch(e) {}

  let secObj = null;
  try {
    const sj = JSON.parse(r2Resps[2].getContentText());
    if (sj.code === 0 || sj.code === undefined) secObj = sj.data || sj;
  } catch(e) {}

  let freshPct = null;
  try {
    const fj = JSON.parse(r2Resps[3].getContentText());
    const d  = fj.data ?? fj;
    const holders = Array.isArray(d) ? d : (Array.isArray(d?.holders) ? d.holders : (Array.isArray(d?.list) ? d.list : null));
    if (holders && holders.length) {
      freshPct = holders.reduce((sum, h) => {
        const pct = parseFloat(h.amount_percentage ?? h.percentage ?? h.pct ?? 0);
        return sum + (isNaN(pct) ? 0 : pct);
      }, 0);
    }
  } catch(e) {}

  return { chain: winChain, data: buildData_(infoObj, poolObj, vol24h, secObj, freshPct) };
}

// ─── 공통: 요청 객체 생성 ────────────────────────────────────────────────
function buildReq_(path, params) {
  const ts  = Math.floor(Date.now() / 1000);
  const cid = Utilities.getUuid();
  const qs  = Object.entries(Object.assign({}, params, { timestamp: ts, client_id: cid }))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return {
    url: `${GMGN_BASE}${path}?${qs}`,
    method: "GET",
    muteHttpExceptions: true,
    headers: { "X-APIKEY": GMGN_API_KEY, "Content-Type": "application/json", "User-Agent": "gmgn-cli/1.3.2" }
  };
}

// ─── 공통: 응답 파싱 + 유효성 확인 ───────────────────────────────────────
function parseRes_(res) {
  if (res.getResponseCode() !== 200) return null;
  let json;
  try { json = JSON.parse(res.getContentText()); } catch(e) { return null; }
  if (json.code !== undefined && json.code !== 0) return null;
  const obj = json.data || json;
  if (!obj || typeof obj !== "object") return null;
  const hasData = obj.name || obj.symbol ||
                  (obj.holder_count > 0) ||
                  (parseFloat(obj.liquidity) > 0) ||
                  (parseFloat(obj.market_cap) > 0);
  return hasData ? obj : null;
}

// ─── 체인 감지 / 주소 정규화 ─────────────────────────────────────────────
function detectChains_(address) {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return ["eth", "bsc", "base"];
  if (/^T[0-9a-zA-Z]{33}$/.test(address))  return ["tron"];
  return ["sol"];
}
function normalizeAddress_(address) {
  return /^0x/.test(address) ? address.toLowerCase() : address;
}

// ─── 응답 데이터 조합 ────────────────────────────────────────────────────
function buildData_(info, pool, vol24hKline, sec, freshPct) {
  const price   = parseNum_(info?.price?.price ?? info?.price);
  const csupply = parseNum_(info?.circulating_supply);
  const tsupply = parseNum_(info?.total_supply);

  const mc  = parseNum_(info?.market_cap)
           ?? (price && csupply ? price * csupply : null);
  const fdv = parseNum_(info?.fdv)
           ?? (price && tsupply ? price * tsupply : mc);

  const poolItem = Array.isArray(pool) ? pool[0] : pool;

  const vol = vol24hKline != null ? vol24hKline
    : parseNum_(poolItem?.volume_24h ?? poolItem?.volume ?? info?.volume_24h ?? info?.volume);

  const holders   = parseNum_(info?.holder_count ?? info?.holders);
  const liquidity = parseNum_(info?.liquidity ?? poolItem?.liquidity);

  const ts = parseNum_(
    info?.open_timestamp           ?? info?.creation_timestamp     ?? info?.created_timestamp ??
    info?.create_timestamp         ?? info?.launch_timestamp       ?? info?.pool_creation_timestamp ??
    poolItem?.open_timestamp       ?? poolItem?.creation_timestamp ?? poolItem?.pool_creation_timestamp ??
    poolItem?.create_timestamp     ?? poolItem?.created_timestamp  ?? poolItem?.created_at
  );

  // Tax: sec === undefined → 빈 칸(""), sec === null → 빈 칸(""), 필드 없음 → "-", 값 있음 → "X%"
  const tax = extractTaxes_(sec, info, poolItem);

  const freshWallet = freshPct != null
    ? (freshPct > 1 ? freshPct.toFixed(2) : (freshPct * 100).toFixed(2)) + "%"
    : null;

  return {
    name        : info?.name   || info?.token_name  || "",
    symbol      : info?.symbol || info?.token_symbol || "",
    marketCap   : mc,
    fdv,
    volume24h   : vol,
    holders,
    liquidity,
    freshWallet,
    tokenAge    : ts ? formatAge_(ts) : null,
    buyTax      : tax.buy,
    sellTax     : tax.sell,
    dexTax      : tax.dex
  };
}

// ─── Tax 추출 ────────────────────────────────────────────────────────────
// 반환값: 빈 문자열("") = 불러올 수 없음, "-" = 필드 없음(과세 없음), "X%" = 값 있음
function extractTaxes_(sec, info, poolItem) {
  // security 응답이 아예 없으면 모두 빈 칸
  if (sec === null || sec === undefined) return { buy: "", sell: "", dex: "" };

  const sources = [sec, info, poolItem].filter(o => o && typeof o === "object");

  return {
    buy : pickTax_(sources, ["buy_tax", "buyTax", "buy_fee"]),
    sell: pickTax_(sources, ["sell_tax", "sellTax", "sell_fee"]),
    dex : pickTax_(sources, ["dex_tax", "dexTax", "transfer_tax", "transferTax", "dex_fee"])
  };
}
function pickTax_(sources, keys) {
  for (const src of sources) {
    for (const k of keys) {
      const v = src[k];
      if (v !== null && v !== undefined && v !== "") {
        const n = parseFloat(v);
        if (isNaN(n)) continue;
        if (n === 0) return "-";
        return (n > 1 ? n : n * 100).toFixed(2) + "%";
      }
    }
  }
  return "-";  // 필드 자체가 없으면 과세 없음 표시
}

// ─── 행 배열 생성 ─────────────────────────────────────────────────────────
function buildRowArray_(chain, d) {
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  return [
    d.name,
    d.symbol,
    d.marketCap   ?? "N/A",
    d.fdv         ?? "N/A",
    d.volume24h   ?? "N/A",
    d.holders     ?? "N/A",
    d.liquidity   ?? "N/A",
    d.freshWallet ?? "N/A",
    d.tokenAge    ?? "N/A",
    chain.toUpperCase(),
    d.buyTax,
    d.sellTax,
    d.dexTax,
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
             "24h 거래량 ($)","홀더","유동성 ($)","Fresh Wallet","Token Age","체인",
             "Buy Tax","Sell Tax","DEX Tax","조회 시각"];
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

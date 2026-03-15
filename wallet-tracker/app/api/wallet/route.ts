import { NextRequest, NextResponse } from "next/server";

const MORALIS_API_KEY = process.env.MORALIS_API_KEY || "";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const MORALIS_API = "https://deep-index.moralis.io/api/v2.2";

const ETH_CHAIN_ID = "0x1";

interface TokenBalance {
  token_address: string;
  name: string;
  symbol: string;
  logo?: string;
  thumbnail?: string;
  decimals: number;
  balance: string;
  possible_spam?: boolean;
  verified_contract?: boolean;
}

async function moralisFetch(endpoint: string) {
  const res = await fetch(`${MORALIS_API}${endpoint}`, {
    headers: { "X-API-Key": MORALIS_API_KEY, "Accept": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Moralis API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// KRW 환율 (업비트 USDT/KRW)
async function getKrwRate(): Promise<number> {
  try {
    const res = await fetch("https://api.upbit.com/v1/ticker?markets=KRW-USDT", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const rate = data[0]?.trade_price ?? 0;
      if (rate > 0) return rate;
    }
  } catch { /* fall through */ }
  return 1400;
}

// ETH 네이티브 가격
async function getEthPrice(): Promise<number> {
  // 1차: CoinGecko
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${COINGECKO_API}/simple/price?ids=ethereum&vs_currencies=usd`, { cache: "no-store" });
      if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (res.ok) {
        const data = await res.json();
        const price = data.ethereum?.usd ?? 0;
        if (price > 0) return price;
      }
    } catch { /* fall through */ }
  }
  // 2차: Moralis (WETH)
  try {
    const data = await moralisFetch(`/erc20/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/price?chain=${ETH_CHAIN_ID}`);
    return data?.usdPrice ?? 0;
  } catch { return 0; }
}

// Moralis 배치 가격 API (최대 25개씩)
async function getMoralisBatchPrices(addresses: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const CHUNK = 25;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    try {
      const res = await fetch(`${MORALIS_API}/erc20/prices`, {
        method: "POST",
        headers: {
          "X-API-Key": MORALIS_API_KEY,
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: chunk.map((addr) => ({ token_address: addr, chain: ETH_CHAIN_ID })),
        }),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.tokenAddress && item.usdPrice) {
            result[item.tokenAddress.toLowerCase()] = item.usdPrice;
          }
        }
      }
    } catch { /* fall through */ }
  }
  return result;
}

// CoinGecko 토큰 가격 (50개씩, 재시도)
async function getCoinGeckoPrices(addresses: string[]): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};
  const result: Record<string, number> = {};
  const CHUNK = 50;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${COINGECKO_API}/simple/token_price/ethereum?contract_addresses=${chunk.join(",")}&vs_currencies=usd`,
          { cache: "no-store" }
        );
        if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
        if (!res.ok) break;
        const data = await res.json();
        for (const [addr, val] of Object.entries(data)) {
          result[addr.toLowerCase()] = (val as { usd?: number }).usd ?? 0;
        }
        break;
      } catch { break; }
    }
  }
  return result;
}

async function getWalletData(address: string) {
  const [tokenData, nativeData, ethPrice] = await Promise.allSettled([
    moralisFetch(`/${address}/erc20?chain=${ETH_CHAIN_ID}&exclude_spam=false`),
    moralisFetch(`/${address}/balance?chain=${ETH_CHAIN_ID}`),
    getEthPrice(),
  ]);

  const tokens: TokenBalance[] = tokenData.status === "fulfilled"
    ? (tokenData.value?.result ?? tokenData.value ?? [])
    : [];
  const nativeBalance = nativeData.status === "fulfilled" ? nativeData.value : { balance: "0" };
  const nativePriceUsd = ethPrice.status === "fulfilled" ? ethPrice.value : 0;

  const nativeAmount = parseFloat(nativeBalance.balance) / 1e18;
  const nativeUsdValue = nativeAmount * nativePriceUsd;

  const assets: AssetItem[] = [];

  if (nativeUsdValue > 0) {
    assets.push({
      type: "native",
      address: "native",
      name: "Ethereum",
      symbol: "ETH",
      logo: null,
      balance: nativeAmount,
      usdPrice: nativePriceUsd,
      usdValue: nativeUsdValue,
      chain: "Ethereum",
      wallet: address,
    });
  }

  if (tokens.length === 0) return assets;

  const contractAddresses = tokens.map((t) => t.token_address.toLowerCase());

  // 1차: Moralis 배치 가격 (더 안정적)
  const moralisPrices = await getMoralisBatchPrices(contractAddresses);

  // 2차: Moralis에서 가격 없는 토큰만 CoinGecko로 보완
  const missingAddrs = contractAddresses.filter((a) => !moralisPrices[a] || moralisPrices[a] === 0);
  const cgPrices = missingAddrs.length > 0 ? await getCoinGeckoPrices(missingAddrs) : {};

  for (const token of tokens) {
    // 스팸 토큰 제거
    if (token.possible_spam === true && !token.verified_contract) continue;

    const addrLower = token.token_address.toLowerCase();
    const bal = parseFloat(token.balance) / Math.pow(10, token.decimals);
    const price = moralisPrices[addrLower] || cgPrices[addrLower] || 0;

    // 개당 가격 $1M 초과 = 스캠 (가격 조작)
    if (price > 1_000_000) continue;

    const value = bal * price;
    if (value <= 0) continue;

    assets.push({
      type: "erc20",
      address: token.token_address,
      name: token.name,
      symbol: token.symbol,
      logo: token.logo ?? token.thumbnail ?? null,
      balance: bal,
      usdPrice: price,
      usdValue: value,
      chain: "Ethereum",
      wallet: address,
    });
  }

  return assets;
}

export interface AssetItem {
  type: "native" | "erc20";
  address: string;
  name: string;
  symbol: string;
  logo: string | null;
  balance: number;
  usdPrice: number;
  usdValue: number;
  chain: string;
  wallet: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { addresses }: { addresses: string[] } = body;

    if (!addresses?.length) {
      return NextResponse.json({ error: "지갑 주소를 입력해주세요." }, { status: 400 });
    }
    if (!MORALIS_API_KEY) {
      return NextResponse.json({ error: "MORALIS_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    const [results, krwRate] = await Promise.all([
      Promise.allSettled(addresses.map((addr) => getWalletData(addr.trim()))),
      getKrwRate(),
    ]);
    const allAssets: AssetItem[] = results
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => (r as PromiseFulfilledResult<AssetItem[]>).value);

    const aggregateMap = new Map<string, {
      name: string; symbol: string; logo: string | null;
      chain: string; totalUsdValue: number; usdPrice: number;
      wallets: { address: string; balance: number; usdValue: number }[];
    }>();

    for (const asset of allAssets) {
      const key = `${asset.symbol}__eth__${asset.address}`;
      if (!aggregateMap.has(key)) {
        aggregateMap.set(key, {
          name: asset.name, symbol: asset.symbol, logo: asset.logo,
          chain: asset.chain, totalUsdValue: 0, usdPrice: asset.usdPrice, wallets: [],
        });
      }
      const entry = aggregateMap.get(key)!;
      entry.totalUsdValue += asset.usdValue;
      entry.wallets.push({ address: asset.wallet, balance: asset.balance, usdValue: asset.usdValue });
    }

    const filtered = Array.from(aggregateMap.values())
      .filter((a) => a.totalUsdValue >= 100)
      .sort((a, b) => b.totalUsdValue - a.totalUsdValue);

    const totalUsdValue = filtered.reduce((sum, a) => sum + a.totalUsdValue, 0);

    return NextResponse.json({ assets: filtered, totalUsdValue, queriedWallets: addresses, krwRate });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

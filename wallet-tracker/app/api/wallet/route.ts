import { NextRequest, NextResponse } from "next/server";

const MORALIS_API_KEY = process.env.MORALIS_API_KEY || "";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const MORALIS_API = "https://deep-index.moralis.io/api/v2.2";

const CHAINS: Record<string, { id: string; name: string; symbol: string; coingeckoId: string; coingeckoPlatform: string; wrappedAddress: string }> = {
  eth:       { id: "0x1",    name: "Ethereum", symbol: "ETH",  coingeckoId: "ethereum",    coingeckoPlatform: "ethereum",           wrappedAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" },
  bsc:       { id: "0x38",   name: "BNB Chain", symbol: "BNB", coingeckoId: "binancecoin", coingeckoPlatform: "binance-smart-chain", wrappedAddress: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c" },
  polygon:   { id: "0x89",   name: "Polygon",  symbol: "MATIC",coingeckoId: "matic-network",coingeckoPlatform: "polygon-pos",       wrappedAddress: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270" },
  arbitrum:  { id: "0xa4b1", name: "Arbitrum", symbol: "ETH",  coingeckoId: "ethereum",    coingeckoPlatform: "arbitrum-one",       wrappedAddress: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1" },
  optimism:  { id: "0xa",    name: "Optimism", symbol: "ETH",  coingeckoId: "ethereum",    coingeckoPlatform: "optimistic-ethereum",wrappedAddress: "0x4200000000000000000000000000000000000006" },
  avalanche: { id: "0xa86a", name: "Avalanche",symbol: "AVAX", coingeckoId: "avalanche-2", coingeckoPlatform: "avalanche",          wrappedAddress: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7" },
  base:      { id: "0x2105", name: "Base",     symbol: "ETH",  coingeckoId: "ethereum",    coingeckoPlatform: "base",               wrappedAddress: "0x4200000000000000000000000000000000000006" },
};

interface TokenBalance {
  token_address: string;
  name: string;
  symbol: string;
  logo?: string;
  thumbnail?: string;
  decimals: number;
  balance: string;
}

interface NativeBalance {
  balance: string;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function moralisFetch(endpoint: string) {
  const res = await fetch(`${MORALIS_API}${endpoint}`, {
    headers: { "X-API-Key": MORALIS_API_KEY, "Accept": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Moralis API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// CoinGecko simple price (native tokens) with retry
async function getNativePriceCoingecko(coingeckoId: string): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `${COINGECKO_API}/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
        { cache: "no-store" }
      );
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) return 0;
      const data = await res.json();
      const price = data[coingeckoId]?.usd ?? 0;
      if (price > 0) return price;
    } catch { /* fall through */ }
  }
  return 0;
}

// Moralis price fallback for native (via wrapped token address)
async function getNativePriceMoralis(wrappedAddress: string, chainId: string): Promise<number> {
  try {
    const data = await moralisFetch(`/erc20/${wrappedAddress}/price?chain=${chainId}&include=percent_change`);
    return data?.usdPrice ?? 0;
  } catch {
    return 0;
  }
}

async function getNativePrice(coingeckoId: string, wrappedAddress: string, chainId: string): Promise<number> {
  const price = await getNativePriceCoingecko(coingeckoId);
  if (price > 0) return price;
  // CoinGecko failed → Moralis fallback
  return getNativePriceMoralis(wrappedAddress, chainId);
}

// CoinGecko token prices in chunks of 50 with retry
async function getTokenPricesFromCoinGecko(platform: string, addresses: string[]): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};
  const result: Record<string, number> = {};
  const CHUNK = 50;

  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${COINGECKO_API}/simple/token_price/${platform}?contract_addresses=${chunk.join(",")}&vs_currencies=usd`,
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

// Moralis price fallback for individual tokens
async function getMoralisTokenPrice(tokenAddress: string, chainId: string): Promise<number> {
  try {
    const data = await moralisFetch(`/erc20/${tokenAddress}/price?chain=${chainId}`);
    return data?.usdPrice ?? 0;
  } catch {
    return 0;
  }
}

async function getWalletData(address: string, chainKey: string) {
  const chain = CHAINS[chainKey];
  const chainId = chain.id;

  const [tokenData, nativeData, nativePriceResult] = await Promise.allSettled([
    moralisFetch(`/${address}/erc20?chain=${chainId}&exclude_spam=false`),
    moralisFetch(`/${address}/balance?chain=${chainId}`),
    getNativePrice(chain.coingeckoId, chain.wrappedAddress, chainId),
  ]);

  const tokens: TokenBalance[] = tokenData.status === "fulfilled"
    ? (tokenData.value?.result ?? tokenData.value ?? [])
    : [];
  const nativeBalance: NativeBalance = nativeData.status === "fulfilled"
    ? nativeData.value
    : { balance: "0" };
  const nativePriceUsd: number = nativePriceResult.status === "fulfilled"
    ? nativePriceResult.value
    : 0;

  const nativeAmount = parseFloat(nativeBalance.balance) / 1e18;
  const nativeUsdValue = nativeAmount * nativePriceUsd;

  const assets: AssetItem[] = [];

  if (nativeUsdValue > 0) {
    assets.push({
      type: "native",
      address: "native",
      name: chain.name,
      symbol: chain.symbol,
      logo: null,
      balance: nativeAmount,
      usdPrice: nativePriceUsd,
      usdValue: nativeUsdValue,
      chain: chain.name,
      chainKey,
      wallet: address,
    });
  }

  if (tokens.length === 0) return assets;

  const contractAddresses = tokens.map((t) => t.token_address.toLowerCase());

  // CoinGecko first
  const cgPrices = await getTokenPricesFromCoinGecko(chain.coingeckoPlatform, contractAddresses);

  // Find tokens that CoinGecko couldn't price → Moralis fallback
  const missingAddresses = contractAddresses.filter((addr) => !cgPrices[addr] || cgPrices[addr] === 0);
  const moralisPrices: Record<string, number> = {};
  if (missingAddresses.length > 0) {
    const moralisResults = await Promise.allSettled(
      missingAddresses.map(async (addr) => ({
        addr,
        price: await getMoralisTokenPrice(addr, chainId),
      }))
    );
    for (const r of moralisResults) {
      if (r.status === "fulfilled" && r.value.price > 0) {
        moralisPrices[r.value.addr] = r.value.price;
      }
    }
  }

  for (const token of tokens) {
    const addrLower = token.token_address.toLowerCase();
    const bal = parseFloat(token.balance) / Math.pow(10, token.decimals);
    const price = cgPrices[addrLower] || moralisPrices[addrLower] || 0;
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
      chain: chain.name,
      chainKey,
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
  chainKey: string;
  wallet: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { addresses, chains }: { addresses: string[]; chains: string[] } = body;

    if (!addresses?.length) {
      return NextResponse.json({ error: "지갑 주소를 입력해주세요." }, { status: 400 });
    }
    if (!MORALIS_API_KEY) {
      return NextResponse.json({ error: "MORALIS_API_KEY가 설정되지 않았습니다." }, { status: 500 });
    }

    const selectedChains = chains?.length ? chains : Object.keys(CHAINS);
    const tasks = addresses.flatMap((addr) =>
      selectedChains.map((chain) => getWalletData(addr.trim(), chain))
    );

    const results = await Promise.allSettled(tasks);
    const allAssets: AssetItem[] = results
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => (r as PromiseFulfilledResult<AssetItem[]>).value);

    const aggregateMap = new Map<string, {
      name: string; symbol: string; logo: string | null;
      chain: string; chainKey: string; totalUsdValue: number;
      wallets: { address: string; balance: number; usdValue: number }[];
    }>();

    for (const asset of allAssets) {
      const key = `${asset.symbol}__${asset.chainKey}__${asset.address}`;
      if (!aggregateMap.has(key)) {
        aggregateMap.set(key, {
          name: asset.name, symbol: asset.symbol, logo: asset.logo,
          chain: asset.chain, chainKey: asset.chainKey,
          totalUsdValue: 0, wallets: [],
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

    return NextResponse.json({ assets: filtered, totalUsdValue, queriedWallets: addresses, queriedChains: selectedChains });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

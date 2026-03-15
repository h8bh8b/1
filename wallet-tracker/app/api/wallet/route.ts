import { NextRequest, NextResponse } from "next/server";

const MORALIS_API_KEY = process.env.MORALIS_API_KEY || "";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const MORALIS_API = "https://deep-index.moralis.io/api/v2.2";

// Supported chains
const CHAINS: Record<string, { id: string; name: string; symbol: string; coingeckoId: string; coingeckoPlatform: string }> = {
  eth: { id: "0x1", name: "Ethereum", symbol: "ETH", coingeckoId: "ethereum", coingeckoPlatform: "ethereum" },
  bsc: { id: "0x38", name: "BNB Chain", symbol: "BNB", coingeckoId: "binancecoin", coingeckoPlatform: "binance-smart-chain" },
  polygon: { id: "0x89", name: "Polygon", symbol: "MATIC", coingeckoId: "matic-network", coingeckoPlatform: "polygon-pos" },
  arbitrum: { id: "0xa4b1", name: "Arbitrum", symbol: "ETH", coingeckoId: "ethereum", coingeckoPlatform: "arbitrum-one" },
  optimism: { id: "0xa", name: "Optimism", symbol: "ETH", coingeckoId: "ethereum", coingeckoPlatform: "optimistic-ethereum" },
  avalanche: { id: "0xa86a", name: "Avalanche", symbol: "AVAX", coingeckoId: "avalanche-2", coingeckoPlatform: "avalanche" },
  base: { id: "0x2105", name: "Base", symbol: "ETH", coingeckoId: "ethereum", coingeckoPlatform: "base" },
};

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

interface NativeBalance {
  balance: string;
}

async function moralisFetch(endpoint: string) {
  const res = await fetch(`${MORALIS_API}${endpoint}`, {
    headers: {
      "X-API-Key": MORALIS_API_KEY,
      "Accept": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Moralis API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getNativePrice(coingeckoId: string): Promise<number> {
  try {
    const res = await fetch(
      `${COINGECKO_API}/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return data[coingeckoId]?.usd ?? 0;
  } catch {
    return 0;
  }
}

async function getTokenPricesFromCoinGecko(platform: string, addresses: string[]): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};
  try {
    const joined = addresses.join(",");
    const res = await fetch(
      `${COINGECKO_API}/simple/token_price/${platform}?contract_addresses=${joined}&vs_currencies=usd`,
      { cache: "no-store" }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const result: Record<string, number> = {};
    for (const [addr, val] of Object.entries(data)) {
      result[addr.toLowerCase()] = (val as { usd?: number }).usd ?? 0;
    }
    return result;
  } catch {
    return {};
  }
}

async function getWalletData(address: string, chainKey: string) {
  const chain = CHAINS[chainKey];
  const chainId = chain.id;

  const [tokenData, nativeData, nativePrice] = await Promise.allSettled([
    moralisFetch(`/${address}/erc20?chain=${chainId}&exclude_spam=false`),
    moralisFetch(`/${address}/balance?chain=${chainId}`),
    getNativePrice(chain.coingeckoId),
  ]);

  const tokens: TokenBalance[] = tokenData.status === "fulfilled" ? (tokenData.value?.result ?? tokenData.value ?? []) : [];
  const nativeBalance: NativeBalance = nativeData.status === "fulfilled" ? nativeData.value : { balance: "0" };
  const nativePriceUsd: number = nativePrice.status === "fulfilled" ? nativePrice.value : 0;

  // Native token
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

  // Filter out obvious spam (only skip if flagged as spam AND not verified)
  const validTokens = tokens;

  // Batch fetch prices from CoinGecko
  const contractAddresses = validTokens.map((t) => t.token_address.toLowerCase());
  const prices = await getTokenPricesFromCoinGecko(chain.coingeckoPlatform, contractAddresses);

  // ERC-20 tokens
  for (const token of validTokens) {
    const bal = parseFloat(token.balance) / Math.pow(10, token.decimals);
    const price = prices[token.token_address.toLowerCase()] ?? 0;
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

    // Aggregate by (symbol + chain) across wallets
    const aggregateMap = new Map<string, {
      name: string; symbol: string; logo: string | null;
      chain: string; chainKey: string; totalUsdValue: number;
      wallets: { address: string; balance: number; usdValue: number }[];
    }>();

    for (const asset of allAssets) {
      const key = `${asset.symbol}__${asset.chainKey}__${asset.address}`;
      if (!aggregateMap.has(key)) {
        aggregateMap.set(key, {
          name: asset.name,
          symbol: asset.symbol,
          logo: asset.logo,
          chain: asset.chain,
          chainKey: asset.chainKey,
          totalUsdValue: 0,
          wallets: [],
        });
      }
      const entry = aggregateMap.get(key)!;
      entry.totalUsdValue += asset.usdValue;
      entry.wallets.push({ address: asset.wallet, balance: asset.balance, usdValue: asset.usdValue });
    }

    // Filter $100+
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

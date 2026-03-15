const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Configuration ───
const PORT = process.env.PORT || 3000;
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '600') * 1000; // ms
const MIN_USD = parseFloat(process.env.MIN_USD_VALUE || '1000');

// ─── Chain definitions ───
const CHAINS = {
  ethereum: {
    name: 'Ethereum',
    alchemyNet: 'eth-mainnet',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoPlatform: 'ethereum',
    coingeckoNativeId: 'ethereum',
  },
  polygon: {
    name: 'Polygon',
    alchemyNet: 'polygon-mainnet',
    nativeSymbol: 'POL',
    nativeDecimals: 18,
    coingeckoPlatform: 'polygon-pos',
    coingeckoNativeId: 'matic-network',
  },
  arbitrum: {
    name: 'Arbitrum',
    alchemyNet: 'arb-mainnet',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoPlatform: 'arbitrum-one',
    coingeckoNativeId: 'ethereum',
  },
  optimism: {
    name: 'Optimism',
    alchemyNet: 'opt-mainnet',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoPlatform: 'optimistic-ethereum',
    coingeckoNativeId: 'ethereum',
  },
  base: {
    name: 'Base',
    alchemyNet: 'base-mainnet',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoPlatform: 'base',
    coingeckoNativeId: 'ethereum',
  },
  bsc: {
    name: 'BNB Chain',
    alchemyNet: 'bnb-mainnet',
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    coingeckoPlatform: 'binance-smart-chain',
    coingeckoNativeId: 'binancecoin',
  },
  avalanche: {
    name: 'Avalanche',
    alchemyNet: 'avax-mainnet',
    nativeSymbol: 'AVAX',
    nativeDecimals: 18,
    coingeckoPlatform: 'avalanche',
    coingeckoNativeId: 'avalanche-2',
  },
};

// ─── In-memory cache ───
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ─── HTTP fetch helper ───
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── Alchemy RPC call ───
async function alchemyRPC(apiKey, chain, method, params) {
  const net = CHAINS[chain].alchemyNet;
  const url = `https://${net}.g.alchemy.com/v2/${apiKey}`;
  return fetchJSON(url, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

// ─── Get native balance ───
async function getNativeBalance(apiKey, chain, address) {
  const cacheKey = `native:${chain}:${address}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const res = await alchemyRPC(apiKey, chain, 'eth_getBalance', [address, 'latest']);
  if (res.error) throw new Error(res.error.message);
  const weiHex = res.result;
  const wei = BigInt(weiHex);
  const decimals = CHAINS[chain].nativeDecimals;
  const balance = Number(wei) / Math.pow(10, decimals);

  setCache(cacheKey, balance);
  return balance;
}

// ─── Get all ERC-20 token balances ───
async function getTokenBalances(apiKey, chain, address) {
  const cacheKey = `tokens:${chain}:${address}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  // alchemy_getTokenBalances returns all tokens with non-zero balance
  const res = await alchemyRPC(apiKey, chain, 'alchemy_getTokenBalances', [address, 'erc20']);
  if (res.error) throw new Error(res.error.message);

  const balances = (res.result?.tokenBalances || [])
    .filter(t => t.tokenBalance && t.tokenBalance !== '0x0' && t.tokenBalance !== '0x')
    .map(t => ({
      contractAddress: t.contractAddress.toLowerCase(),
      balanceHex: t.tokenBalance,
    }));

  setCache(cacheKey, balances);
  return balances;
}

// ─── Get token metadata ───
async function getTokenMetadata(apiKey, chain, contractAddress) {
  const cacheKey = `meta:${chain}:${contractAddress}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const res = await alchemyRPC(apiKey, chain, 'alchemy_getTokenMetadata', [contractAddress]);
  if (res.error) throw new Error(res.error.message);

  const meta = {
    name: res.result?.name || 'Unknown',
    symbol: res.result?.symbol || '???',
    decimals: res.result?.decimals ?? 18,
    logo: res.result?.logo || null,
  };

  // Token metadata doesn't change — cache for a long time
  cache.set(`meta:${chain}:${contractAddress}`, { data: meta, ts: Date.now() + 86400000 });
  return meta;
}

// ─── CoinGecko price fetch (batch, with per-token caching) ───
async function getTokenPrices(platform, contractAddresses) {
  if (contractAddresses.length === 0) return {};

  // Check per-token cache first
  const allPrices = {};
  const uncached = [];
  for (const addr of contractAddresses) {
    const cached = getCached(`tprice:${platform}:${addr}`);
    if (cached !== null) {
      allPrices[addr] = cached;
    } else {
      uncached.push(addr);
    }
  }

  if (uncached.length === 0) return allPrices;

  // Fetch uncached in batches of 100
  const chunks = [];
  for (let i = 0; i < uncached.length; i += 100) {
    chunks.push(uncached.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const addrs = chunk.join(',');
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${addrs}&vs_currencies=usd`;
    try {
      const res = await fetchJSON(url);
      for (const [addr, priceData] of Object.entries(res)) {
        const lower = addr.toLowerCase();
        const price = priceData?.usd || 0;
        allPrices[lower] = price;
        setCache(`tprice:${platform}:${lower}`, price);
      }
      // Cache 0 for tokens not returned (no price available)
      for (const addr of chunk) {
        if (!(addr in allPrices)) {
          allPrices[addr] = 0;
          setCache(`tprice:${platform}:${addr}`, 0);
        }
      }
    } catch (e) {
      console.error('CoinGecko token price error:', e.message);
    }
  }

  return allPrices;
}

async function getNativePrice(coingeckoId) {
  const cacheKey = `nativeprice:${coingeckoId}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
  try {
    const res = await fetchJSON(url);
    const price = res[coingeckoId]?.usd || 0;
    setCache(cacheKey, price);
    return price;
  } catch (e) {
    console.error('CoinGecko native price error:', e.message);
    return 0;
  }
}

// ─── API endpoint ───
app.post('/api/check', async (req, res) => {
  try {
    const { addresses, chains, apiKey } = req.body;

    if (!apiKey) return res.status(400).json({ error: 'Alchemy API key is required' });
    if (!addresses || !addresses.length) return res.status(400).json({ error: 'At least one address is required' });
    if (!chains || !chains.length) return res.status(400).json({ error: 'At least one chain is required' });

    const results = [];
    const minUsd = MIN_USD;

    for (const chain of chains) {
      if (!CHAINS[chain]) continue;
      const chainCfg = CHAINS[chain];

      // 1. Get native price (one call per chain, cached)
      const nativePrice = await getNativePrice(chainCfg.coingeckoNativeId);

      // 2. For each address, get native + token balances
      const allTokenAddresses = new Set();
      const addressBalances = [];

      for (const addr of addresses) {
        const address = addr.trim().toLowerCase();
        if (!address) continue;

        try {
          // Native balance
          const nativeBal = await getNativeBalance(apiKey, chain, address);
          const nativeUsd = nativeBal * nativePrice;

          if (nativeUsd >= minUsd) {
            results.push({
              chain: chainCfg.name,
              wallet: address,
              token: chainCfg.nativeSymbol,
              type: 'native',
              balance: nativeBal,
              price: nativePrice,
              value: nativeUsd,
              contractAddress: null,
              logo: null,
            });
          }

          // Token balances
          const tokens = await getTokenBalances(apiKey, chain, address);
          addressBalances.push({ address, tokens });
          tokens.forEach(t => allTokenAddresses.add(t.contractAddress));
        } catch (e) {
          console.error(`Error fetching ${chain}/${address}:`, e.message);
        }
      }

      // 3. Batch fetch token prices (one call per chain)
      const tokenAddrsArray = Array.from(allTokenAddresses);
      const tokenPrices = await getTokenPrices(chainCfg.coingeckoPlatform, tokenAddrsArray);

      // 4. Get metadata only for tokens that have a price and might qualify
      for (const { address, tokens } of addressBalances) {
        for (const token of tokens) {
          const price = tokenPrices[token.contractAddress] || 0;
          // Parse balance
          let balanceRaw;
          try {
            balanceRaw = BigInt(token.balanceHex);
          } catch {
            continue;
          }
          if (balanceRaw === 0n) continue;

          // We need decimals to calculate the actual balance
          // Fetch metadata (cached after first call, persists across requests)
          let meta;
          try {
            meta = await getTokenMetadata(apiKey, chain, token.contractAddress);
          } catch (e) {
            meta = { name: 'Unknown', symbol: '???', decimals: 18, logo: null };
          }

          const balance = Number(balanceRaw) / Math.pow(10, meta.decimals);
          const value = balance * price;

          // Show all tokens: if price is known and >= $1000, or if price is unknown show with value=0
          // The user said "no spam filtering" so we show tokens even without price
          if (value >= minUsd || (price === 0 && balance > 0)) {
            results.push({
              chain: chainCfg.name,
              wallet: address,
              token: `${meta.name} (${meta.symbol})`,
              type: 'ERC-20',
              balance,
              price,
              value,
              contractAddress: token.contractAddress,
              logo: meta.logo,
            });
          }
        }
      }
    }

    // Sort: by value descending, unknowns at the bottom
    results.sort((a, b) => {
      if (a.price === 0 && b.price !== 0) return 1;
      if (a.price !== 0 && b.price === 0) return -1;
      return b.value - a.value;
    });

    res.json({
      results,
      cacheInfo: {
        ttlSeconds: CACHE_TTL / 1000,
        cachedEntries: cache.size,
      },
    });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Cache clear endpoint ───
app.post('/api/cache/clear', (req, res) => {
  cache.clear();
  res.json({ message: 'Cache cleared' });
});

// ─── Cache stats ───
app.get('/api/cache/stats', (req, res) => {
  res.json({
    entries: cache.size,
    ttlSeconds: CACHE_TTL / 1000,
  });
});

app.listen(PORT, () => {
  console.log(`Wallet Asset Checker running on http://localhost:${PORT}`);
});

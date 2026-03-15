"use client";

import { useState } from "react";

const CHAINS = [
  { key: "eth", name: "Ethereum", icon: "⟠" },
  { key: "bsc", name: "BNB Chain", icon: "⬡" },
  { key: "polygon", name: "Polygon", icon: "⬟" },
  { key: "arbitrum", name: "Arbitrum", icon: "🔵" },
  { key: "optimism", name: "Optimism", icon: "🔴" },
  { key: "avalanche", name: "Avalanche", icon: "🔺" },
  { key: "base", name: "Base", icon: "🔷" },
];

interface WalletBreakdown {
  address: string;
  balance: number;
  usdValue: number;
}

interface AggregatedAsset {
  name: string;
  symbol: string;
  logo: string | null;
  chain: string;
  chainKey: string;
  totalUsdValue: number;
  wallets: WalletBreakdown[];
}

interface ApiResponse {
  assets: AggregatedAsset[];
  totalUsdValue: number;
  queriedWallets: string[];
  queriedChains: string[];
  error?: string;
}

function shortenAddress(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function formatBalance(bal: number) {
  if (bal >= 1_000_000) return `${(bal / 1_000_000).toFixed(4)}M`;
  if (bal >= 1_000) return `${(bal / 1_000).toFixed(4)}K`;
  if (bal < 0.0001 && bal > 0) return bal.toExponential(4);
  return bal.toFixed(4);
}

export default function Home() {
  const [addressInputs, setAddressInputs] = useState<string[]>([""]);
  const [selectedChains, setSelectedChains] = useState<string[]>(CHAINS.map((c) => c.key));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedAssets, setExpandedAssets] = useState<Set<number>>(new Set());

  const addAddress = () => setAddressInputs((prev) => [...prev, ""]);
  const removeAddress = (i: number) =>
    setAddressInputs((prev) => prev.filter((_, idx) => idx !== i));
  const updateAddress = (i: number, val: string) =>
    setAddressInputs((prev) => prev.map((a, idx) => (idx === i ? val : a)));

  const toggleChain = (key: string) =>
    setSelectedChains((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );

  const toggleAssetExpand = (i: number) =>
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const handleSearch = async () => {
    const cleaned = addressInputs.map((a) => a.trim()).filter(Boolean);
    if (!cleaned.length) {
      setError("지갑 주소를 1개 이상 입력해주세요.");
      return;
    }
    if (!selectedChains.length) {
      setError("체인을 1개 이상 선택해주세요.");
      return;
    }
    setError(null);
    setResult(null);
    setExpandedAssets(new Set());
    setLoading(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: cleaned, chains: selectedChains }),
      });
      const data: ApiResponse = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "오류가 발생했습니다.");
      } else {
        setResult(data);
      }
    } catch {
      setError("서버와 통신 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const totalDeposited = result?.assets.reduce(
    (sum, a) => sum + a.wallets.reduce((s, w) => s + w.balance, 0),
    0
  ) ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 py-5">
          <h1 className="text-2xl font-bold text-white">
            🔍 지갑 자산 트래커
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            업비트 상장 전 지갑 입금 현황 분석 · $100 이상 보유 자산 표시
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Wallet Inputs */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-200">지갑 주소</h2>
            <span className="text-xs text-gray-500">
              {addressInputs.filter((a) => a.trim()).length}개 입력됨
            </span>
          </div>
          <div className="space-y-2">
            {addressInputs.map((addr, i) => (
              <div key={i} className="flex gap-2">
                <span className="flex items-center text-xs text-gray-500 w-6 shrink-0 justify-end">
                  {i + 1}
                </span>
                <input
                  type="text"
                  placeholder="0x... 또는 지갑 주소 입력"
                  value={addr}
                  onChange={(e) => updateAddress(i, e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && i === addressInputs.length - 1 && addAddress()
                  }
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                />
                {addressInputs.length > 1 && (
                  <button
                    onClick={() => removeAddress(i)}
                    className="text-gray-600 hover:text-red-400 transition-colors px-2"
                    aria-label="삭제"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addAddress}
            className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            + 지갑 주소 추가
          </button>
        </div>

        {/* Chain Selection */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-200">체인 선택</h2>
            <div className="flex gap-3 text-xs">
              <button
                onClick={() => setSelectedChains(CHAINS.map((c) => c.key))}
                className="text-blue-400 hover:text-blue-300 transition-colors"
              >
                전체 선택
              </button>
              <button
                onClick={() => setSelectedChains([])}
                className="text-gray-500 hover:text-gray-400 transition-colors"
              >
                전체 해제
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHAINS.map((chain) => (
              <button
                key={chain.key}
                onClick={() => toggleChain(chain.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                  selectedChains.includes(chain.key)
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                {chain.icon} {chain.name}
              </button>
            ))}
          </div>
        </div>

        {/* Search Button */}
        <button
          onClick={handleSearch}
          disabled={loading}
          className="w-full py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
              조회 중...
            </span>
          ) : (
            "🔍 자산 조회"
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-5 py-4 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">조회 지갑 수</p>
                <p className="text-xl font-bold text-white">{result.queriedWallets.length}개</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">$100 이상 자산</p>
                <p className="text-xl font-bold text-white">{result.assets.length}종</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">총 자산 가치</p>
                <p className="text-xl font-bold text-green-400">{formatUsd(result.totalUsdValue)}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">총 수량 합계</p>
                <p className="text-xl font-bold text-blue-400">{formatBalance(totalDeposited)}</p>
              </div>
            </div>

            {/* Wallet Labels */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-2">조회된 지갑 주소</p>
              <div className="flex flex-wrap gap-2">
                {result.queriedWallets.map((addr, i) => (
                  <span
                    key={i}
                    className="bg-gray-800 text-gray-300 text-xs font-mono px-2 py-1 rounded-lg border border-gray-700"
                    title={addr}
                  >
                    <span className="text-gray-500 mr-1">#{i + 1}</span>
                    {shortenAddress(addr)}
                  </span>
                ))}
              </div>
            </div>

            {/* Asset List */}
            {result.assets.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                $100 이상 보유 자산이 없습니다.
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800 text-xs text-gray-500 grid grid-cols-12 gap-2">
                  <span className="col-span-4">자산</span>
                  <span className="col-span-2 text-right">체인</span>
                  <span className="col-span-2 text-right">총 수량</span>
                  <span className="col-span-2 text-right">USD 가치</span>
                  <span className="col-span-2 text-right">지갑 수</span>
                </div>
                {result.assets.map((asset, i) => {
                  const isExpanded = expandedAssets.has(i);
                  const totalBalance = asset.wallets.reduce((s, w) => s + w.balance, 0);
                  return (
                    <div key={i} className="border-b border-gray-800 last:border-0">
                      <div
                        className="px-5 py-3 grid grid-cols-12 gap-2 items-center hover:bg-gray-800/50 transition-colors cursor-pointer"
                        onClick={() => toggleAssetExpand(i)}
                      >
                        {/* Asset Name */}
                        <div className="col-span-4 flex items-center gap-2 min-w-0">
                          {asset.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={asset.logo}
                              alt={asset.symbol}
                              className="w-7 h-7 rounded-full shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400 shrink-0">
                              {asset.symbol.slice(0, 2)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-white text-sm truncate">{asset.symbol}</p>
                            <p className="text-xs text-gray-500 truncate">{asset.name}</p>
                          </div>
                        </div>

                        {/* Chain */}
                        <div className="col-span-2 text-right">
                          <span className="text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-400">
                            {asset.chain}
                          </span>
                        </div>

                        {/* Total Balance */}
                        <div className="col-span-2 text-right">
                          <p className="text-sm font-mono text-gray-200">{formatBalance(totalBalance)}</p>
                        </div>

                        {/* USD Value */}
                        <div className="col-span-2 text-right">
                          <p
                            className={`text-sm font-semibold ${
                              asset.totalUsdValue >= 10000
                                ? "text-green-400"
                                : asset.totalUsdValue >= 1000
                                ? "text-green-500"
                                : "text-gray-200"
                            }`}
                          >
                            {formatUsd(asset.totalUsdValue)}
                          </p>
                        </div>

                        {/* Wallet count + expand */}
                        <div className="col-span-2 text-right">
                          <span className="text-xs text-gray-500">
                            {asset.wallets.length}개 {isExpanded ? "▲" : "▼"}
                          </span>
                        </div>
                      </div>

                      {/* Expanded wallet breakdown */}
                      {isExpanded && (
                        <div className="bg-gray-950 border-t border-gray-800 px-5 py-2 space-y-1">
                          {asset.wallets.map((w, wi) => {
                            const walletIdx = result.queriedWallets.findIndex(
                              (qa) => qa.toLowerCase() === w.address.toLowerCase()
                            );
                            return (
                              <div key={wi} className="flex items-center justify-between text-xs py-1">
                                <span className="font-mono text-gray-400">
                                  <span className="text-gray-600 mr-1">#{walletIdx >= 0 ? walletIdx + 1 : wi + 1}</span>
                                  {w.address.length > 20
                                    ? `${w.address.slice(0, 10)}…${w.address.slice(-8)}`
                                    : w.address}
                                </span>
                                <div className="flex gap-4 text-right">
                                  <span className="text-gray-300 font-mono">{formatBalance(w.balance)}</span>
                                  <span className="text-gray-400 w-20">{formatUsd(w.usdValue)}</span>
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex justify-between pt-1 border-t border-gray-800 text-xs font-semibold">
                            <span className="text-gray-500">합계</span>
                            <div className="flex gap-4 text-right">
                              <span className="text-gray-200 font-mono">{formatBalance(totalBalance)}</span>
                              <span className="text-green-400 w-20">{formatUsd(asset.totalUsdValue)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 mt-10">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-600">
          Powered by Moralis API · 가격 데이터는 실시간이 아닐 수 있습니다 · $100 이하 자산은 표시되지 않습니다
        </div>
      </div>
    </div>
  );
}

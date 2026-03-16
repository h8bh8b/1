"use client";

import { useState } from "react";

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
  totalUsdValue: number;
  usdPrice?: number;
  wallets: WalletBreakdown[];
}

interface ApiResponse {
  assets: AggregatedAsset[];
  totalUsdValue: number;
  queriedWallets: string[];
  krwRate?: number;
  error?: string;
}

function shortenAddress(addr: string) {
  return addr.length > 14 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function formatUsdFull(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

function formatBalance(bal: number) {
  if (bal >= 1_000_000) return `${(bal / 1_000_000).toFixed(4)}M`;
  if (bal >= 1_000) return `${(bal / 1_000).toFixed(4)}K`;
  if (bal < 0.0001 && bal > 0) return bal.toExponential(4);
  return bal.toFixed(4);
}

function formatKrw(value: number) {
  if (value >= 1_000_000_000_000) return `₩${(value / 1_000_000_000_000).toFixed(2)}조`;
  if (value >= 100_000_000) return `₩${(value / 100_000_000).toFixed(2)}억`;
  if (value >= 10_000) return `₩${(value / 10_000).toFixed(0)}만`;
  return `₩${Math.round(value).toLocaleString()}`;
}

export default function Home() {
  const [addressInputs, setAddressInputs] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState<Date | null>(null);

  const addAddress = () => setAddressInputs((prev) => [...prev, ""]);
  const removeAddress = (i: number) =>
    setAddressInputs((prev) => prev.filter((_, idx) => idx !== i));
  const updateAddress = (i: number, val: string) =>
    setAddressInputs((prev) => prev.map((a, idx) => (idx === i ? val : a)));

  const handleSearch = async () => {
    const cleaned = addressInputs.map((a) => a.trim()).filter(Boolean);
    if (!cleaned.length) {
      setError("지갑 주소를 1개 이상 입력해주세요.");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: cleaned }),
      });
      const data: ApiResponse = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "오류가 발생했습니다.");
      } else {
        setResult(data);
        setQueryTime(new Date());
      }
    } catch {
      setError("서버와 통신 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 py-5">
          <h1 className="text-2xl font-bold text-white">
            🔍 지갑 자산 트래커
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            업비트 상장 전 지갑 입금 현황 분석 · 이더리움 / 솔라나 체인 · $100 이상 보유 자산 표시
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
                  placeholder="0x... (이더리움) 또는 솔라나 주소 입력"
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

        {/* Search Button */}
        <button
          onClick={handleSearch}
          disabled={loading}
          className="w-full py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
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
            {result.assets.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                $100 이상 보유 자산이 없습니다.
              </div>
            ) : (
              result.assets.map((asset, i) => {
                const totalBalance = asset.wallets.reduce((s, w) => s + w.balance, 0);
                const krwRate = result.krwRate ?? 0;
                const usdPrice = asset.usdPrice ?? 0;

                return (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    {/* Card Header */}
                    <div className="px-6 py-5">
                      <div className="flex items-center gap-3 mb-3">
                        {asset.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.logo}
                            alt={asset.symbol}
                            className="w-10 h-10 rounded-full shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-400 shrink-0">
                            {asset.symbol.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-bold text-white">{asset.name}</span>
                            <span className="text-gray-400 font-medium text-sm">{asset.symbol}</span>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${asset.chain === "Solana" ? "bg-purple-900 text-purple-300" : "bg-blue-900 text-blue-300"}`}>
                              {asset.chain === "Solana" ? "SOL" : "ETH"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-6 text-sm">
                        <span className="text-gray-400">
                          Price: <span className="text-yellow-400 font-semibold">{formatUsd(usdPrice)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="border-t border-gray-700">
                      {/* Table Header */}
                      <div className="px-6 py-2 grid grid-cols-12 text-xs text-gray-500 uppercase tracking-wider">
                        <span className="col-span-4">WALLET</span>
                        <span className="col-span-3 text-right">AMOUNT</span>
                        <span className="col-span-3 text-right">USD</span>
                        <span className="col-span-2 text-right">KRW</span>
                      </div>

                      {/* Wallet Rows */}
                      {asset.wallets.map((w, wi) => {
                        const walletIdx = result.queriedWallets.findIndex(
                          (qa) => qa.toLowerCase() === w.address.toLowerCase()
                        );
                        const krwValue = w.usdValue * krwRate;
                        return (
                          <div key={wi} className="px-6 py-3 border-t border-gray-800 grid grid-cols-12 items-center hover:bg-gray-800/30 transition-colors">
                            <div className="col-span-4 flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400 shrink-0 font-semibold">
                                {walletIdx >= 0 ? walletIdx + 1 : wi + 1}
                              </div>
                              <span className="font-mono text-gray-400 text-xs truncate">
                                {shortenAddress(w.address)}
                              </span>
                            </div>
                            <span className="col-span-3 text-right text-sm font-mono text-gray-200">
                              {formatBalance(w.balance)}
                            </span>
                            <span className="col-span-3 text-right text-sm text-gray-300">
                              {formatUsdFull(w.usdValue)}
                            </span>
                            <span className="col-span-2 text-right text-sm text-yellow-400 font-mono">
                              {formatKrw(krwValue)}
                            </span>
                          </div>
                        );
                      })}

                      {/* Total Row */}
                      <div className="px-6 py-3 border-t border-gray-700 grid grid-cols-12 items-center bg-gray-800/40">
                        <span className="col-span-4 text-xs text-gray-500 font-semibold">합계</span>
                        <span className="col-span-3 text-right text-sm font-mono text-gray-200 font-semibold">
                          {formatBalance(totalBalance)}
                        </span>
                        <span className="col-span-3 text-right text-sm text-green-400 font-semibold">
                          {formatUsd(asset.totalUsdValue)}
                        </span>
                        <span className="col-span-2 text-right text-sm text-yellow-400 font-semibold font-mono">
                          {formatKrw(asset.totalUsdValue * krwRate)}
                        </span>
                      </div>
                    </div>

                    {/* Card Footer */}
                    <div className="px-6 py-2 border-t border-gray-800 flex justify-between items-center text-xs text-gray-600">
                      <span>
                        {queryTime?.toLocaleString("ko-KR", {
                          year: "numeric", month: "2-digit", day: "2-digit",
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })}
                      </span>
                      <span>USDT/KRW ₩{Math.round(krwRate).toLocaleString()}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 mt-10">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-600">
          Powered by Moralis API · 이더리움 / 솔라나 체인 · $100 이하 자산은 표시되지 않습니다
        </div>
      </div>
    </div>
  );
}

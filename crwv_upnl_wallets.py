"""
$CRWV uPNL 상위 지갑 10개 조회 스크립트
========================================
데이터 출처: Hyperliquid 공식 API / CoinGlass API
Hyperdash(hyperdash.com)는 Hyperliquid 체인 데이터를 시각화하는 분석 플랫폼으로
공개 API를 별도로 제공하지 않으므로 원본 소스인 Hyperliquid API를 직접 사용합니다.

사용 방법:
  # Method 1 (무료, Hyperliquid 공식 API)
  python crwv_upnl_wallets.py --method hyperliquid

  # Method 2 (CoinGlass API - 직접적, API 키 필요)
  python crwv_upnl_wallets.py --method coinglass --api-key YOUR_KEY

주의: Hyperliquid API는 클라우드/데이터센터 IP를 차단할 수 있습니다.
      로컬 PC에서 실행하거나 --proxy 옵션으로 프록시를 지정하세요.
"""

import requests
import time
import json
import argparse
from typing import Optional

COIN = "CRWV"

# Hyperliquid 엔드포인트
HL_INFO_URL = "https://api.hyperliquid.xyz/info"
HL_LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"

# CoinGlass 엔드포인트
COINGLASS_URL = "https://open-api-v4.coinglass.com/api/hyperliquid/position"


# ──────────────────────────────────────────────────────────────
# 공통 HTTP 세션 설정
# ──────────────────────────────────────────────────────────────

def make_session(proxy: Optional[str] = None) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
    })
    if proxy:
        session.proxies = {"http": proxy, "https": proxy}
    return session


# ──────────────────────────────────────────────────────────────
# Method 1: Hyperliquid 공식 API (무료, 인증 불필요)
# ──────────────────────────────────────────────────────────────

def hl_post(session: requests.Session, payload: dict) -> dict:
    resp = session.post(
        HL_INFO_URL,
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def get_leaderboard(session: requests.Session) -> list[dict]:
    """
    Hyperliquid 리더보드: stats-data 엔드포인트 사용
    응답 예시:
      [{"ethAddress": "0x...", "accountValue": "12345.0",
        "windowPnl": "999.0", "prizeRank": 1, ...}, ...]
    """
    resp = session.get(HL_LEADERBOARD_URL, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    # 응답 구조에 따라 키가 다를 수 있음
    if isinstance(data, list):
        return data
    return data.get("leaderboardRows", data.get("data", []))


def get_user_positions(session: requests.Session, address: str) -> list[dict]:
    """특정 지갑의 모든 퍼펫 포지션 반환"""
    data = hl_post(session, {"type": "clearinghouseState", "user": address})
    return data.get("assetPositions", [])


def extract_coin_position(positions: list[dict], coin: str) -> Optional[dict]:
    """지갑 포지션 목록에서 특정 코인 포지션만 추출"""
    for item in positions:
        pos = item.get("position", {})
        if pos.get("coin") == coin:
            return pos
    return None


def get_top_wallets_hyperliquid(
    coin: str = COIN,
    top_n: int = 10,
    scan_limit: int = 300,
    proxy: Optional[str] = None,
) -> list[dict]:
    """
    Hyperliquid API 기반 $CRWV uPNL 상위 지갑 조회

    전략:
      1) 전체 리더보드(상위 트레이더) 주소 수집
      2) 각 지갑에서 CRWV 포지션 확인
      3) uPNL 내림차순 정렬 → 상위 top_n 반환

    Args:
      coin:        조회할 코인 심볼 (예: "CRWV")
      top_n:       반환할 상위 지갑 수
      scan_limit:  리더보드에서 스캔할 최대 주소 수
      proxy:       HTTP 프록시 URL (예: "http://user:pw@host:port")
    """
    session = make_session(proxy)

    print(f"[Hyperliquid] 리더보드 조회 중...")
    try:
        rows = get_leaderboard(session)
    except requests.HTTPError as e:
        raise RuntimeError(
            f"리더보드 조회 실패: {e}\n"
            "Hyperliquid API는 클라우드 IP를 차단합니다. "
            "로컬 PC에서 실행하거나 --proxy 옵션을 사용하세요."
        )

    print(f"[Hyperliquid] 리더보드 트레이더 수: {len(rows)}")

    holders: list[dict] = []

    for i, row in enumerate(rows[:scan_limit]):
        # 필드명이 ethAddress 또는 address 일 수 있음
        address = row.get("ethAddress") or row.get("address", "")
        if not address:
            continue

        try:
            positions = get_user_positions(session, address)
            pos = extract_coin_position(positions, coin)
            if pos:
                size = float(pos.get("szi", 0))
                upnl = float(pos.get("unrealizedPnl", 0))
                holders.append({
                    "rank": 0,  # 최종 정렬 후 부여
                    "address": address,
                    "coin": coin,
                    "side": "Long" if size > 0 else "Short",
                    "size": abs(size),
                    "entry_price": pos.get("entryPx"),
                    "mark_price": pos.get("positionValue") and (
                        float(pos.get("positionValue", 0)) / abs(size)
                        if size != 0 else None
                    ),
                    "unrealized_pnl": upnl,
                    "return_on_equity": pos.get("returnOnEquity"),
                    "leverage": (pos.get("leverage") or {}).get("value"),
                })
                print(
                    f"  ✓ {coin} 포지션: {address[:10]}...  "
                    f"uPNL=${upnl:,.2f}"
                )

            # Rate limit: ~3 req/s
            time.sleep(0.35)

        except Exception as e:
            print(f"  ✗ 오류 ({address[:10]}...): {e}")
            continue

        # 충분한 보유자 확보 시 조기 종료
        if len(holders) >= top_n * 5:
            break

    holders.sort(key=lambda x: x["unrealized_pnl"], reverse=True)
    for i, h in enumerate(holders[:top_n], 1):
        h["rank"] = i

    return holders[:top_n]


# ──────────────────────────────────────────────────────────────
# Method 2: CoinGlass API (API 키 필요, 가장 직접적)
# ──────────────────────────────────────────────────────────────

def get_top_wallets_coinglass(
    api_key: str,
    coin: str = COIN,
    top_n: int = 10,
    proxy: Optional[str] = None,
) -> list[dict]:
    """
    CoinGlass API 기반 $CRWV uPNL 상위 지갑 조회
    API 키 발급: https://www.coinglass.com/CryptoApi

    엔드포인트: GET /api/hyperliquid/position
    파라미터:
      symbol     - 코인 심볼  (예: CRWV)
      sortField  - 정렬 기준  (unrealizedPnl | size | entryPrice)
      sortType   - desc | asc
      page       - 페이지 번호 (1부터)
      pageSize   - 페이지당 항목 수 (최대 100)
    """
    session = make_session(proxy)
    session.headers["coinGlass-api-key"] = api_key

    params = {
        "symbol": coin,
        "sortField": "unrealizedPnl",
        "sortType": "desc",
        "page": 1,
        "pageSize": top_n,
    }

    print(f"[CoinGlass] {coin} 포지션 조회 중...")
    resp = session.get(COINGLASS_URL, params=params, timeout=15)

    if resp.status_code == 401:
        raise RuntimeError("CoinGlass API 키가 유효하지 않습니다.")
    resp.raise_for_status()

    data = resp.json()
    # 응답 구조: {"code": "0", "data": {"list": [...], "total": N}}
    items = (data.get("data") or {}).get("list", [])

    results: list[dict] = []
    for i, item in enumerate(items[:top_n], 1):
        size = float(item.get("size") or item.get("szi") or 0)
        results.append({
            "rank": i,
            "address": item.get("address") or item.get("user"),
            "coin": coin,
            "side": item.get("side") or ("Long" if size > 0 else "Short"),
            "size": abs(size),
            "entry_price": item.get("entryPrice") or item.get("entryPx"),
            "mark_price": item.get("markPrice"),
            "unrealized_pnl": float(item.get("unrealizedPnl") or 0),
            "return_on_equity": item.get("returnOnEquity") or item.get("roe"),
            "leverage": item.get("leverage"),
        })

    return results


# ──────────────────────────────────────────────────────────────
# 결과 출력
# ──────────────────────────────────────────────────────────────

def print_results(wallets: list[dict], method: str) -> None:
    if not wallets:
        print(f"\n결과 없음: {COIN} 포지션 보유 지갑을 찾지 못했습니다.")
        return

    print(f"\n{'='*80}")
    print(f"  ${wallets[0]['coin']} uPNL 상위 {len(wallets)}개 지갑  [{method}]")
    print(f"{'='*80}")
    print(
        f"{'순위':<5} {'지갑 주소':<44} {'방향':<6} "
        f"{'포지션 크기':>12} {'uPNL (USD)':>14} {'레버리지':>8}"
    )
    print(f"{'-'*80}")
    for w in wallets:
        addr = (w["address"] or "N/A")
        side = w.get("side", "?")
        size = w.get("size") or 0
        upnl = w.get("unrealized_pnl", 0)
        lev  = w.get("leverage") or "?"
        print(
            f"{w['rank']:<5} {addr:<44} {side:<6} "
            f"{float(size):>12,.4f} {upnl:>14,.2f} {str(lev):>8}x"
        )
    print(f"{'='*80}\n")

    # JSON으로도 출력
    print("JSON 형식:")
    print(json.dumps(wallets, indent=2, ensure_ascii=False))


# ──────────────────────────────────────────────────────────────
# 진입점
# ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="$CRWV uPNL 상위 지갑 조회 (Hyperliquid / CoinGlass)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--method",
        choices=["hyperliquid", "coinglass"],
        default="hyperliquid",
        help="사용할 API (기본값: hyperliquid)",
    )
    parser.add_argument(
        "--api-key",
        default="",
        metavar="KEY",
        help="CoinGlass API 키 (--method coinglass 필수)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=10,
        metavar="N",
        help="상위 N개 지갑 반환 (기본값: 10)",
    )
    parser.add_argument(
        "--coin",
        default=COIN,
        help=f"조회할 코인 심볼 (기본값: {COIN})",
    )
    parser.add_argument(
        "--proxy",
        default=None,
        metavar="URL",
        help="HTTP 프록시 (예: http://user:pw@host:8080)",
    )
    parser.add_argument(
        "--scan-limit",
        type=int,
        default=300,
        metavar="N",
        help="Hyperliquid 방법: 스캔할 최대 리더보드 주소 수 (기본값: 300)",
    )
    args = parser.parse_args()

    try:
        if args.method == "hyperliquid":
            wallets = get_top_wallets_hyperliquid(
                coin=args.coin,
                top_n=args.top,
                scan_limit=args.scan_limit,
                proxy=args.proxy,
            )
            print_results(wallets, "Hyperliquid 공식 API")

        elif args.method == "coinglass":
            if not args.api_key:
                parser.error(
                    "CoinGlass 방법은 --api-key 가 필요합니다.\n"
                    "API 키 발급: https://www.coinglass.com/CryptoApi"
                )
            wallets = get_top_wallets_coinglass(
                api_key=args.api_key,
                coin=args.coin,
                top_n=args.top,
                proxy=args.proxy,
            )
            print_results(wallets, "CoinGlass API")

    except RuntimeError as e:
        print(f"\n[오류] {e}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Collect CoinMarketCap historical top 20 crypto rankings.
Period: 2024/1/1 ~ 2026/3/18 (weekly Sunday snapshots)
"""

import requests
import json
import time
import os
from datetime import datetime, timedelta

API_URL = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listings/historical"
DATA_FILE = "crypto_rankings_data.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def get_sundays(start_date, end_date):
    dates = []
    current = start_date
    while current.weekday() != 6:
        current += timedelta(days=1)
    while current <= end_date:
        dates.append(current)
        current += timedelta(days=7)
    return dates

def fetch_snapshot(date):
    """Fetch top 20 for a given date."""
    date_str = date.strftime("%Y-%m-%d")
    params = {"date": date_str, "start": "1", "limit": "20", "convert": "USD"}

    for attempt in range(4):
        try:
            resp = requests.get(API_URL, headers=HEADERS, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            items = data.get("data", [])
            result = []
            for item in items:
                quotes = item.get("quotes", [{}])
                market_cap = quotes[0].get("marketCap", 0) if quotes else 0
                result.append({
                    "rank": item.get("cmcRank", 0),
                    "name": item.get("name", ""),
                    "symbol": item.get("symbol", ""),
                    "market_cap": market_cap,
                    "price": quotes[0].get("price", 0) if quotes else 0,
                })
            return result
        except Exception as e:
            if attempt < 3:
                wait = 2 ** (attempt + 1)
                print(f"  Retry in {wait}s: {e}")
                time.sleep(wait)
            else:
                print(f"  Failed after 4 attempts: {e}")
                return None

def main():
    start_date = datetime(2024, 1, 1)
    end_date = datetime(2026, 3, 18)
    sundays = get_sundays(start_date, end_date)
    print(f"Total snapshots to fetch: {len(sundays)}")

    # Load existing data
    all_data = {}
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            all_data = json.load(f)
        print(f"Resuming from {len(all_data)} existing snapshots")

    for i, sunday in enumerate(sundays):
        key = sunday.strftime("%Y-%m-%d")
        if key in all_data:
            print(f"[{i+1}/{len(sundays)}] {key} - cached")
            continue

        print(f"[{i+1}/{len(sundays)}] Fetching {key}...")
        result = fetch_snapshot(sunday)
        if result:
            all_data[key] = result
            print(f"  Top 3: {', '.join(r['symbol'] for r in result[:3])}")
        else:
            print(f"  FAILED")

        # Save every 10 snapshots
        if (i + 1) % 10 == 0:
            with open(DATA_FILE, "w") as f:
                json.dump(all_data, f, indent=2)

        time.sleep(1.5)  # Rate limiting

    # Final save
    with open(DATA_FILE, "w") as f:
        json.dump(all_data, f, indent=2)

    # Stats
    all_projects = set()
    for rows in all_data.values():
        for r in rows:
            all_projects.add(f"{r['name']} ({r['symbol']})")

    print(f"\nDone! {len(all_data)} snapshots collected")
    print(f"Unique projects in top 20: {len(all_projects)}")
    for p in sorted(all_projects):
        print(f"  - {p}")

if __name__ == "__main__":
    main()

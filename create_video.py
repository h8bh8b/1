#!/usr/bin/env python3
"""
Create an animated bar chart race video showing top 20 crypto ranking changes.
Period: 2024/1/1 ~ 2026/3/18
"""

import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
from matplotlib.patches import FancyBboxPatch
import numpy as np
import subprocess
import os
from datetime import datetime

# ── Configuration ──────────────────────────────────────────────────────────────
DATA_FILE = "crypto_rankings_data.json"
OUTPUT_VIDEO = "crypto_ranking_race.mp4"
FRAMES_DIR = "frames"
FPS = 4  # frames per second for final video
INTERP_FRAMES = 6  # interpolation frames between snapshots for smooth animation
WIDTH, HEIGHT = 1920, 1080
DPI = 100

# Color palette for projects (consistent colors)
COLOR_PALETTE = {
    'BTC': '#F7931A', 'ETH': '#627EEA', 'USDT': '#26A17B', 'BNB': '#F3BA2F',
    'SOL': '#9945FF', 'XRP': '#23292F', 'USDC': '#2775CA', 'ADA': '#0033AD',
    'AVAX': '#E84142', 'DOGE': '#C3A634', 'DOT': '#E6007A', 'MATIC': '#8247E5',
    'TRX': '#FF0013', 'LINK': '#2A5ADA', 'TON': '#0098EA', 'SHIB': '#FFA409',
    'ICP': '#29ABE2', 'LTC': '#345D9D', 'DAI': '#F5AC37', 'BCH': '#8DC351',
    'XLM': '#14B6E7', 'UNI': '#FF007A', 'NEAR': '#000000', 'SUI': '#4DA2FF',
    'HBAR': '#000000', 'PEPE': '#4B8B3B', 'LEO': '#F7931A', 'POL': '#8247E5',
    'APT': '#000000', 'ARB': '#28A0F0', 'TIA': '#7B2FBE', 'CRO': '#002D72',
    'HYPE': '#00FF88', 'BGB': '#1DA1F2', 'OM': '#C73636', 'PI': '#8B008B',
    'TRUMP': '#FF4500', 'XMR': '#FF6600', 'USDe': '#1E90FF', 'CC': '#4682B4',
    'SYS': '#0082C6', 'ZEC': '#ECB244', 'USD1': '#228B22',
}
DEFAULT_COLOR = '#888888'

def load_data():
    with open(DATA_FILE, 'r') as f:
        raw = json.load(f)

    # Sort dates
    dates = sorted(raw.keys())
    snapshots = []
    for d in dates:
        entries = raw[d]
        snapshot = {}
        for e in entries:
            symbol = e['symbol']
            snapshot[symbol] = {
                'name': e['name'],
                'symbol': symbol,
                'rank': e['rank'],
                'market_cap': e['market_cap'],
            }
        snapshots.append((d, snapshot))
    return snapshots

def interpolate_snapshots(snap1, snap2, t):
    """Interpolate between two snapshots. t in [0, 1]."""
    all_symbols = set(snap1.keys()) | set(snap2.keys())
    result = {}
    for sym in all_symbols:
        d1 = snap1.get(sym)
        d2 = snap2.get(sym)

        if d1 and d2:
            rank = d1['rank'] * (1 - t) + d2['rank'] * t
            mc = d1['market_cap'] * (1 - t) + d2['market_cap'] * t
            name = d2['name']
        elif d1:
            # Exiting top 20 - slide down
            rank = d1['rank'] * (1 - t) + 21 * t
            mc = d1['market_cap'] * (1 - t)
            name = d1['name']
        else:
            # Entering top 20 - slide up
            rank = 21 * (1 - t) + d2['rank'] * t
            mc = d2['market_cap'] * t
            name = d2['name']

        result[sym] = {
            'name': name,
            'symbol': sym,
            'rank': rank,
            'market_cap': mc,
        }
    return result

def format_market_cap(val):
    if val >= 1e12:
        return f"${val/1e12:.2f}T"
    elif val >= 1e9:
        return f"${val/1e9:.1f}B"
    elif val >= 1e6:
        return f"${val/1e6:.0f}M"
    else:
        return f"${val:,.0f}"

def draw_frame(snapshot, date_str, frame_num, total_frames, all_unique_count):
    """Draw a single frame of the bar chart race."""
    fig, ax = plt.subplots(figsize=(WIDTH/DPI, HEIGHT/DPI), dpi=DPI)
    fig.patch.set_facecolor('#0D1117')
    ax.set_facecolor('#0D1117')

    # Sort by rank (ascending = best rank first), take top 20
    items = sorted(snapshot.values(), key=lambda x: x['rank'])
    items = [i for i in items if i['rank'] <= 20.5][:20]

    # Reverse for horizontal bar chart (best at top)
    items = items[::-1]

    if not items:
        plt.close()
        return

    max_mc = max(i['market_cap'] for i in items) if items else 1

    y_positions = list(range(len(items)))
    bar_heights = [i['market_cap'] for i in items]
    colors = [COLOR_PALETTE.get(i['symbol'], DEFAULT_COLOR) for i in items]

    bars = ax.barh(y_positions, bar_heights, height=0.7, color=colors,
                   edgecolor='none', alpha=0.9, zorder=2)

    # Add labels
    for idx, item in enumerate(items):
        rank_int = round(item['rank'])
        label = f" #{rank_int}  {item['symbol']}"
        mc_label = format_market_cap(item['market_cap'])

        # Bar width relative to max
        bar_ratio = item['market_cap'] / max_mc if max_mc > 0 else 0

        ax.text(max_mc * 0.005, idx, label,
                va='center', ha='left', fontsize=13, fontweight='bold',
                color='white', zorder=3, fontfamily='monospace')

        if bar_ratio > 0.15:
            # Place market cap label inside the bar, right-aligned
            ax.text(item['market_cap'] - max_mc * 0.005, idx, mc_label,
                    va='center', ha='right', fontsize=11,
                    color='white', alpha=0.9, zorder=3, fontfamily='monospace')
        else:
            # Place market cap label outside the bar, to the left
            ax.text(max_mc * -0.005, idx, mc_label,
                    va='center', ha='right', fontsize=10,
                    color='#8B949E', alpha=0.9, zorder=3, fontfamily='monospace')

    # Axis formatting
    ax.set_xlim(0, max_mc * 1.05)
    ax.set_ylim(-0.8, len(items) - 0.2)
    ax.set_yticks([])
    ax.xaxis.set_major_formatter(ticker.FuncFormatter(
        lambda x, p: format_market_cap(x) if x > 0 else ''))
    ax.tick_params(axis='x', colors='#8B949E', labelsize=10)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_visible(False)
    ax.spines['bottom'].set_color('#30363D')

    # Add grid
    ax.xaxis.grid(True, color='#21262D', linewidth=0.5, zorder=0)

    # Title and date
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        display_date = dt.strftime("%B %d, %Y")
    except:
        display_date = date_str

    ax.text(0.5, 1.06, 'Top 20 Cryptocurrency Rankings by Market Cap',
            transform=ax.transAxes, fontsize=22, fontweight='bold',
            color='white', ha='center', va='bottom', fontfamily='sans-serif')

    ax.text(0.5, 1.01, f'CoinMarketCap Historical Data  |  {display_date}',
            transform=ax.transAxes, fontsize=14,
            color='#8B949E', ha='center', va='bottom', fontfamily='sans-serif')

    # Stats box in bottom right
    ax.text(0.98, 0.05,
            f'Total unique projects in Top 20: {all_unique_count}',
            transform=ax.transAxes, fontsize=13, color='#58A6FF',
            ha='right', va='bottom', fontfamily='sans-serif',
            bbox=dict(boxstyle='round,pad=0.5', facecolor='#161B22',
                      edgecolor='#30363D', alpha=0.9))

    # Progress bar at bottom
    progress = frame_num / max(total_frames - 1, 1)
    ax_prog = fig.add_axes([0.125, 0.02, 0.775, 0.01])
    ax_prog.set_xlim(0, 1)
    ax_prog.set_ylim(0, 1)
    ax_prog.barh(0.5, progress, height=1, color='#58A6FF', alpha=0.7)
    ax_prog.barh(0.5, 1, height=1, color='#21262D', alpha=0.5)
    ax_prog.set_xticks([])
    ax_prog.set_yticks([])
    ax_prog.spines[:].set_visible(False)
    ax_prog.text(0, -0.5, '2024-01', fontsize=8, color='#8B949E',
                 ha='left', va='top', transform=ax_prog.transAxes)
    ax_prog.text(1, -0.5, '2026-03', fontsize=8, color='#8B949E',
                 ha='right', va='top', transform=ax_prog.transAxes)

    plt.tight_layout(rect=[0, 0.04, 1, 0.95])

    frame_path = os.path.join(FRAMES_DIR, f"frame_{frame_num:05d}.png")
    fig.savefig(frame_path, facecolor=fig.get_facecolor(), dpi=DPI)
    plt.close(fig)
    return frame_path

def main():
    print("Loading data...")
    snapshots = load_data()
    print(f"Loaded {len(snapshots)} snapshots")

    # Count unique projects
    all_projects = set()
    for _, snap in snapshots:
        for sym in snap:
            all_projects.add(snap[sym]['name'])
    unique_count = len(all_projects)
    print(f"Unique projects: {unique_count}")

    # Create frames directory
    os.makedirs(FRAMES_DIR, exist_ok=True)

    # Generate interpolated frames
    total_frames = (len(snapshots) - 1) * INTERP_FRAMES + 1
    print(f"Generating {total_frames} frames...")

    frame_num = 0
    for i in range(len(snapshots) - 1):
        date1, snap1 = snapshots[i]
        date2, snap2 = snapshots[i + 1]

        for j in range(INTERP_FRAMES):
            t = j / INTERP_FRAMES
            interp = interpolate_snapshots(snap1, snap2, t)

            # Date label: show the source date
            date_label = date1

            draw_frame(interp, date_label, frame_num, total_frames, unique_count)

            if frame_num % 20 == 0:
                print(f"  Frame {frame_num}/{total_frames} ({date_label})")
            frame_num += 1

    # Last frame
    last_date, last_snap = snapshots[-1]
    draw_frame(last_snap, last_date, frame_num, total_frames, unique_count)
    frame_num += 1
    print(f"  Frame {frame_num}/{total_frames} ({last_date})")

    print(f"\nTotal frames generated: {frame_num}")

    # Combine frames into video with ffmpeg
    print("Creating video with ffmpeg...")
    effective_fps = FPS * INTERP_FRAMES  # smooth playback
    cmd = [
        'ffmpeg', '-y',
        '-framerate', str(effective_fps),
        '-i', os.path.join(FRAMES_DIR, 'frame_%05d.png'),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '18',
        '-preset', 'medium',
        '-movflags', '+faststart',
        OUTPUT_VIDEO
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ffmpeg error: {result.stderr}")
    else:
        size_mb = os.path.getsize(OUTPUT_VIDEO) / (1024 * 1024)
        print(f"\nVideo created: {OUTPUT_VIDEO} ({size_mb:.1f} MB)")
        duration = frame_num / effective_fps
        print(f"Duration: {duration:.1f} seconds at {effective_fps} fps")

    # Summary statistics
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    print(f"Period: 2024-01-07 ~ 2026-03-15 (weekly snapshots)")
    print(f"Total snapshots: {len(snapshots)}")
    print(f"Total unique projects in Top 20: {unique_count}")
    print(f"\nProjects that appeared in Top 20:")
    for p in sorted(all_projects):
        print(f"  - {p}")

    # Count how many weeks each project was in top 20
    print(f"\nWeeks in Top 20 (sorted by frequency):")
    week_counts = {}
    for _, snap in snapshots:
        for sym, data in snap.items():
            key = f"{data['name']} ({sym})"
            week_counts[key] = week_counts.get(key, 0) + 1
    for proj, count in sorted(week_counts.items(), key=lambda x: -x[1]):
        pct = count / len(snapshots) * 100
        bar = '█' * int(pct / 2)
        print(f"  {proj:35s} {count:3d}/{len(snapshots)} weeks ({pct:5.1f}%) {bar}")

if __name__ == "__main__":
    main()

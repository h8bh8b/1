#!/usr/bin/env python3
"""
Create a yearly Top-20 crypto market-cap animation from a large CSV.

Expected CSV columns (case-insensitive aliases supported):
- Date
- Symbol
- Name or Project
- MarketCap

Example:
    python create_crypto_top20_video.py \
        --input R.csv \
        --output crypto_top20_by_year.mp4
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="연도별 크립토 Top-20 시각화 동영상 생성")
    parser.add_argument("--input", required=True, help="입력 CSV 파일 경로")
    parser.add_argument("--output", default="crypto_top20_by_year.mp4", help="출력 동영상 파일 경로")
    parser.add_argument("--fps", type=int, default=1, help="초당 프레임 수 (기본: 1)")
    parser.add_argument("--dpi", type=int, default=160, help="저장 DPI (기본: 160)")
    parser.add_argument("--top-n", type=int, default=20, help="표시할 코인 개수 (기본: 20)")
    return parser.parse_args()


def _normalize_colmap(df_columns: list[str]) -> dict[str, str]:
    """Map normalized column names to original names."""
    mapping: dict[str, str] = {}
    for c in df_columns:
        key = re.sub(r"[^a-z0-9]", "", c.lower())
        mapping[key] = c
    return mapping


def _require_column(colmap: dict[str, str], *aliases: str) -> str:
    for alias in aliases:
        if alias in colmap:
            return colmap[alias]
    raise ValueError(f"필수 컬럼을 찾지 못했습니다. 후보: {aliases}")


def load_and_prepare(csv_path: Path, top_n: int) -> pd.DataFrame:
    import pandas as pd

    # 1) Read minimal columns for memory efficiency (important for large files)
    #    We first read header to detect actual names.
    header_df = pd.read_csv(csv_path, nrows=0)
    colmap = _normalize_colmap(header_df.columns.tolist())

    date_col = _require_column(colmap, "date")
    symbol_col = _require_column(colmap, "symbol", "ticker")
    name_col = colmap.get("name") or colmap.get("project") or symbol_col
    mcap_col = _require_column(colmap, "marketcap", "marketcapitalization", "mktcap")

    usecols = [date_col, symbol_col, name_col, mcap_col]
    df = pd.read_csv(csv_path, usecols=usecols)
    df = df.rename(
        columns={
            date_col: "Date",
            symbol_col: "Symbol",
            name_col: "Name",
            mcap_col: "MarketCap",
        }
    )

    # 2) Clean types
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"])

    # Remove $, commas, spaces etc.
    df["MarketCap"] = (
        df["MarketCap"].astype(str).str.replace(r"[^0-9.\-]", "", regex=True)
    )
    df["MarketCap"] = pd.to_numeric(df["MarketCap"], errors="coerce")
    df = df.dropna(subset=["MarketCap"])

    # 3) Keep year-end snapshot: for each year, use latest available date
    df["Year"] = df["Date"].dt.year
    latest_dates = df.groupby("Year", as_index=False)["Date"].max().rename(columns={"Date": "LatestDate"})
    year_end = df.merge(latest_dates, on="Year")
    year_end = year_end[year_end["Date"] == year_end["LatestDate"]].copy()

    # 4) Rank and keep top N
    year_end = year_end.sort_values(["Year", "MarketCap"], ascending=[True, False])
    year_end["Rank"] = year_end.groupby("Year")["MarketCap"].rank(method="first", ascending=False)
    year_end = year_end[year_end["Rank"] <= top_n].copy()

    return year_end[["Year", "Date", "Symbol", "Name", "MarketCap", "Rank"]]


def format_market_cap(x: float) -> str:
    if x >= 1e12:
        return f"${x/1e12:.2f}T"
    if x >= 1e9:
        return f"${x/1e9:.2f}B"
    if x >= 1e6:
        return f"${x/1e6:.2f}M"
    return f"${x:,.0f}"


def create_animation(data: pd.DataFrame, output_file: Path, fps: int, dpi: int, top_n: int) -> None:
    import matplotlib.pyplot as plt
    from matplotlib import animation
    import pandas as pd

    years = sorted(data["Year"].unique())
    if not years:
        raise ValueError("시각화할 데이터가 없습니다. CSV 내용을 확인하세요.")

    # Global max for consistent axis
    global_max = data["MarketCap"].max() * 1.12

    fig, ax = plt.subplots(figsize=(14, 8))

    # Stable color per coin symbol
    symbols = sorted(data["Symbol"].unique())
    cmap = plt.cm.get_cmap("tab20", max(20, len(symbols)))
    color_map = {s: cmap(i % cmap.N) for i, s in enumerate(symbols)}

    def draw_frame(year: int) -> None:
        ax.clear()
        d = data[data["Year"] == year].sort_values("MarketCap", ascending=True)

        labels = d.apply(lambda r: f"{r['Symbol']} ({r['Name']})", axis=1)
        values = d["MarketCap"].to_numpy()
        colors = [color_map[s] for s in d["Symbol"]]

        ax.barh(labels, values, color=colors, edgecolor="black", linewidth=0.3)

        # value labels
        for i, v in enumerate(values):
            ax.text(v + global_max * 0.005, i, format_market_cap(float(v)), va="center", fontsize=9)

        frame_date = d["Date"].max()
        date_text = frame_date.strftime("%Y-%m-%d") if pd.notna(frame_date) else f"{year}"

        ax.set_xlim(0, global_max)
        ax.set_xlabel("Market Cap (USD)")
        ax.set_title(
            f"Top {top_n} Crypto by Market Cap - {year} (snapshot: {date_text})",
            fontsize=16,
            weight="bold",
        )
        ax.grid(axis="x", linestyle="--", alpha=0.3)
        ax.tick_params(axis="y", labelsize=10)

        # reverse to put rank #1 on top
        ax.invert_yaxis()

        # watermark-like year label
        ax.text(
            0.97,
            0.12,
            str(year),
            transform=ax.transAxes,
            ha="right",
            va="center",
            fontsize=44,
            alpha=0.12,
            weight="bold",
        )

    anim = animation.FuncAnimation(fig, draw_frame, frames=years, interval=1000 / max(fps, 1), repeat=False)

    try:
        writer = animation.FFMpegWriter(fps=fps, bitrate=2400)
        anim.save(str(output_file), writer=writer, dpi=dpi)
    except Exception as e:
        raise RuntimeError(
            "MP4 저장에 실패했습니다. ffmpeg 설치/경로를 확인하세요.\n"
            "예: sudo apt-get install ffmpeg"
        ) from e
    finally:
        plt.close(fig)


def generate_video_from_csv(
    input_path: Path,
    output_path: Path,
    fps: int = 1,
    dpi: int = 160,
    top_n: int = 20,
) -> Path:
    if output_path.suffix.lower() != ".mp4":
        output_path = output_path.with_suffix(".mp4")

    data = load_and_prepare(input_path, top_n=top_n)
    create_animation(data, output_path, fps=fps, dpi=dpi, top_n=top_n)
    return output_path


def main() -> None:
    args = parse_args()

    try:
        import pandas as pd
        import matplotlib.pyplot as plt  # noqa: F401
    except ModuleNotFoundError as e:
        missing = str(e).split("'")[1] if "'" in str(e) else str(e)
        raise SystemExit(
            f"필수 패키지 '{missing}' 가 설치되어 있지 않습니다.\n"
            "다음 명령으로 설치하세요: pip install pandas matplotlib"
        )

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise FileNotFoundError(f"입력 파일을 찾을 수 없습니다: {input_path}")

    output_path = generate_video_from_csv(
        input_path=input_path,
        output_path=output_path,
        fps=args.fps,
        dpi=args.dpi,
        top_n=args.top_n,
    )

    data = load_and_prepare(input_path, top_n=args.top_n)
    years = sorted(data["Year"].unique())
    print(f"완료: {len(years)}개 연도 프레임 생성 ({years[0]}~{years[-1]})")
    print(f"출력 파일: {output_path}")


if __name__ == "__main__":
    main()

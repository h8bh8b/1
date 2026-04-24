"""
GMGN Telegram Bot
Provides on-chain crypto analytics via the GMGN OpenAPI.

Commands:
  /token   <chain> <address>              — token overview
  /security <chain> <address>             — rug/honeypot check
  /holders  <chain> <address> [limit]     — top holders
  /traders  <chain> <address> [limit]     — top traders by profit
  /trending <chain> [interval] [limit]    — trending tokens
  /kline    <chain> <address> <resolution>— recent OHLCV candles
  /wallet   <chain> <address>             — wallet holdings
  /stats    <chain> <address> [period]    — wallet trading stats
  /help                                   — show this message
"""

import logging
import os
from textwrap import dedent

from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from gmgn_client import GMGNClient, GMGNError

load_dotenv()

logging.basicConfig(
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
GMGN_API_KEY = os.environ["GMGN_API_KEY"]
GMGN_PRIVATE_KEY = os.getenv("GMGN_PRIVATE_KEY")

CHAINS = {"sol", "bsc", "base", "eth"}
VALID_INTERVALS = {"1m", "5m", "1h", "6h", "24h"}
VALID_RESOLUTIONS = {"1m", "5m", "15m", "1h", "4h", "1d"}


# ── helpers ────────────────────────────────────────────────────────────────

def _client() -> GMGNClient:
    return GMGNClient(GMGN_API_KEY, GMGN_PRIVATE_KEY)


def _fmt_num(val, decimals: int = 2) -> str:
    """Format a numeric value, handling None / empty string gracefully."""
    try:
        f = float(val)
    except (TypeError, ValueError):
        return "N/A"
    if f >= 1_000_000_000:
        return f"${f/1_000_000_000:.{decimals}f}B"
    if f >= 1_000_000:
        return f"${f/1_000_000:.{decimals}f}M"
    if f >= 1_000:
        return f"${f/1_000:.{decimals}f}K"
    return f"${f:.{decimals}f}"


def _pct(val) -> str:
    try:
        return f"{float(val)*100:.1f}%"
    except (TypeError, ValueError):
        return "N/A"


def _yn(val) -> str:
    if val in (True, "yes", 1, "1"):
        return "✅ Yes"
    if val in (False, "no", 0, "0"):
        return "❌ No"
    return "❓ Unknown"


async def _reply(update: Update, text: str):
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN_V2,
                                    disable_web_page_preview=True)


def _esc(text: str) -> str:
    """Escape special chars for Telegram MarkdownV2."""
    for ch in r"\_*[]()~`>#+-=|{}.!":
        text = text.replace(ch, f"\\{ch}")
    return text


async def _err(update: Update, msg: str):
    await update.message.reply_text(f"⚠️ {msg}")


# ── /start & /help ─────────────────────────────────────────────────────────

HELP_TEXT = dedent("""\
*GMGN Crypto Bot* 🤖

Query real\\-time on\\-chain data powered by [GMGN\\.ai](https://gmgn.ai)

*Token commands*
`/token   <chain> <address>` — token overview
`/security <chain> <address>` — rug / honeypot check
`/holders  <chain> <address> [limit]` — top holders
`/traders  <chain> <address> [limit]` — top traders by profit

*Market commands*
`/trending <chain> [interval] [limit]` — trending tokens
`/kline    <chain> <address> <resolution>` — recent candles

*Wallet commands*
`/wallet   <chain> <address>` — wallet holdings
`/stats    <chain> <address> [period]` — wallet stats

*Chains:* `sol` \\| `bsc` \\| `base` \\| `eth`
*Intervals:* `1m` `5m` `1h` `6h` `24h`
*Resolutions:* `1m` `5m` `15m` `1h` `4h` `1d`
*Periods:* `7d` `30d`
""")


async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(HELP_TEXT, parse_mode=ParseMode.MARKDOWN_V2,
                                    disable_web_page_preview=True)


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(HELP_TEXT, parse_mode=ParseMode.MARKDOWN_V2,
                                    disable_web_page_preview=True)


# ── /token ─────────────────────────────────────────────────────────────────

async def cmd_token(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if len(args) < 2:
        return await _err(update, "Usage: /token <chain> <address>")
    chain, address = args[0].lower(), args[1]
    if chain not in CHAINS:
        return await _err(update, f"Unknown chain '{chain}'. Use: {', '.join(CHAINS)}")

    async with _client() as c:
        try:
            d = await c.token_info(chain, address)
        except GMGNError as e:
            return await _err(update, e.message)

    symbol = _esc(d.get("symbol", "?"))
    name = _esc(d.get("name", "?"))
    price = d.get("price", 0)
    liq = d.get("liquidity", 0)
    holders = d.get("holder_count", "N/A")
    mcap = d.get("market_cap") or d.get("usd_market_cap", 0)
    ath = d.get("ath_price", 0)
    launchpad = _esc(str(d.get("launchpad", "") or "—"))

    stat = d.get("stat") or {}
    smart = stat.get("smart_degen_count", "?")
    kol = stat.get("renowned_count", "?")
    bot_ratio = _esc(_pct(stat.get("dex_bot_ratio")))

    text = (
        f"*{symbol}* \\({name}\\) — `{_esc(chain.upper())}`\n"
        f"📍 `{_esc(address)}`\n\n"
        f"💵 Price: `{_esc(str(price))}`\n"
        f"💧 Liquidity: `{_esc(_fmt_num(liq))}`\n"
        f"📊 Market Cap: `{_esc(_fmt_num(mcap))}`\n"
        f"🏆 ATH: `{_esc(str(ath))}`\n"
        f"👥 Holders: `{_esc(str(holders))}`\n"
        f"🚀 Launchpad: {launchpad}\n\n"
        f"🧠 Smart Money: `{_esc(str(smart))}` \\| KOL: `{_esc(str(kol))}`\n"
        f"🤖 Bot ratio: `{bot_ratio}`"
    )
    await _reply(update, text)


# ── /security ──────────────────────────────────────────────────────────────

async def cmd_security(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if len(args) < 2:
        return await _err(update, "Usage: /security <chain> <address>")
    chain, address = args[0].lower(), args[1]
    if chain not in CHAINS:
        return await _err(update, f"Unknown chain '{chain}'. Use: {', '.join(CHAINS)}")

    async with _client() as c:
        try:
            d = await c.token_security(chain, address)
        except GMGNError as e:
            return await _err(update, e.message)

    honeypot = d.get("is_honeypot")
    open_source = d.get("open_source")
    renounced = d.get("owner_renounced")
    rug = d.get("rug_ratio")
    buy_tax = d.get("buy_tax")
    sell_tax = d.get("sell_tax")
    top10 = d.get("top_10_holder_rate")
    wash = d.get("is_wash_trading")
    burn = d.get("burn_status", "")
    rat = d.get("rat_trader_amount_rate")
    bundler = d.get("bundler_trader_amount_rate")

    rug_emoji = "🔴" if (rug and float(rug) > 0.3) else "🟢"

    text = (
        f"🔒 *Security Report*\n"
        f"📍 `{_esc(address)}`\n\n"
        f"🍯 Honeypot: {_yn(honeypot)}\n"
        f"📂 Open source: {_yn(open_source)}\n"
        f"🔓 Renounced: {_yn(renounced)}\n"
        f"🔥 Burn: `{_esc(burn or 'none')}`\n\n"
        f"{rug_emoji} Rug ratio: `{_esc(_pct(rug))}`\n"
        f"💸 Buy tax: `{_esc(_pct(buy_tax))}`  Sell tax: `{_esc(_pct(sell_tax))}`\n"
        f"🐀 Rat traders: `{_esc(_pct(rat))}`\n"
        f"📦 Bundlers: `{_esc(_pct(bundler))}`\n"
        f"🐋 Top\\-10 holders: `{_esc(_pct(top10))}`\n"
        f"🧺 Wash trading: {_yn(wash)}"
    )
    await _reply(update, text)


# ── /holders ───────────────────────────────────────────────────────────────

async def cmd_holders(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if len(args) < 2:
        return await _err(update, "Usage: /holders <chain> <address> [limit]")
    chain, address = args[0].lower(), args[1]
    limit = int(args[2]) if len(args) >= 3 and args[2].isdigit() else 10
    limit = min(max(limit, 1), 20)
    if chain not in CHAINS:
        return await _err(update, f"Unknown chain '{chain}'.")

    async with _client() as c:
        try:
            d = await c.token_holders(chain, address, limit)
        except GMGNError as e:
            return await _err(update, e.message)

    items = d.get("list") or d if isinstance(d, list) else []
    lines = [f"🐋 *Top {_esc(str(limit))} Holders* — `{_esc(address[:8])}…`\n"]
    for i, h in enumerate(items[:limit], 1):
        addr = h.get("address", "?")
        pct = _pct(h.get("amount_percentage"))
        usd = _fmt_num(h.get("usd_value"))
        tag = _esc(str(h.get("wallet_tag_v2") or h.get("tags") or ""))
        lines.append(f"`{i:>2}.` `{_esc(addr[:8])}…` {_esc(pct)} \\({_esc(usd)}\\) {tag}")

    await _reply(update, "\n".join(lines))


# ── /traders ───────────────────────────────────────────────────────────────

async def cmd_traders(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if len(args) < 2:
        return await _err(update, "Usage: /traders <chain> <address> [limit]")
    chain, address = args[0].lower(), args[1]
    limit = int(args[2]) if len(args) >= 3 and args[2].isdigit() else 10
    limit = min(max(limit, 1), 20)
    if chain not in CHAINS:
        return await _err(update, f"Unknown chain '{chain}'.")

    async with _client() as c:
        try:
            d = await c.token_traders(chain, address, limit)
        except GMGNError as e:
            return await _err(update, e.message)

    items = d.get("list") or d if isinstance(d, list) else []
    lines = [f"📈 *Top {_esc(str(limit))} Traders* — `{_esc(address[:8])}…`\n"]
    for i, t in enumerate(items[:limit], 1):
        addr = t.get("address", "?")
        profit = _fmt_num(t.get("profit") or t.get("realized_profit"))
        pnl = _esc(_pct(t.get("realized_pnl")))
        tag = _esc(str(t.get("wallet_tag_v2") or ""))
        lines.append(f"`{i:>2}.` `{_esc(addr[:8])}…` profit: {_esc(profit)} PnL: {pnl} {tag}")

    await _reply(update, "\n".join(lines))


# ── /trending ──────────────────────────────────────────────────────────────

async def cmd_trending(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if not args:
        return await _err(update, "Usage: /trending <chain> [interval] [limit]")
    chain = args[0].lower()
    interval = args[1] if len(args) >= 2 and args[1] in VALID_INTERVALS else "1h"
    limit = int(args[2]) if len(args) >= 3 and args[2].isdigit() else 10
    limit = min(max(limit, 1), 20)
    if chain not in CHAINS:
        return await _err(update, f"Unknown chain '{chain}'.")

    async with _client() as c:
        try:
            d = await c.market_trending(chain, interval, limit)
        except GMGNError as e:
            return await _err(update, e.message)

    items = (d.get("rank") or []) if isinstance(d, dict) else d
    lines = [f"🔥 *Trending {_esc(chain.upper())}* \\({_esc(interval)}\\)\n"]
    for i, t in enumerate(items[:limit], 1):
        sym = _esc(t.get("symbol", "?"))
        price = _esc(str(t.get("price", "?")))
        mcap = _esc(_fmt_num(t.get("market_cap") or t.get("usd_market_cap")))
        vol = _esc(_fmt_num(t.get("volume")))
        swaps = _esc(str(t.get("swaps", "?")))
        smart = _esc(str(t.get("smart_degen_count", 0)))
        addr = _esc(t.get("address", "")[:8])
        lines.append(
            f"`{i:>2}.` *{sym}* `{addr}…`\n"
            f"     💵{price} MCap:{mcap} Vol:{vol} Swaps:{swaps} 🧠{smart}"
        )

    await _reply(update, "\n".join(lines))


# ── /kline ─────────────────────────────────────────────────────────────────

async def cmd_kline(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if len(args) < 3:
        return await _err(update, "Usage: /kline <chain> <address> <resolution>")
    chain, address, resolution = args[0].lower(), args[1], args[2].lower()
    if chain not in CHAINS:
        return await _err(update, f"Unknown chain '{chain}'.")
    if resolution not in VALID_RESOLUTIONS:
        return await _err(update, f"Invalid resolution. Use: {', '.join(VALID_RESOLUTIONS)}")

    import time as t_mod
    to_ts = int(t_mod.time())
    # show ~10 candles
    seconds = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
    from_ts = to_ts - seconds.get(resolution, 3600) * 10

    async with _client() as c:
        try:
            d = await c.market_kline(chain, address, resolution, from_ts, to_ts)
        except GMGNError as e:
            return await _err(update, e.message)

    candles = d.get("list") or d if isinstance(d, (dict, list)) else []
    if isinstance(candles, dict):
        candles = candles.get("list", [])

    lines = [f"📊 *Kline* `{_esc(address[:8])}…` \\({_esc(resolution)}\\)\n"]
    lines.append("`time             open       high       low        close      vol(USD)`")
    for c_item in candles[-10:]:
        ts = c_item.get("time", 0)
        import datetime
        dt = _esc(datetime.datetime.utcfromtimestamp(ts / 1000 if ts > 1e10 else ts).strftime("%m-%d %H:%M"))
        o = _esc(f"{float(c_item.get('open',0)):.6g}")
        h = _esc(f"{float(c_item.get('high',0)):.6g}")
        lo = _esc(f"{float(c_item.get('low',0)):.6g}")
        cl = _esc(f"{float(c_item.get('close',0)):.6g}")
        vol = _esc(_fmt_num(c_item.get("volume")))
        lines.append(f"`{dt}  {o:<10} {h:<10} {lo:<10} {cl:<10} {vol}`")

    await _reply(update, "\n".join(lines))


# ── /wallet ────────────────────────────────────────────────────────────────

async def cmd_wallet(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if len(args) < 2:
        return await _err(update, "Usage: /wallet <chain> <address>")
    chain, wallet = args[0].lower(), args[1]
    if chain not in CHAINS:
        return await _err(update, f"Unknown chain '{chain}'.")

    async with _client() as c:
        try:
            d = await c.wallet_holdings(chain, wallet)
        except GMGNError as e:
            return await _err(update, e.message)

    holdings = d.get("holdings") or d.get("list") or []
    lines = [f"👜 *Wallet* `{_esc(wallet[:8])}…` — {_esc(chain.upper())}\n"]
    if not holdings:
        lines.append("_No holdings found_")
    for h in holdings[:15]:
        tok = h.get("token") or {}
        sym = _esc(tok.get("symbol") or h.get("symbol", "?"))
        usd = _esc(_fmt_num(h.get("usd_value")))
        pnl = _esc(_pct(h.get("profit_change")))
        rpnl = _esc(_fmt_num(h.get("realized_profit")))
        lines.append(f"• *{sym}* {usd}  PnL: {pnl} \\(realized: {rpnl}\\)")

    await _reply(update, "\n".join(lines))


# ── /stats ─────────────────────────────────────────────────────────────────

async def cmd_stats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    args = ctx.args
    if len(args) < 2:
        return await _err(update, "Usage: /stats <chain> <address> [7d|30d]")
    chain, wallet = args[0].lower(), args[1]
    period = args[2] if len(args) >= 3 and args[2] in ("7d", "30d") else "30d"
    if chain not in CHAINS:
        return await _err(update, f"Unknown chain '{chain}'.")

    async with _client() as c:
        try:
            d = await c.wallet_stats(chain, wallet, period)
        except GMGNError as e:
            return await _err(update, e.message)

    realized = _fmt_num(d.get("realized_profit"))
    unrealized = _fmt_num(d.get("unrealized_profit"))
    winrate = _pct(d.get("winrate"))
    buys = d.get("buy_count", "?")
    sells = d.get("sell_count", "?")
    pnl = _pct(d.get("pnl"))

    text = (
        f"📋 *Wallet Stats* \\({_esc(period)}\\)\n"
        f"📍 `{_esc(wallet[:8])}…`\n\n"
        f"💰 Realized: `{_esc(realized)}`\n"
        f"📈 Unrealized: `{_esc(unrealized)}`\n"
        f"🎯 Win rate: `{_esc(winrate)}`\n"
        f"📊 PnL ratio: `{_esc(pnl)}`\n"
        f"🟢 Buys: `{_esc(str(buys))}` | 🔴 Sells: `{_esc(str(sells))}`"
    )
    await _reply(update, text)


# ── main ───────────────────────────────────────────────────────────────────

def main():
    app = (
        Application.builder()
        .token(TELEGRAM_TOKEN)
        .build()
    )
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("token", cmd_token))
    app.add_handler(CommandHandler("security", cmd_security))
    app.add_handler(CommandHandler("holders", cmd_holders))
    app.add_handler(CommandHandler("traders", cmd_traders))
    app.add_handler(CommandHandler("trending", cmd_trending))
    app.add_handler(CommandHandler("kline", cmd_kline))
    app.add_handler(CommandHandler("wallet", cmd_wallet))
    app.add_handler(CommandHandler("stats", cmd_stats))

    logger.info("Bot starting…")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()

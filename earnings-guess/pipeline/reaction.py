"""reaction.py — 答案計算 (SDD 4.1). yfinance, auto-adjusted closes.

base = close(t0 − 1); gap = open(t0)/base − 1; r1 = close(t0); r5 = close(t0+4);
r20 = close(t0+19) — all vs base. Excess = stock − benchmark (same window, simple
difference). path = closes t0−5 … t0+20 scaled so base = 100.
Raises Incomplete when the window is not finished or data is missing → card held.
"""
from __future__ import annotations

from datetime import date, timedelta

from calendar_us import reaction_day, add_trading_days


class Incomplete(Exception):
    pass


def fetch_history(symbols: list[str], start: date, end: date) -> dict:
    """{symbol: {iso_date: (open, high, low, close, volume)}} — isolated so tests can stub it."""
    import yfinance as yf
    out = {}
    for s in symbols:
        df = yf.Ticker(s).history(start=start.isoformat(), end=(end + timedelta(days=1)).isoformat(), auto_adjust=True)
        if df is None or df.empty:
            raise Incomplete(f'yfinance 沒有資料：{s}')
        out[s] = {idx.date().isoformat(): (float(r['Open']), float(r['High']), float(r['Low']), float(r['Close']), float(r.get('Volume', 0) or 0)) for idx, r in df.iterrows()}
    return out


def infer_session(ticker: str, call_date: date) -> str | None:
    """BMO / AMC from yfinance earnings_dates (time of day, US/Eastern). None if unknown."""
    try:
        import yfinance as yf
        ed = yf.Ticker(ticker).get_earnings_dates(limit=24)
    except Exception:
        return None
    if ed is None or ed.empty:
        return None
    for ts in ed.index:
        try:
            local = ts.tz_convert('America/New_York')
        except Exception:
            local = ts
        if local.date() == call_date or abs((local.date() - call_date).days) <= 1:
            return 'BMO' if local.hour < 12 else 'AMC'
    return None


def _bars(px, days, base, vbase):
    """OHLCV columns scaled so close(t0−1) = 100; volume as % of the pre-call median."""
    r = lambda x: round(x / base * 100, 2)
    return {'o': [r(px[d][0]) for d in days], 'h': [r(px[d][1]) for d in days], 'l': [r(px[d][2]) for d in days],
            'c': [r(px[d][3]) for d in days], 'v': [round(px[d][4] / vbase * 100) if vbase else 0 for d in days]}


def compute(ticker: str, call_date: date, session: str, sector_etf: str, market_etf: str, today: date,
            fetch=fetch_history, pre_bars: int = 40, post_bars: int = 20) -> dict:
    """Reaction numbers + anonymised OHLCV for the chart (pre = before t0, post = t0 … t0+post_bars−1)."""
    t0 = reaction_day(call_date, session)
    t_end = add_trading_days(t0, max(20, post_bars))
    if add_trading_days(t0, 19) > today:
        raise Incomplete(f't0+19 = {add_trading_days(t0, 19)} 尚未到')
    start = add_trading_days(t0, -max(8, pre_bars + 2))
    syms = list(dict.fromkeys([ticker, sector_etf, market_etf]))
    data = fetch(syms, start, min(t_end, today))
    out = {}
    for s in syms:
        px = data.get(s) or {}
        days = sorted(px)
        if t0.isoformat() not in px:
            raise Incomplete(f'{s} 缺 t0 {t0} 的資料')
        i0 = days.index(t0.isoformat())
        if i0 < 6 or i0 + 19 >= len(days):
            raise Incomplete(f'{s} 資料不足（需要 t0−6 … t0+19）')
        base = px[days[i0 - 1]][3]
        c = lambda k: px[days[i0 + k]][3]
        pre_days = days[max(0, i0 - pre_bars):i0]
        post_days = days[i0:i0 + post_bars]
        vols = sorted(px[d][4] for d in pre_days if px[d][4])
        vbase = vols[len(vols) // 2] if vols else 0
        out[s] = {
            'gap': px[days[i0]][0] / base - 1, 'r1': c(0) / base - 1, 'r5': c(4) / base - 1, 'r20': c(19) / base - 1,
            'path': [round(px[d][3] / base * 100, 2) for d in days[i0 - 5: i0 + 21]],
            'pre': _bars(px, pre_days, base, vbase), 'post': _bars(px, post_days, base, vbase),
            'closes': [round(px[d][3] / base * 100, 2) for d in pre_days + post_days],
        }
    st, se, sm = out[ticker], out[sector_etf], out[market_etf]
    ex = lambda b: {k: round(st[k] - b[k], 5) for k in ('r1', 'r5', 'r20')}
    return {
        't0': t0.isoformat(),
        'returns': {k: round(st[k], 5) for k in ('gap', 'r1', 'r5', 'r20')},
        'excess': {'sector': ex(se), 'market': ex(sm)},
        'path': st['path'], 'benchPath': se['path'],
        'benchmark': {'sector': sector_etf, 'market': market_etf},
        'chartPre': st['pre'], 'chartPost': st['post'], 'benchChart': se['closes'],
    }

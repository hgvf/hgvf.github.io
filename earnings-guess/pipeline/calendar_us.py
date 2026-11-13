"""calendar_us.py — NYSE trading days without external data (SDD 4.1, 7.2).

t0 (reaction day): BMO → the call date itself if it is a trading day, else the
next one; AMC → the next trading day after the call date.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

# One-off closures (national days of mourning, etc.)
SPECIAL_CLOSURES = {
    date(2018, 12, 5), date(2025, 1, 9),
}


def _easter(y: int) -> date:
    a = y % 19; b = y // 100; c = y % 100; d = b // 4; e = b % 4
    f = (b + 8) // 25; g = (b - f + 1) // 3; h = (19 * a + b - d - g + 15) % 30
    i = c // 4; k = c % 4; l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31; day = (h + l - 7 * m + 114) % 31 + 1
    return date(y, month, day)


def _nth_weekday(y, m, weekday, n):
    d = date(y, m, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_weekday(y, m, weekday):
    d = date(y, m + 1, 1) - timedelta(days=1) if m < 12 else date(y, 12, 31)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d: date):
    if d.weekday() == 5:      # Saturday → Friday (except New Year, handled by caller)
        return d - timedelta(days=1)
    if d.weekday() == 6:      # Sunday → Monday
        return d + timedelta(days=1)
    return d


@lru_cache(maxsize=None)
def holidays(y: int) -> frozenset:
    h = set()
    ny = date(y, 1, 1)
    if ny.weekday() == 6:
        h.add(ny + timedelta(days=1))
    elif ny.weekday() != 5:   # NYSE does not close Fri Dec 31 for a Saturday New Year
        h.add(ny)
    h.add(_nth_weekday(y, 1, 0, 3))                 # MLK
    h.add(_nth_weekday(y, 2, 0, 3))                 # Presidents
    h.add(_easter(y) - timedelta(days=2))           # Good Friday
    h.add(_last_weekday(y, 5, 0))                   # Memorial
    if y >= 2022:
        h.add(_observed(date(y, 6, 19)))            # Juneteenth
    h.add(_observed(date(y, 7, 4)))                 # Independence
    h.add(_nth_weekday(y, 9, 0, 1))                 # Labor
    h.add(_nth_weekday(y, 11, 3, 4))                # Thanksgiving
    h.add(_observed(date(y, 12, 25)))               # Christmas
    return frozenset(h)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in holidays(d.year) and d not in SPECIAL_CLOSURES


def next_trading_day(d: date, include_self=False) -> date:
    if include_self and is_trading_day(d):
        return d
    d += timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def prev_trading_day(d: date) -> date:
    d -= timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def add_trading_days(d: date, n: int) -> date:
    step = next_trading_day if n >= 0 else prev_trading_day
    for _ in range(abs(n)):
        d = step(d)
    return d


def reaction_day(call_date: date, session: str) -> date:
    if session == 'BMO':
        return next_trading_day(call_date, include_self=True)
    if session == 'AMC':
        return next_trading_day(call_date)
    raise ValueError(f'session 必須是 BMO 或 AMC：{session}')

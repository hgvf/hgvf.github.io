"""models.py — Pydantic models: queue card, public card, answer (SDD 3.1 / 3.3 / 4.4).

Queue cards are the existing earnings-call JSON plus game fields. The existing
`{"calls":[...]}` wrapper is accepted and split into single cards.
"""
from __future__ import annotations

import re
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


class Highlight(BaseModel):
    text: str
    sentiment: Literal['bullish', 'neutral', 'bearish'] = 'neutral'

    @field_validator('sentiment', mode='before')
    @classmethod
    def _norm(cls, v):
        v = str(v or 'neutral').lower()
        return v if v in ('bullish', 'neutral', 'bearish') else 'neutral'


class Alias(BaseModel):
    text: str
    kind: Literal['company', 'product', 'person'] = 'company'


class QueueCard(BaseModel):
    # existing fields
    ticker: str
    company: str = ''
    year: int
    quarter: str
    date: str = Field(description='法說會日期（當地）YYYY-MM-DD')
    summary: str = ''
    highlights: list[Highlight] = []
    watch: list[str] = []
    # game fields
    session: Optional[Literal['BMO', 'AMC']] = None
    market: str = 'US'
    sector: Optional[str] = None
    aliases: list[Union[str, Alias]] = []
    releaseAt: Optional[str] = None

    @field_validator('ticker', mode='before')
    @classmethod
    def _t(cls, v):
        return str(v).strip().upper()

    @field_validator('quarter', mode='before')
    @classmethod
    def _q(cls, v):
        v = str(v).strip().upper()
        m = re.match(r'^(?:Q)?([1-4])(?:Q)?$', v)
        return f'Q{m.group(1)}' if m else v

    @field_validator('watch', mode='before')
    @classmethod
    def _w(cls, v):
        if v is None or v == '':
            return []
        if isinstance(v, str):
            return [v]
        return [str(x) for x in v if x is not None and str(x).strip()]

    @field_validator('session', mode='before')
    @classmethod
    def _s(cls, v):
        if v in (None, ''):
            return None
        v = str(v).upper()
        return {'PRE': 'BMO', 'POST': 'AMC', 'BEFORE': 'BMO', 'AFTER': 'AMC'}.get(v, v)

    @property
    def key(self) -> str:
        return f'{self.ticker}-{self.year}-{self.quarter}'

    def alias_objs(self) -> list[Alias]:
        return [a if isinstance(a, Alias) else Alias(text=a) for a in self.aliases if (a.text if isinstance(a, Alias) else a)]

    @property
    def net_sentiment(self) -> int:
        return sum(1 for h in self.highlights if h.sentiment == 'bullish') - sum(1 for h in self.highlights if h.sentiment == 'bearish')


def split_calls(data) -> list[dict]:
    """Accept {"calls":[...]}, a bare list, or a single call object."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get('calls'), list):
        return data['calls']
    if isinstance(data, dict) and data.get('ticker'):
        return [data]
    raise ValueError('格式需為 {"calls":[...]}、陣列、或單一 call 物件')


class Returns(BaseModel):
    gap: float
    r1: float
    r5: float
    r20: float


class Excess(BaseModel):
    r1: float
    r5: float
    r20: float


class Answer(BaseModel):
    ticker: str
    company: str
    date: str
    session: Literal['BMO', 'AMC']
    t0: str
    benchmark: dict
    returns: Returns
    excess: dict          # {"sector": Excess, "market": Excess}
    path: list[float]     # stock closes t0-5 … t0+20, base close = 100
    benchPath: list[float]
    netSentiment: int
    sentiments: list[str]  # original highlight sentiments, in public-card order
    year: int
    quarter: str


class PublicCard(BaseModel):
    id: str
    n: int
    releasedOn: str
    market: str
    sector: str
    session: Literal['BMO', 'AMC']
    summary: str
    highlights: list[dict]
    watch: list[str]
    choices: list[str]
    answer: str

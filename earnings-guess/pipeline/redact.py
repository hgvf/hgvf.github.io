"""redact.py — 去識別化 + 殘留檢查 (SDD 3.2).

1. company / ticker / aliases → 「本公司」「[產品]」「[管理層]」
2. year / quarter tokens → 「本季」「上一季」「下一季」「本年度」…
3. residual scan: own ticker / names / 4-digit years → hard flag (needs_review);
   other uppercase tokens not in the allowlist → soft warnings
4. optional amount_mode=magnitude: $4.2B → $X B
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from models import QueueCard

HERE = os.path.dirname(os.path.abspath(__file__))
SUFFIXES = r'(?:,?\s+(?:Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|Limited|Holdings?|Group|plc|PLC|N\.V\.|S\.A\.|AG|SE|Technologies|Technology|Systems))+'
REPL = {'company': '本公司', 'product': '[產品]', 'person': '[管理層]'}


def load_allowlist(path=None) -> set[str]:
    path = path or os.path.join(HERE, '..', 'config', 'redact_allowlist.txt')
    try:
        with open(path, encoding='utf-8') as f:
            return {ln.strip().upper() for ln in f if ln.strip() and not ln.startswith('#')}
    except FileNotFoundError:
        return set()


@dataclass
class RedactResult:
    summary: str
    highlights: list[dict]
    watch: list[str]
    hard: list[str] = field(default_factory=list)     # → needs_review
    soft: list[str] = field(default_factory=list)     # → listed, not blocking

    @property
    def ok(self) -> bool:
        return not self.hard


def name_variants(company: str) -> list[str]:
    if not company:
        return []
    base = re.sub(SUFFIXES + r'\s*$', '', company).strip(' ,')
    out = {company.strip(), base}
    return sorted((v for v in out if v and len(v) >= 2), key=len, reverse=True)


def _qrel(card_year: int, card_q: int, y: int, q: int) -> str:
    diff = (y * 4 + q) - (card_year * 4 + card_q)
    return {0: '本季', -1: '上一季', -2: '兩季前', -3: '三季前', 1: '下一季', 2: '兩季後', -4: '去年同季', 4: '明年同季'}.get(diff, '某季')


def _yrel(card_year: int, y: int) -> str:
    return {0: '本年度', -1: '上一年度', 1: '下一年度', 2: '後年度', -2: '前年度'}.get(y - card_year, '某年度')


def _year4(s: str) -> int:
    y = int(s)
    return y + 2000 if y < 100 else y


def redact_text(text: str, card: QueueCard, amount_mode='keep') -> str:
    if not text:
        return text
    cy, cq = card.year, int(card.quarter[1]) if re.match(r'Q[1-4]$', card.quarter) else 1
    t = text
    # names & aliases (longest first so "KLA Corp" goes before "KLA")
    pairs = [(v, 'company') for v in name_variants(card.company)]
    for a in card.alias_objs():
        pairs.append((a.text, a.kind))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    for txt, kind in pairs:
        if re.search(r'[一-鿿]', txt):
            t = t.replace(txt, REPL[kind])
        else:
            t = re.sub(rf"(?<![A-Za-z0-9]){re.escape(txt)}(?:['’]s)?(?![A-Za-z0-9])", REPL[kind], t, flags=re.I)
    t = re.sub(rf'(?<![A-Za-z0-9$]){re.escape(card.ticker)}(?![A-Za-z0-9])', '本公司', t)
    t = re.sub(r'本公司(\s*本公司)+', '本公司', t)
    # 英文字母邊界：中文字也是 \w，所以不用 \b（「較CY2026」「年度Q2」都要抓得到）
    L, R = r'(?<![A-Za-z0-9])', r'(?![A-Za-z0-9])'
    qnum = lambda g: '一二三四'.find(g) + 1 if g in '一二三四' else int(g)
    # quarter + year（季在前 / 年在前都抓）
    t = re.sub(L + r"(?:F?Q)([1-4])\s*(?:FY\s*)?'?((?:19|20)?\d{2})" + R,
               lambda m: _qrel(cy, cq, _year4(m.group(2)), int(m.group(1))), t)
    t = re.sub(L + r"([1-4])Q\s*'?((?:19|20)?\d{2})" + R, lambda m: _qrel(cy, cq, _year4(m.group(2)), int(m.group(1))), t)
    t = re.sub(L + r"(?:FY|CY)?\s*'?((?:19|20)\d{2}|\d{2})\s*(?:年度?)?\s*F?Q([1-4])" + R,
               lambda m: _qrel(cy, cq, _year4(m.group(1)), int(m.group(2))), t)
    t = re.sub(r"((?:19|20)\d{2})\s*年?\s*(?:第)?([一二三四1-4])\s*季",
               lambda m: _qrel(cy, cq, int(m.group(1)), qnum(m.group(2))), t)
    # half years
    t = re.sub(L + r"([12])H\s*'?((?:19|20)?\d{2})" + R + '|' + L + r"H([12])\s*'?((?:19|20)\d{2})" + R,
               lambda m: ('上半年' if (m.group(1) or m.group(3)) == '1' else '下半年') + '（' + _yrel(cy, _year4(m.group(2) or m.group(4))) + '）', t)
    # fiscal / calendar years
    t = re.sub(L + r"(?:FY|CY|fiscal(?:\s+year)?|calendar(?:\s+year)?)\s*'?((?:19|20)?\d{2})" + R,
               lambda m: _yrel(cy, _year4(m.group(1))), t, flags=re.I)
    t = re.sub(r'((?:19|20)\d{2})\s*(?:年度|年)', lambda m: _yrel(cy, int(m.group(1))), t)
    t = re.sub(r'(?<![\d.,$])((?:19|20)\d{2})(?![\d%.,])', lambda m: _yrel(cy, int(m.group(1))), t)
    # 年份換掉後殘留的 CY / FY 前綴（「CY本年度」→「本年度」）
    t = re.sub(L + r'(?:CY|FY)\s*(?=(?:本|上一|下一|前|後|某)年度)', '', t)
    # 沒帶年份的季度：「Q2營收」「本年度 Q2」→ 以本季為基準換成相對季別（同一年度內）
    t = re.sub(L + r'F?Q([1-4])' + R, lambda m: _qrel(cy, cq, cy, int(m.group(1))), t)
    t = re.sub(r'(?<![\d年])第([一二三四])季', lambda m: _qrel(cy, cq, cy, qnum(m.group(1))), t)   # 只換「第N季」，不碰「上一季」
    # 用月份稱呼的季度會透露財年制度（例：September quarter、6月季）
    t = re.sub(L + r'(?:January|February|March|April|May|June|July|August|September|October|November|December|'
               r'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?[- ]quarters?' + R, '某季', t, flags=re.I)
    t = re.sub(r'(?<!\d)(?:[1-9]|1[0-2])月(?:份)?(?:季度|季)', '某季', t)
    t = re.sub(r'本年度\s+本季|本季\s+本季', '本季', t)
    if amount_mode == 'magnitude':
        t = re.sub(r'(\$|US\$|NT\$)\s?(\d+(?:\.\d+)?)\s?(B|M|K|bn|billion|million|trillion|T)\b',
                   lambda m: f"{m.group(1)}{'X' * len(m.group(2).split('.')[0])} {m.group(3)}", t, flags=re.I)
    return t


def residual_check(texts: list[str], card: QueueCard, allow: set[str], known_tickers: set[str]) -> tuple[list[str], list[str]]:
    hard, soft = [], []
    blob = '\n'.join(texts)
    needles = {card.ticker} | set(name_variants(card.company)) | {a.text for a in card.alias_objs()}
    for n in needles:
        if not n:
            continue
        if re.search(r'[一-鿿]', n):
            if n in blob:
                hard.append(n)
        elif re.search(rf'(?<![A-Za-z0-9]){re.escape(n)}(?![A-Za-z0-9])', blob, flags=re.I if len(n) > 3 else 0):
            hard.append(n)
    for y in re.findall(r'(?<![\d.,$])((?:19|20)\d{2})(?![\d%])', blob):
        hard.append(y)
    for tok in sorted(set(re.findall(r'\b[A-Z]{2,5}\b', blob))):
        if tok in allow or tok in hard:
            continue
        if tok in known_tickers:
            soft.append(f'{tok}（其他公司代號）')
        else:
            soft.append(tok)
    return sorted(set(hard)), soft


def redact_card(card: QueueCard, allow: set[str] | None = None, known_tickers: set[str] | None = None,
                amount_mode='keep', block_on_unknown_uppercase=False) -> RedactResult:
    allow = allow if allow is not None else load_allowlist()
    known = known_tickers or set()
    summary = redact_text(card.summary, card, amount_mode)
    highlights = [{'text': redact_text(h.text, card, amount_mode), 'sentiment': h.sentiment} for h in card.highlights]
    watch = [redact_text(w, card, amount_mode) for w in card.watch]
    hard, soft = residual_check([summary, *[h['text'] for h in highlights], *watch], card, allow, known)
    if block_on_unknown_uppercase and soft:
        hard += soft
        soft = []
    return RedactResult(summary, highlights, watch, hard, soft)

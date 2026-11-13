"""pipeline.py — enrich → schedule → answer → redact → publish (SDD 3–5)."""
from __future__ import annotations

import base64
import json
import os
import random
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import yaml
from pydantic import ValidationError

from calendar_us import reaction_day, add_trading_days
from models import QueueCard
from reaction import Incomplete, compute, infer_session
from redact import redact_card, load_allowlist

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # earnings-guess/
SITE = os.path.dirname(ROOT)                      # repo root
OBF_KEY = b'hgvf-earnings'


def load_yaml(name):
    with open(os.path.join(ROOT, 'config', name), encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def obfuscate(obj) -> str:
    raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return base64.b64encode(bytes(b ^ OBF_KEY[i % len(OBF_KEY)] for i, b in enumerate(raw))).decode('ascii')


def deobfuscate(s: str):
    raw = base64.b64decode(s)
    return json.loads(bytes(b ^ OBF_KEY[i % len(OBF_KEY)] for i, b in enumerate(raw)).decode('utf-8'))


def now_dates():
    now = datetime.now(timezone.utc)
    return now.astimezone(ZoneInfo('America/New_York')).date(), now.astimezone(ZoneInfo('Asia/Taipei')).date()


class Universe:
    """ticker → sector / name from the site's watchlist + config."""

    def __init__(self, bench_cfg: dict, meta: dict, watchlist_path=None):
        self.bench = bench_cfg
        self.meta = meta
        self.by_ticker: dict[str, dict] = {}
        path = watchlist_path or os.path.join(SITE, 'data', 'watchlist.json')
        try:
            with open(path, encoding='utf-8') as f:
                wl = json.load(f)
            wmap = bench_cfg.get('watchlist', {})
            for s in wl.get('sectors', []):
                game = wmap.get(s.get('name'))
                for ss in s.get('subsectors', []):
                    for t in ss.get('tickers', []):
                        sym = str(t.get('symbol') or '').upper()
                        if not sym or (t.get('market') or 'US') != 'US' or '.' in sym:
                            continue
                        self.by_ticker.setdefault(sym, {'sector': game, 'name': t.get('name')})
        except FileNotFoundError:
            pass

    def sector_of(self, card: dict) -> str | None:
        t = str(card.get('ticker', '')).upper()
        return card.get('sector') or (self.meta.get('tickers') or {}).get(t, {}).get('sector') or self.by_ticker.get(t, {}).get('sector')

    def etfs(self, sector: str) -> tuple[str, str]:
        s = (self.bench.get('sectors') or {}).get(sector) or (self.bench.get('sectors') or {}).get(self.bench.get('default_sector', 'Other')) or {'etf': 'SPY', 'market': 'SPY'}
        return s['etf'], s['market']

    def peers(self, sector: str, exclude: str, extra: list[str]) -> list[str]:
        same = sorted({t for t, v in self.by_ticker.items() if v.get('sector') == sector} | set(extra))
        return [t for t in same if t != exclude]

    def known_tickers(self) -> set[str]:
        return set(self.by_ticker)


def enrich(raw: dict, uni: Universe, state_card: dict, infer=infer_session) -> tuple[QueueCard | None, list[str]]:
    """Merge card + meta.yaml + watchlist; returns (card, problems)."""
    meta = uni.meta
    d = {k: v for k, v in raw.items() if not k.startswith('_') and k not in ('updated_at', 'id')}
    problems = []
    t = str(d.get('ticker', '')).upper()
    mt = (meta.get('tickers') or {}).get(t, {})
    d['sector'] = uni.sector_of(d)
    d['aliases'] = list(d.get('aliases') or []) + list(mt.get('aliases') or [])
    try:
        card = QueueCard(**d)
    except ValidationError as e:
        return None, [f'schema：{err["loc"]} {err["msg"]}' for err in e.errors()]
    if not card.session:
        card.session = (meta.get('sessions') or {}).get(card.key) or state_card.get('session')
    if not card.session and infer:
        try:
            card.session = infer(card.ticker, date.fromisoformat(card.date))
        except Exception:
            card.session = None
        if card.session:
            state_card['session'] = card.session
            state_card['sessionSource'] = 'yfinance'
    if not card.releaseAt:
        ra = (meta.get('release_at') or {}).get(card.key)
        card.releaseAt = str(ra) if ra else None
    if not card.session:
        problems.append('缺 session（BMO / AMC）：卡片或 config/meta.yaml 的 sessions 補上')
    if not card.sector:
        problems.append('缺 sector：卡片或 config/meta.yaml 的 tickers.<T>.sector 補上（或在 benchmarks.yaml 的 watchlist 對照表加上這個板塊）')
    if card.market != 'US':
        problems.append(f'v1 只收美股卡片（market={card.market}）')
    return card, problems


class Run:
    def __init__(self, source, *, today_et=None, today_tw=None, site_dir=SITE, dry_run=False, fetch=None, infer=infer_session, log=print):
        self.src = source
        self.cfg = load_yaml('release.yaml')
        self.uni = Universe(load_yaml('benchmarks.yaml'), load_yaml('meta.yaml'))
        et, tw = now_dates()
        self.today_et, self.today_tw = today_et or et, today_tw or tw
        self.site_dir = site_dir
        self.out_dir = os.path.join(site_dir, 'earnings-guess', 'data')
        self.dry = dry_run
        self.fetch = fetch
        self.infer = infer
        self.log = log
        self.allow = load_allowlist()
        self.issues: list[dict] = []
        self.state = self.src.load_state()
        self.state.setdefault('cards', {})
        self.state.setdefault('seq', 0)

    # ── helpers ──
    def _released(self):
        return sorted(((k, v) for k, v in self.state['cards'].items() if v.get('status') == 'released'), key=lambda kv: kv[1]['releasedOn'])

    def cards(self):
        out = []
        seen = set()
        for raw in self.src.load_cards():
            key = f"{str(raw.get('ticker', '')).upper()}-{raw.get('year')}-{str(raw.get('quarter', '')).upper()}"
            st = self.state['cards'].setdefault(key, {'status': 'queued'})
            card, problems = enrich(raw, self.uni, st, self.infer)
            if card is None:
                st.update(status='invalid', reason='; '.join(problems))
                out.append((key, None, st, problems)); continue
            if card.key in seen:
                problems.append(f'重複卡片：{card.key}')
            seen.add(card.key)
            out.append((card.key, card, st, problems))
        return out

    def window_done(self, card: QueueCard) -> bool:
        t0 = reaction_day(date.fromisoformat(card.date), card.session)
        return add_trading_days(t0, 19) <= self.today_et

    def answer_for(self, card: QueueCard) -> dict:
        etf, mkt = self.uni.etfs(card.sector)
        kw = {'fetch': self.fetch} if self.fetch else {}
        kw.update(pre_bars=int(self.cfg.get('chart_pre_bars', 40)), post_bars=int(self.cfg.get('chart_post_bars', 20)))
        r = compute(card.ticker, date.fromisoformat(card.date), card.session, etf, mkt, self.today_et, **kw)
        return {
            'ticker': card.ticker, 'company': card.company or card.ticker, 'date': card.date, 'session': card.session,
            'year': card.year, 'quarter': card.quarter, 'netSentiment': card.net_sentiment, **r,
        }

    def prior_for(self, card: QueueCard, items) -> list[dict]:
        """前一、兩季同公司的卡（以「本季」為基準去識別化），附當時的反應供參考。"""
        n = int(self.cfg.get('prior_quarters', 2))
        qn = lambda c: c.year * 4 + int(c.quarter[1]) if re.match(r'Q[1-4]$', c.quarter) else c.year * 4
        prev = sorted((c for _, c, _, _ in items if c and c.ticker == card.ticker and qn(c) < qn(card) and c.date < card.date),
                      key=qn, reverse=True)[:n]
        out = []
        for p in prev:
            ctx = card.model_copy(update={'summary': p.summary, 'highlights': p.highlights, 'watch': p.watch,
                                          'aliases': list(card.aliases) + list(p.aliases), 'company': card.company or p.company})
            red = self.redact(ctx)
            if not red.ok:
                self.log(f'prior {p.key} 去識別化有疑慮，略過：{red.hard}')
                continue
            label = {1: '上一季', 2: '兩季前', 3: '三季前', 4: '去年同季'}.get(qn(card) - qn(p), f'{qn(card) - qn(p)} 季前')
            reaction = None
            if p.session:
                try:
                    a = self.answer_for(p)
                    reaction = {'session': p.session, 'gap': a['returns']['gap'], 'r1': a['returns']['r1'], 'r5': a['returns']['r5'],
                                'excess': {'sector': a['excess']['sector'], 'market': a['excess']['market']}}
                except Exception as e:      # missing prices → show the text only
                    self.log(f'prior {p.key} 反應計算失敗：{e}')
            out.append({'label': label, 'summary': red.summary, 'highlights': red.highlights, 'watch': red.watch,
                        'netSentiment': p.net_sentiment, 'reaction': reaction})
        return out

    def build_public(self, card: QueueCard, red, ans: dict, pid: str, n: int, all_tickers: list[str], prior=None) -> dict:
        rnd = random.Random(pid)
        order = list(range(len(red.highlights)))
        rnd.shuffle(order)
        hl = [red.highlights[i] for i in order]
        prior = prior or []
        # 情緒標籤是逐張判斷題的答案 → 只放在混淆過的 answer 裡，公開卡只有文字
        chart_pre = ans.pop('chartPre', None)
        ans = {**ans, 'sentiments': [h['sentiment'] for h in hl],
               'priorSentiments': [[h['sentiment'] for h in p['highlights']] for p in prior]}
        hl = [{'text': h['text']} for h in hl]
        prior = [{**p, 'highlights': [{'text': h['text']} for h in p['highlights']], 'netSentiment': None} for p in prior]
        peers = self.uni.peers(card.sector, card.ticker, [t for t in all_tickers if self.uni.sector_of({'ticker': t}) == card.sector])
        if len(peers) < 3:
            peers += [t for t in sorted(self.uni.known_tickers() | set(all_tickers)) if t != card.ticker and t not in peers]
        choices = rnd.sample(peers, min(3, len(peers))) + [card.ticker]
        rnd.shuffle(choices)
        return {
            'id': pid, 'n': n, 'releasedOn': self.today_tw.isoformat(), 'market': card.market, 'sector': card.sector,
            'session': card.session, 'summary': red.summary, 'highlights': hl, 'watch': red.watch,
            'choices': choices, 'prior': prior, 'chart': {'pre': chart_pre} if chart_pre else None, 'answer': obfuscate(ans),
        }

    def redact(self, card):
        return redact_card(card, self.allow, self.uni.known_tickers(), self.cfg.get('amount_mode', 'keep'), self.cfg.get('block_on_unknown_uppercase', False))

    # ── commands ──
    def validate(self) -> int:
        bad = 0
        for key, card, st, problems in self.cards():
            if card is not None:
                red = self.redact(card)
                if red.hard:
                    problems = problems + [f'去識別化後仍有可疑字串：{", ".join(red.hard)}']
                soft = f'　（提醒：{", ".join(red.soft[:8])}）' if red.soft else ''
            else:
                soft = ''
            status = '✗' if problems else '✓'
            bad += bool(problems)
            self.log(f'{status} {key:24s} {(card.sector if card else "-")!s:12s} {(card.session if card else "-")!s:4s} {"; ".join(problems)}{soft}')
        return 1 if bad else 0

    def release(self, count=None, only_id=None) -> list[dict]:
        count = count or int(self.cfg.get('per_day', 0)) or 10 ** 9
        unlimited = count >= 10 ** 9
        items = self.cards()
        all_tickers = sorted({c.ticker for _, c, _, _ in items if c})
        released = self._released()
        rnd = random.Random(f'release:{self.today_tw}')
        cands, missing = [], []
        for key, card, st, problems in items:
            if card is None or st.get('status') == 'released':
                continue
            if only_id and key != only_id:
                continue
            if problems:
                st.update(status='needs_review', reason='; '.join(problems))
                missing.append((key, problems))
                continue
            if st.get('status') == 'held' and st.get('heldUntil', '') > self.today_tw.isoformat():
                continue
            if card.releaseAt and card.releaseAt > self.today_tw.isoformat() and not only_id:
                st['status'] = 'scheduled'; continue
            if not self.window_done(card):
                st['status'] = 'queued'; continue
            forced = bool(only_id) or (card.releaseAt and card.releaseAt <= self.today_tw.isoformat())
            cands.append((0 if forced else 1, rnd.random(), key, card, st, forced))
        cands.sort(key=lambda x: (x[0], x[1]))
        picks = []
        for _, _, key, card, st, forced in cands:
            if len(picks) >= count:
                break
            hist = released + [(k, v) for k, v in picks]
            if not forced and not unlimited and not self._gaps_ok(card, hist):
                continue
            red = self.redact(card)
            if not red.ok:
                st.update(status='needs_review', reason=f'可疑字串：{", ".join(red.hard)}')
                self.issues.append(self._issue(key, '去識別化需要人工確認', [f'可疑字串：{", ".join(red.hard)}', f'提醒：{", ".join(red.soft)}' if red.soft else '']))
                continue
            try:
                ans = self.answer_for(card)
            except Incomplete as e:
                st.update(status='held', reason=str(e), heldUntil=(self.today_tw + timedelta(days=int(self.cfg.get('retry_held_days', 1)))).isoformat())
                self.log(f'held {key}: {e}')
                continue
            except Exception as e:      # network / yfinance hiccup → never fail the workflow
                st.update(status='held', reason=f'{type(e).__name__}: {e}', heldUntil=(self.today_tw + timedelta(days=1)).isoformat())
                self.log(f'held {key}: {e}')
                continue
            out = ans['excess']['sector']['r1'] > 0
            if not forced and not unlimited and out and not self._balance_ok(hist, out):
                self.log(f'skip {key}: 跑贏卡太多（答案打散）')
                continue
            self.state['seq'] += 1
            pid = f'c-{secrets.token_hex(3)}'
            pub = self.build_public(card, red, ans, pid, self.state['seq'], all_tickers, self.prior_for(card, items))
            self._write(pub, card)
            meta = {'status': 'released', 'releasedOn': self.today_tw.isoformat(), 'publicId': pid, 'n': self.state['seq'], 'sector': card.sector,
                    'ticker': card.ticker, 'outperform': out, 'session': card.session}
            if not self.dry:
                st.clear(); st.update(meta)
            picks.append((key, meta))
            self.log(json.dumps({'key': key, 'public': {**pub, 'answer': '<obfuscated>'}, 'answer': ans} if self.dry else {'released': key, 'id': pid}, ensure_ascii=False, indent=1))
        if missing:
            self.issues.append({'title': f'法說會盲猜：{len(missing)} 張卡缺遊戲欄位', 'labels': ['earnings-guess', 'needs_review'],
                                'body': '這些卡還不能排進佇列：\n\n| 卡片 | 原因 |\n|---|---|\n' + '\n'.join(f'| {k} | {"；".join(p)} |' for k, p in missing)
                                + '\n\n在 `earnings-guess/config/meta.yaml` 補上即可，下次排程會自動重新檢查。'})
        left = sum(1 for _, c, st, p in items if c and st.get('status') not in ('released', 'invalid') and not p)
        if left - len(picks) < int(self.cfg.get('min_queue_alert', 7)):
            self.issues.append({'title': '法說會盲猜：佇列快用完了，請補卡', 'labels': ['earnings-guess'],
                                'body': f'目前還沒釋出、資料完整的卡剩 {left - len(picks)} 張（門檻 {self.cfg.get("min_queue_alert", 7)}）。\n\n用財報電話會議分析頁的匯入功能新增卡片即可，pipeline 會自動排進佇列。'})
        if not self.dry:
            self.state['lastRun'] = datetime.now(timezone.utc).isoformat()
            self.src.save_state(self.state)
        return [p for p in picks]

    def plan(self, days=30):
        """Project the next N days ignoring answers (balance rule needs prices)."""
        items = [(k, c, st) for k, c, st, p in self.cards() if c and not p and st.get('status') != 'released']
        hist = list(self._released())
        out = []
        today_et, today_tw = self.today_et, self.today_tw
        for d in range(days):
            self.today_et, self.today_tw = today_et + timedelta(days=d), today_tw + timedelta(days=d)
            rnd = random.Random(f'release:{self.today_tw}')
            pool = [(rnd.random(), k, c) for k, c, st in items if self.window_done(c) and (not c.releaseAt or c.releaseAt <= self.today_tw.isoformat())]
            pool.sort(key=lambda x: (0 if x[2].releaseAt == self.today_tw.isoformat() else 1, x[0]))
            n = 0
            for _, k, c in pool:
                if n >= int(self.cfg.get('per_day', 1)):
                    break
                if not self._gaps_ok(c, hist):
                    continue
                meta = {'releasedOn': self.today_tw.isoformat(), 'sector': c.sector, 'ticker': c.ticker}
                hist.append((k, meta)); items = [x for x in items if x[0] != k]
                out.append((self.today_tw.isoformat(), k, c.sector)); n += 1
            if n == 0:
                out.append((self.today_tw.isoformat(), '—', ''))
        self.today_et, self.today_tw = today_et, today_tw
        for row in out:
            self.log(f'{row[0]}  {row[1]:24s} {row[2]}')
        return out

    # ── rules ──
    def _gaps_ok(self, card, hist) -> bool:
        today = self.today_tw
        sg = int(self.cfg.get('sector_gap_days', 1)); tg = int(self.cfg.get('ticker_gap_days', 14))
        for _, v in hist:
            d = date.fromisoformat(v['releasedOn'])
            if v.get('ticker') == card.ticker and (today - d).days < tg:
                return False
            if v.get('sector') == card.sector and 0 < (today - d).days <= sg:
                return False
            if v.get('sector') == card.sector and d == today:
                return False
        return True

    def _balance_ok(self, hist, out) -> bool:
        w = int(self.cfg.get('balance_window', 7)); mx = int(self.cfg.get('balance_max_outperform', 5))
        recent = [v for _, v in sorted(hist, key=lambda kv: kv[1]['releasedOn'])][-(w - 1):]
        return sum(1 for v in recent if v.get('outperform')) + (1 if out else 0) <= mx

    def _issue(self, key, what, lines):
        return {'title': f'法說會盲猜：{key} {what}', 'labels': ['earnings-guess', 'needs_review'],
                'body': '\n'.join(['卡片沒有自動釋出，原因：', '', *[f'- {x}' for x in lines if x], '',
                                   '處理方式：在 `earnings-guess/config/meta.yaml` 補上 `tickers.<T>.aliases` / `sector` / `sessions`，'
                                   '或直接修改卡片文字。下次排程會自動重新檢查，不需要手動改狀態。'])}

    def _write(self, pub, card):
        if self.dry:
            return
        calls = os.path.join(self.out_dir, 'calls')
        os.makedirs(calls, exist_ok=True)
        with open(os.path.join(calls, f"{pub['id']}.json"), 'w', encoding='utf-8') as f:
            json.dump(pub, f, ensure_ascii=False, indent=1)
        idx_path = os.path.join(self.out_dir, 'index.json')
        try:
            with open(idx_path, encoding='utf-8') as f:
                idx = json.load(f)
        except FileNotFoundError:
            idx = {'version': 1, 'calls': []}
        idx['calls'] = [c for c in idx['calls'] if c['id'] != pub['id']] + [{'id': pub['id'], 'n': pub['n'], 'releasedOn': pub['releasedOn'], 'sector': pub['sector'], 'session': pub['session'],
                                                                                 'teaser': pub['summary'][:90]}]
        idx['updatedAt'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
        with open(idx_path, 'w', encoding='utf-8') as f:
            json.dump(idx, f, ensure_ascii=False, indent=1)

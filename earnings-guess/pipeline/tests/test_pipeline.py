import json, os, sys, tempfile, unittest, subprocess
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from calendar_us import reaction_day, is_trading_day, add_trading_days, holidays
from models import QueueCard, split_calls
from redact import redact_card
from pipeline import Run, obfuscate, deobfuscate
from sources import DirSource
from reaction import compute, Incomplete


class TestCalendar(unittest.TestCase):
    def test_bmo_amc_weekend(self):
        self.assertEqual(reaction_day(date(2026, 7, 30), 'BMO'), date(2026, 7, 30))   # Thu
        self.assertEqual(reaction_day(date(2026, 7, 30), 'AMC'), date(2026, 7, 31))   # Fri
        self.assertEqual(reaction_day(date(2026, 7, 31), 'AMC'), date(2026, 8, 3))    # Fri AMC → Mon
        self.assertEqual(reaction_day(date(2026, 8, 1), 'BMO'), date(2026, 8, 3))     # Sat → Mon

    def test_holidays(self):
        self.assertEqual(reaction_day(date(2026, 4, 2), 'AMC'), date(2026, 4, 6))     # Good Friday 2026-04-03
        self.assertEqual(reaction_day(date(2026, 11, 25), 'AMC'), date(2026, 11, 27))  # Thanksgiving
        self.assertEqual(reaction_day(date(2026, 1, 16), 'AMC'), date(2026, 1, 20))   # MLK 1/19
        self.assertFalse(is_trading_day(date(2026, 7, 3)))                            # Jul 4 is Sat → Fri observed
        self.assertFalse(is_trading_day(date(2026, 6, 19)))                           # Juneteenth
        self.assertTrue(is_trading_day(date(2021, 12, 31)))                           # Sat New Year: no Friday close
        self.assertFalse(is_trading_day(date(2025, 1, 9)))                            # special closure
        self.assertIn(date(2027, 3, 26), holidays(2027))                              # Good Friday 2027
        self.assertEqual(add_trading_days(date(2026, 12, 23), 2), date(2026, 12, 28))  # skips Christmas (Fri 12/25)


CARD = {
    'ticker': 'KLAC', 'company': 'KLA Corporation', 'year': 2026, 'quarter': 'Q2', 'date': '2026-07-30',
    'summary': "KLA's Q2 2026 revenue beat; KLAC guided FY2027 up. Rick Wallace said 2026 WFE grows. Q3'26 outlook strong, 2H26 too.",
    'highlights': [{'text': 'eDR7380 demand from AI; CY2026 capex up', 'sentiment': 'bullish'}, {'text': 'China down 10%', 'sentiment': 'bearish'}],
    'watch': ['KLA Corp margins in 2027'], 'session': 'AMC', 'sector': 'Semicap',
    'aliases': ['KLA', {'text': 'Rick Wallace', 'kind': 'person'}, {'text': 'eDR7380', 'kind': 'product'}],
}


class TestRedact(unittest.TestCase):
    def test_redact(self):
        r = redact_card(QueueCard(**CARD), known_tickers={'LRCX', 'AMAT'})
        blob = ' '.join([r.summary, *[h['text'] for h in r.highlights], *r.watch])
        for bad in ['KLA', 'KLAC', 'Rick', 'eDR7380', '2026', '2027', "'26", '2H26']:
            self.assertNotIn(bad, blob, blob)
        self.assertIn('本公司', r.summary)
        self.assertIn('本季', r.summary)
        self.assertIn('下一年度', r.summary)
        self.assertIn('下一季', r.summary)
        self.assertIn('[管理層]', r.summary)
        self.assertIn('[產品]', r.highlights[0]['text'])
        self.assertTrue(r.ok, r.hard)
        self.assertIn('10%', r.highlights[1]['text'])

    def test_residual_flags(self):
        from redact import residual_check
        hard, soft = residual_check(['KLAC grew in 2026; AMAT and XYZQ too'], QueueCard(**CARD), {'AI'}, {'AMAT'})
        self.assertIn('KLAC', hard); self.assertIn('2026', hard)
        self.assertTrue(any('AMAT' in x for x in soft)); self.assertIn('XYZQ', soft)
        r = redact_card(QueueCard(**dict(CARD, summary='Founded in 1975 by KLA-Tencor')))
        self.assertTrue(r.ok); self.assertNotIn('1975', r.summary)

    def test_magnitude(self):
        c = dict(CARD, summary='Revenue $3.2B, FCF $420M')
        r = redact_card(QueueCard(**c), amount_mode='magnitude')
        self.assertIn('$X B', r.summary); self.assertIn('$XXX M', r.summary)

    def test_split_calls(self):
        self.assertEqual(len(split_calls({'calls': [CARD, CARD]})), 2)
        self.assertEqual(len(split_calls(CARD)), 1)


def fake_fetch(syms, start, end):
    out = {}
    d = start
    days = []
    while d <= end + timedelta(days=10):
        if is_trading_day(d): days.append(d)
        d += timedelta(days=1)
    for s in syms:
        k = {'KLAC': 1.01, 'SOXX': 1.002, 'SPY': 1.001}.get(s, 1.0)
        px, o = 100.0, {}
        for x in days:
            o[x.isoformat()] = (px, px * k); px *= k
        out[s] = o
    return out


class TestReaction(unittest.TestCase):
    def test_compute(self):
        r = compute('KLAC', date(2026, 7, 30), 'AMC', 'SOXX', 'SPY', date(2026, 9, 30), fetch=fake_fetch)
        self.assertEqual(r['t0'], '2026-07-31')
        self.assertAlmostEqual(r['returns']['r1'], 0.01, places=4)
        self.assertAlmostEqual(r['returns']['r20'], 1.01 ** 20 - 1, places=4)
        self.assertGreater(r['excess']['sector']['r1'], 0)
        self.assertEqual(len(r['path']), 26)
        self.assertEqual(r['path'][4], 100.0)

    def test_incomplete(self):
        with self.assertRaises(Incomplete):
            compute('KLAC', date(2026, 7, 30), 'AMC', 'SOXX', 'SPY', date(2026, 8, 10), fetch=fake_fetch)


class TestRelease(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        q = os.path.join(self.tmp, 'queue'); os.makedirs(q)
        cards = []
        for i, (t, sec) in enumerate([('KLAC', 'Semicap'), ('LRCX', 'Semicap'), ('NVDA', 'Semis'), ('MSFT', 'Software'), ('PLTR', 'Software')]):
            cards.append(dict(CARD, ticker=t, company=t + ' Inc', sector=sec, aliases=[], date=f'2026-07-{20 + i:02d}', summary=f'{t} beat estimates.'))
        cards.append(dict(CARD, ticker='NEW1', company='New One', aliases=[], date='2026-11-10'))      # window not done
        cards.append(dict(CARD, ticker='NOSEC', company='No Sector', sector=None, aliases=[], session=None, date='2026-07-01'))
        with open(os.path.join(q, 'calls.json'), 'w') as f: json.dump({'calls': cards}, f)
        self.src = DirSource(q, os.path.join(self.tmp, 'state', 'schedule.json'))

    def run_day(self, d, **kw):
        logs = []
        r = Run(self.src, today_et=d, today_tw=d + timedelta(days=1), site_dir=self.tmp, fetch=fake_fetch, infer=lambda *a: None, log=logs.append, **kw)
        return r, r.release()

    def test_daily_release_rules(self):
        r, picks = self.run_day(date(2026, 10, 1))
        self.assertEqual(len(picks), 1)
        idx = json.load(open(os.path.join(self.tmp, 'earnings-guess', 'data', 'index.json')))
        self.assertEqual(len(idx['calls']), 1)
        pub = json.load(open(os.path.join(self.tmp, 'earnings-guess', 'data', 'calls', idx['calls'][0]['id'] + '.json')))
        ans = deobfuscate(pub['answer'])
        self.assertIn(ans['ticker'], pub['choices'])
        self.assertEqual(len(pub['choices']), 4)
        self.assertNotIn(ans['ticker'], json.dumps({k: v for k, v in pub.items() if k not in ('choices', 'answer')}))
        self.assertTrue(any('缺遊戲欄位' in i['title'] for i in r.issues))
        sectors = [pub['sector']]
        for k in range(2, 5):
            r, picks = self.run_day(date(2026, 10, k))
            idx = json.load(open(os.path.join(self.tmp, 'earnings-guess', 'data', 'index.json')))
            sectors.append(idx['calls'][-1]['sector'])
        for a, b in zip(sectors, sectors[1:]):
            self.assertNotEqual(a, b, sectors)        # same sector never on consecutive days
        with open(os.path.join(self.tmp, 'state', 'schedule.json')) as fh: st = json.load(fh)
        self.assertNotEqual(st['cards']['NEW1-2026-Q2']['status'], 'released')

    def test_dry_run_writes_nothing(self):
        r = Run(self.src, today_et=date(2026, 10, 1), today_tw=date(2026, 10, 2), site_dir=self.tmp, fetch=fake_fetch, infer=lambda *a: None, dry_run=True, log=lambda *a: None)
        self.assertEqual(len(r.release()), 1)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, 'earnings-guess', 'data', 'index.json')))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, 'state', 'schedule.json')))


class TestObfuscation(unittest.TestCase):
    def test_js_roundtrip(self):
        s = obfuscate({'ticker': 'KLAC', 'company': '科磊', 'x': [1.5]})
        self.assertEqual(deobfuscate(s)['company'], '科磊')
        js = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'js', 'obf.js')
        out = subprocess.run(['node', '--input-type=module', '-e', f"import {{ deobfuscate }} from '{js}'; console.log(JSON.stringify(deobfuscate('{s}')))"], capture_output=True, text=True)
        self.assertEqual(json.loads(out.stdout)['company'], '科磊', out.stderr)


if __name__ == '__main__':
    unittest.main()

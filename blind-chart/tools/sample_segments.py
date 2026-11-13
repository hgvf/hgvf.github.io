#!/usr/bin/env python3
"""sample_segments.py — 從日 K parquet 抽出候選片段（SDD 3.4、3.5、5.3 步驟 1–2、4）。

    python blind-chart/tools/sample_segments.py --data DATA_DIR --out build/segments.jsonl.gz \
        [--map "ticker=symbol,trade_date=date"] [--market TW] [--markets TW,US] [--seed 2026Q4]

輸入（DATA_DIR 底下遞迴找 *.parquet；可以是每市場一檔，也可以是 MinIO 那種分區資料夾）：
  bars:      market, symbol, date, open, high, low, close, volume[, turnover]
             · 價格須為還原權值價
             · market 欄缺 → 由路徑推斷（路徑含 tw / us / jp / kr），或用 --market 指定
  universe.parquet（選用）: market, symbol, name, board, sector, listed_since, snapshot_date
  benchmarks.parquet（選用）: market, symbol, date, close   （TAIEX / SPX / N225 / KOSPI）

輸出 segments.jsonl.gz：每行一個候選片段（真實價格、含日期），交給 gen-puzzles.mjs
做 regime 標籤、訊號掃描、匿名化。這個檔案含真實行情，不要 commit。
"""
import argparse, gzip, json, os, random, re, sys, glob
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load_json(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def parse_map(s):
    out = {}
    for part in filter(None, (s or '').split(',')):
        src, dst = part.split('=')
        out[src.strip()] = dst.strip()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--map', default='')
    ap.add_argument('--market', default=None, help='整批資料都屬於這個市場時指定')
    ap.add_argument('--markets', default='TW,US,JP,KR')
    ap.add_argument('--seed', default=None)
    ap.add_argument('--universe-config', default=os.path.join(ROOT, 'config', 'universe.json'))
    ap.add_argument('--puzzles-config', default=os.path.join(ROOT, 'config', 'puzzles.json'))
    ap.add_argument('--min-date', default='2005-01-01')
    args = ap.parse_args()

    ucfg = load_json(args.universe_config)
    pcfg = load_json(args.puzzles_config)
    seed = args.seed or pcfg['seed']
    rnd = random.Random(seed)
    total = pcfg['contextBars'] + max(pcfg.get('playBarsVariants', [pcfg['playBars']])) + pcfg['revealBars']
    total_default = pcfg['contextBars'] + pcfg['playBars'] + pcfg['revealBars']

    files = [f for f in glob.glob(os.path.join(args.data, '**', '*.parquet'), recursive=True)]
    special = {'universe.parquet', 'benchmarks.parquet', 'manifest.parquet'}
    bar_files = [f for f in files if os.path.basename(f) not in special]
    if not bar_files:
        sys.exit(f'找不到 bars parquet：{args.data}')
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order=false")
    m = parse_map(args.map)
    flist = '[' + ','.join(f"'{f}'" for f in bar_files) + ']'
    raw = con.sql(f"SELECT * FROM read_parquet({flist}, union_by_name=true, filename=true)")
    cols = {c.lower(): c for c in raw.columns}

    def col(name):
        for src, dst in m.items():
            if dst == name and src.lower() in cols:
                return f'"{cols[src.lower()]}"'
        return f'"{cols[name]}"' if name in cols else None

    need = ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume']
    miss = [c for c in need if col(c) is None]
    if miss:
        sys.exit(f'缺欄位 {miss}；先跑 inspect_parquet.py 看建議的 --map')
    mkt_expr = f"upper({col('market')})" if col('market') else (
        f"'{args.market.upper()}'" if args.market else
        "CASE WHEN regexp_matches(lower(filename), '(^|[/_.-])tw([/_.-]|$)') THEN 'TW' "
        "WHEN regexp_matches(lower(filename), '(^|[/_.-])us([/_.-]|$)') THEN 'US' "
        "WHEN regexp_matches(lower(filename), '(^|[/_.-])jp([/_.-]|$)') THEN 'JP' "
        "WHEN regexp_matches(lower(filename), '(^|[/_.-])kr([/_.-]|$)') THEN 'KR' END")
    to_expr = col('turnover') or f"{col('close')} * {col('volume')}"
    con.execute(f"""
      CREATE TABLE bars AS
      SELECT {mkt_expr} AS market, CAST({col('symbol')} AS VARCHAR) AS symbol, CAST({col('date')} AS DATE) AS date,
             CAST({col('open')} AS DOUBLE) AS open, CAST({col('high')} AS DOUBLE) AS high,
             CAST({col('low')} AS DOUBLE) AS low, CAST({col('close')} AS DOUBLE) AS close,
             CAST({col('volume')} AS DOUBLE) AS volume, CAST({to_expr} AS DOUBLE) AS turnover
      FROM read_parquet({flist}, union_by_name=true, filename=true)
      WHERE CAST({col('date')} AS DATE) >= DATE '{args.min_date}'
    """)
    unk = con.execute("SELECT count(*) FROM bars WHERE market IS NULL").fetchall()[0][0]
    if unk:
        print(f'警告：{unk} 列無法判斷市場（路徑沒有 tw/us/jp/kr 且沒有 market 欄），已略過', file=sys.stderr)

    uni = {}
    up = next((f for f in files if os.path.basename(f) == 'universe.parquet'), None)
    if up:
        for r in con.execute(f"SELECT * FROM read_parquet('{up}')").fetchall():
            d = dict(zip([c[0] for c in con.description], r))
            uni[(str(d.get('market', '')).upper(), str(d['symbol']))] = d
    bench = {}
    bp = next((f for f in files if os.path.basename(f) == 'benchmarks.parquet'), None)
    if bp:
        for mk, sym, dt, c in con.execute(f"SELECT upper(market), symbol, CAST(date AS DATE), close FROM read_parquet('{bp}') ORDER BY 1,3").fetchall():
            bench.setdefault(mk, {'symbol': sym, 'px': {}})['px'][dt.isoformat()] = c

    excl = {b.upper() for b in ucfg.get('excludeBoards', [])}
    out_n = 0
    stats = {}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with gzip.open(args.out, 'wt', encoding='utf-8') as fo:
        for mk in [x.strip().upper() for x in args.markets.split(',')]:
            mc = ucfg['markets'].get(mk)
            if not mc:
                continue
            syms = [r[0] for r in con.execute(
                "SELECT symbol FROM bars WHERE market=? GROUP BY symbol HAVING count(*) >= ? ORDER BY symbol", [mk, total_default]).fetchall()]
            if uni:
                syms = [s for s in syms if (mk, s) in uni and str(uni[(mk, s)].get('board') or '').upper() not in excl]
            st = stats[mk] = {'symbols': len(syms), 'tried': 0, 'quality': 0, 'liquidity': 0, 'kept': 0}
            if not syms:
                continue
            want = int(pcfg['poolSize'].get(mk, 600) * pcfg.get('candidateMultiplier', 3))
            per_sym = {}
            used = {}
            attempts = 0
            while st['kept'] < want and attempts < want * 15:
                attempts += 1
                s = rnd.choice(syms)
                if used.get(s, 0) >= pcfg['maxPerSymbol'] * 2:
                    continue
                if s not in per_sym:
                    rows = con.execute("SELECT date, open, high, low, close, volume, turnover FROM bars WHERE market=? AND symbol=? ORDER BY date", [mk, s]).fetchall()
                    per_sym[s] = rows
                    if len(per_sym) > 400:            # bound memory
                        per_sym.pop(next(iter(per_sym)))
                rows = per_sym[s]
                play = rnd.choice(pcfg.get('playBarsVariants', [pcfg['playBars']])) if rnd.random() < 0.25 else pcfg['playBars']
                n = pcfg['contextBars'] + play + pcfg['revealBars']
                if len(rows) < n:
                    continue
                st['tried'] += 1
                a = rnd.randrange(0, len(rows) - n + 1)
                seg = rows[a:a + n]
                if not quality_ok(seg, mc, ucfg):
                    st['quality'] += 1
                    continue
                ps, pe = pcfg['contextBars'], pcfg['contextBars'] + play
                tos = sorted(r[6] for r in seg[ps:pe] if r[6] is not None)
                med = tos[len(tos) // 2] if tos else 0
                if med < mc['minMedianTurnover'] or (mc.get('minClose') and min(r[4] for r in seg[ps:pe]) < mc['minClose']):
                    st['liquidity'] += 1
                    continue
                used[s] = used.get(s, 0) + 1
                u = uni.get((mk, s), {})
                b = bench.get(mk)
                bc = [b['px'].get(r[0].isoformat()) for r in seg] if b else None
                rec = {
                    'market': mk, 'symbol': s, 'name': u.get('name') or s, 'sector': u.get('sector'),
                    'lotSize': mc['lotSize'], 'playBars': play,
                    'dates': [r[0].isoformat() for r in seg],
                    'o': [r[1] for r in seg], 'h': [r[2] for r in seg], 'l': [r[3] for r in seg],
                    'c': [r[4] for r in seg], 'v': [r[5] for r in seg], 'to': [r[6] for r in seg],
                    'bench': {'symbol': b['symbol'], 'c': ffill(bc)} if b else None,
                }
                fo.write(json.dumps(rec, separators=(',', ':')) + '\n')
                st['kept'] += 1
                out_n += 1
    print(json.dumps({'segments': out_n, 'seed': seed, 'markets': stats}, ensure_ascii=False, indent=1))


def ffill(a):
    out, last = [], None
    for x in a:
        last = x if x is not None else last
        out.append(last)
    return out


def quality_ok(seg, mc, ucfg):
    zero = 0
    prev = None
    lim = mc['maxAbsDailyReturn']
    for _, o, h, l, c, v, _to in seg:
        if None in (o, h, l, c) or min(o, h, l, c) <= 0:
            return False
        if l > min(o, c) + 1e-9 or h < max(o, c) - 1e-9:
            return False
        if prev and abs(c / prev - 1) > lim:
            return False
        zero = zero + 1 if not v else 0
        if zero > ucfg.get('maxZeroVolumeRun', 5):
            return False
        prev = c
    return True


if __name__ == '__main__':
    main()

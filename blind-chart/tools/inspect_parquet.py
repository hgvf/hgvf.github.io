#!/usr/bin/env python3
"""inspect_parquet.py — 看你的 parquet 長什麼樣，並建議 --map 參數。

    python blind-chart/tools/inspect_parquet.py /path/to/parquet_dir

會列出每個檔案的欄位、型別、列數、日期範圍與前 3 列，並對照 SDD 3.3 的
canonical schema 給出 sample_segments.py 需要的 --map 字串。
"""
import sys, glob, os
import duckdb

CANON = {
    'market': ['market', 'exchange_country', 'mkt'],
    'symbol': ['symbol', 'ticker', 'code', 'stock_id', 'sid'],
    'date': ['date', 'trade_date', 'dt', 'day', 'timestamp', 'ts', 'datetime'],
    'open': ['open', 'o', 'open_price', 'adj_open'],
    'high': ['high', 'h', 'high_price', 'adj_high'],
    'low': ['low', 'l', 'low_price', 'adj_low'],
    'close': ['close', 'c', 'close_price', 'adj_close', 'adjclose'],
    'volume': ['volume', 'v', 'vol', 'trading_volume', 'shares'],
    'turnover': ['turnover', 'amount', 'value', 'trading_money', 'trade_value'],
}

def main(root):
    files = sorted(glob.glob(os.path.join(root, '**', '*.parquet'), recursive=True)) if os.path.isdir(root) else [root]
    if not files:
        sys.exit(f'找不到 parquet：{root}')
    con = duckdb.connect()
    cols_all = set()
    for f in files[:20]:
        rel = con.sql(f"SELECT * FROM read_parquet('{f}')")
        print(f'\n== {f}')
        print('  欄位：', ', '.join(f'{c}:{t}' for c, t in zip(rel.columns, rel.types)))
        print('  列數：', con.execute(f"SELECT count(*) FROM read_parquet('{f}')").fetchall()[0][0])
        print(rel.limit(3))
        cols_all |= {c.lower(): c for c in rel.columns}.keys()
    if len(files) > 20:
        print(f'... 共 {len(files)} 個檔案（只列前 20 個）')
    mapping = []
    missing = []
    for canon, cands in CANON.items():
        hit = next((c for c in cands if c in cols_all), None)
        if hit is None:
            missing.append(canon)
        elif hit != canon:
            mapping.append(f'{hit}={canon}')
    print('\n建議參數：', f'--map "{",".join(mapping)}"' if mapping else '（欄位名稱已符合，不需要 --map）')
    if missing:
        print('缺少欄位：', ', '.join(missing),
              '\n  market 缺 → 用檔名或資料夾名推斷（tw/us/jp/kr），或加 --market TW；turnover 缺 → 以 close×volume 估。')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])

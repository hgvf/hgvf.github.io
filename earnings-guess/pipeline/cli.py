#!/usr/bin/env python3
"""賭財報（法說會盲猜）pipeline CLI.

  python earnings-guess/pipeline/cli.py validate  [--source firestore|dir] ...
  python earnings-guess/pipeline/cli.py release   [--count N] [--id TICKER-YEAR-Qn] [--dry-run]
  python earnings-guess/pipeline/cli.py plan      [--days 30]

Sources:
  --source firestore --credentials sa.json      （預設，佇列 = 網站既有的 earnings_calls）
  --source dir --queue queue/calls --state state/schedule.json   （SDD 的 private repo 版）
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pipeline import Run, SITE  # noqa: E402
from sources import DirSource, FirestoreSource  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['validate', 'release', 'plan', 'rebuild'])
    ap.add_argument('--source', default='firestore', choices=['firestore', 'dir'])
    ap.add_argument('--credentials')
    ap.add_argument('--queue', default='queue/calls')
    ap.add_argument('--state', default='state/schedule.json')
    ap.add_argument('--site-dir', default=SITE, help='網站 repo 根目錄（公開卡寫到 <site>/earnings-guess/data/）')
    ap.add_argument('--count', type=int)
    ap.add_argument('--id')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--days', type=int, default=30)
    ap.add_argument('--which', default='non_us', choices=['non_us', 'all'], help='rebuild 的範圍')
    ap.add_argument('--issues-out', help='把要開的 GitHub Issue 寫成 JSON（workflow 用 gh 開）')
    a = ap.parse_args()

    src = FirestoreSource(a.credentials) if a.source == 'firestore' else DirSource(a.queue, a.state)
    run = Run(src, site_dir=a.site_dir, dry_run=a.dry_run or a.cmd not in ('release', 'rebuild'))
    code = 0
    if a.cmd == 'validate':
        code = run.validate()
    elif a.cmd == 'plan':
        run.plan(a.days)
    elif a.cmd == 'rebuild':
        print(f'重建 {run.rebuild(a.which)} 張{"（dry run，未寫入）" if a.dry_run else ""}')
    else:
        picks = run.release(count=a.count, only_id=a.id)
        print(f'釋出 {len(picks)} 張{"（dry run，未寫入）" if a.dry_run else ""}')
    if a.issues_out:
        with open(a.issues_out, 'w', encoding='utf-8') as f:
            json.dump(run.issues, f, ensure_ascii=False, indent=1)
    sys.exit(code)


if __name__ == '__main__':
    main()

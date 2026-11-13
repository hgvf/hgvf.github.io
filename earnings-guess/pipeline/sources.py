"""sources.py — where queue cards and schedule state live.

FirestoreSource (default in this repo's workflow):
  queue  = Firestore `earnings_calls` (the cards the site already has)
  state  = Firestore `earnings_guess_state/schedule` — no client rule matches
           this collection, so browsers cannot read the release plan.
DirSource (private-repo layout from the SDD):
  queue  = queue/calls/*.json (single card or {"calls":[...]})
  state  = state/schedule.json
"""
from __future__ import annotations

import glob
import json
import os

from models import split_calls


class DirSource:
    def __init__(self, queue_dir: str, state_path: str):
        self.queue_dir, self.state_path = queue_dir, state_path

    def load_cards(self) -> list[dict]:
        cards = []
        for f in sorted(glob.glob(os.path.join(self.queue_dir, '**', '*.json'), recursive=True)):
            with open(f, encoding='utf-8') as fh:
                for c in split_calls(json.load(fh)):
                    c['_src'] = os.path.relpath(f, self.queue_dir)
                    cards.append(c)
        return cards

    def load_state(self) -> dict:
        try:
            with open(self.state_path, encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            return {'cards': {}, 'seq': 0}

    def save_state(self, st: dict):
        os.makedirs(os.path.dirname(os.path.abspath(self.state_path)), exist_ok=True)
        with open(self.state_path, 'w', encoding='utf-8') as f:
            json.dump(st, f, ensure_ascii=False, indent=1, sort_keys=True)


class FirestoreSource:
    STATE = ('earnings_guess_state', 'schedule')

    def __init__(self, credentials: str):
        import firebase_admin
        from firebase_admin import credentials as cred, firestore
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred.Certificate(credentials))
        self.db = firestore.client()

    def load_cards(self) -> list[dict]:
        out = []
        for d in self.db.collection('earnings_calls').stream():
            c = d.to_dict()
            c['_src'] = f'firestore:{d.id}'
            out.append(c)
        return out

    def load_state(self) -> dict:
        snap = self.db.collection(self.STATE[0]).document(self.STATE[1]).get()
        return snap.to_dict() if snap.exists else {'cards': {}, 'seq': 0}

    def save_state(self, st: dict):
        self.db.collection(self.STATE[0]).document(self.STATE[1]).set(st)

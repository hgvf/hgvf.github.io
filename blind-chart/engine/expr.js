// expr.js — the condition mini-language (SDD 4.3). Hand-written tokenizer +
// Pratt parser → AST → closure evaluator. No eval / Function.
//
// Grammar
//   expr    := or
//   or      := and ('or' and)*
//   and     := not ('and' not)*
//   not     := 'not' not | cmp
//   cmp     := add (('<'|'<='|'>'|'>='|'=='|'!=') add)?
//   add     := mul (('+'|'-') mul)*
//   mul     := unary (('*'|'/') unary)*
//   unary   := '-' unary | postfix
//   postfix := primary ('[' INT ']')*          // x[1] = one bar ago; only non-negative literals
//   primary := NUMBER | 'true' | 'false' | IDENT | IDENT '(' args ')' | '(' expr ')'
//   IDENT   := [A-Za-z_][A-Za-z0-9_]*('.'[A-Za-z0-9_]+)*

export class ExprError extends Error {
  constructor(message, pos, src) { super(message); this.pos = pos; this.src = src; }
}

export const POS_VARS = ['size', 'avgPrice', 'unrealizedR', 'unrealizedPnl', 'barsHeld', 'adds', 'highestSinceEntry',
  'lastAddPrice', 'entryPrice', 'initialStop', 'stop', 'riskPerShare'];
export const ACCT_VARS = ['equity', 'cash', 'openRiskR', 'openRisk'];

const FUNCS = {
  cross_up: 2, cross_down: 2, rising: 2, falling: 2, highest: 2, lowest: 2,
  min: -2, max: -2, abs: 1, nz: -1, na: 1, sma: 2, change: -1,
};

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch) && /[0-9]/.test(src[i + (ch === '.' ? 1 : 0)] || '')) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      toks.push({ t: 'num', v: parseFloat(m[0]), pos: i, raw: m[0] }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*/.exec(src.slice(i));
      const w = m[0];
      if (w === 'and' || w === 'or' || w === 'not') toks.push({ t: 'op', v: w, pos: i });
      else if (w === 'true' || w === 'false') toks.push({ t: 'num', v: w === 'true' ? 1 : 0, pos: i, bool: true });
      else toks.push({ t: 'id', v: w, pos: i });
      i += w.length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
      toks.push({ t: 'op', v: two === '&&' ? 'and' : two === '||' ? 'or' : two, pos: i }); i += 2; continue;
    }
    if ('+-*/<>()[],!'.includes(ch)) { toks.push({ t: 'op', v: ch === '!' ? 'not' : ch, pos: i }); i++; continue; }
    throw new ExprError(`無法辨識的字元「${ch}」`, i, src);
  }
  toks.push({ t: 'eof', pos: src.length });
  return toks;
}

function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = v => {
    const t = next();
    if (t.v !== v) throw new ExprError(`這裡應該是「${v}」`, t.pos, src);
    return t;
  };
  const isOp = v => peek().t === 'op' && peek().v === v;

  function orE() { let l = andE(); while (isOp('or')) { const t = next(); l = { k: 'bin', op: 'or', l, r: andE(), pos: t.pos }; } return l; }
  function andE() { let l = notE(); while (isOp('and')) { const t = next(); l = { k: 'bin', op: 'and', l, r: notE(), pos: t.pos }; } return l; }
  function notE() { if (isOp('not')) { const t = next(); return { k: 'not', x: notE(), pos: t.pos }; } return cmpE(); }
  function cmpE() {
    const l = addE();
    const t = peek();
    if (t.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v)) { next(); return { k: 'bin', op: t.v, l, r: addE(), pos: t.pos }; }
    return l;
  }
  function addE() { let l = mulE(); while (isOp('+') || isOp('-')) { const t = next(); l = { k: 'bin', op: t.v, l, r: mulE(), pos: t.pos }; } return l; }
  function mulE() { let l = unary(); while (isOp('*') || isOp('/')) { const t = next(); l = { k: 'bin', op: t.v, l, r: unary(), pos: t.pos }; } return l; }
  function unary() { if (isOp('-')) { const t = next(); return { k: 'neg', x: unary(), pos: t.pos }; } return postfix(); }
  function postfix() {
    let x = primary();
    while (isOp('[')) {
      const t = next();
      const n = next();
      if (n.t !== 'num' || !Number.isInteger(n.v) || n.v < 0) throw new ExprError('[ ] 內只能放非負整數（往前取值，例 close[1]）', n.pos, src);
      expect(']');
      x = { k: 'shift', x, n: n.v, pos: t.pos };
    }
    return x;
  }
  function primary() {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: t.v, pos: t.pos };
    if (t.t === 'id') {
      if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) { args.push(orE()); while (isOp(',')) { next(); args.push(orE()); } }
        expect(')');
        const arity = FUNCS[t.v];
        if (arity === undefined) throw new ExprError(`未知的函數：${t.v}()`, t.pos, src);
        if (arity > 0 && args.length !== arity) throw new ExprError(`${t.v}() 需要 ${arity} 個參數`, t.pos, src);
        if (arity < 0 && args.length < 1) throw new ExprError(`${t.v}() 至少需要 1 個參數`, t.pos, src);
        if (['rising', 'falling', 'highest', 'lowest', 'sma'].includes(t.v)) {
          const nArg = args[1];
          if (nArg.k !== 'num' || !Number.isInteger(nArg.v) || nArg.v < 1) throw new ExprError(`${t.v}() 第二個參數須為正整數`, nArg.pos, src);
        }
        return { k: 'call', f: t.v, args, pos: t.pos };
      }
      return { k: 'var', name: t.v, pos: t.pos };
    }
    if (t.t === 'op' && t.v === '(') { const e = orE(); expect(')'); return e; }
    if (t.t === 'eof') throw new ExprError('運算式不完整', t.pos, src);
    throw new ExprError(`這裡不能出現「${t.v}」`, t.pos, src);
  }
  if (peek().t === 'eof') throw new ExprError('運算式是空的', 0, src);
  const ast = orE();
  if (peek().t !== 'eof') throw new ExprError(`多出來的「${peek().v}」`, peek().pos, src);
  return ast;
}

function collectVars(ast, out = []) {
  if (!ast) return out;
  if (ast.k === 'var') out.push(ast);
  for (const key of ['l', 'r', 'x']) if (ast[key]) collectVars(ast[key], out);
  if (ast.args) ast.args.forEach(a => collectVars(a, out));
  return out;
}

/** Compile an expression. `known` = Set of series names available (optional;
    when given, unknown identifiers become compile errors with a position). */
export function compile(src, known) {
  if (typeof src !== 'string') throw new ExprError('運算式必須是字串', 0, String(src));
  const ast = parse(src);
  const vars = collectVars(ast);
  for (const v of vars) {
    if (v.name.startsWith('pos.')) {
      if (!POS_VARS.includes(v.name.slice(4))) throw new ExprError(`未知的部位變數：${v.name}（可用：${POS_VARS.map(x => 'pos.' + x).join(' ')}）`, v.pos, src);
    } else if (v.name.startsWith('acct.')) {
      if (!ACCT_VARS.includes(v.name.slice(5))) throw new ExprError(`未知的帳戶變數：${v.name}（可用：${ACCT_VARS.map(x => 'acct.' + x).join(' ')}）`, v.pos, src);
    } else if (known && !known.has(v.name)) {
      throw new ExprError(`未知的變數：${v.name}`, v.pos, src);
    }
  }
  const usesState = vars.some(v => v.name.startsWith('pos.') || v.name.startsWith('acct.'));
  const fn = build(ast);
  return {
    src, ast, usesState,
    refs: [...new Set(vars.map(v => v.name))],
    /** ctx: { view: BarView, state: { pos: {...}, acct: {...} } } → number (booleans are 1/0) */
    eval: (ctx) => fn(ctx, 0),
    test: (ctx) => truthy(fn(ctx, 0)),
  };
}

const truthy = v => !Number.isNaN(v) && v !== 0;
const B = b => (b ? 1 : 0);

function build(n) {
  switch (n.k) {
    case 'num': { const v = n.v; return () => v; }
    case 'var': {
      const name = n.name;
      if (name.startsWith('pos.') || name.startsWith('acct.')) {
        const [grp, key] = name.split('.');
        return (ctx, off) => {
          if (off !== 0) throw new ExprError(`${name} 不支援往前取值`, n.pos);
          const v = ctx.state?.[grp]?.[key];
          return v == null ? NaN : +v;
        };
      }
      return (ctx, off) => ctx.view.get(name, off);
    }
    case 'shift': { const f = build(n.x), k = n.n; return (ctx, off) => f(ctx, off + k); }
    case 'neg': { const f = build(n.x); return (ctx, off) => -f(ctx, off); }
    case 'not': { const f = build(n.x); return (ctx, off) => B(!truthy(f(ctx, off))); }
    case 'bin': {
      const l = build(n.l), r = build(n.r);
      switch (n.op) {
        case 'and': return (c, o) => B(truthy(l(c, o)) && truthy(r(c, o)));
        case 'or': return (c, o) => B(truthy(l(c, o)) || truthy(r(c, o)));
        case '+': return (c, o) => l(c, o) + r(c, o);
        case '-': return (c, o) => l(c, o) - r(c, o);
        case '*': return (c, o) => l(c, o) * r(c, o);
        case '/': return (c, o) => { const d = r(c, o); return d === 0 ? NaN : l(c, o) / d; };
        case '<': return (c, o) => B(l(c, o) < r(c, o));
        case '<=': return (c, o) => B(l(c, o) <= r(c, o));
        case '>': return (c, o) => B(l(c, o) > r(c, o));
        case '>=': return (c, o) => B(l(c, o) >= r(c, o));
        case '==': return (c, o) => B(l(c, o) === r(c, o));
        case '!=': return (c, o) => B(l(c, o) !== r(c, o));
      }
      break;
    }
    case 'call': {
      const a = n.args.map(build);
      const N = n.args[1]?.k === 'num' ? n.args[1].v : 0;
      switch (n.f) {
        case 'cross_up': return (c, o) => B(a[0](c, o) > a[1](c, o) && a[0](c, o + 1) <= a[1](c, o + 1));
        case 'cross_down': return (c, o) => B(a[0](c, o) < a[1](c, o) && a[0](c, o + 1) >= a[1](c, o + 1));
        case 'rising': return (c, o) => { const x0 = a[0](c, o); for (let k = 1; k <= N; k++) if (!(x0 > a[0](c, o + k))) return 0; return 1; };
        case 'falling': return (c, o) => { const x0 = a[0](c, o); for (let k = 1; k <= N; k++) if (!(x0 < a[0](c, o + k))) return 0; return 1; };
        case 'highest': return (c, o) => { let m = -Infinity; for (let k = 0; k < N; k++) { const v = a[0](c, o + k); if (Number.isNaN(v)) return NaN; m = Math.max(m, v); } return m; };
        case 'lowest': return (c, o) => { let m = Infinity; for (let k = 0; k < N; k++) { const v = a[0](c, o + k); if (Number.isNaN(v)) return NaN; m = Math.min(m, v); } return m; };
        case 'sma': return (c, o) => { let s = 0; for (let k = 0; k < N; k++) s += a[0](c, o + k); return s / N; };
        case 'min': return (c, o) => Math.min(...a.map(f => f(c, o)));
        case 'max': return (c, o) => Math.max(...a.map(f => f(c, o)));
        case 'abs': return (c, o) => Math.abs(a[0](c, o));
        case 'na': return (c, o) => B(Number.isNaN(a[0](c, o)));
        case 'nz': return (c, o) => { const v = a[0](c, o); return Number.isNaN(v) ? (a[1] ? a[1](c, o) : 0) : v; };
        case 'change': return (c, o) => { const k = n.args[1]?.k === 'num' ? n.args[1].v : 1; return a[0](c, o) - a[0](c, o + k); };
      }
    }
  }
  throw new ExprError(`無法編譯的節點：${n.k}`, n.pos);
}

/** Validate without a context; returns null or { message, pos }. */
export function checkExpr(src, known) {
  try { compile(src, known); return null; } catch (e) { return { message: e.message, pos: e.pos ?? 0 }; }
}

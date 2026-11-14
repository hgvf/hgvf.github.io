// chart.js — lightweight-charts wrapper. Bars are mapped to fake daily times
// (no real dates leak); the axis shows bar numbers relative to the play start.
import { INDICATORS } from '../engine/index.js';

const LC = () => window.LightweightCharts;
const T0 = 946684800;                 // 2000-01-01 UTC, arbitrary
export const timeOf = i => T0 + i * 86400;
export const barOf = t => Math.round((t - T0) / 86400);
const PALETTE = ['#2563EB', '#9333EA', '#0891B2', '#CA8A04', '#DB2777', '#4B5563', '#059669'];
export const COL = { up: '#16A34A', down: '#DC2626', stop: '#DC2626', target: '#16A34A', avg: '#78716C', add: '#2563EB', signal: '#D97706', sellSig: '#7C3AED' };

// ── 一般技術指標（和策略無關，玩家自己開關；預設全關） ──
export const TOOL_INDS = [
  { id: '_ma5', type: 'sma', params: { length: 5 } },
  { id: '_ma20', type: 'sma', params: { length: 20 } },
  { id: '_ma60', type: 'sma', params: { length: 60 } },
  { id: '_bb', type: 'bollinger', params: { length: 20, mult: 2 } },
  { id: '_rsi', type: 'rsi', params: { length: 14 } },
  { id: '_kd', type: 'kd', params: { length: 9, kSmooth: 3, dSmooth: 3 } },
  { id: '_macd', type: 'macd', params: { fast: 12, slow: 26, signal: 9 } },
];
export const TOOLS = {
  ma: { label: '均線', pane: 'price', lines: [['_ma5', '#EA580C', 'MA5'], ['_ma20', '#0D9488', 'MA20'], ['_ma60', '#7C2D12', 'MA60']] },
  bb: { label: '布林', pane: 'price', lines: [['_bb.upper', '#64748B', '布林上', 2], ['_bb.mid', '#64748B', '布林中', 1], ['_bb.lower', '#64748B', '布林下', 2]] },
  rsi: { label: 'RSI', pane: 'sub', title: 'RSI 14', lines: [['_rsi', '#7C3AED', 'RSI']], levels: [70, 30] },
  kd: { label: 'KD', pane: 'sub', title: 'KD 9', lines: [['_kd.k', '#2563EB', 'K'], ['_kd.d', '#EA580C', 'D']], levels: [80, 20] },
  macd: { label: 'MACD', pane: 'sub', title: 'MACD 12/26/9', lines: [['_macd.macd', '#2563EB', 'DIF'], ['_macd.signal', '#EA580C', 'MACD']], hist: '_macd.hist', levels: [0] },
};

const baseOpts = (el, playStart) => ({
  autoSize: true,
  layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#6B4C35', fontFamily: 'Inter, "Noto Sans TC", sans-serif', fontSize: 11 },
  grid: { vertLines: { color: 'rgba(120,80,30,0.07)' }, horzLines: { color: 'rgba(120,80,30,0.07)' } },
  rightPriceScale: { borderColor: 'rgba(120,80,30,0.2)', minimumWidth: 64 },
  timeScale: { borderColor: 'rgba(120,80,30,0.2)', rightOffset: 6, barSpacing: 7, minBarSpacing: 1.5,
    tickMarkFormatter: t => { const b = barOf(t) - playStart; return b < 0 ? `${b}` : `#${b + 1}`; } },
  localization: { timeFormatter: t => { const b = barOf(t) - playStart; return b < 0 ? `背景 ${b}` : `第 ${b + 1} 根`; }, priceFormatter: p => p.toFixed(2) },
  crosshair: { mode: 0 },
  handleScroll: { vertTouchDrag: false },
});

const SELL_TXT = { stop: '停損', trail: '移停', target: '停利', time_stop: '時間到', exit_signal: '賣' };

export class ChartView {
  /** opts: { playStart, spec, showVolume, tools: 一般指標的序列（computeIndicators(bars, TOOL_INDS)） } */
  constructor(mainEl, subEl, legendEl, { playStart, spec, showVolume = true, tools = null }) {
    this.playStart = playStart; this.spec = spec; this.legendEl = legendEl;
    this.toolSeries = tools || {};
    this.chart = LC().createChart(mainEl, baseOpts(mainEl, playStart));
    this.candles = this.chart.addCandlestickSeries({ upColor: COL.up, downColor: COL.down, borderUpColor: COL.up, borderDownColor: COL.down, wickUpColor: COL.up, wickDownColor: COL.down, priceLineVisible: false });
    this.vol = showVolume ? this.chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }) : null;
    if (this.vol) this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    this.overlays = {};
    this.indOn = {};
    this.colors = {};
    let ci = 0;
    for (const ind of spec.indicators) {
      const p = INDICATORS[ind.type];
      if (!p || p.pane !== 'price' || ind.type === 'swing') continue;
      const outs = ind.type === 'supertrend' ? ['line'] : p.outputs.filter(o => o !== 'width');
      const color = PALETTE[ci++ % PALETTE.length];
      this.colors[ind.id] = color;
      this.overlays[ind.id] = outs.map(o => ({
        key: p.outputs.length > 1 ? `${ind.id}.${o}` : ind.id,
        s: this.chart.addLineSeries({ color, lineWidth: o === 'mid' ? 1 : 1.5, lineStyle: o === 'mid' ? 2 : 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      }));
      this.indOn[ind.id] = true;
    }
    this.toolOn = {};
    this.toolLines = {};
    const line = (color, style, w = 2) => this.chart.addLineSeries({ color, lineWidth: w, lineStyle: style, lineType: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false });
    this.stopS = line(COL.stop, 0);
    this.targetS = spec.targets.map(() => line(COL.target, 2));
    this.avgS = line(COL.avg, 1, 1);
    this.addS = line(COL.add, 3, 1);
    // sub pane
    this.subEl = subEl;
    this.sub = null; this.subSeries = []; this.subId = null;
    this.subInds = spec.indicators.filter(x => INDICATORS[x.type]?.pane === 'sub');
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && this.sub && !this._syncing) { this._syncing = true; this.sub.timeScale().setVisibleLogicalRange(r); this._syncing = false; } });
    this.legend();
  }
  val(key) { return this._last?.ctx.series[key] || this.toolSeries[key]; }
  legend() {
    if (!this.legendEl) return;
    const items = [['停損', COL.stop], ['停利', COL.target], ['均價', COL.avg], ['加碼價', COL.add]];
    for (const [k, on] of Object.entries(this.toolOn)) if (on && TOOLS[k].pane === 'price') for (const [, c, n] of TOOLS[k].lines) if (!n.startsWith('布林') || n === '布林中') items.push([n === '布林中' ? '布林' : n, c]);
    this.legendEl.innerHTML = items.map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('');
  }
  /** 主圖上的一般指標（均線 / 布林）開關 */
  toggleTool(k) {
    const t = TOOLS[k];
    if (!t || t.pane !== 'price') return false;
    this.toolOn[k] = !this.toolOn[k];
    if (this.toolOn[k] && !this.toolLines[k]) {
      this.toolLines[k] = t.lines.map(([key, color, , style = 0]) => ({ key, s: this.chart.addLineSeries({ color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }) }));
    }
    this.legend();
    if (this._last) this.update(this._last);
    return this.toolOn[k];
  }
  /** 副圖：策略自己的副圖指標 id，或一般指標 'tool:rsi' / 'tool:kd' / 'tool:macd'；null = 關閉 */
  setSub(id) {
    this.subId = id;
    if (!id) { this.subEl.hidden = true; if (this.sub) { this.sub.remove(); this.sub = null; } this.subEl.querySelector('.sub-legend')?.remove(); return; }
    this.subEl.hidden = false;
    if (!this.sub) {
      this.sub = LC().createChart(this.subEl, { ...baseOpts(this.subEl, this.playStart), timeScale: { visible: false, rightOffset: 6, barSpacing: 7 } });
      this.sub.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && !this._syncing) { this._syncing = true; this.chart.timeScale().setVisibleLogicalRange(r); this._syncing = false; } });
    }
    this.subSeries.forEach(s => this.sub.removeSeries(s.s));
    let defs, title, levels = [];
    if (id.startsWith('tool:')) {
      const t = TOOLS[id.slice(5)];
      defs = [...(t.hist ? [{ key: t.hist, hist: true }] : []), ...t.lines.map(([key, color, name]) => ({ key, color, name }))];
      title = t.title; levels = t.levels || [];
    } else {
      const ind = this.subInds.find(x => x.id === id);
      const p = INDICATORS[ind.type];
      defs = p.outputs.map((o, k) => ({ key: p.outputs.length > 1 ? `${id}.${o}` : id, hist: o === 'hist', color: PALETTE[k % PALETTE.length], name: p.outputs.length > 1 ? o : id }));
      title = id;
    }
    this.subSeries = defs.map((d, k) => ({
      key: d.key, hist: d.hist,
      s: d.hist ? this.sub.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
        : this.sub.addLineSeries({ color: d.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: k === (defs[0].hist ? 1 : 0) }),
    }));
    const first = this.subSeries.find(x => !x.hist);
    for (const v of levels) first?.s.createPriceLine({ price: v, color: 'rgba(120,80,30,.35)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    let lg = this.subEl.querySelector('.sub-legend');
    if (!lg) { lg = document.createElement('div'); lg.className = 'legend sub-legend'; this.subEl.appendChild(lg); }
    lg.innerHTML = `<span>${title}</span>${defs.filter(d => !d.hist).map(d => `<span><i style="background:${d.color}"></i>${d.name}</span>`).join('')}`;
    if (this._last) this.update(this._last);
  }
  toggleOverlay(id) { this.indOn[id] = !this.indOn[id]; if (this._last) this.update(this._last); return this.indOn[id]; }

  /** d: { ctx, t, run (simulate output, may be null), hint, revealTo?, markers? } */
  update(d) {
    this._last = d;
    const { ctx, t } = d;
    const S = ctx.series, upto = d.revealTo ?? t;
    const k = [], v = [];
    for (let i = 0; i <= upto; i++) {
      const tm = timeOf(i);
      k.push({ time: tm, open: S.open[i], high: S.high[i], low: S.low[i], close: S.close[i], ...(i > t ? { color: 'rgba(120,113,108,.55)', borderColor: 'rgba(120,113,108,.55)', wickColor: 'rgba(120,113,108,.55)' } : {}) });
      v.push({ time: tm, value: S.volume[i] || 0, color: S.close[i] >= S.open[i] ? 'rgba(22,163,74,.28)' : 'rgba(220,38,38,.28)' });
    }
    this.candles.setData(k);
    this.vol?.setData(v);
    const ser = (arr, from = 0) => { const o = []; if (!arr) return o; for (let i = from; i <= upto; i++) o.push(Number.isFinite(arr[i]) ? { time: timeOf(i), value: arr[i] } : { time: timeOf(i) }); return o; };
    for (const [id, list] of Object.entries(this.overlays)) for (const x of list) x.s.setData(this.indOn[id] && d.hint !== 'none' ? ser(S[x.key]) : []);
    for (const [key, list] of Object.entries(this.toolLines)) for (const x of list) x.s.setData(this.toolOn[key] ? ser(this.val(x.key)) : []);
    const run = d.run, showLines = run && d.hint !== 'none';
    const ps = ctx.playStart;
    this.stopS.setData(showLines ? ser(run.stopLine, ps) : []);
    this.targetS.forEach((s, j) => s.setData(showLines ? ser(run.targetLines[j], ps) : []));
    this.avgS.setData(showLines ? ser(run.avgLine, ps) : []);
    this.addS.setData(showLines ? ser(run.addTrigger, ps) : []);
    // markers：買訊 / 賣訊 / 加訊（規則）＋ 實際成交
    const m = [];
    if (run) {
      if (d.hint !== 'none') {
        for (const i of run.signals) if (i <= upto) m.push({ time: timeOf(i), position: 'aboveBar', color: COL.signal, shape: 'arrowDown', text: '買訊' });
        const end = Math.min(upto, run.advice.length - 1);
        for (let i = ps; i <= end; i++) {
          const a = run.advice[i];
          if (!a?.pos) continue;
          if (a.exitAll || a.exitPart) m.push({ time: timeOf(i), position: 'aboveBar', color: COL.sellSig, shape: 'arrowDown', text: '賣訊' });
          else if (a.addSignal) m.push({ time: timeOf(i), position: 'belowBar', color: COL.add, shape: 'circle', text: '加訊' });
        }
      }
      for (const f of run.fills) {
        if (f.bar > upto) continue;
        const buy = f.side === 'buy';
        const txt = buy ? (f.kind === 'add' ? `加碼 ${f.qty}` : `買 ${f.qty}`) : `${SELL_TXT[f.reason] || '賣'} ${f.qty}`;
        m.push({ time: timeOf(f.bar), position: buy ? 'belowBar' : 'aboveBar', color: buy ? (f.kind === 'add' ? COL.add : COL.up) : COL.down, shape: buy ? 'arrowUp' : 'arrowDown', text: txt });
      }
    }
    for (const x of d.markers || []) m.push(x);
    m.sort((a, b) => a.time - b.time);
    this.candles.setMarkers(m);
    if (this.sub && this.subId) {
      for (const x of this.subSeries) {
        const arr = this.val(x.key);
        x.s.setData(x.hist ? ser(arr).map(p => (p.value != null ? { ...p, color: p.value >= 0 ? 'rgba(22,163,74,.5)' : 'rgba(220,38,38,.5)' } : p)) : ser(arr));
      }
    }
    if (!this._fitted) { this.focus(t); this._fitted = true; }
    else if (d.follow) this.chart.timeScale().scrollToRealTime();
  }
  focus(bar, span = 140) {
    const ts = this.chart.timeScale();
    ts.setVisibleLogicalRange({ from: Math.max(0, bar - span), to: bar + 8 });
  }
  destroy() { this.chart.remove(); this.sub?.remove(); }
}

/** Small line chart (equity curves, history trends). */
export function lineChart(el, seriesList, { markers = [], xLabel } = {}) {
  const c = LC().createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#6B4C35', fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(120,80,30,0.07)' } },
    timeScale: { tickMarkFormatter: t => (xLabel ? xLabel(barOf(t)) : `${barOf(t)}`), borderColor: 'rgba(120,80,30,0.2)' },
    localization: { timeFormatter: t => (xLabel ? xLabel(barOf(t)) : `${barOf(t)}`) },
    rightPriceScale: { borderColor: 'rgba(120,80,30,0.2)' },
    handleScroll: { vertTouchDrag: false },
  });
  const out = seriesList.map(s => {
    const ls = c.addLineSeries({ color: s.color, lineWidth: s.width || 2, lineStyle: s.style || 0, priceLineVisible: false, title: s.title || '' });
    ls.setData(s.data.map(p => ({ time: timeOf(p.x), value: p.y })));
    return ls;
  });
  if (markers.length && out[0]) out[0].setMarkers(markers.map(m => ({ ...m, time: timeOf(m.x) })).sort((a, b) => a.time - b.time));
  c.timeScale().fitContent();
  return c;
}

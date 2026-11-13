// chart.js — 法說會前後的日 K（lightweight-charts）。
// 作答前只有法說前 N 根（公開卡 chart.pre）；揭曉後再接上法說後的 K 棒與產業 ETF
// （都在混淆過的 answer 裡）。價格以 close(t0−1) = 100 縮放、成交量以法說前中位數 = 100，
// 不會透露真實股價水位。
const T0 = 946684800;
const tm = i => T0 + i * 86400;
const bar = t => Math.round((t - T0) / 86400);
let chart = null;

export function drawCallChart(el, card, ans, noteEl, SESSION) {
  if (chart) { chart.remove(); chart = null; }
  const pre = card.chart?.pre;
  if (!el) return;
  if (!pre || !window.LightweightCharts) { el.hidden = true; if (noteEl) noteEl.hidden = true; return; }
  const post = ans?.chartPost;
  const nPre = pre.c.length;
  const label = i => (i < nPre ? `t${i - nPre}` : i === nPre ? 't0' : `t+${i - nPre}`);
  chart = window.LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#6B4C35', fontSize: 11, fontFamily: 'Inter, "Noto Sans TC", sans-serif' },
    grid: { vertLines: { color: 'rgba(120,80,30,0.06)' }, horzLines: { color: 'rgba(120,80,30,0.06)' } },
    rightPriceScale: { borderColor: 'rgba(120,80,30,0.2)' },
    timeScale: { borderColor: 'rgba(120,80,30,0.2)', rightOffset: post ? 2 : 6, tickMarkFormatter: t => label(bar(t)) },
    localization: { timeFormatter: t => label(bar(t)), priceFormatter: p => p.toFixed(1) },
    handleScroll: { vertTouchDrag: false },
  });
  const up = '#16A34A', dn = '#DC2626';
  const candles = chart.addCandlestickSeries({ upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn, priceLineVisible: false });
  const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  const all = { o: [...pre.o, ...(post?.o || [])], h: [...pre.h, ...(post?.h || [])], l: [...pre.l, ...(post?.l || [])], c: [...pre.c, ...(post?.c || [])], v: [...pre.v, ...(post?.v || [])] };
  candles.setData(all.c.map((c, i) => ({ time: tm(i), open: all.o[i], high: all.h[i], low: all.l[i], close: c })));
  vol.setData(all.v.map((v, i) => ({ time: tm(i), value: v, color: i >= nPre ? 'rgba(217,119,6,.45)' : (all.c[i] >= all.o[i] ? 'rgba(22,163,74,.28)' : 'rgba(220,38,38,.28)') })));
  const base = chart.addLineSeries({ color: 'rgba(120,80,30,.35)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  base.setData(all.c.map((_, i) => ({ time: tm(i), value: 100 })));
  if (post && ans.benchChart?.length) {
    const b = chart.addLineSeries({ color: '#2563EB', lineWidth: 1.5, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: ans.benchmark?.sector || '產業' });
    const off = all.c.length - ans.benchChart.length;
    b.setData(ans.benchChart.map((v, k) => ({ time: tm(k + Math.max(0, off)), value: v })));
  }
  const ses = SESSION?.[card.session] || '';
  candles.setMarkers(post
    ? [{ time: tm(nPre), position: 'aboveBar', color: '#D97706', shape: 'arrowDown', text: `t0 反應日（${ses}法說）` }]
    : [{ time: tm(nPre - 1), position: 'aboveBar', color: '#D97706', shape: 'arrowDown', text: '法說會前一根' }]);
  chart.timeScale().fitContent();
  if (noteEl) noteEl.innerHTML = post
    ? `橘色量 = 法說後；虛線藍 = ${ans.benchmark?.sector || '基準'}；價格以法說會前一根收盤 = 100`
    : `價格以法說會前一根收盤 = 100`;
}

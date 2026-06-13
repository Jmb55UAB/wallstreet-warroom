// Builds data.json from holdings.json + LIVE Yahoo Finance quotes.
// Runs in GitHub Actions (Node 20, global fetch). Equity positions are auto-priced;
// cash/buying_power/realized/options/closed/briefs are desk-set passthroughs.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const holdings = JSON.parse(fs.readFileSync(path.join(ROOT, 'holdings.json'), 'utf8'));

// previous data.json (for fallback if a quote fetch fails)
let prev = { positions: [] };
try { prev = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')); } catch (e) {}
const prevLast = {};
(prev.positions || []).forEach(p => { if (p.sym) prevLast[p.sym] = parseFloat(p.last); });

async function quote(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (warroom-desk-bot)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  const px = m && (m.regularMarketPrice ?? m.previousClose);
  if (!px) throw new Error('no price');
  return px;
}

function pctClass(pct) { return pct > 0.05 ? 'up' : (pct < -0.05 ? 'down' : 'flat'); }
function fmtPct(pct) {
  if (Math.abs(pct) < 0.05) return 'b/e';
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

(async () => {
  let equity = 0;
  const positions = [];
  for (const h of holdings.positions) {
    let last;
    try { last = await quote(h.sym); }
    catch (e) { last = prevLast[h.sym] || h.avg; console.error(`quote ${h.sym} failed (${e.message}); fallback ${last}`); }
    const value = h.qty * last;
    equity += value;
    const pct = (last / h.avg - 1) * 100;
    positions.push({
      t: h.sym, sym: h.sym,
      qty: Number(h.qty).toFixed(4),
      avg: Number(h.avg).toFixed(2),
      last: Number(last).toFixed(2),
      pl: fmtPct(pct), cls: pctClass(pct)
    });
  }

  // desk-set option rows (manual; not auto-priced)
  let optionsValue = 0;
  (holdings.options || []).forEach(o => {
    optionsValue += Number(o.value || 0);
    positions.push({ t: o.t, sym: o.sym, qty: o.qty, avg: o.avg, last: o.last, pl: o.pl, cls: o.cls, chain: !!o.chain });
  });

  const cash = Number(holdings.cash || 0);
  const total = equity + cash + optionsValue;
  const start = Number(holdings.start_capital || 500);
  const wk1pct = (total / start - 1) * 100;

  const now = new Date();
  const et = now.toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const data = {
    updated: `LIVE ${et} ET (auto)`,
    account: {
      value: total.toFixed(2),
      cash: cash.toFixed(2),
      bp: Number(holdings.buying_power || 0).toFixed(2),
      realized: holdings.realized || '',
      wk1: (wk1pct >= 0 ? '+' : '') + wk1pct.toFixed(1) + '%'
    },
    positions,
    closed: holdings.closed || [],
    briefs: holdings.briefs || []
  };

  fs.writeFileSync(path.join(ROOT, 'data.json'), JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote data.json: total $${total.toFixed(2)}, equity $${equity.toFixed(2)}, ${positions.length} rows`);
})();

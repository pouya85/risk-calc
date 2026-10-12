'use strict';

const STORE_KEY = 'riskcalc.v1';

const DEFAULT_ACCOUNTS = [
  { name: 'اکانت ۱', size: 100000, balance: 100000, todayPnl: 0, riskPct: 1, dailyPct: 5, maxDdPct: 10, enabled: true },
  { name: 'اکانت ۲', size: 100000, balance: 100000, todayPnl: 0, riskPct: 1, dailyPct: 5, maxDdPct: 10, enabled: true },
  { name: 'اکانت ۳', size: 50000,  balance: 50000,  todayPnl: 0, riskPct: 1, dailyPct: 5, maxDdPct: 10, enabled: true },
  { name: 'اکانت ۴', size: 50000,  balance: 50000,  todayPnl: 0, riskPct: 1, dailyPct: 5, maxDdPct: 10, enabled: true },
  { name: 'دمو',           size: 100000, balance: 100000, todayPnl: 0, riskPct: 1, dailyPct: 5, maxDdPct: 10, enabled: false },
];

const MAX_TRADES_PER_DAY = 2;
const MIN_RR = 2;

let state = load();

function defaults() {
  return {
    pair: 'EURUSD', spread: '', entry: '', sl: '', tp: '',
    tradesToday: 0, stopHit: false,
    accounts: structuredClone(DEFAULT_ACCOUNTS),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch (_) { /* حالت private یا storage بسته */ }
  return defaults();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
}

// ارقام فارسی/عربی و ممیز فارسی را به عدد لاتین تبدیل می‌کند
function latin(v) {
  return String(v)
    .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0)
    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660)
    .replace(/[٫,]/g, '.')
    .replace(/[−–]/g, '-')
    .replace(/\s/g, '');
}

function num(v) {
  if (v === null || v === undefined) return NaN;
  const s = latin(v);
  if (s === '' || s === '-' || s === '.') return NaN;
  return Number(s);
}

const pipSize = pair => pair.endsWith('JPY') ? 0.01 : 0.0001;

// ارزش هر پیپ برای ۱ لات استاندارد به دلار
function pipValuePerLot(pair, price) {
  if (pair.endsWith('USD')) return 10;
  if (pair.startsWith('USD')) return 100000 * pipSize(pair) / price;
  return 10;
}

const $ = id => document.getElementById(id);
const usd = v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fx = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '—';

function compute() {
  const pair = state.pair;
  const entry = num(state.entry), sl = num(state.sl), tp = num(state.tp);
  const spread = num(state.spread);
  const ps = pipSize(pair);
  const out = { warnings: [], valid: false };

  // گرد به ۰٫۱ پیپ (یک پیپت): 1.16240−1.16200 در float می‌شود 4.0000000004 و لات 24.99 درمی‌آمد
  const pips = d => Math.round(Math.abs(d) / ps * 10) / 10;

  if (!(entry > 0) || !(sl > 0) || pips(entry - sl) === 0) return out;

  out.valid = true;
  out.dir = sl < entry ? 'LONG' : 'SHORT';
  out.slPips = pips(entry - sl);
  out.pv = pipValuePerLot(pair, entry);

  if (tp > 0) {
    const rightSide = out.dir === 'LONG' ? tp > entry : tp < entry;
    if (rightSide) {
      out.tpPips = pips(tp - entry);
      out.rr = out.tpPips / out.slPips;
    } else {
      out.warnings.push(['bad', 'TP در سمت اشتباهِ Entry است — جهت معامله را چک کن']);
    }
  }

  if (out.rr !== undefined && out.rr < MIN_RR)
    out.warnings.push(['warn', `R:R کمتر از 1:${MIN_RR} است — ولی TP را برای عدد داخل مقاومت نکِش`]);
  if (spread > 1.5 && out.slPips < 3)
    out.warnings.push(['bad', `اسپرد ${fx(spread)} پیپ + SL زیر ۳ پیپ = خطرناک`]);
  if (out.slPips < 1)
    out.warnings.push(['warn', 'SL کمتر از ۱ پیپ — قیمت‌ها را دوباره چک کن']);
  if (out.slPips > 150)
    out.warnings.push(['warn', 'SL بیشتر از ۱۵۰ پیپ — قیمت‌ها را دوباره چک کن']);

  out.accounts = state.accounts.filter(a => a.enabled).map(a => {
    const size = num(a.size) || 0;
    const balance = Number.isFinite(num(a.balance)) ? num(a.balance) : size;
    const todayPnl = num(a.todayPnl) || 0;
    const riskUsd = size * (num(a.riskPct) || 0) / 100;

    const lotRaw = riskUsd / (out.slPips * out.pv);
    const lot = Math.floor(lotRaw * 100 + 1e-9) / 100; // رو به پایین تا ریسک از سقف رد نشود
    const realRisk = lot * out.slPips * out.pv;
    const profit = out.tpPips ? lot * out.tpPips * out.pv : NaN;

    const dailyLeft = size * (num(a.dailyPct) || 0) / 100 + todayPnl;
    const ddLeft = balance - size * (1 - (num(a.maxDdPct) || 0) / 100);

    return {
      name: a.name, size, riskUsd, lot, realRisk, profit,
      profitPct: profit / size * 100,
      dailyLeft, dailyAfter: dailyLeft - realRisk,
      ddLeft, ddAfter: ddLeft - realRisk,
    };
  });

  // ⁨…⁩ نام لاتین اکانت را از متن فارسی جدا می‌کند تا # و : جابه‌جا نشوند
  for (const r of out.accounts) {
    const n = `⁨${r.name}⁩`;
    if (r.dailyAfter < 0) out.warnings.push(['bad', `${n}: استاپ این معامله از Daily Loss رد می‌شود`]);
    else if (r.ddAfter < 0) out.warnings.push(['bad', `${n}: استاپ این معامله از Max Drawdown رد می‌شود`]);
    if (r.lot <= 0) out.warnings.push(['warn', `${n}: لات کمتر از 0.01 می‌شود`]);
  }
  return out;
}

function render() {
  const r = compute();

  // بنر قوانین روز
  const banner = $('dayBanner');
  if (state.stopHit) {
    banner.textContent = '⛔ استاپ اول خورده — امروز تمام است.';
    banner.hidden = false;
  } else if (state.tradesToday >= MAX_TRADES_PER_DAY) {
    banner.textContent = `⛔ ${MAX_TRADES_PER_DAY} معاملهٔ امروز انجام شده — امروز تمام است.`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
  $('tradesToday').textContent = state.tradesToday;
  $('stopHit').checked = state.stopHit;

  // خلاصه
  const dir = $('sDir');
  dir.textContent = r.valid ? (r.dir === 'LONG' ? 'Buy ▲' : 'Sell ▼') : '—';
  dir.className = 'v ' + (r.valid ? r.dir.toLowerCase() : '');
  $('sSL').textContent = r.valid ? fx(r.slPips) : '—';
  $('sTP').textContent = r.tpPips ? fx(r.tpPips) : '—';
  const rr = $('sRR');
  rr.textContent = r.rr !== undefined ? '1:' + fx(r.rr, 2) : '—';
  rr.className = 'v ' + (r.rr === undefined ? '' : r.rr >= MIN_RR ? 'good' : 'bad');

  // هشدارها
  $('warnings').innerHTML = r.warnings.map(([cls, t]) => `<li class="${cls}">${esc(t)}</li>`).join('');

  // نتایج
  const box = $('results');
  if (!r.valid) {
    box.innerHTML = '<div class="empty">Entry و Stop Loss را وارد کن</div>';
    return;
  }
  if (!r.accounts.length) {
    box.innerHTML = '<div class="empty">هیچ اکانتی فعال نیست — از بخش «اکانت‌ها» روشن کن</div>';
    return;
  }
  box.innerHTML = r.accounts.map(a => `
    <div class="res ${a.dailyAfter < 0 || a.ddAfter < 0 ? 'breach' : ''}">
      <div class="resHead">
        <span class="name">${esc(a.name)}</span>
        <span class="lot">${a.lot.toFixed(2)} <small>lot</small></span>
      </div>
      <div class="kv">
        <div><span class="k">ریسک</span><span class="n bad">${usd(a.realRisk)}</span></div>
        <div><span class="k">سود اگر TP</span><span class="n good">${Number.isFinite(a.profit) ? usd(a.profit) : '—'}</span></div>
        <div><span class="k">Daily باقی</span><span class="n">${usd(a.dailyLeft)}</span></div>
        <div><span class="k">سود %</span><span class="n good">${Number.isFinite(a.profitPct) ? a.profitPct.toFixed(2) + '%' : '—'}</span></div>
        <div><span class="k">بعد از SL</span><span class="n ${a.dailyAfter < 0 ? 'bad' : ''}">${usd(a.dailyAfter)}</span></div>
        <div><span class="k">تا Max DD</span><span class="n ${a.ddAfter < 0 ? 'bad' : ''}">${usd(a.ddLeft)}</span></div>
      </div>
    </div>`).join('');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- اکانت‌ها ----------
function renderAccounts() {
  const wrap = $('accounts');
  const tpl = $('accTpl');
  wrap.innerHTML = '';
  state.accounts.forEach((acc, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      if (inp.type === 'checkbox') inp.checked = !!acc[f];
      else inp.value = acc[f] ?? '';
      inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
        acc[f] = inp.type === 'checkbox' ? inp.checked : inp.value;
        save(); render();
      });
    });
    node.querySelector('.del').addEventListener('click', () => {
      if (!confirm(`«${acc.name}» حذف شود؟`)) return;
      state.accounts.splice(i, 1);
      save(); renderAccounts(); render();
    });
    wrap.appendChild(node);
  });
}

// ---------- ورودی‌ها ----------
for (const id of ['pair', 'spread', 'entry', 'sl', 'tp']) {
  const el = $(id);
  el.value = state[id];
  el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    state[id] = el.value;
    save(); render();
  });
  // بعد از تایپ با کیبورد فارسی، ارقام را لاتین نشان بده
  if (el.tagName === 'INPUT') el.addEventListener('change', () => {
    el.value = state[id] = latin(el.value);
    save();
  });
}

$('clearTrade').addEventListener('click', () => {
  for (const id of ['entry', 'sl', 'tp']) { state[id] = ''; $(id).value = ''; }
  save(); render();
  $('entry').focus();
});

// محاسبه با هر تایپ زنده انجام می‌شود؛ این دکمه کیبورد را می‌بندد و به نتیجه می‌برد
$('calc').addEventListener('click', () => {
  const empty = ['entry', 'sl'].find(id => !(num(state[id]) > 0));
  if (empty) { $(empty).focus(); return; }
  document.activeElement?.blur();
  render();
  $('stats').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('tradesPlus').addEventListener('click', () => { state.tradesToday = Math.min(9, state.tradesToday + 1); save(); render(); });
$('tradesMinus').addEventListener('click', () => { state.tradesToday = Math.max(0, state.tradesToday - 1); save(); render(); });
$('stopHit').addEventListener('change', e => { state.stopHit = e.target.checked; save(); render(); });

$('newDay').addEventListener('click', () => {
  if (!confirm('روز جدید؟ P&L امروز همهٔ اکانت‌ها و شمارندهٔ معاملات صفر می‌شود.')) return;
  state.tradesToday = 0;
  state.stopHit = false;
  state.accounts.forEach(a => { a.todayPnl = 0; });
  save(); renderAccounts(); render();
});

$('addAcc').addEventListener('click', () => {
  state.accounts.push({ name: 'اکانت جدید', size: 100000, balance: 100000, todayPnl: 0, riskPct: 1, dailyPct: 5, maxDdPct: 10, enabled: true });
  save(); renderAccounts(); render();
});

$('resetAcc').addEventListener('click', () => {
  if (!confirm('همهٔ اکانت‌ها به حالت پیش‌فرض برگردند؟')) return;
  state.accounts = structuredClone(DEFAULT_ACCOUNTS);
  save(); renderAccounts(); render();
});

renderAccounts();
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => reg.update()).catch(() => {});
  // وقتی نسخهٔ جدید فعال شد، یک بار صفحه را تازه کن تا فایل‌های جدید بیایند
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
}

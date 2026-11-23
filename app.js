'use strict';

const STORE_KEY = 'riskcalc.v1';

// از داشبورد FundedNext، ۲۲ نوامبر ۲۰۲۶ — 2-Step: DLL 5%، Max 10%، هدف 8% (فاز ۲: 5%) | 1-Step: DLL 3%، Max 6%، هدف 10%
// ریسک از ۲۳ نوامبر با پلکان (ladder) است؛ riskPct فقط برای حالت «ثابت» (ladder: 'off')
// (مخزن عمومی است: شمارهٔ لاگین اینجا نیاید؛ اسم را داخل اپ عوض کن)
const DEFAULT_ACCOUNTS = [
  { name: '100K 2-Step #1', size: 100000, balance: 100000,   todayPnl: 0, riskPct: 0.75, dailyPct: 5, maxDdPct: 10, ladder: '2step', targetPct: 8,  enabled: true },
  { name: '100K 2-Step #2', size: 100000, balance: 100000,   todayPnl: 0, riskPct: 0.75, dailyPct: 5, maxDdPct: 10, ladder: '2step', targetPct: 8,  enabled: true },
  { name: '50K 2-Step',     size: 50000,  balance: 50000,    todayPnl: 0, riskPct: 0.75, dailyPct: 5, maxDdPct: 10, ladder: '2step', targetPct: 8,  enabled: true },
  { name: '50K 1-Step #1',  size: 50000,  balance: 49999.99, todayPnl: 0, riskPct: 0.5,  dailyPct: 3, maxDdPct: 6,  ladder: '1step', targetPct: 10, enabled: true },
  { name: '50K 1-Step #2',  size: 50000,  balance: 49999.15, todayPnl: 0, riskPct: 0.5,  dailyPct: 3, maxDdPct: 6,  ladder: '1step', targetPct: 10, enabled: true },
  { name: 'دمو',            size: 100000, balance: 100000,   todayPnl: 0, riskPct: 1,    dailyPct: 5, maxDdPct: 10, ladder: 'off',   targetPct: '', enabled: false, demo: true },
];
// هر بار لیست پیش‌فرض اکانت‌ها عوض شد، این را بالا ببر تا اپِ نصب‌شده هم لیست جدید را بگیرد
const ACCOUNTS_VERSION = 2;

const MAX_TRADES_PER_DAY = 2;
const MIN_RR = 2;

let state = load();

function defaults() {
  return {
    pair: 'EURUSD', spread: '', entry: '', sl: '', tp: '',
    tradesToday: 0, stopHit: false,
    accountsVersion: ACCOUNTS_VERSION,
    accounts: structuredClone(DEFAULT_ACCOUNTS),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return addLadderFields(migrateAccounts({ ...defaults(), accountsVersion: 0, ...JSON.parse(raw) }));
  } catch (_) { /* حالت private یا storage بسته */ }
  return defaults();
}

// اکانت‌های ذخیره‌شده قبل از پلکان (۲۳ نوامبر ۲۰۲۶) فیلد ladder ندارند. لیست و موجودی‌ها را دست نزن،
// فقط نوع پلکان را از حدهای خود اکانت حدس بزن. (function declaration است چون load() قبل از const‌های پایین اجرا می‌شود)
function addLadderFields(s) {
  for (const a of Array.isArray(s.accounts) ? s.accounts : []) {
    if (a.ladder !== undefined) continue;
    const demo = a.demo === true || /دمو|demo/i.test(a.name || '');
    const d = num(a.dailyPct), m = num(a.maxDdPct);
    a.ladder = demo ? 'off' : d === 3 && m === 6 ? '1step' : d === 5 && m === 10 ? '2step' : 'off';
    a.targetPct = a.ladder === '1step' ? 10 : a.ladder === '2step' ? 8 : '';
  }
  return s;
}

// لیست قدیمی اکانت‌ها را با لیست جدید عوض می‌کند؛ اکانت دمو (موجودی و روشن/خاموش) همان می‌ماند
function migrateAccounts(s) {
  if (s.accountsVersion === ACCOUNTS_VERSION) return s;
  const old = Array.isArray(s.accounts) ? s.accounts : [];
  const oldDemo = old.find(a => a.demo === true || /دمو|demo/i.test(a.name || ''));
  s.accounts = structuredClone(DEFAULT_ACCOUNTS).map(a => (a.demo && oldDemo ? { ...oldDemo, demo: true } : a));
  s.accountsVersion = ACCOUNTS_VERSION;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) {}
  return s;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
  window.RCSync?.changed();
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

const isDemoAccount = a => a.demo === true || /دمو|demo/i.test(a.name || '');

const PAIRS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'AUDUSD', 'NZDUSD', 'USDJPY', 'USDCAD', 'USDCHF'];
const isGold = pair => pair === 'XAUUSD';

// طلا: ۱ پیپ = 0.10 دلار حرکت قیمت، ۱ لات = ۱۰۰ اونس ← هر پیپ ۱۰ دلار در هر لات
const pipSize = pair => isGold(pair) ? 0.1 : pair.endsWith('JPY') ? 0.01 : 0.0001;

// ارزش هر پیپ برای ۱ لات استاندارد به دلار
function pipValuePerLot(pair, price) {
  if (pair.endsWith('USD')) return 10; // شامل XAUUSD: 100oz × 0.10
  if (pair.startsWith('USD')) return 100000 * pipSize(pair) / price;
  return 10;
}

// کمیسیون رفت‌وبرگشت هر لات به دلار، از مشخصات نماد در FundedNext (MT5)
// هر deal یک بار کمیسیون دارد، یعنی باز + بسته = ۲ بار
// XAUUSD: 0.0016% ارزش قرارداد (100oz × قیمت) · فارکس: 5 USD per lot
function commissionPerLot(pair, price) {
  if (isGold(pair)) return 2 * 0.000016 * 100 * price;
  return 2 * 5;
}

// حداکثر حجم هر سفارش در FundedNext
const maxVolume = pair => isGold(pair) ? 50 : 40;

// ---------- پلکان ریسک (CLAUDE.md، ۲۳ نوامبر ۲۰۲۶) ----------
// پله از سود/افت بستهٔ فاز = (موجودی − سایز اولیه) ÷ سایز. پلهٔ افت بر پلهٔ سود مقدم است.
const LADDERS = {
  '2step': { base: 0.75, up: [[3, 1]],              down: [[-2, 0.5], [-5, 0.33]] },
  '1step': { base: 0.5,  up: [[2, 0.75], [4, 1]],   down: [[-2, 0.33]] },
};
const LADDER_NAMES = { '2step': '⁦2-Step⁩', '1step': '⁦1-Step⁩' }; // بدون LRI در متن RTL «Step-2» می‌شد
const LADDER_MIN = 0.25;      // کف ریسک در خط پایان
const LADDER_CUSHION = 0.02;  // تا گرد شدن لات به پایین، برد آخر را کمی زیر هدف نگذارد
const ASSUMED_NET_RR = 2;     // وقتی TP وارد نشده

// LRI…PDI (نه FSI): رشتهٔ بدون حرف قوی مثل «+3%» داخل FSI در متن RTL به «%3+» برمی‌گشت
const ltr = s => `⁦${s}⁩`;
const pctTxt = v => ltr(`${v > 0 ? '+' : ''}${+v.toFixed(2)}%`);

// netRr: R:R خالص همین معامله (برای قانون خط پایان)؛ بدون TP فرض ۲R
function ladderStep(a, netRr) {
  const L = LADDERS[a.ladder];
  if (!L) return null;
  const size = num(a.size) || 0;
  const balance = Number.isFinite(num(a.balance)) ? num(a.balance) : size;
  const pnl = size ? (balance - size) / size * 100 : 0;
  let pct = L.base, label = 'شروع';
  for (const [th, r] of L.up) if (pnl >= th) { pct = r; label = `سود ≥ ${pctTxt(th)}`; }
  for (const [th, r] of L.down) if (pnl <= th) { pct = r; label = `افت ≤ ${pctTxt(th)}`; }
  const target = num(a.targetPct);
  let done = false, trimmed = false;
  if (target > 0) {
    const need = target - pnl;
    const rr = netRr > 0 ? netRr : ASSUMED_NET_RR;
    if (need <= 0) {
      done = true; label = 'هدف رسیده ✓';
    } else if (need < pct * rr) {
      pct = Math.max(Math.min(need / rr + LADDER_CUSHION, pct), LADDER_MIN);
      trimmed = true; label += ' · خط پایان';
    }
  }
  return { pct, pnl, label, done, trimmed, target };
}

function stepText(a) {
  const s = ladderStep(a);
  if (!s) return `ریسک ثابت ${pctTxt(num(a.riskPct) || 0).replace('+', '')}`;
  return `پلکان ${LADDER_NAMES[a.ladder]} · سود فاز ${pctTxt(s.pnl)}`
    + (s.target > 0 ? ` از ${pctTxt(s.target).replace('+', '')}` : '')
    + ` · پله: ${s.label} · ریسک ${pctTxt(s.pct).replace('+', '')}`;
}

const $ = id => document.getElementById(id);
const usd = v => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fx = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '—';

// inp پیش‌فرض همان ورودی‌های تب ریسک است؛ ژورنال با قیمت‌های خودش صدا می‌زند
function compute(inp = state) {
  const pair = inp.pair;
  const entry = num(inp.entry), sl = num(inp.sl), tp = num(inp.tp);
  const spread = num(inp.spread);
  const ps = pipSize(pair);
  const out = { warnings: [], valid: false };

  // گرد به ۰٫۱ پیپ (یک پیپت): 1.16240−1.16200 در float می‌شود 4.0000000004 و لات 24.99 درمی‌آمد
  const pips = d => Math.round(Math.abs(d) / ps * 10) / 10;

  if (!(entry > 0) || !(sl > 0) || pips(entry - sl) === 0) return out;

  out.valid = true;
  out.dir = sl < entry ? 'LONG' : 'SHORT';
  out.slPips = pips(entry - sl);
  out.pv = pipValuePerLot(pair, entry);
  out.comm = commissionPerLot(pair, entry);

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
  const gold = isGold(pair);
  if (!gold && spread > 1.5 && out.slPips < 3)
    out.warnings.push(['bad', `اسپرد ${fx(spread)} پیپ + SL زیر ۳ پیپ = خطرناک`]);
  if (gold && spread > 0 && spread >= out.slPips * 0.15)
    out.warnings.push(['bad', `اسپرد ${fx(spread)} پیپ بیشتر از ۱۵٪ SL است = خطرناک`]);
  const [minSl, maxSl] = gold ? [5, 1000] : [1, 150];
  if (out.slPips < minSl)
    out.warnings.push(['warn', `SL کمتر از ${minSl} پیپ — قیمت‌ها را دوباره چک کن`]);
  if (out.slPips > maxSl)
    out.warnings.push(['warn', `SL بیشتر از ${maxSl} پیپ — قیمت‌ها را دوباره چک کن`]);

  out.netRr = out.tpPips ? (out.tpPips * out.pv - out.comm) / (out.slPips * out.pv + out.comm) : undefined;

  out.accounts = state.accounts.map((a, idx) => [a, idx]).filter(([a]) => a.enabled).map(([a, idx]) => {
    const size = num(a.size) || 0;
    const balance = Number.isFinite(num(a.balance)) ? num(a.balance) : size;
    const todayPnl = num(a.todayPnl) || 0;
    const step = ladderStep(a, out.netRr);
    const riskPct = step ? step.pct : (num(a.riskPct) || 0);
    const riskUsd = size * riskPct / 100;

    // کمیسیون جزو ریسک است تا ضرر واقعی در SL از سقف ۱٪ رد نشود
    const lotRaw = riskUsd / (out.slPips * out.pv + out.comm);
    // رو به پایین تا ریسک از سقف رد نشود · هدف رسیده = فقط 0.01 برای پر کردن حداقل روزها
    const lot = step?.done ? 0.01 : Math.floor(lotRaw * 100 + 1e-9) / 100;
    const realRisk = lot * (out.slPips * out.pv + out.comm);
    const profit = out.tpPips ? lot * (out.tpPips * out.pv - out.comm) : NaN;

    const dailyLeft = size * (num(a.dailyPct) || 0) / 100 + todayPnl;
    const ddLeft = balance - size * (1 - (num(a.maxDdPct) || 0) / 100);

    return {
      idx, name: a.name, demo: isDemoAccount(a), size, riskPct, step, riskUsd, lot, realRisk, profit,
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
    if (r.step?.done) out.warnings.push(['info', `${n}: هدف رسیده — اگر روز حداقل مانده، فقط 0.01 لات باز کن`]);
    else if (r.lot <= 0) out.warnings.push(['warn', `${n}: لات کمتر از 0.01 می‌شود`]);
    const maxVol = maxVolume(pair);
    if (r.lot > maxVol) out.warnings.push(['warn', `${n}: لات بیشتر از حداکثر هر سفارش (${maxVol}) — در ${Math.ceil(r.lot / maxVol)} سفارش باز کن`]);
  }
  if (out.comm > 0) {
    out.warnings.push(['info', `ریسک و سود شامل کمیسیون رفت‌وبرگشت است: ~$${out.comm.toFixed(2)} در هر لات`
      + (out.netRr !== undefined ? ` · R:R خالص بعد از کمیسیون: 1:${out.netRr.toFixed(2)}` : '')]);
  }
  return out;
}

function render() {
  const r = compute();
  $('toJournal').hidden = !(r.valid && r.accounts.length);
  $('goldNote').hidden = !isGold(state.pair);

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
      <div class="step">${a.step
        ? `پله: ${a.step.label} · سود فاز ${pctTxt(a.step.pnl)} · `
          + (a.step.done ? `فقط ${ltr('0.01')} لات` : `ریسک ${pctTxt(a.riskPct).replace('+', '')}`)
        : `ریسک ثابت ${pctTxt(a.riskPct).replace('+', '')}`}</div>
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
    const stepEl = node.querySelector('.accStep');
    const updStep = () => { stepEl.textContent = stepText(acc); };
    node.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      if (inp.type === 'checkbox') inp.checked = !!acc[f];
      else inp.value = acc[f] ?? '';
      inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
        acc[f] = inp.type === 'checkbox' ? inp.checked : inp.value;
        save(); render(); updStep();
      });
    });
    updStep();
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
  state.accounts.push({ name: 'اکانت جدید', size: 100000, balance: 100000, todayPnl: 0, riskPct: 1, dailyPct: 5, maxDdPct: 10, ladder: 'off', targetPct: '', enabled: true });
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

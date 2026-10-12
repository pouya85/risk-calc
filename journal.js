'use strict';

// ---------- ژورنال ترید ----------
const J_KEY = 'riskcalc.journal.v1';
const BACKUP_KEY = 'riskcalc.lastBackup';

// چک‌لیست ۷ موردی CLAUDE.md — ۵ و بالاتر = سِتاپ معتبر
const CHECKS = [
  'HTF Bias همسو (Daily / 4H)',
  'داخل Killzone',
  'BSL / SSL سوییپ شده',
  'Displacement قوی',
  'FVG یا OB مشخص',
  'SL پشت سوییپ واقعی (از OHLCV)',
  'R:R حداقل 1:2',
];
const MIN_SCORE = 5;
const SL_REASONS = ['SL', 'Entry', 'Bias', 'Timing', 'سِتاپ نامعتبر بود'];
const RESULT_LABEL = { tp: 'TP', sl: 'SL', be: 'سربه‌سر', manual: 'بستن دستی' };
const OUT_KZ = 'خارج از Killzone';

let journal = jLoad();
let jView = 'list', jType = 'all', jPeriod = 'all';
let openId = null;
let draftClose = null; // { result, exit, preview, accUsd, apply }

function jLoad() {
  try { const r = localStorage.getItem(J_KEY); if (r) return JSON.parse(r); } catch (_) {}
  return [];
}
function jSave() {
  try { localStorage.setItem(J_KEY, JSON.stringify(journal)); } catch (_) {}
}

const round2 = v => Math.round(v * 100) / 100;
const score = tr => tr.checks.filter(Boolean).length;
const signed = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const usdSigned = v => (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const resClass = r => r > 0.001 ? 'win' : r < -0.001 ? 'loss' : 'be';
const tradeById = id => journal.find(t => t.id === id);

function killzoneAt(t) {
  const w = windows(t).find(w => w.start <= t && t < w.end);
  return w ? w.name : OUT_KZ;
}

function toLocalInput(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// قیمت‌ها → پیپ، R:R و لات هر اکانت (همان محاسبهٔ تب ریسک)
function applyCalc(tr) {
  const r = compute({ pair: tr.pair, entry: tr.entry, sl: tr.sl, tp: tr.tp, spread: '' });
  if (!r.valid) { tr.slPips = null; return false; }
  tr.dir = r.dir;
  tr.slPips = r.slPips;
  tr.tpPips = r.tpPips ?? null;
  tr.rr = r.rr ?? null;
  tr.pv = r.pv;
  tr.accounts = r.accounts.map(a => ({ idx: a.idx, name: a.name, demo: a.demo, lot: a.lot, risk: round2(a.realRisk) }));
  return true;
}

function newTrade(inp, t = Date.now()) {
  const tr = {
    id: t.toString(36) + Math.random().toString(36).slice(2, 6),
    t, kz: killzoneAt(t),
    pair: inp.pair || 'EURUSD', entry: inp.entry || '', sl: inp.sl || '', tp: inp.tp || '',
    dir: null, slPips: null, tpPips: null, rr: null, pv: 10, accounts: [],
    status: 'open', checks: CHECKS.map(() => false),
    review: { reasons: [], tpEarly: null, nextLevel: '', rules: null, notes: '' },
  };
  applyCalc(tr);
  tr.checks[1] = tr.kz !== OUT_KZ;
  tr.checks[6] = (tr.rr || 0) >= 2;
  tr.demo = tr.accounts.length > 0 && tr.accounts.every(a => a.demo);
  return tr;
}

// ---------- لیست ----------
function jRender() {
  document.querySelectorAll('#jTabs button').forEach(b => b.classList.toggle('active', b.dataset.jv === jView));
  $('jListView').hidden = jView !== 'list';
  $('jStatsView').hidden = jView !== 'stats';
  if (jView === 'list') renderList(); else renderStats();
  renderBackupInfo();
}

function renderList() {
  const list = [...journal].sort((a, b) => b.t - a.t);
  if (!list.length) {
    $('jList').innerHTML = '<div class="empty">هنوز معامله‌ای ثبت نشده.<br>در تب ریسک بعد از وارد کردن قیمت‌ها «📓 ثبت در ژورنال» را بزن.</div>';
    return;
  }
  $('jList').innerHTML = list.map(tr => {
    const sc = score(tr);
    const res = tr.status === 'open'
      ? '<span class="jRes open">باز</span>'
      : `<span class="jRes ${resClass(tr.r)}">${signed(tr.r)}R</span>`;
    const dirTxt = tr.dir === 'LONG' ? '<span class="long">Buy ▲</span>' : tr.dir === 'SHORT' ? '<span class="short">Sell ▼</span>' : '';
    return `
      <button type="button" class="jItem" data-id="${tr.id}">
        <div class="jTop"><span class="jPair">${esc(tr.pair)} ${dirTxt}</span>${res}</div>
        <div class="jMeta">
          <span>${faDate(tr.t, { weekday: 'short', day: 'numeric', month: 'short' })} · ${hm(tr.t)}</span>
          <span>${esc(tr.kz)}</span>
          <span>${tr.demo ? 'دمو' : 'چلنج'}</span>
          <span class="score ${sc >= MIN_SCORE ? 'ok' : 'low'}">✓ ${sc}/7</span>
        </div>
      </button>`;
  }).join('');
}

// ---------- برگهٔ جزئیات ----------
function openSheet(id) {
  openId = id;
  draftClose = null;
  $('sheet').hidden = false;
  document.body.classList.add('noscroll');
  renderSheet();
  $('sheet').scrollTop = 0;
}

function closeSheet() {
  const tr = tradeById(openId);
  // معاملهٔ دستی که قیمت معتبر نگرفت ذخیره نشود
  if (tr && tr.status === 'open' && !tr.slPips) journal = journal.filter(t => t !== tr);
  jSave();
  openId = null;
  draftClose = null;
  $('sheet').hidden = true;
  document.body.classList.remove('noscroll');
  jRender();
}

function renderSheet() {
  const tr = tradeById(openId);
  if (!tr) { closeSheet(); return; }
  const closed = tr.status === 'closed';
  const dis = closed ? 'disabled' : '';
  const pairs = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDJPY', 'USDCAD', 'USDCHF'];
  $('sheetTitle').textContent = closed ? 'معاملهٔ بسته' : 'معاملهٔ باز';

  let h = `
  <section class="card">
    <div class="row2">
      <label>جفت‌ارز
        <select data-f="pair" ${dis}>${pairs.map(p => `<option ${p === tr.pair ? 'selected' : ''}>${p}</option>`).join('')}</select>
      </label>
      <label>زمان ورود
        <input type="datetime-local" data-f="t" value="${toLocalInput(tr.t)}" ${dis}>
      </label>
    </div>
    <label>Entry<input data-f="entry" class="price" inputmode="decimal" value="${esc(tr.entry)}" placeholder="قیمت ورود" ${dis}></label>
    <div class="row2">
      <label>Stop Loss<input data-f="sl" class="price" inputmode="decimal" value="${esc(tr.sl)}" placeholder="قیمت استاپ" ${dis}></label>
      <label>Take Profit<input data-f="tp" class="price" inputmode="decimal" value="${esc(tr.tp)}" placeholder="قیمت تارگت" ${dis}></label>
    </div>
    <div id="sDerived"></div>
    <div class="seg small">
      <button type="button" data-act="demo" data-v="0" class="${!tr.demo ? 'active' : ''}">چلنج</button>
      <button type="button" data-act="demo" data-v="1" class="${tr.demo ? 'active' : ''}">دمو</button>
    </div>
  </section>

  <section class="card">
    <h2>چک‌لیست <span id="sScore" class="score"></span></h2>
    <div class="checks">
      ${CHECKS.map((c, i) => `<button type="button" class="chk ${tr.checks[i] ? 'on' : ''}" data-act="check" data-i="${i}"><span class="box">${tr.checks[i] ? '✓' : ''}</span>${c}</button>`).join('')}
    </div>
    <div id="sScoreWarn"></div>
  </section>`;

  if (!closed) {
    const cur = draftClose?.result;
    h += `
  <section class="card">
    <h2>نتیجه</h2>
    <p class="hint">وقتی معامله بسته شد، نتیجه را انتخاب کن.</p>
    <div class="seg">
      ${Object.entries(RESULT_LABEL).map(([k, v]) => `<button type="button" data-act="result" data-v="${k}" class="${cur === k ? 'active' : ''}">${v}</button>`).join('')}
    </div>
    <label id="exitWrap" ${cur === 'manual' ? '' : 'hidden'}>قیمت خروج<input data-f="exit" class="price" inputmode="decimal" value="${esc(draftClose?.exit || '')}"></label>
    <div id="sClosePrev"></div>
  </section>`;
  } else {
    h += `
  <section class="card">
    <h2>نتیجه: ${RESULT_LABEL[tr.result]}</h2>
    <div class="kpis">
      <div><span class="k">R</span><span class="v ${resClass(tr.r)}">${signed(tr.r)}</span></div>
      <div><span class="k">پیپ</span><span class="v ${resClass(tr.r)}">${signed(tr.pips, 1)}</span></div>
      <div><span class="k">دلار</span><span class="v ${resClass(tr.r)}">${usdSigned(tr.usd)}</span></div>
    </div>
    <ul class="accList">${tr.accounts.map((a, i) => `<li><span>${esc(a.name)}</span><span class="n">${a.lot.toFixed(2)} lot · ${usdSigned(tr.accUsd[i] || 0)}</span></li>`).join('')}</ul>
    <p class="hint">خروج ${esc(String(tr.exit))}${tr.applied ? ' · روی موجودی اکانت‌ها اعمال شد' : ''}</p>
    <button type="button" class="ghost" data-act="reopen">بازگشایی معامله${tr.applied ? ' (P&amp;L برگردانده می‌شود)' : ''}</button>
  </section>

  <section class="card">
    <h2>بررسی بعد از معامله</h2>`;
    if (tr.r < -0.001) {
      h += `<span class="lbl">اشکال کجا بود؟</span>
      <div class="chips">${SL_REASONS.map(x => `<button type="button" class="chip ${tr.review.reasons.includes(x) ? 'on' : ''}" data-act="reason" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
    }
    if (tr.result === 'tp') {
      h += `<span class="lbl">TP زود بود؟</span>
      <div class="seg small">
        <button type="button" data-act="tpEarly" data-v="1" class="${tr.review.tpEarly === true ? 'active' : ''}">بله</button>
        <button type="button" data-act="tpEarly" data-v="0" class="${tr.review.tpEarly === false ? 'active' : ''}">نه</button>
      </div>
      <label>سطح نقدینگی بعدی<input data-f="nextLevel" value="${esc(tr.review.nextLevel)}" inputmode="decimal" placeholder="مثلاً BSL بعدی"></label>`;
    }
    h += `<span class="lbl">قوانین رعایت شد؟</span>
      <div class="seg small">
        <button type="button" data-act="rules" data-v="1" class="${tr.review.rules === true ? 'active' : ''}">بله</button>
        <button type="button" data-act="rules" data-v="0" class="${tr.review.rules === false ? 'active' : ''}">نه</button>
      </div>
  </section>`;
  }

  h += `
  <section class="card">
    <label>یادداشت<textarea data-f="notes" rows="3" placeholder="هر چیزی که باید یادت بماند">${esc(tr.review.notes)}</textarea></label>
  </section>
  <button type="button" class="ghost danger" data-act="delete">حذف معامله</button>`;

  $('sheetBody').innerHTML = h;
  renderDerived();
  renderScore();
  if (!closed) renderClosePreview();
}

function renderDerived() {
  const tr = tradeById(openId);
  if (!tr) return;
  if (!tr.slPips) {
    $('sDerived').innerHTML = '<div class="empty">Entry و Stop Loss را وارد کن</div>';
    return;
  }
  $('sDerived').innerHTML = `
    <div class="kpis">
      <div><span class="k">جهت</span><span class="v ${tr.dir === 'LONG' ? 'long' : 'short'}">${tr.dir === 'LONG' ? 'Buy ▲' : 'Sell ▼'}</span></div>
      <div><span class="k">SL / TP</span><span class="v">${fx(tr.slPips)} / ${tr.tpPips ? fx(tr.tpPips) : '—'}</span></div>
      <div><span class="k">R:R</span><span class="v ${tr.rr >= 2 ? 'good' : tr.rr ? 'bad' : ''}">${tr.rr ? '1:' + tr.rr.toFixed(2) : '—'}</span></div>
    </div>
    <p class="hint">${esc(tr.kz)} · ${tr.accounts.length ? tr.accounts.map(a => `${esc(a.name)} ${a.lot.toFixed(2)}`).join(' · ') : 'اکانت فعالی نیست'}</p>`;
}

function renderScore() {
  const tr = tradeById(openId);
  const sc = score(tr);
  $('sScore').textContent = `${sc}/7`;
  $('sScore').className = 'score ' + (sc >= MIN_SCORE ? 'ok' : 'low');
  $('sScoreWarn').innerHTML = sc < MIN_SCORE
    ? '<ul class="warnings"><li class="warn">صبر کن، سِتاپ کامل نیست (۴ مورد یا کمتر)</li></ul>'
    : '';
}

function closeCalc(tr, result, exitStr) {
  const entry = num(tr.entry);
  const exit = result === 'tp' ? num(tr.tp) : result === 'sl' ? num(tr.sl) : result === 'be' ? entry : num(exitStr);
  if (!(exit > 0) || !tr.slPips) return null;
  const diff = tr.dir === 'LONG' ? exit - entry : entry - exit;
  const pips = Math.round(diff / pipSize(tr.pair) * 10) / 10;
  return {
    // رشتهٔ اصلی را نگه دار تا صفرهای آخر (1.16240) نیفتند
    exit: { tp: tr.tp, sl: tr.sl, be: tr.entry }[result] || latin(exitStr),
    pips,
    r: round2(pips / tr.slPips),
    accUsd: tr.accounts.map(a => round2(a.lot * pips * tr.pv)),
  };
}

function renderClosePreview() {
  const tr = tradeById(openId);
  const box = $('sClosePrev');
  if (!draftClose) { box.innerHTML = ''; return; }
  const p = closeCalc(tr, draftClose.result, draftClose.exit);
  draftClose.preview = p;
  if (!p) {
    box.innerHTML = `<div class="empty">${draftClose.result === 'tp' ? 'TP وارد نشده' : 'قیمت خروج را وارد کن'}</div>`;
    return;
  }
  draftClose.accUsd = p.accUsd.slice();
  box.innerHTML = `
    <div class="kpis">
      <div><span class="k">R</span><span class="v ${resClass(p.r)}">${signed(p.r)}</span></div>
      <div><span class="k">پیپ</span><span class="v ${resClass(p.r)}">${signed(p.pips, 1)}</span></div>
      <div><span class="k">خروج</span><span class="v">${p.exit}</span></div>
    </div>
    ${tr.accounts.length ? `<span class="lbl">سود/زیان هر اکانت (اگر کمیسیون یا اسلیپیج داشتی اصلاح کن)</span>
    <div class="accEdit">${tr.accounts.map((a, i) => `<label>${esc(a.name)}<input data-f="accUsd" data-i="${i}" inputmode="decimal" value="${p.accUsd[i]}"></label>`).join('')}</div>
    <label class="switch"><input type="checkbox" data-f="apply" checked><span>به P&amp;L امروز و موجودی اکانت‌ها اضافه شود</span></label>` : ''}
    <p class="hint">با ثبت: شمارندهٔ معاملات امروز +۱${p.r < 0 ? ' و «استاپ خوردم» روشن می‌شود (روز تمام است)' : ''}.</p>
    <button type="button" class="primary big" data-act="confirmClose">ثبت نتیجه و بستن معامله</button>`;
  draftClose.apply = tr.accounts.length > 0;
}

function findAccount(a) {
  const byIdx = state.accounts[a.idx];
  if (byIdx && byIdx.name === a.name) return byIdx;
  return state.accounts.find(x => x.name === a.name);
}

function addPnl(tr, sign) {
  tr.accounts.forEach((a, i) => {
    const acc = findAccount(a);
    const v = sign * (tr.accUsd[i] || 0);
    if (!acc || !v) return;
    const bal = Number.isFinite(num(acc.balance)) ? num(acc.balance) : num(acc.size);
    acc.todayPnl = round2((num(acc.todayPnl) || 0) + v);
    acc.balance = round2(bal + v);
  });
}

function confirmClose() {
  const tr = tradeById(openId);
  const p = draftClose?.preview;
  if (!tr || !p) return;
  tr.status = 'closed';
  tr.result = draftClose.result;
  tr.exit = p.exit;
  tr.pips = p.pips;
  tr.r = p.r;
  tr.accUsd = tr.accounts.map((_, i) => round2(num(draftClose.accUsd[i]) || 0));
  tr.usd = round2(tr.accUsd.reduce((s, v) => s + v, 0));
  tr.closedAt = Date.now();
  tr.applied = !!draftClose.apply;
  if (tr.applied) addPnl(tr, 1);
  state.tradesToday = Math.min(9, state.tradesToday + 1);
  if (tr.r < 0) state.stopHit = true;
  draftClose = null;
  save(); renderAccounts(); render();
  jSave();
  renderSheet();
}

function reopen() {
  const tr = tradeById(openId);
  if (!confirm(tr.applied ? 'معامله باز شود؟ سود/زیانش از P&L امروز و موجودی اکانت‌ها کم می‌شود.' : 'معامله دوباره باز شود؟')) return;
  if (tr.applied) addPnl(tr, -1);
  state.tradesToday = Math.max(0, state.tradesToday - 1);
  tr.status = 'open';
  for (const k of ['result', 'exit', 'pips', 'r', 'accUsd', 'usd', 'closedAt', 'applied']) delete tr[k];
  save(); renderAccounts(); render();
  jSave();
  renderSheet();
}

// رویدادهای برگه
$('sheetClose').addEventListener('click', closeSheet);

$('sheetBody').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const tr = tradeById(openId);
  const v = b.dataset.v;
  switch (b.dataset.act) {
    case 'check':
      tr.checks[+b.dataset.i] = !tr.checks[+b.dataset.i];
      b.classList.toggle('on');
      b.querySelector('.box').textContent = tr.checks[+b.dataset.i] ? '✓' : '';
      renderScore();
      break;
    case 'demo':
      tr.demo = v === '1';
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      break;
    case 'result':
      draftClose = { result: v, exit: draftClose?.exit || '' };
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      $('exitWrap').hidden = v !== 'manual';
      renderClosePreview();
      break;
    case 'confirmClose': confirmClose(); break;
    case 'reopen': reopen(); break;
    case 'reason': {
      const rs = tr.review.reasons;
      const i = rs.indexOf(v);
      if (i >= 0) rs.splice(i, 1); else rs.push(v);
      b.classList.toggle('on');
      break;
    }
    case 'tpEarly':
    case 'rules':
      tr.review[b.dataset.act] = v === '1';
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      break;
    case 'delete':
      if (!confirm('این معامله حذف شود؟' + (tr.applied ? '\n(سود/زیانی که روی اکانت‌ها اعمال شده برنمی‌گردد)' : ''))) return;
      journal = journal.filter(t => t !== tr);
      openId = null;
      closeSheet();
      return;
  }
  jSave();
});

$('sheetBody').addEventListener('input', e => {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  const tr = tradeById(openId);
  const f = el.dataset.f;
  if (['pair', 'entry', 'sl', 'tp'].includes(f)) {
    tr[f] = el.value;
    applyCalc(tr);
    renderDerived();
    if (draftClose) renderClosePreview();
  } else if (f === 't') {
    const t = new Date(el.value).getTime();
    if (Number.isFinite(t)) { tr.t = t; tr.kz = killzoneAt(t); renderDerived(); }
  } else if (f === 'exit') {
    draftClose.exit = el.value;
    renderClosePreview();
    return;
  } else if (f === 'accUsd') {
    draftClose.accUsd[+el.dataset.i] = el.value;
    return;
  } else if (f === 'apply') {
    draftClose.apply = el.checked;
    return;
  } else if (f === 'notes' || f === 'nextLevel') {
    tr.review[f] = el.value;
  }
  jSave();
});
// select و datetime در iOS فقط change می‌فرستند
$('sheetBody').addEventListener('change', e => {
  if (e.target.matches('select, input[type="datetime-local"], input[type="checkbox"]'))
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
});

// ---------- آمار ----------
function filteredTrades() {
  const now = new Date();
  let from = 0;
  if (jPeriod === 'week') from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7).getTime();
  if (jPeriod === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return journal
    .filter(t => t.status === 'closed' && t.t >= from)
    .filter(t => jType === 'all' || (jType === 'demo') === !!t.demo)
    .sort((a, b) => a.t - b.t);
}

function metrics(list) {
  const wins = list.filter(t => t.r > 0.001), losses = list.filter(t => t.r < -0.001);
  const pos = wins.reduce((s, t) => s + t.r, 0), neg = losses.reduce((s, t) => s + t.r, 0);
  const totalR = list.reduce((s, t) => s + t.r, 0);
  let streakW = 0, streakL = 0, cw = 0, cl = 0;
  for (const t of list) {
    if (t.r > 0.001) { cw++; cl = 0; } else if (t.r < -0.001) { cl++; cw = 0; } else { cw = 0; cl = 0; }
    streakW = Math.max(streakW, cw); streakL = Math.max(streakL, cl);
  }
  return {
    n: list.length, wins: wins.length, losses: losses.length,
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) * 100 : null,
    totalR, avgR: list.length ? totalR / list.length : null,
    pf: neg ? pos / -neg : null,
    usd: list.reduce((s, t) => s + (t.usd || 0), 0),
    streakW, streakL,
  };
}

function groupTable(title, list, keyFn) {
  const groups = new Map();
  for (const t of list) {
    const k = keyFn(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  if (!groups.size) return '';
  const rows = [...groups.entries()].map(([k, l]) => [k, metrics(l)]).sort((a, b) => b[1].n - a[1].n);
  return `
  <section class="card">
    <h2>${title}</h2>
    <table class="tbl">
      <thead><tr><th></th><th>تعداد</th><th>Win%</th><th>جمع R</th></tr></thead>
      <tbody>${rows.map(([k, m]) => `<tr><td>${esc(k)}</td><td>${m.n}</td><td>${m.winRate === null ? '—' : m.winRate.toFixed(0) + '%'}</td><td class="${resClass(m.totalR)}">${signed(m.totalR, 1)}</td></tr>`).join('')}</tbody>
    </table>
  </section>`;
}

function renderStats() {
  const list = filteredTrades();
  const open = journal.filter(t => t.status === 'open').length;
  if (!list.length) {
    $('jStatsBody').innerHTML = `<div class="empty">در این بازه معاملهٔ بسته‌ای نیست${open ? ` (${open} معاملهٔ باز)` : ''}</div>`;
    return;
  }
  const m = metrics(list);
  const tile = (k, v, cls = '') => `<div><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  let h = `
  <section class="card">
    <div class="kpis k3">
      ${tile('معاملات', m.n)}
      ${tile('Win rate', m.winRate === null ? '—' : m.winRate.toFixed(0) + '%', m.winRate >= 50 ? 'good' : 'bad')}
      ${tile('جمع R', signed(m.totalR, 1), resClass(m.totalR))}
      ${tile('میانگین R', signed(m.avgR), resClass(m.avgR))}
      ${tile('Profit Factor', m.pf === null ? '—' : m.pf.toFixed(2), m.pf >= 1 ? 'good' : 'bad')}
      ${tile('دلار', usdSigned(m.usd), resClass(m.usd))}
      ${tile('برد / باخت', `${m.wins} / ${m.losses}`)}
      ${tile('بیشترین برد پیاپی', m.streakW)}
      ${tile('بیشترین باخت پیاپی', m.streakL)}
    </div>
    ${open ? `<p class="hint">${open} معاملهٔ باز در آمار حساب نشده.</p>` : ''}
  </section>`;

  h += groupTable('چک‌لیست: معتبر در برابر ناقص', list, t => score(t) >= MIN_SCORE ? 'معتبر (۵+ از ۷)' : 'ناقص (۴ یا کمتر)');
  h += groupTable('Killzone', list, t => t.kz);
  h += groupTable('جفت‌ارز', list, t => t.pair);
  h += groupTable('روز هفته', list, t => faDate(t.t, { weekday: 'long' }));
  h += groupTable('قوانین رعایت شد؟', list.filter(t => t.review.rules !== null), t => t.review.rules ? 'بله' : 'نه');

  // دلیل‌های استاپ
  const reasons = {};
  for (const t of list) for (const r of t.review.reasons || []) reasons[r] = (reasons[r] || 0) + 1;
  const rs = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  if (rs.length) h += `
  <section class="card">
    <h2>اشکال در معاملات ضررده</h2>
    <ul class="accList">${rs.map(([k, n]) => `<li><span>${esc(k)}</span><span class="n">${n}</span></li>`).join('')}</ul>
  </section>`;

  $('jStatsBody').innerHTML = h;
}

// ---------- پشتیبان ----------
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function markBackup() {
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (_) {}
  renderBackupInfo();
}

function renderBackupInfo() {
  let last = 0;
  try { last = +localStorage.getItem(BACKUP_KEY) || 0; } catch (_) {}
  const el = $('backupInfo');
  if (!journal.length) { el.textContent = 'اطلاعات فقط روی همین گوشی است. هر چند وقت یک بار خروجی بگیر.'; el.className = 'hint'; return; }
  const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  el.textContent = last === 0 ? '⚠️ هنوز پشتیبان نگرفته‌ای — اطلاعات فقط روی همین گوشی است.'
    : days === 0 ? 'آخرین پشتیبان: امروز' : `آخرین پشتیبان: ${days} روز پیش`;
  el.className = 'hint' + (last === 0 || days > 7 ? ' warnText' : '');
}

$('expJson').addEventListener('click', async () => {
  const data = { app: 'risk-calc', version: 1, exported: new Date().toISOString(), journal, state };
  if (await saveFile(`journal-${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json')) markBackup();
});

$('expCsv').addEventListener('click', async () => {
  const cols = ['date', 'time', 'killzone', 'type', 'pair', 'dir', 'entry', 'sl', 'tp', 'sl_pips', 'tp_pips', 'rr', 'score', 'status', 'result', 'exit', 'pips', 'r', 'usd', 'rules', 'sl_reasons', 'tp_early', 'next_level', 'notes'];
  const q = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [...journal].sort((a, b) => a.t - b.t).map(t => {
    const d = new Date(t.t);
    return [
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      t.kz, t.demo ? 'demo' : 'challenge', t.pair, t.dir, t.entry, t.sl, t.tp, t.slPips, t.tpPips, t.rr && t.rr.toFixed(2), score(t),
      t.status, t.result, t.exit, t.pips, t.r, t.usd,
      t.review.rules === null ? '' : t.review.rules ? 'yes' : 'no',
      (t.review.reasons || []).join(' | '),
      t.review.tpEarly === null ? '' : t.review.tpEarly ? 'yes' : 'no',
      t.review.nextLevel, t.review.notes,
    ].map(q).join(',');
  });
  // BOM تا Excel فارسی را درست نشان دهد
  if (await saveFile(`journal-${stamp()}.csv`, '﻿' + [cols.join(','), ...rows].join('\n'), 'text/csv')) markBackup();
});

$('impJson').addEventListener('click', () => $('impFile').click());
$('impFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.journal)) throw new Error('فایل ژورنال این اپ نیست');
    if (!confirm(`${data.journal.length} معامله${data.state ? ' و تنظیمات اکانت‌ها' : ''} جایگزین اطلاعات فعلی شود؟`)) return;
    localStorage.setItem(J_KEY, JSON.stringify(data.journal));
    if (data.state) localStorage.setItem(STORE_KEY, JSON.stringify(data.state));
    location.reload();
  } catch (err) {
    alert('بازگرداندن نشد: ' + err.message);
  }
});

// ---------- اتصال‌ها ----------
$('toJournal').addEventListener('click', () => {
  const inp = { pair: state.pair, entry: state.entry, sl: state.sl, tp: state.tp };
  const last = journal[journal.length - 1];
  if (last && last.pair === inp.pair && last.entry === inp.entry && last.sl === inp.sl && Date.now() - last.t < 30 * 60e3
      && !confirm('همین معامله چند دقیقه پیش ثبت شده. دوباره ثبت شود؟')) return;
  const tr = newTrade(inp);
  journal.push(tr);
  jSave();
  showView('journal');
  openSheet(tr.id);
});

$('jAdd').addEventListener('click', () => {
  const tr = newTrade({ pair: state.pair });
  journal.push(tr);
  openSheet(tr.id);
});

$('jList').addEventListener('click', e => {
  const b = e.target.closest('.jItem');
  if (b) openSheet(b.dataset.id);
});

document.querySelectorAll('#jTabs button').forEach(b => b.addEventListener('click', () => { jView = b.dataset.jv; jRender(); }));
for (const [id, set] of [['jType', v => { jType = v; }], ['jPeriod', v => { jPeriod = v; }]]) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset.v);
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    renderStats();
  });
}

if (!$('view-journal').hidden) jRender();

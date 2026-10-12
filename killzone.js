'use strict';

// ---------- تب‌ها ----------
const TAB_KEY = 'riskcalc.tab';

function showView(name) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  try { localStorage.setItem(TAB_KEY, name); } catch (_) {}
  window.scrollTo(0, 0);
  if (name === 'kz') kzTick();
}

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------- Killzone ----------
const LONDON = 'Europe/London';

// London روی ساعت لندن، NY AM روی ساعت نیویورک (08:30 = دیتای آمریکا)
const SESSIONS = [
  { name: 'London', tz: LONDON, start: [7, 0], end: [10, 0] },
  { name: 'NY AM', tz: 'America/New_York', start: [8, 30], end: [11, 0] },
];
const DEAD = { start: [10, 15], end: [11, 30] };           // وقت لندن
const HOT = [[13, 30], [15, 0], [15, 45]];                  // وقت لندن
const TL_FROM = 6, TL_TO = 18;                              // بازهٔ نوار زمانی

const fmtCache = {};
function parts(t, tz) {
  const f = fmtCache[tz] ||= new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o = {};
  for (const p of f.formatToParts(t)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

// اختلاف ساعت محلی tz با UTC (میلی‌ثانیه)
function tzOffset(t, tz) {
  const p = parts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

// ساعت دیواری در یک منطقهٔ زمانی ← لحظهٔ مطلق
function wall(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffset(guess, tz);
  const o2 = tzOffset(t, tz);
  if (guess - t !== o2) t = guess - o2;
  return t;
}

const pad = n => String(n).padStart(2, '0');
const hm = (t, tz = LONDON) => { const p = parts(t, tz); return `${pad(p.h)}:${pad(p.mi)}`; };
const faDate = (t, opts) => new Intl.DateTimeFormat('fa-IR-u-ca-gregory', { timeZone: LONDON, ...opts }).format(t);

function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

// پنجره‌های killzone از دیروز تا ۸ روز بعد (بدون شنبه و یکشنبه)
function windows(now) {
  const p = parts(now, LONDON);
  const out = [];
  for (let k = -1; k <= 8; k++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + k));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const [Y, M, D] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    for (const s of SESSIONS) {
      out.push({
        name: s.name, dayOffset: k,
        start: wall(Y, M, D, ...s.start, s.tz),
        end: wall(Y, M, D, ...s.end, s.tz),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function londonWall(now, h, mi, dayOffset = 0) {
  const p = parts(now, LONDON);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + dayOffset));
  return wall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, LONDON);
}

// اگر ساعت لندن تا ۱۴ روز آینده عوض می‌شود، روزش را پیدا کن
function upcomingDstChange(now) {
  const o0 = tzOffset(now, LONDON);
  for (let k = 1; k <= 14; k++) {
    const t = now + k * 864e5;
    const o = tzOffset(t, LONDON);
    if (o !== o0) return { at: t, toGmt: o < o0 };
  }
  return null;
}

const DAY = 864e5;

function kzTick() {
  if (document.getElementById('view-kz').hidden) return;
  const now = Date.now();
  const $k = id => document.getElementById(id);

  // ساعت
  $k('kzClock').textContent = (() => { const p = parts(now, LONDON); return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`; })();
  const isBst = tzOffset(now, LONDON) > 0;
  $k('kzTz').textContent = `London · ${isBst ? 'BST (GMT+1)' : 'GMT (GMT+0)'}`;
  $k('kzDate').textContent = faDate(now, { weekday: 'long', day: 'numeric', month: 'long' });

  const all = windows(now);
  const live = all.find(w => w.start <= now && now < w.end);
  const next = all.find(w => w.start > now);
  const today = all.filter(w => w.dayOffset === 0);
  const dow = new Date(londonWall(now, 12, 0)).getUTCDay();
  const weekend = dow === 0 || dow === 6;

  // وضعیت
  const box = $k('kzStatus');
  box.classList.toggle('live', !!live);
  $k('kzBarWrap').hidden = !live;
  if (live) {
    $k('kzState').textContent = `🟢 داخل Killzone ${live.name}`;
    $k('kzCountdown').textContent = countdown(live.end - now);
    $k('kzSub').textContent = `تا پایان · ${hm(live.end)}`;
    $k('kzBar').style.width = ((now - live.start) / (live.end - live.start) * 100).toFixed(1) + '%';
  } else if (next) {
    const when = next.dayOffset === 0 ? '' : ` (${faDate(next.start, { weekday: 'long' })})`;
    $k('kzState').textContent = weekend ? `🌙 آخر هفته — تا ${next.name}${when}` : `⏳ تا شروع ${next.name}${when}`;
    $k('kzCountdown').textContent = countdown(next.start - now);
    $k('kzSub').textContent = `${hm(next.start)} تا ${hm(next.end)} به وقت لندن`;
  }

  // هشدارها
  const alerts = [];
  if (typeof state !== 'undefined' && (state.stopHit || state.tradesToday >= MAX_TRADES_PER_DAY))
    alerts.push(['bad', '⛔ طبق قوانین امروز تمام است (از تب ریسک)']);
  const ny = today.find(w => w.name === 'NY AM');
  if (ny && hm(ny.start) !== '13:30')
    alerts.push(['warn', `⚠️ این هفته تغییر ساعت آمریکا و انگلیس هم‌زمان نیست: NY AM ساعت ${hm(ny.start)} لندن شروع می‌شود`]);
  const dst = upcomingDstChange(now);
  if (dst)
    alerts.push(['warn', `📌 ${faDate(dst.at, { weekday: 'long', day: 'numeric', month: 'long' })} ساعت لندن عوض می‌شود — تایم‌زون اندیکاتور TFO را از ${dst.toGmt ? 'GMT+1 به GMT+0' : 'GMT+0 به GMT+1'} عوض کن`]);
  $k('kzAlerts').innerHTML = alerts.map(([c, t]) => `<li class="${c}">${t}</li>`).join('');

  // نوار زمانی امروز
  const t0 = londonWall(now, TL_FROM, 0), t1 = londonWall(now, TL_TO, 0);
  const pos = t => ((t - t0) / (t1 - t0) * 100);
  const clampSpan = (a, b) => { const l = Math.max(0, pos(a)), r = Math.min(100, pos(b)); return r > l ? `left:${l}%;width:${r - l}%` : null; };
  let html = '';
  const dead = clampSpan(londonWall(now, ...DEAD.start), londonWall(now, ...DEAD.end));
  if (dead && !weekend) html += `<div class="dead" style="${dead}"></div>`;
  for (const w of today) {
    const st = clampSpan(w.start, w.end);
    if (st) html += `<div class="zone" style="${st}"><span>${w.name}</span></div>`;
  }
  if (!weekend) for (const [h, m] of HOT) {
    const x = pos(londonWall(now, h, m));
    if (x >= 0 && x <= 100) html += `<div class="hot" style="left:${x}%"></div>`;
  }
  const nx = pos(now);
  if (nx >= 0 && nx <= 100) html += `<div class="now" style="left:${nx}%"></div>`;
  $k('kzTimeline').innerHTML = html;

  // لیست امروز
  $k('kzList').innerHTML = weekend
    ? '<li><span>آخر هفته — killzone ندارد</span></li>'
    : today.map(w => {
        const tag = now >= w.end ? ['', 'تمام شد'] : now >= w.start ? ['live', 'فعال'] : w === next ? ['next', 'بعدی'] : ['', 'امروز'];
        return `<li><span>${w.name}</span><span class="t">${hm(w.start)}–${hm(w.end)}</span><span class="tag ${tag[0]}">${tag[1]}</span></li>`;
      }).join('');
}

// ---------- نوتیفیکیشن (Web Push) ----------
const VAPID_PUBLIC = 'BJ_ErLMi_3IORZHYJbhM1vves2060FVYwYccpzvA1-Hlj-6TiJyRTrZpoepQsCNjas_42UoOOSZ1IV5zP56jeYc';

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

async function pushRender() {
  const $p = id => document.getElementById(id);
  const msg = $p('pushMsg');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;

  $p('pushOn').hidden = true;
  $p('pushCodeBox').hidden = true;

  if (!supported) {
    msg.textContent = standalone
      ? 'این دستگاه از نوتیفیکیشن وب پشتیبانی نمی‌کند (iOS 16.4 یا جدیدتر لازم است).'
      : 'برای نوتیفیکیشن، اپ را از آیکون روی Home Screen باز کن، نه از Safari.';
    return;
  }
  if (Notification.permission === 'denied') {
    msg.textContent = 'اجازهٔ نوتیفیکیشن رد شده. از Settings ← Notifications ← اپ «ریسک» روشنش کن.';
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    msg.textContent = '✅ روی این گوشی فعال است.';
    $p('pushCode').value = JSON.stringify(sub);
    $p('pushCodeBox').hidden = false;
  } else {
    msg.textContent = '';
    $p('pushOn').hidden = false;
  }
}

document.getElementById('pushOn').addEventListener('click', async () => {
  const msg = document.getElementById('pushMsg');
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { pushRender(); return; }
    const reg = await navigator.serviceWorker.ready;
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC) });
    await pushRender();
  } catch (e) {
    msg.textContent = 'خطا: ' + e.message;
  }
});

document.getElementById('pushCopy').addEventListener('click', async e => {
  const ta = document.getElementById('pushCode');
  try { await navigator.clipboard.writeText(ta.value); }
  catch (_) { ta.select(); document.execCommand('copy'); }
  e.target.textContent = '✓ کپی شد';
  setTimeout(() => { e.target.textContent = 'کپی کد'; }, 2000);
});

document.getElementById('pushLocal').addEventListener('click', async () => {
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification('✅ تست روی گوشی', { body: 'اجازهٔ نوتیفیکیشن درست است.', icon: 'icons/icon-192.png', tag: 'kz-local' });
});

document.getElementById('pushOff').addEventListener('click', async () => {
  if (!confirm('نوتیفیکیشن روی این گوشی غیرفعال شود؟')) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  pushRender();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.tab) showView(e.data.tab); });
}
pushRender().catch(() => {});

setInterval(kzTick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) kzTick(); });

let startTab = 'risk';
try { startTab = localStorage.getItem(TAB_KEY) || 'risk'; } catch (_) {}
if (new URLSearchParams(location.search).get('tab') === 'kz') startTab = 'kz'; // از کلیک روی نوتیفیکیشن
showView(startTab === 'kz' ? 'kz' : 'risk');

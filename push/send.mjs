// فرستادن نوتیفیکیشن Killzone به گوشی — در GitHub Actions اجرا می‌شود
// cron گیت‌هاب UTC است و ممکن است چند دقیقه دیر شروع شود؛ برای همین زودتر
// اجرا می‌شویم و تا لحظهٔ دقیق صبر می‌کنیم. ساعت‌ها با تایم‌زون واقعی حساب
// می‌شوند تا تغییر ساعت تابستانی (و هفته‌های ناهم‌زمان آمریکا/انگلیس) درست باشد.
import webpush from 'web-push';

const VAPID_PUBLIC = 'BJ_ErLMi_3IORZHYJbhM1vves2060FVYwYccpzvA1-Hlj-6TiJyRTrZpoepQsCNjas_42UoOOSZ1IV5zP56jeYc';
const LEAD_MIN = 5; // چند دقیقه قبل از شروع
const LONDON = 'Europe/London';

const SESSIONS = {
  london: { name: 'London', tz: LONDON, start: [7, 0], end: [10, 0] },
  ny: { name: 'NY AM', tz: 'America/New_York', start: [8, 30], end: [11, 0] },
};

function parts(t, tz) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o = {};
  for (const p of f.formatToParts(t)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}
const tzOffset = (t, tz) => { const p = parts(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
function wall(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffset(guess, tz);
  const o2 = tzOffset(t, tz);
  if (guess - t !== o2) t = guess - o2;
  return t;
}
const pad = n => String(n).padStart(2, '0');
const hm = t => { const p = parts(t, LONDON); return `${pad(p.h)}:${pad(p.mi)}`; };
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

let subs;
try {
  subs = JSON.parse(process.env.PUSH_SUBSCRIPTIONS || '[]');
  if (!Array.isArray(subs)) subs = [subs];
} catch (e) {
  console.error('PUSH_SUBSCRIPTIONS is not valid JSON');
  process.exit(1);
}
if (!subs.length) { console.error('No subscriptions set'); process.exit(1); }

webpush.setVapidDetails('https://pouya85.github.io/risk-calc/', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY);

async function send(payload) {
  let failed = 0;
  for (const [i, sub] of subs.entries()) {
    try {
      const r = await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 600, urgency: 'high' });
      console.log(`sub ${i}: ${r.statusCode}`);
    } catch (e) {
      failed++;
      console.error(`sub ${i}: ${e.statusCode || ''} ${e.body || e.message}`);
      if (e.statusCode === 404 || e.statusCode === 410) console.error('  → subscription expired; re-enable notifications in the app');
    }
  }
  if (failed === subs.length) process.exit(1);
}

const mode = (process.env.MODE || 'test').trim();

if (mode === 'test') {
  await send({ title: '✅ تست نوتیفیکیشن', body: 'نوتیفیکیشن Killzone درست کار می‌کند.', tag: 'kz-test' });
  process.exit(0);
}

const s = SESSIONS[mode];
if (!s) { console.error('Unknown MODE: ' + mode); process.exit(1); }

const now = Date.now();
const p = parts(now, s.tz);
const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
if (dow === 0 || dow === 6) { console.log('Weekend, nothing to send'); process.exit(0); }

const start = wall(p.y, p.m, p.d, ...s.start, s.tz);
const end = wall(p.y, p.m, p.d, ...s.end, s.tz);
const alertAt = start - LEAD_MIN * 60e3;

if (now > start) { console.log(`Run started too late (${hm(now)} London, session started ${hm(start)})`); process.exit(0); }
console.log(`Waiting until ${hm(alertAt)} London (${Math.round((alertAt - now) / 60e3)} min)`);
await sleep(alertAt - Date.now());

await send({
  title: `⏰ ${LEAD_MIN} دقیقه تا Killzone ${s.name}`,
  body: `${hm(start)} تا ${hm(end)} به وقت لندن`,
  tag: 'kz-' + mode,
});

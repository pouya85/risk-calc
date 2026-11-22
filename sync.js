'use strict';

// ---------- همگام‌سازی با سرور (اختیاری) ----------
// اکانت‌ها و ژورنال روی سرور هم ذخیره می‌شوند تا گوشی و کامپیوتر یکی بمانند و با پاک شدن حافظهٔ Safari از دست نروند.
// کد اتصال = «آدرس#کلید» و فقط روی همین دستگاه می‌ماند — مخزن عمومی است، پس آدرس سرور در کد نیست.
// «تغییر نفرستاده» = هش فعلی داده‌ها با هش آخرین همگام‌سازی فرق دارد؛ پس بعد از reload یا import هم چیزی جا نمی‌ماند.
const SYNC_CFG = 'riskcalc.sync';
const SYNC_LOST = 'riskcalc.sync.lastLocal'; // نسخهٔ این دستگاه، اگر جایش نسخهٔ سرور آمد
const SYNC_TRANSIENT = ['pair', 'spread', 'entry', 'sl', 'tp']; // ورودی‌های لحظه‌ای تب ریسک همگام نمی‌شوند

window.RCSync = (() => {
  let cfg = readCfg();
  let timer = null, busy = false, again = false;
  let view = { s: 'idle', msg: '' };

  function readCfg() {
    try { const c = JSON.parse(localStorage.getItem(SYNC_CFG)); return c && c.url && c.key ? c : null; } catch (_) { return null; }
  }
  function writeCfg() {
    try { cfg ? localStorage.setItem(SYNC_CFG, JSON.stringify(cfg)) : localStorage.removeItem(SYNC_CFG); } catch (_) {}
  }

  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ':' + s.length;
  }

  function snapshot() {
    let st = {}, jr = [];
    try { st = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) {}
    try { jr = JSON.parse(localStorage.getItem(J_KEY)) || []; } catch (_) {}
    for (const k of SYNC_TRANSIENT) delete st[k];
    const body = { state: st, journal: jr };
    return { body, h: hash(JSON.stringify(body)) };
  }

  const device = () => /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Windows/.test(navigator.userAgent) ? 'Windows' : 'web';
  const fmtTime = at => at ? new Date(at * 1000).toLocaleString('fa-IR-u-ca-gregory', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  async function api(method, path, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const json = body ? JSON.stringify(body) : undefined;
    let res;
    try {
      res = await fetch(cfg.url + path, {
        method, cache: 'no-store', signal: ctl.signal,
        keepalive: !!json && json.length < 60000, // تا با رفتن به اپ دیگر هم ارسال تمام شود
        headers: json ? { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' } : { Authorization: 'Bearer ' + cfg.key },
        body: json,
      });
    } catch (_) {
      throw new Error(navigator.onLine === false ? 'اینترنت وصل نیست' : 'سرور در دسترس نیست');
    } finally { clearTimeout(t); }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401) throw new Error('کلید اشتباه است');
    if (res.status === 429) throw new Error('تلاش زیاد — ۱۰ دقیقه بعد دوباره');
    if (res.status === 409 && method === 'PUT' && data) return { status: 409, data };
    if (!res.ok || !data) throw new Error(`خطای سرور (${res.status})`);
    return { status: res.status, data };
  }

  function keepLocalCopy(snap) {
    try { localStorage.setItem(SYNC_LOST, JSON.stringify({ at: Date.now(), ...snap.body })); } catch (_) {}
  }

  // نسخهٔ سرور را روی این دستگاه می‌گذارد؛ ورودی‌های لحظه‌ای همین دستگاه می‌مانند
  function applyRemote(doc) {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (_) {}
    const st = { ...(doc.state || {}) };
    for (const k of SYNC_TRANSIENT) if (k in local) st[k] = local[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(st));
    localStorage.setItem(J_KEY, JSON.stringify(doc.journal || []));
    cfg.rev = doc.rev; cfg.at = doc.at; cfg.ok = Date.now(); cfg.h = snapshot().h;
    writeCfg();
    location.reload();
  }

  function done(r) {
    cfg.at = r.at || cfg.at; cfg.ok = Date.now();
    writeCfg();
    show('ok');
  }

  async function push(snap) {
    show('busy');
    const r = await api('PUT', '/api/data', { base: cfg.rev || 0, device: device(), ...snap.body });
    if (r.status === 409) return conflict(r.data, snap);
    cfg.rev = r.data.rev; cfg.h = snap.h;
    done(r.data);
    if (snapshot().h !== cfg.h) again = true; // در حین ارسال دوباره عوض شد
  }

  async function pull() {
    show('busy');
    const { data: r } = await api('GET', '/api/data?have=' + (cfg.rev || 0));
    if (r.rev === cfg.rev) return done(r);
    if (r.rev < cfg.rev || !r.state) { cfg.rev = r.rev; return push(snapshot()); } // سرور خالی شده → نسخهٔ این دستگاه
    applyRemote(r);
  }

  function conflict(remote, snap) {
    const msg = `این اطلاعات روی دستگاه دیگری هم عوض شده (${fmtTime(remote.at)}).\n\n`
      + 'OK = نسخهٔ همین دستگاه روی سرور برود\nCancel = نسخهٔ سرور روی این دستگاه بیاید';
    if (confirm(msg)) { cfg.rev = remote.rev; return push(snap); }
    keepLocalCopy(snap);
    applyRemote(remote);
  }

  async function sync() {
    if (!cfg) return;
    if (busy) { again = true; return; }
    busy = true;
    clearTimeout(timer);
    try {
      const snap = snapshot();
      if (snap.h !== cfg.h) await push(snap); else await pull();
    } catch (e) {
      show('err', e.message);
    } finally {
      busy = false;
      if (again) { again = false; timer = setTimeout(sync, 300); }
    }
  }

  function changed() {
    if (!cfg) return;
    clearTimeout(timer);
    timer = setTimeout(sync, 1500);
  }

  async function connect(code) {
    const m = String(code).trim().match(/^(https?:\/\/[^\s#]+)#([A-Za-z0-9_-]{20,})$/);
    if (!m) throw new Error('کد درست نیست — باید شبیه https://…#… باشد');
    cfg = { url: m[1].replace(/\/+$/, ''), key: m[2], rev: 0, h: '', at: 0 };
    let r;
    try { r = (await api('GET', '/api/data')).data; } catch (e) { cfg = null; throw e; }
    const snap = snapshot();
    if (!r.rev) { writeCfg(); return push(snap); } // سرور خالی است
    if (hash(JSON.stringify({ state: r.state, journal: r.journal })) === snap.h) {
      cfg.rev = r.rev; cfg.h = snap.h; return done(r);
    }
    if (confirm(`روی سرور اطلاعات هست: ${(r.journal || []).length} معامله، آخرین تغییر ${fmtTime(r.at)}.\n\nروی این دستگاه بیاید؟ (اکانت‌ها و ژورنال این دستگاه جایگزین می‌شوند)`)) {
      keepLocalCopy(snap);
      return applyRemote(r);
    }
    if (confirm('پس اطلاعات همین دستگاه جایگزین نسخهٔ سرور شود؟')) {
      cfg.rev = r.rev; writeCfg();
      return push(snap);
    }
    cfg = null;
    show('idle');
  }

  function disconnect() {
    cfg = null;
    writeCfg();
    show('idle');
  }

  // ---------- نمایش ----------
  function show(s, msg = '') {
    view = { s, msg };
    const info = $('syncInfo');
    if (!info) return;
    $('syncOff').hidden = !!cfg;
    $('syncOn').hidden = !cfg;
    let text = 'اکانت‌ها و ژورنال فقط روی همین دستگاه‌اند. با کد همگام‌سازی روی سرور هم ذخیره می‌شوند و گوشی و کامپیوتر یکی می‌مانند.';
    let cls = 'hint';
    if (cfg) {
      const last = cfg.ok ? new Date(cfg.ok).toLocaleTimeString('fa-IR-u-ca-gregory', { hour: '2-digit', minute: '2-digit' }) : '';
      if (s === 'busy') text = '⏳ در حال همگام‌سازی…';
      else if (s === 'err') { text = `⚠️ ${msg} — تغییرها روی همین دستگاه می‌ماند و بعداً فرستاده می‌شود.`; cls += ' warnText'; }
      else text = `✅ همگام${last ? ` · ${last}` : ''} · روی سرور هم ذخیره می‌شود`;
    }
    info.textContent = text;
    info.className = cls;
    if (typeof renderBackupInfo === 'function' && $('backupInfo')) renderBackupInfo();
  }

  $('syncConnect').addEventListener('click', async () => {
    const btn = $('syncConnect');
    btn.disabled = true;
    try {
      await connect($('syncCode').value);
      $('syncCode').value = '';
    } catch (e) {
      show('idle');
      alert('وصل نشد: ' + e.message);
    } finally { btn.disabled = false; }
  });
  $('syncNow').addEventListener('click', () => sync());
  $('syncOffBtn').addEventListener('click', () => {
    if (confirm('همگام‌سازی روی این دستگاه خاموش شود؟ اطلاعات روی این دستگاه و روی سرور می‌ماند.')) disconnect();
  });

  document.addEventListener('visibilitychange', () => { if (cfg) { if (document.hidden) { if (snapshot().h !== cfg.h) sync(); } else sync(); } });
  window.addEventListener('online', () => sync());
  setInterval(() => { if (cfg && !document.hidden) sync(); }, 60000);

  show('idle');
  if (cfg) sync();

  return { changed, sync, on: () => !!cfg };
})();

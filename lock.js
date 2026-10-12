'use strict';

// ---------- قفل Face ID (WebAuthn / Passkey روی خود گوشی) ----------
// امضا روی سرور چک نمی‌شود (اپ سرور ندارد)؛ هدف فقط این است که کسی که گوشیِ باز
// دستش است بدون Face ID یا رمز گوشی ژورنال و اکانت‌ها را نبیند.
const LOCK_KEY = 'riskcalc.lock';
const LOCK_AFTER_MS = 5 * 60e3; // بعد از ۵ دقیقه بیرون بودن دوباره قفل شود

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const rnd = n => crypto.getRandomValues(new Uint8Array(n));

function lockCfg() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY)); } catch (_) { return null; }
}

async function lockSupported() {
  return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
    && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
}

async function createCredential() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rnd(32),
      rp: { name: 'ابزار ترید', id: location.hostname },
      user: { id: rnd(16), name: 'risk-calc', displayName: 'قفل ابزار ترید' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
    },
  });
  localStorage.setItem(LOCK_KEY, JSON.stringify({ credId: b64u(cred.rawId), created: Date.now() }));
}

async function verify() {
  const cfg = lockCfg();
  await navigator.credentials.get({
    publicKey: {
      challenge: rnd(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64u(cfg.credId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
}

function showLock(on) {
  document.documentElement.classList.toggle('locked', on);
  $('lockScreen').hidden = !on;
}

$('unlockBtn').addEventListener('click', async () => {
  const msg = $('lockMsg');
  msg.textContent = '';
  try {
    await verify();
    showLock(false);
  } catch (e) {
    msg.textContent = e.name === 'NotAllowedError'
      ? 'باز نشد. دوباره امتحان کن.'
      : 'خطا: ' + e.message;
    $('relockBtn').hidden = false;
  }
});

// اگر Passkey پاک شده باشد: ساخت دوباره هم Face ID یا رمز گوشی می‌خواهد
$('relockBtn').addEventListener('click', async () => {
  try {
    await createCredential();
    showLock(false);
    lockRenderSettings();
  } catch (e) {
    $('lockMsg').textContent = 'ساخته نشد: ' + e.message;
  }
});

async function lockRenderSettings() {
  const t = $('lockToggle'), info = $('lockInfo');
  t.checked = !!lockCfg();
  if (!(await lockSupported())) {
    t.disabled = !t.checked;
    info.textContent = 'این دستگاه Face ID / Touch ID برای وب ندارد (روی آیفون از آیکون Home Screen باز کن).';
  } else {
    t.disabled = false;
    info.textContent = 'موقع باز کردن اپ و بعد از ۵ دقیقه بیرون بودن، Face ID می‌خواهد.';
  }
}

$('lockToggle').addEventListener('change', async e => {
  const t = e.target;
  try {
    if (t.checked) {
      await createCredential();
    } else {
      await verify(); // خاموش کردن هم Face ID می‌خواهد
      localStorage.removeItem(LOCK_KEY);
    }
  } catch (err) {
    t.checked = !t.checked;
    $('lockInfo').textContent = err.name === 'NotAllowedError' ? 'لغو شد.' : 'خطا: ' + err.message;
  }
});

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (!lockCfg()) return;
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) showLock(true);
});

showLock(!!lockCfg());
lockRenderSettings();

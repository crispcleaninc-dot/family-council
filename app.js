/* Family Council — app (runs in the browser; all data goes through the relay). */
(function () {
'use strict';

/* ============================ basics ============================ */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k) { try { return localStorage.getItem('fc_' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('fc_' + k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem('fc_' + k); } catch (e) {} }
};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const COLORS = ['#26386b', '#7a4f9a', '#1f6b3a', '#a3271f', '#8a5a00', '#1d4f91', '#6b2f6b', '#2f6f73'];
const colorFor = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const ago = t => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; };
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/* ============================ catalog ============================ */
const STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','Puerto Rico','Guam','U.S. Virgin Islands','American Samoa','Northern Mariana Islands','Outside the U.S.'];
const CATS = {
  chores: ['🧽', 'Chores'], siblings: ['👫', 'Siblings'], 'parent-child': ['👩‍👧', 'Parent & child'], relationship: ['💞', 'Relationship'],
  friends: ['🤝', 'Friends'], money: ['💵', 'Money'], respect: ['🙇', 'Respect'], 'screen-time': ['📱', 'Screen time'], school: ['🎒', 'School'], other: ['💬', 'Something else']
};
const GUIDES = {
  mother:      { e: '🤱', name: 'Mother', d: 'Warm and firm. Names feelings, then holds everyone to the standard.' },
  judge:       { e: '👩🏾‍⚖️', name: 'Judge Grace', d: 'Formal and fair. Keeps order and rules on what was shown.' },
  elder:       { e: '🧓🏾', name: 'The Elder', d: 'Wise and patient. Thinks about what matters a year from now.' },
  grandmother: { e: '👵🏾', name: 'Grandmother', d: 'Loving, funny, no-nonsense. Lets everyone save face.' },
  pastor:      { e: '✝️', name: 'Pastor', d: 'Grace and truth. Forgiveness with accountability. Scripture when faith mode is on.' },
  mediator:    { e: '🕊️', name: 'The Mediator', d: 'Neutral. Finds what each person needs and builds options.' }
};
const PHASES = [
  ['open', 'Opening', 'Court is called to order'],
  ['sides', 'Your side', 'Opening statements and testimony under oath'],
  ['responses', 'Responses', 'Rebuttal'],
  ['questions', 'Questions', 'Cross-examination'],
  ['proposals', 'Settle it', 'Settlement talks or mediation'],
  ['resolution', 'Sign', 'Judgment or court order'],
  ['followup', 'Keep it', 'Enforcement (contempt, fines)'],
  ['closed', 'Closed', 'Case closed']
];
const PHASE_HELP = {
  open: 'The guide opens the council and sets the rules. Everyone promises to follow the final resolution.',
  sides: 'Each person says their side once, with the talking stick. No answering back yet.',
  responses: 'Now each person can respond to what they heard. Start with what you agree with.',
  questions: 'The guide asks questions about anything unclear. Answer honestly and briefly.',
  proposals: 'Look at fair ways to settle it. Anyone can suggest one.',
  resolution: 'Read the promises. Each person signs. Once it is binding, everyone has to keep it.',
  followup: 'Check in: did you keep your promise? Kept promises build your streak.',
  closed: 'This council is closed.'
};
const KINDS = [['side', '🗣 My side'], ['response', '↩ Response'], ['apology', '💚 Apology'], ['answer', '✋ Answer'], ['question', '❓ Question'], ['proposal', '💡 Idea'], ['note', '📝 Note']];
const BADGES = {
  welcome: ['👋', 'Welcome', 'Joined Family Council'], first_council: ['🏛️', 'First council', 'Opened a council'],
  spoke_up: ['🗣️', 'Spoke up', 'Shared your side'], bridge: ['🌉', 'Bridge builder', 'Invited someone to settle it'],
  humble_heart: ['💚', 'Humble heart', 'Offered a real apology'], peacemaker: ['🕊️', 'Peacemaker', 'Reached a binding resolution'],
  promise_keeper: ['🤝', 'Promise keeper', 'Kept a promise at check-in']
};
const PROMPTS = [
  'Say one thing you appreciate about someone you disagreed with this week.',
  'Before you answer today, repeat back what you heard: "So you are saying..."',
  'Swap one "You always" for "I felt ___ when ___."',
  'A soft answer turneth away wrath. — Proverbs 15:1',
  'Pick one promise you made and keep it early today.',
  'Ask someone at home: "Is there anything I did that we need to talk about?"',
  'Facts, feelings, guesses: notice which one you are about to say.',
  'Lower your voice by half and see what happens.',
  'Thank someone for something they did without being asked.',
  'Apologize for something specific. No "but."',
  'Let someone finish their whole sentence before you speak.',
  'Be swift to hear, slow to speak, slow to wrath. — James 1:19',
  'Write down one thing you will do differently next time.',
  'Give someone the benefit of the doubt today.'
];
const HOME_VS_COURT = [
  ['Who decides', 'Your family, together, with the guide\'s help. Parents keep the final say on house rules for children.', 'A judge (sometimes a jury), using the law. Not how anyone feels.'],
  ['Feelings', 'Heard and respected. They matter here.', 'Feelings are not evidence. Courts decide on facts and law.'],
  ['Telling your side', 'Everyone gets a turn with the talking stick.', 'Testimony under oath. Lying under oath is perjury, a crime.'],
  ['Questions', 'The guide asks kind questions to understand.', 'The other side cross-examines you, following strict rules.'],
  ['Proof', 'What you can show and what everyone agrees happened.', 'Evidence must follow the rules of evidence. Most "he said she said" is weak.'],
  ['Who can bring it', 'Anyone in the family, any age.', 'You need a real legal claim. Children usually need a parent or guardian to bring a case for them.'],
  ['The result', 'A written resolution everyone signs.', 'A judgment or court order.'],
  ['If someone breaks it', 'The agreed consequence, a repair, and the council reopens.', 'Contempt of court: fines, wage garnishment, even jail.'],
  ['Appeals', 'One appeal to a different guide.', 'Appeal to a higher court for legal mistakes only, with short deadlines.'],
  ['Cost and time', 'Free. Tonight.', 'Filing fees, possibly lawyers. Weeks to years.'],
  ['Privacy', 'Stays in the family.', 'Most court records are public.'],
  ['The goal', 'Stay a family and fix the problem.', 'Decide who is legally right.']
];
const SAFETY_RX = /\b(kill (you|myself|me|him|her)|hurt (myself|me|you)|hit(s)? me|beat(s)? me|beating me|suicide|want to die|end it all|kill myself|touch(ed|es)? me|gun|knife|choke|choked|threaten(ed|s)?)\b/i;
const NAMECALL_RX = /\b(stupid|idiot|dumb|shut up|loser|ugly|liar|hate you|moron|worthless|pathetic|crazy|freak|bitch|ass|damn|hell)\b/i;
const ABSOLUTE_RX = /\b(you always|you never|every time you|you don'?t ever)\b/i;

/* ============================ state ============================ */
const S = {
  token: LS.get('token') || '', user: null, view: 'loading', disputes: [], board: [],
  cur: null, curId: '', tab: 'council', version: 0, speakAs: '', kind: 'side', draft: null, pollT: null,
  wizard: { title: '', category: 'chores', guide: 'mother', description: '', relation: '', guests: [] },
  pendingJoin: new URLSearchParams(location.search).get('join') || '', lastPoints: null, busy: {},
  speak: LS.get('speak') !== '0'
};
const fs = Number(LS.get('fs') || 17); document.documentElement.style.setProperty('--fs', fs + 'px');

/* ============================ relay ============================ */
function relayUrl() { return LS.get('relay') || (window.FC_CONFIG && window.FC_CONFIG.RELAY_URL) || ''; }
async function api(action, extra) {
  const url = relayUrl();
  if (!url) throw { code: 'no_relay', message: 'The app is not connected to its server yet. Open Me > Server.' };
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify(Object.assign({ action, token: S.token }, extra || {})) });
  } catch (e) { throw { code: 'offline', message: navigator.onLine ? 'Could not reach the server. Try again.' : 'You are offline.' }; }
  let o; try { o = await r.json(); } catch (e) { throw { code: 'bad_response', message: 'The server did not answer (HTTP ' + r.status + ').' }; }
  if (!o.ok) {
    if (o.error === 'signed_out') { signOutLocal(); }
    throw { code: o.error || 'error', message: o.message || o.error || 'Something went wrong.' };
  }
  return o;
}

/* ============================ ui helpers ============================ */
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
function sheet(html) { $('#sheetBody').innerHTML = '<div class="grab"></div>' + html; $('#sheet').classList.add('on'); }
function closeSheet() { $('#sheet').classList.remove('on'); }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + (label ? ' ' + esc(label) : ''); }
  else { btn.disabled = false; if (btn.dataset.l) btn.innerHTML = btn.dataset.l; }
}
function avatar(name, cls, extra) { return '<div class="avatar ' + (cls || '') + '" style="background:' + colorFor(name) + '">' + esc(initials(name)) + (extra || '') + '</div>'; }
function pointPop(n) { if (!n) return; const d = document.createElement('div'); d.className = 'pointpop'; d.textContent = '+' + n + ' 🕊 Peace Points'; document.body.appendChild(d); setTimeout(() => d.remove(), 1500); }
function confetti() {
  const c = $('#confetti'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const P = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .4, r: 4 + Math.random() * 6, c: ['#C9A961', '#1B2951', '#e6cf94', '#1f6b3a', '#fff'][Math.floor(Math.random() * 5)], vy: 2 + Math.random() * 3, vx: -1.5 + Math.random() * 3, a: Math.random() * 6 }));
  let f = 0;
  (function tick() {
    x.clearRect(0, 0, c.width, c.height);
    P.forEach(p => { p.y += p.vy; p.x += p.vx; p.a += .1; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); x.restore(); });
    if (++f < 200) requestAnimationFrame(tick); else x.clearRect(0, 0, c.width, c.height);
  })();
}
function setUser(u) {
  if (!u) return;
  const before = S.user ? S.user.points : null;
  S.user = u;
  $('#ptsChip').classList.remove('hidden'); $('#streakChip').classList.remove('hidden');
  $('#ptsVal').textContent = u.points; $('#streakVal').textContent = u.streak;
  if (before !== null && u.points > before) pointPop(u.points - before);
}
function safetyBox() {
  return '<div class="safety"><b>🛑 This needs a trusted adult or a professional now.</b>A family council is not the right place for hurting, threats, or danger. ' +
    'Emergency: <a href="tel:911">911</a>. Crisis (call or text): <a href="tel:988">988</a>. Domestic violence: <a href="tel:18007997233">1-800-799-7233</a>. Child abuse: <a href="tel:18004224453">1-800-422-4453</a>.</div>';
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); }
});
$('#aPlus').onclick = () => setFs(1); $('#aMinus').onclick = () => setFs(-1);
function setFs(d) { const v = Math.max(14, Math.min(24, Number(LS.get('fs') || 17) + d)); LS.set('fs', v); document.documentElement.style.setProperty('--fs', v + 'px'); }

/* ============================ router ============================ */
function go(view, id) {
  const ix = document.getElementById('interject'); if (ix) ix.classList.remove('on');
  stopPoll(); if (S.live && S.live.on && view !== 'council') stopLive();
  S.view = view; if (id !== undefined) S.curId = id;
  $$('#bnav button').forEach(b => b.classList.toggle('on', b.dataset.go === view));
  $('#bnav').classList.toggle('hidden', view === 'welcome' || view === 'loading');
  window.scrollTo(0, 0);
  render();
}
function render() {
  const v = $('#view');
  if (S.view === 'welcome') return renderWelcome(v);
  if (S.view === 'home') return renderHome(v);
  if (S.view === 'new') return renderNew(v);
  if (S.view === 'council') return renderCouncil(v);
  if (S.view === 'board') return renderBoard(v);
  if (S.view === 'learn') return renderLearn(v);
  if (S.view === 'me') return renderMe(v);
  v.innerHTML = '<div class="empty"><div class="big"><span class="typing"><i></i><i></i><i></i></span></div></div>';
}

/* ============================ welcome / auth ============================ */
let authMode = 'signin', signupStep = 1;
function stateOptions(sel) { return '<option value="">Choose your state</option>' + STATES.map(s => '<option' + (s === sel ? ' selected' : '') + '>' + esc(s) + '</option>').join(''); }
const CONSENT = [
  'Family Council helps people talk through disagreements fairly. It is <b>not</b> a court, a lawyer, a therapist, or an emergency service.',
  'What you write, and what live listening hears, is saved in the app owner\'s private Google account so the people in your council can see it. The app owner can see stored records.',
  'To get guide answers, council text is sent to Anthropic\'s Claude AI. Live listening uses your browser\'s speech service (Google, in Chrome) to turn speech into text. No audio is saved.',
  'Your private coach and advocate notes are shown only to you (and the family members you bring on your device).',
  'Law information is general education. Check it with an official source or a lawyer before relying on it.',
  'If anyone is in danger, call 911. For a crisis, call or text 988.',
  'Under 13? A parent adds you to their account instead.'
];
function renderWelcome(v) {
  v.innerHTML = `
  <div class="hero">
    <div class="seal">⚖</div>
    <h1>Family Council</h1>
    <p>Settle it fairly. Keep the peace. Everyone is heard, a guide keeps it fair, and everyone signs a promise they keep.</p>
  </div>
  <div class="authcard card">
    <div class="seg"><button data-m="signin" class="${authMode === 'signin' ? 'on' : ''}">Sign in</button><button data-m="signup" class="${authMode === 'signup' ? 'on' : ''}">Create account</button></div>
    <div id="authBody"></div>
  </div>
  <div class="feature-row" style="max-width:480px;margin:14px auto">
    <div><span>🎙️</span>Listens live and steps in</div><div><span>⚖️</span>Home vs. real court</div><div><span>📜</span>Signed resolutions</div>
  </div>
  <p class="tiny" style="text-align:center;max-width:480px;margin:0 auto">Not a court or legal advice. In danger? Call 911. Crisis? Call or text 988.</p>`;
  $$('.seg button').forEach(b => b.onclick = () => { authMode = b.dataset.m; signupStep = 1; renderWelcome(v); });
  const body = $('#authBody');
  if (authMode === 'signin') {
    body.innerHTML = `
      <label class="f" for="liEmail">Email</label><input class="f" id="liEmail" type="email" autocomplete="email" inputmode="email" value="${esc(LS.get('email') || '')}">
      <label class="f" for="liPin">PIN</label><input class="f pin" id="liPin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" placeholder="••••">
      <div class="err" id="liErr"></div>
      <button class="btn wide" id="liGo">Sign in</button>
      <p class="muted" style="text-align:center;margin:12px 0 0"><a href="#" id="forgot">Forgot your PIN?</a></p>`;
    const doLogin = async () => {
      const b = $('#liGo'); busy(b, true, 'Signing in');
      try {
        const r = await api('login', { email: $('#liEmail').value, pin: $('#liPin').value });
        LS.set('email', $('#liEmail').value.trim()); signedIn(r);
      } catch (e) { $('#liErr').textContent = e.message; busy(b, false); }
    };
    $('#liGo').onclick = doLogin; $('#liPin').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
    $('#forgot').onclick = e => { e.preventDefault(); forgotPin(); };
  } else if (signupStep === 1) {
    body.innerHTML = `
      <p class="muted">First we send a one-time code to your email to make sure it's yours.</p>
      <label class="f" for="suEmail">Email</label><input class="f" id="suEmail" type="email" autocomplete="email" inputmode="email">
      <div class="err" id="suErr"></div>
      <button class="btn wide" id="suSend">Send my code</button>`;
    $('#suSend').onclick = async () => {
      const b = $('#suSend'); busy(b, true, 'Sending');
      try { await api('sendCode', { email: $('#suEmail').value }); S.suEmail = $('#suEmail').value.trim(); signupStep = 2; renderWelcome(v); toast('Code sent. Check your email.'); }
      catch (e) { $('#suErr').textContent = e.message; busy(b, false); }
    };
  } else {
    body.innerHTML = `
      <p class="muted">We sent a 6-digit code to <b>${esc(S.suEmail)}</b>. <a href="#" id="suBack">Change</a></p>
      <label class="f" for="suCode">Code from the email</label><input class="f pin" id="suCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
      <label class="f" for="suName">First name</label><input class="f" id="suName" autocomplete="given-name">
      <div class="grid2">
        <div><label class="f" for="suAge">Age</label><input class="f" id="suAge" type="number" inputmode="numeric" min="13" max="120"></div>
        <div><label class="f" for="suState">State</label><select class="f" id="suState">${stateOptions('')}</select></div>
      </div>
      <label class="f" for="suRegion">County and city</label><input class="f" id="suRegion" placeholder="Example: Oakland County, West Bloomfield">
      <p class="tiny">Your state, county and age decide which laws show up in the Home vs. Court comparison.</p>
      <div class="grid2">
        <div><label class="f" for="suPin">Make a PIN (4–8 numbers)</label><input class="f pin" id="suPin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>
        <div><label class="f" for="suPin2">PIN again</label><input class="f pin" id="suPin2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>
      </div>
      <label class="chk"><input type="checkbox" id="suFaith"> <span>Faith mode: guides may share a short scripture when it fits.</span></label>
      <details class="card flat" open><summary>Before you join (please read)</summary><ul class="muted" style="padding-left:18px">${CONSENT.map(c => '<li>' + c + '</li>').join('')}</ul></details>
      <label class="chk"><input type="checkbox" id="suConsent"> <span><b>I have read this and I agree.</b></span></label>
      <div class="err" id="suErr"></div>
      <button class="btn wide gold" id="suGo">Create my account</button>`;
    $('#suBack').onclick = e => { e.preventDefault(); signupStep = 1; renderWelcome(v); };
    $('#suGo').onclick = async () => {
      const err = $('#suErr'); err.textContent = '';
      if ($('#suPin').value !== $('#suPin2').value) { err.textContent = 'The two PINs do not match.'; return; }
      if (Number($('#suAge').value) && Number($('#suAge').value) < 13) { err.textContent = 'Under 13? Ask a parent to add you as a family member on their account.'; return; }
      const b = $('#suGo'); busy(b, true, 'Creating');
      try {
        const r = await api('signup', { email: S.suEmail, code: $('#suCode').value, pin: $('#suPin').value, name: $('#suName').value, age: $('#suAge').value,
          state: $('#suState').value, region: $('#suRegion').value, faith: $('#suFaith').checked, consent: $('#suConsent').checked });
        LS.set('email', S.suEmail); signedIn(r, true);
      } catch (e) { err.textContent = e.message; busy(b, false); }
    };
  }
}
function forgotPin() {
  sheet(`<h2>Reset your PIN</h2>
    <label class="f" for="rpEmail">Email</label><input class="f" id="rpEmail" type="email" value="${esc(LS.get('email') || '')}">
    <button class="btn soft sm" id="rpSend" style="margin-top:8px">Send a reset code</button>
    <label class="f" for="rpCode">Code</label><input class="f pin" id="rpCode" inputmode="numeric" maxlength="6">
    <label class="f" for="rpPin">New PIN</label><input class="f pin" id="rpPin" type="password" inputmode="numeric" maxlength="8">
    <div class="err" id="rpErr"></div>
    <button class="btn wide" id="rpGo">Reset and sign in</button>`);
  $('#rpSend').onclick = async () => { try { await api('sendCode', { email: $('#rpEmail').value, purpose: 'reset' }); toast('If that email has an account, a code is on the way.'); } catch (e) { $('#rpErr').textContent = e.message; } };
  $('#rpGo').onclick = async () => {
    try { const r = await api('resetPin', { email: $('#rpEmail').value, code: $('#rpCode').value, pin: $('#rpPin').value }); closeSheet(); signedIn(r); }
    catch (e) { $('#rpErr').textContent = e.message; }
  };
}
function signedIn(r, isNew) {
  S.token = r.token; LS.set('token', r.token); setUser(r.user);
  if (isNew) { confetti(); toast('Welcome, ' + r.user.name + '! +10 Peace Points'); }
  go('home');
  if (S.pendingJoin) joinSheet(S.pendingJoin);
}
function signOutLocal() { authMode = 'signin'; signupStep = 1; S.token = ''; S.user = null; LS.del('token'); $('#ptsChip').classList.add('hidden'); $('#streakChip').classList.add('hidden'); go('welcome'); }

/* ============================ home ============================ */
async function loadHome() {
  try { const r = await api('listDisputes'); S.disputes = r.disputes; setUser(r.user); return true; }
  catch (e) { if (e.code !== 'signed_out') toast(e.message); return false; }
}
function levelRing(u) {
  const L = u.level, span = L.nextAt ? (L.nextAt - L.floor) : 1, pct = L.nextAt ? Math.min(1, (u.points - L.floor) / span) : 1;
  const C = 2 * Math.PI * 30;
  return `<svg class="ring" viewBox="0 0 74 74"><circle cx="37" cy="37" r="30" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="8"/>
    <circle cx="37" cy="37" r="30" fill="none" stroke="#C9A961" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 37 37)"/>
    <text x="37" y="44" text-anchor="middle" font-size="22">🕊</text></svg>`;
}
function renderHome(v) {
  const u = S.user;
  if (!u) { v.innerHTML = ''; return; }
  const hour = new Date().getHours(), greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const prompt = PROMPTS[Math.floor(Date.now() / 864e5) % PROMPTS.length];
  const L = u.level;
  const open = S.disputes.filter(d => d.status !== 'closed'), closed = S.disputes.filter(d => d.status === 'closed');
  const allBadges = Object.keys(BADGES);
  v.innerHTML = `
    <div class="hello">${avatar(u.name, 'lg')}<div><div class="muted">${greet},</div><h1 style="font-size:1.35em">${esc(u.name)}</h1></div></div>
    <div class="card navy">
      <div class="levelcard">${levelRing(u)}
        <div style="flex:1"><div style="font-size:.72em;letter-spacing:.12em;color:#cfd5e6;font-weight:800">YOUR LEVEL</div>
          <div style="font-family:Cinzel,serif;font-size:1.25em;color:#fff;font-weight:700">${esc(L.name)}</div>
          <div class="bar"><i style="width:${L.nextAt ? Math.round(100 * (u.points - L.floor) / (L.nextAt - L.floor)) : 100}%"></i></div>
          <div style="font-size:.74em;color:#cfd5e6;margin-top:4px">${L.nextAt ? (L.nextAt - u.points) + ' points to ' + esc(L.next) : 'Highest level. Thank you for keeping the peace.'}</div>
        </div></div>
      <div class="stats3"><div><b>${u.points}</b><span>Peace Points</span></div><div><b>🔥 ${u.streak}</b><span>Promise streak</span></div><div><b>${S.disputes.filter(d => d.binding).length}</b><span>Resolved</span></div></div>
    </div>
    <div class="card prompt"><div class="lab">TODAY'S PEACE PRACTICE</div><div style="font-weight:600;margin-top:4px">${esc(prompt)}</div></div>
    <div class="row">
      <button class="btn gold" data-go="new" style="flex:1">＋ Start a council</button>
      <button class="btn ghost" id="joinBtn" style="flex:1">🔑 Join with a code</button>
    </div>
    <h2>Your councils</h2>
    <div class="dlist">${open.length ? open.map(dRow).join('') : `<div class="empty card flat"><div class="big">🕊️</div><b>No open disagreements.</b><div class="muted">That's peace. When something comes up, start a council.</div></div>`}</div>
    ${closed.length ? `<details class="card flat"><summary>Closed councils (${closed.length})</summary><div class="dlist">${closed.map(dRow).join('')}</div></details>` : ''}
    <h2>Your badges</h2>
    <div class="badges">${allBadges.map(b => { const has = u.badges.indexOf(b) >= 0; return `<div class="badge ${has ? '' : 'locked'}" title="${esc(BADGES[b][2])}"><div class="b">${BADGES[b][0]}</div>${esc(BADGES[b][1])}</div>`; }).join('')}</div>`;
  $('#joinBtn').onclick = () => joinSheet('');
  $$('.dlist .d').forEach(el => el.onclick = () => openCouncil(el.dataset.id));
}
function dRow(d) {
  const c = CATS[d.category] || CATS.other, g = GUIDES[d.guide] || GUIDES.mother;
  const ph = PHASES.find(p => p[0] === d.phase) || PHASES[0];
  const tag = d.status === 'closed' ? '<span class="tag info">Closed</span>' : d.binding ? '<span class="tag ok">Binding</span>' : '<span class="tag warn">' + esc(ph[1]) + '</span>';
  return `<div class="d" data-id="${esc(d.id)}"><div class="em">${c[0]}</div><div style="min-width:0"><div class="t">${esc(d.title)}</div>
    <div class="s">${g.e} ${esc(g.name)} · ${esc(d.people.join(', '))} · ${ago(d.updated)}</div><div style="margin-top:3px">${tag}</div></div><div class="go">›</div></div>`;
}
function joinSheet(code) {
  sheet(`<h2>Join a council</h2><p class="muted">Someone sent you a code like <b>ABC-123</b>. Enter it to link your account to their council.</p>
    <label class="f" for="jCode">Join code</label><input class="f pin" id="jCode" maxlength="7" value="${esc(code)}" style="text-transform:uppercase;letter-spacing:.25em">
    <label class="f" for="jRel">How are you related to them? (optional)</label><input class="f" id="jRel" placeholder="Example: daughter, brother, partner">
    <div class="err" id="jErr"></div><button class="btn wide gold" id="jGo">Join</button>`);
  $('#jGo').onclick = async () => {
    const b = $('#jGo'); busy(b, true, 'Joining');
    try { const r = await api('join', { code: $('#jCode').value, relation: $('#jRel').value }); S.pendingJoin = ''; history.replaceState(null, '', location.pathname); closeSheet(); toast('You joined the council.'); openCouncil(r.disputeId); }
    catch (e) { $('#jErr').textContent = e.message; busy(b, false); }
  };
}

/* ============================ new council wizard ============================ */
function renderNew(v) {
  const w = S.wizard, u = S.user, hh = (u && u.household) || [];
  v.innerHTML = `
    <h1 style="font-size:1.3em;margin-top:6px">Start a council</h1>
    <p class="muted">A council is a fair, calm way to settle something. It can be as small as dishes.</p>
    <label class="f" for="wTitle">What's it about?</label>
    <input class="f" id="wTitle" maxlength="90" placeholder="Example: Whose turn it is for dishes" value="${esc(w.title)}">
    <label class="f">What kind of disagreement?</label>
    <div class="choices">${Object.keys(CATS).map(k => `<button class="choice ${w.category === k ? 'on' : ''}" data-cat="${k}"><span class="e">${CATS[k][0]}</span>${esc(CATS[k][1])}</button>`).join('')}</div>
    <label class="f">Choose your guide</label>
    <div class="guides">${Object.keys(GUIDES).map(k => `<button class="guidecard ${w.guide === k ? 'on' : ''}" data-guide="${k}"><div class="ge">${GUIDES[k].e}</div><div><b>${esc(GUIDES[k].name)}</b><p>${esc(GUIDES[k].d)}</p></div></button>`).join('')}</div>
    <label class="f" for="wDesc">In a sentence or two, what happened? (everyone will see this)</label>
    <textarea class="f" id="wDesc" maxlength="1500" placeholder="Stick to what happened. Everyone gets to tell their side later.">${esc(w.description)}</textarea>
    <label class="f" for="wRel">Your role (optional)</label><input class="f" id="wRel" placeholder="Example: mom, older sister, partner" value="${esc(w.relation)}">
    <label class="f">Who's in the room with you? (family members on your account)</label>
    ${hh.length ? hh.map(h => `<label class="chk"><input type="checkbox" data-hh="${esc(h.id)}" ${w.guests.indexOf(h.id) >= 0 ? 'checked' : ''}> <span>${esc(h.name)}${h.age ? ', ' + esc(h.age) : ''}${h.relation ? ' (' + esc(h.relation) + ')' : ''}</span></label>`).join('')
      : '<p class="muted">Kids under 13 and others without their own account can be added in <a href="#" data-go="me">Me</a> > Family members.</p>'}
    <div class="note blue">After you create it, you'll get a join code to send to anyone who has their own account.</div>
    <div class="err" id="wErr"></div>
    <button class="btn wide gold" id="wGo">Open the council</button>`;
  const sync = () => { w.title = $('#wTitle').value; w.description = $('#wDesc').value; w.relation = $('#wRel').value; w.guests = $$('[data-hh]').filter(x => x.checked).map(x => x.dataset.hh); };
  $$('[data-cat]').forEach(b => b.onclick = () => { sync(); w.category = b.dataset.cat; renderNew(v); });
  $$('[data-guide]').forEach(b => b.onclick = () => { sync(); w.guide = b.dataset.guide; renderNew(v); });
  $('#wGo').onclick = async () => {
    sync(); const b = $('#wGo'); busy(b, true, 'Opening');
    try {
      const r = await api('createDispute', { title: w.title, category: w.category, guide: w.guide, description: w.description, relation: w.relation, guests: w.guests });
      S.wizard = { title: '', category: 'chores', guide: 'mother', description: '', relation: '', guests: [] };
      await openCouncil(r.dispute.id); inviteSheet(true);
    } catch (e) { $('#wErr').textContent = e.message; busy(b, false); }
  };
}

/* ============================ council ============================ */
async function openCouncil(id) {
  S.curId = id; S.tab = 'council'; S.cur = null; S.draft = null; S.speakAs = ''; go('council', id);
  await loadCouncil(true);
}
async function loadCouncil(full) {
  try {
    const r = await api(full ? 'getDispute' : 'poll', { disputeId: S.curId, version: S.version });
    if (r.same) return;
    const hadBinding = S.cur && S.cur.dispute.resolution && S.cur.dispute.resolution.status === 'binding';
    S.cur = r; S.version = r.version;
    if (!S.speakAs || !r.members.some(m => m.id === S.speakAs && m.mine)) { const me = r.members.find(m => m.mine && !m.isGuest) || r.members.find(m => m.mine); S.speakAs = me ? me.id : ''; }
    const nowBinding = r.dispute.resolution && r.dispute.resolution.status === 'binding';
    if (!full && nowBinding && !hadBinding) { confetti(); toast('The resolution is binding. Everyone keeps it now.'); refreshMe(); }
    if (S.view === 'council') refreshCouncil();
  } catch (e) { if (S.view === 'council') toast(e.message); }
}
function startPoll() { stopPoll(); S.pollT = setInterval(() => { if (!document.hidden && S.view === 'council') loadCouncil(false); }, 4000); }
function stopPoll() { if (S.pollT) clearInterval(S.pollT); S.pollT = null; }
async function refreshMe() { try { const r = await api('me'); setUser(r.user); } catch (e) {} }

function renderCouncil(v) {
  v.innerHTML = `
    <div class="row" style="margin-bottom:6px"><button class="btn ghost sm" data-go="home">‹ Back</button><div class="sp" style="flex:1"></div><button class="btn soft sm" id="invBtn">🔑 Invite</button><button class="btn soft sm" id="moreBtn">⋯</button></div>
    <div id="cHead"><div class="empty"><span class="typing"><i></i><i></i><i></i></span></div></div>
    <div class="stepper" id="cStep"></div>
    <div class="people" id="cPeople"></div>
    <div class="tabs" id="cTabs">
      <button data-t="council">💬 Council</button><button data-t="live">🎙️ Live</button><button data-t="court">⚖️ Home vs Court</button>
      <button data-t="advocate">🧑🏾‍💼 My advocate</button><button data-t="resolution">📜 Resolution</button>
    </div>
    <div id="cSafety"></div>
    <div id="cPanel"></div>`;
  $('#invBtn').onclick = () => inviteSheet(false);
  $('#moreBtn').onclick = moreSheet;
  $$('#cTabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.t; refreshCouncil(true); });
  startPoll();
  if (S.cur && S.cur.dispute.id === S.curId) refreshCouncil(true);
}
function me() { return S.cur ? S.cur.members.find(m => m.id === S.speakAs) : null; }
function refreshCouncil(force) {
  if (!S.cur || !$('#cHead')) return;
  const d = S.cur.dispute, g = GUIDES[d.guide] || GUIDES.mother, c = CATS[d.category] || CATS.other;
  const pi = PHASES.findIndex(p => p[0] === d.phase);
  $('#cHead').innerHTML = `<div class="chead">${'<div class="avatar guide lg">' + g.e + '</div>'}<div style="min-width:0"><div class="t">${esc(d.title)}</div>
    <div class="muted">${c[0]} ${esc(c[1])} · Guide: <b>${esc(g.name)}</b>${d.status === 'closed' ? ' · <span class="tag info">Closed</span>' : ''}</div></div></div>`;
  $('#cStep').innerHTML = PHASES.slice(0, 7).map((p, i) => `<div class="st ${i < pi ? 'done' : ''} ${i === pi ? 'cur' : ''}" data-ph="${p[0]}" title="In court: ${esc(p[2])}"><i></i>${esc(p[1])}</div>`).join('');
  $$('#cStep .st').forEach(el => el.onclick = () => phaseSheet(el.dataset.ph));
  $('#cPeople').innerHTML = S.cur.members.map(m => `<button class="person ${d.floor === m.id ? 'floor' : ''}" data-m="${esc(m.id)}" title="Pass the talking stick">${avatar(m.name, '', d.floor === m.id ? '<span class="stick">🪶</span>' : '')}${esc(m.name)}<small>${esc(m.relation || (m.isGuest ? 'family' : ''))}${m.covenant ? ' ✍️' : ''}</small></button>`).join('') +
    `<button class="person" id="addPerson" title="Add someone in the room"><div class="avatar" style="background:#d9cfb7;color:var(--navy)">＋</div>Add<small>in room</small></button>`;
  $$('#cPeople [data-m]').forEach(el => el.onclick = () => passStick(el.dataset.m));
  $('#addPerson').onclick = addPersonSheet;
  $$('#cTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tab));
  const unsafe = S.cur.entries.some(e => e.meta && e.meta.data && e.meta.data.safety) || S.localSafety;
  $('#cSafety').innerHTML = unsafe ? safetyBox() : '';
  const panel = $('#cPanel');
  if (!force && panel.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') { if (S.tab === 'council') updateFeed(); return; }
  if (S.tab === 'council') panelCouncil(panel);
  else if (S.tab === 'live') panelLive(panel, force);
  else if (S.tab === 'court') panelCourt(panel);
  else if (S.tab === 'advocate') panelAdvocate(panel);
  else panelResolution(panel);
}

function passStick(id) {
  if (!S.cur) return;
  const next = S.cur.dispute.floor === id ? '' : id;
  S.cur.dispute.floor = next; refreshCouncil();
  api('setFloor', { disputeId: S.curId, memberId: next }).catch(e => toast(e.message));
  const m = S.cur.members.find(x => x.id === id);
  if (next && m) { toast('🪶 ' + m.name + ' has the talking stick.'); if (m.mine) S.speakAs = m.id; }
}
function phaseSheet(ph) {
  const p = PHASES.find(x => x[0] === ph);
  sheet(`<h2>${esc(p[1])}</h2><p>${esc(PHASE_HELP[ph])}</p>
    <div class="vs" style="margin:12px 0"><div class="hd home">🏠 In our home</div><div class="hd court">⚖️ In a real court</div>
      <div class="cell home">${esc(p[1])}</div><div class="cell court">${esc(p[2])}</div></div>
    <button class="btn wide" id="phGo">Move the council to this step</button>`);
  $('#phGo').onclick = async () => { closeSheet(); try { await api('setPhase', { disputeId: S.curId, phase: ph }); await loadCouncil(true); } catch (e) { toast(e.message); } };
}
function nextPhase() { const i = PHASES.findIndex(p => p[0] === S.cur.dispute.phase); return PHASES[Math.min(i + 1, 6)][0]; }

/* ---------- council panel (feed + composer) ---------- */
function panelCouncil(panel) {
  const d = S.cur.dispute, mine = S.cur.members.filter(m => m.mine), meM = me();
  const needCovenant = mine.filter(m => !m.covenant);
  panel.innerHTML = `
    ${needCovenant.length && d.status !== 'closed' ? `<div class="card gold"><h3 style="margin-top:0">✍️ The council promise</h3>
      <p style="margin:4px 0 8px">"I will tell the truth, let others finish, and follow the council's final resolution, even if it isn't what I wanted."</p>
      <div class="row">${needCovenant.map(m => `<button class="btn sm" data-cov="${esc(m.id)}">${esc(m.name)}: I promise</button>`).join('')}</div>
      <p class="tiny">If everyone promises, the guide's final ruling is binding even when someone disagrees.</p></div>` : ''}
    <div class="note blue"><b>${esc((PHASES.find(p => p[0] === d.phase) || PHASES[0])[1])}:</b> ${esc(PHASE_HELP[d.phase] || '')}
      ${d.phase !== 'closed' && d.phase !== 'followup' ? ` <a href="#" id="nextPh">Next step ›</a>` : ''}</div>
    <div class="guidebar">
      ${guideBtn('opening', '📣 Open the council')}${guideBtn('guide', '🙋 Ask the guide')}${guideBtn('questions', '❓ Guide\'s questions')}
      ${guideBtn('propose', '💡 Ways to settle it')}${guideBtn('coach', '🧘 Coach me (private)')}
    </div>
    <div class="feed" id="feed"></div>
    <div class="composer"><div class="box">
      <div class="kinds" id="kinds">${KINDS.map(k => `<button data-k="${k[0]}" class="${S.kind === k[0] ? 'on' : ''}">${k[1]}</button>`).join('')}</div>
      <div class="row" style="flex-wrap:nowrap">
        <textarea id="say" rows="2" maxlength="6000" placeholder="${esc(placeholderFor())}">${esc(S.composeText || '')}</textarea>
        <button class="mic" id="dictate" title="Talk instead of type" ${SR ? '' : 'disabled'}>🎤</button>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:4px">
        <label class="tiny">Speaking as <select id="as" class="f" style="width:auto;padding:5px 8px;font-size:.95em;display:inline-block">${mine.map(m => `<option value="${esc(m.id)}" ${m.id === S.speakAs ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        <button class="btn sm" id="send">Send</button>
      </div></div></div>`;
  updateFeed();
  $$('[data-cov]').forEach(b => b.onclick = async () => { busy(b, true); try { await api('consent', { disputeId: S.curId, type: 'covenant', value: true, as: b.dataset.cov }); await loadCouncil(true); toast('Promise made. ✍️'); } catch (e) { toast(e.message); busy(b, false); } });
  const np = $('#nextPh'); if (np) np.onclick = async e => { e.preventDefault(); try { await api('setPhase', { disputeId: S.curId, phase: nextPhase() }); await loadCouncil(true); } catch (er) { toast(er.message); } };
  $$('[data-ai]').forEach(b => b.onclick = () => {
    let q = '';
    if (b.dataset.ai === 'guide' || b.dataset.ai === 'coach') { q = ($('#say').value || '').trim(); if (q) { $('#say').value = ''; S.composeText = ''; } }
    runAi(b.dataset.ai, b, q);
  });
  $$('#kinds button').forEach(b => b.onclick = () => { S.kind = b.dataset.k; $$('#kinds button').forEach(x => x.classList.toggle('on', x === b)); $('#say').placeholder = placeholderFor(); });
  $('#as').onchange = e => { S.speakAs = e.target.value; };
  $('#say').oninput = e => { S.composeText = e.target.value; };
  $('#send').onclick = sendPost;
  $('#dictate').onclick = dictate;
  if (meM && S.kind === 'side' && S.cur.entries.some(e => e.kind === 'side' && e.authorId === meM.id)) { S.kind = 'response'; $$('#kinds button').forEach(x => x.classList.toggle('on', x.dataset.k === 'response')); }
}
function guideBtn(mode, label) { return `<button class="btn ${mode === 'coach' ? 'soft' : 'ghost'} sm" data-ai="${mode}">${label}</button>`; }
function placeholderFor() {
  return { side: 'Say what happened, how you felt, and what you need. Use "I felt ___ when ___."', response: 'Start with something you agree with, then what you see differently.',
    apology: 'I\'m sorry for ___. I will ___.', answer: 'Answer the guide\'s question.', question: 'Ask the guide or the group something.', proposal: 'What would be fair?', note: 'Add a note.' }[S.kind];
}
function updateFeed() {
  const f = $('#feed'); if (!f || !S.cur) return;
  const atBottom = (innerHeight + scrollY) >= document.body.scrollHeight - 160;
  const ids = S.cur.members.filter(m => m.mine).map(m => m.id);
  f.innerHTML = S.cur.entries.map(e => entryHtml(e, ids)).join('') || '<div class="empty"><div class="big">📣</div>Tap <b>Open the council</b> to let the guide start.</div>';
  $$('#feed [data-useopt]').forEach(b => b.onclick = () => useOption(b.dataset.useopt, Number(b.dataset.i)));
  if (atBottom) window.scrollTo(0, document.body.scrollHeight);
}
function entryHtml(e, myIds) {
  if (e.kind === 'system') return `<div class="sys"><span>${esc(e.text)} · ${clock(e.time)}</span></div>`;
  const g = GUIDES[S.cur.dispute.guide] || GUIDES.mother;
  const isGuide = e.authorId === 'guide' || ['guide', 'interject', 'ruling', 'court'].indexOf(e.kind) >= 0;
  const mineE = myIds.indexOf(e.authorId) >= 0;
  const labels = { side: 'Side', response: 'Response', apology: 'Apology 💚', answer: 'Answer', question: 'Question', proposal: 'Idea', note: 'Note', transcript: '🎙 Spoken', flag: '🚩 Flag', checkin: 'Check-in', interject: '🔔 Stepped in', coach: '🔒 Private coaching', advocate: '🔒 Your advocate', ruling: '⚖️ Ruling', court: '⚖️ Court comparison', guide: '' };
  let body = esc(e.text);
  const data = e.meta && e.meta.data;
  if (data && e.meta.mode === 'questions' && data.questions) body = esc(data.say || '') + '<ol style="margin:6px 0 0;padding-left:20px">' + data.questions.map(q => '<li><b>' + esc(q.to) + ':</b> ' + esc(q.q) + '</li>').join('') + '</ol>';
  if (data && e.meta.mode === 'coach') body = '<ul style="margin:0;padding-left:18px">' + (data.tips || []).map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' + (data.ownIt ? '<div style="margin-top:6px"><b>Own this:</b> ' + esc(data.ownIt) + '</div>' : '') + (data.calm ? '<div><b>Calm down:</b> ' + esc(data.calm) + '</div>' : '') + (data.sayInstead ? '<div class="say">' + esc(data.sayInstead) + '</div>' : '');
  if (data && e.meta.mode === 'propose') body = esc(data.summary || '') + (data.options || []).map((o, i) => `<div class="option ${i === data.recommend ? 'rec' : ''}"><b>${i === data.recommend ? '⭐ ' : ''}${esc(o.title)}</b><div class="muted">${esc(o.why || '')}</div>
      <ul style="margin:6px 0;padding-left:18px">${(o.terms || []).map(t => '<li><b>' + esc(t.who) + '</b>: ' + esc(t.what) + (t.by ? ' <span class="muted">(' + esc(t.by) + ')</span>' : '') + '</li>').join('')}</ul>
      ${o.consequence ? '<div class="tiny">If broken: ' + esc(o.consequence) + '</div>' : ''}<button class="btn sm gold" data-useopt="${esc(e.id)}" data-i="${i}">Use this one</button></div>`).join('');
  if (data && e.meta.mode === 'ruling') body = esc(data.summary || '') + '<ul style="margin:6px 0;padding-left:18px">' + (data.terms || []).map(t => '<li><b>' + esc(t.who) + '</b>: ' + esc(t.what) + '</li>').join('') + '</ul>' + (data.plainForKids ? '<div class="kidbox"><div class="lab">FOR KIDS</div>' + esc(data.plainForKids) + '</div>' : '') + '<button class="btn sm gold" data-useopt="' + esc(e.id) + '" data-i="-1">Put this up for signatures</button>';
  if (data && e.meta.mode === 'court') body = esc(data.headline || '') + ' <span class="muted">(see the Home vs Court tab)</span>';
  if (data && data.safety) body = safetyBox() + body;
  const cls = ['msg', mineE ? 'me' : '', isGuide ? 'guide' : '', e.kind === 'interject' ? 'interject' : '', e.private ? 'private' : '', e.kind === 'apology' ? 'apology' : ''].join(' ');
  const av = isGuide ? '<div class="avatar guide">' + g.e + '</div>' : e.private ? '<div class="avatar guide">' + (e.kind === 'coach' ? '🧘' : '🧑🏾‍💼') + '</div>' : avatar(e.authorName);
  return `<div class="${cls}">${av}<div class="bub"><div class="who">${esc(e.authorName)} ${labels[e.kind] ? '<span class="tag ' + (e.private ? 'plum' : 'info') + '">' + labels[e.kind] + '</span>' : ''}<span class="tiny">${clock(e.time)}</span></div>${body}</div></div>`;
}
async function sendPost() {
  const t = $('#say'), text = t.value.trim(); if (!text) return;
  if (SAFETY_RX.test(text)) { S.localSafety = true; refreshCouncil(); }
  if (NAMECALL_RX.test(text)) { toast('Careful: name-calling hurts your side. Try saying what happened instead.'); }
  const b = $('#send'); busy(b, true);
  try {
    await api('post', { disputeId: S.curId, kind: S.kind, text, as: S.speakAs });
    S.composeText = ''; t.value = ''; await loadCouncil(true); refreshMe();
    window.scrollTo(0, document.body.scrollHeight);
  } catch (e) { toast(e.message); } finally { busy(b, false); }
}
async function runAi(mode, btn, text) {
  if (S.busy[mode]) return; S.busy[mode] = true; busy(btn, true, mode === 'coach' ? 'Thinking' : 'The guide is thinking');
  try {
    const r = await api('ai', { disputeId: S.curId, mode, text: text || '', as: S.speakAs });
    if (r.data && r.data.safety) S.localSafety = true;
    await loadCouncil(true);
    window.scrollTo(0, document.body.scrollHeight);
    return r;
  } catch (e) { toast(e.message); } finally { S.busy[mode] = false; busy(btn, false); }
}
function dictate() {
  if (!SR) return;
  const b = $('#dictate'), t = $('#say');
  if (S.dict) { S.dict.stop(); return; }
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
  const base = t.value ? t.value.trim() + ' ' : '';
  rec.onresult = ev => { let s = ''; for (let i = 0; i < ev.results.length; i++) s += ev.results[i][0].transcript; t.value = base + s; S.composeText = t.value; };
  rec.onend = () => { S.dict = null; b.classList.remove('on'); };
  rec.onerror = () => { S.dict = null; b.classList.remove('on'); };
  S.dict = rec; b.classList.add('on'); rec.start();
}

/* ---------- people, invites, more ---------- */
function inviteSheet(isNew) {
  const d = S.cur && S.cur.dispute; if (!d) return;
  const shareTxt = 'Join my Family Council about "' + d.title + '". Code: ' + d.joinCode + ' ' + location.origin + location.pathname + '?join=' + d.joinCode;
  sheet(`<h2>${isNew ? '🎉 Your council is open' : 'Invite someone'}</h2>
    <p class="muted">Anyone with their own account can join with this code. It works for 7 days.</p>
    <div class="codebox" id="codeBox">${esc(d.joinCode)}</div>
    <div class="row"><button class="btn" id="shareBtn" style="flex:1">📤 Share</button><button class="btn ghost" id="copyBtn" style="flex:1">📋 Copy</button></div>
    <h3>Or email the code</h3>
    <input class="f" id="invEmail" type="email" placeholder="their@email.com">
    <textarea class="f" id="invNote" style="min-height:60px;margin-top:8px" placeholder="Optional note: Let's settle this fairly tonight."></textarea>
    <div class="err" id="invErr"></div>
    <div class="row"><button class="btn gold" id="invSend" style="flex:1">Send invite</button><button class="btn ghost sm" id="newCode">New code</button></div>
    <p class="tiny">Kids under 13 or people without an account? Add them as "in the room" with the ＋ next to the people.</p>`);
  $('#shareBtn').onclick = async () => { if (navigator.share) { try { await navigator.share({ title: 'Family Council', text: shareTxt }); } catch (e) {} } else { copy(shareTxt); } };
  $('#copyBtn').onclick = () => copy(shareTxt);
  $('#invSend').onclick = async () => {
    const b = $('#invSend'); busy(b, true, 'Sending');
    try { await api('invite', { disputeId: S.curId, email: $('#invEmail').value, note: $('#invNote').value }); toast('Invite sent. 🌉'); closeSheet(); refreshMe(); }
    catch (e) { $('#invErr').textContent = e.message; busy(b, false); }
  };
  $('#newCode').onclick = async () => { try { const r = await api('invite', { disputeId: S.curId, fresh: true }); d.joinCode = r.joinCode; $('#codeBox').textContent = r.joinCode; toast('New code made. The old one stopped working.'); } catch (e) { toast(e.message); } };
}
function copy(t) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Copied.'), () => toast(t)); }
function addPersonSheet() {
  const hh = (S.user && S.user.household) || [], inIds = S.cur.members.map(m => m.id);
  const names = S.cur.members.map(m => m.name);
  const avail = hh.filter(h => names.indexOf(h.name) < 0);
  sheet(`<h2>Add someone in the room</h2>
    <p class="muted">Family members on your account (like kids under 13) speak and sign on your device.</p>
    ${avail.length ? avail.map(h => `<button class="btn ghost wide" style="margin:6px 0" data-addh="${esc(h.id)}">＋ ${esc(h.name)}${h.age ? ', ' + esc(h.age) : ''}</button>`).join('') : '<p class="muted">Everyone on your family list is already here.</p>'}
    <h3>Add a new family member</h3>
    <div class="grid2"><input class="f" id="nhName" placeholder="First name"><input class="f" id="nhAge" type="number" placeholder="Age"></div>
    <input class="f" id="nhRel" placeholder="Relation (son, niece...)" style="margin-top:8px">
    <div class="err" id="nhErr"></div><button class="btn gold wide" id="nhGo">Save and add</button>
    <p class="tiny">Someone with their own phone and account? Use <b>Invite</b> instead.</p>`);
  void inIds;
  $$('[data-addh]').forEach(b => b.onclick = async () => { busy(b, true); try { await api('addGuest', { disputeId: S.curId, householdId: b.dataset.addh }); closeSheet(); await loadCouncil(true); } catch (e) { toast(e.message); busy(b, false); } });
  $('#nhGo').onclick = async () => {
    const name = $('#nhName').value.trim(); if (!name) { $('#nhErr').textContent = 'Enter a name.'; return; }
    try {
      const list = hh.map(h => ({ id: h.id, name: h.name, age: h.age, relation: h.relation })).concat([{ name, age: $('#nhAge').value, relation: $('#nhRel').value }]);
      const r = await api('saveHousehold', { household: list }); setUser(r.user);
      const added = r.user.household.find(h => h.name === name && !hh.some(o => o.id === h.id));
      await api('addGuest', { disputeId: S.curId, householdId: added.id }); closeSheet(); await loadCouncil(true);
    } catch (e) { $('#nhErr').textContent = e.message; }
  };
}
function moreSheet() {
  const d = S.cur && S.cur.dispute; if (!d) return;
  sheet(`<h2>${esc(d.title)}</h2>
    ${d.description ? '<p>' + esc(d.description) + '</p>' : ''}
    <div class="stack">
      <button class="btn ghost wide" id="mvPhase">Change the step</button>
      <button class="btn ghost wide" id="mvPrint">🖨 Print or save the record</button>
      ${d.status !== 'closed' ? '<button class="btn red wide" id="mvClose">Close this council</button>' : '<button class="btn wide" id="mvReopen">Reopen this council</button>'}
    </div>`);
  $('#mvPhase').onclick = () => { closeSheet(); sheet('<h2>Which step?</h2>' + PHASES.map(p => `<button class="btn ghost wide" style="margin:5px 0" data-pp="${p[0]}">${esc(p[1])}</button>`).join('')); $$('[data-pp]').forEach(b => b.onclick = () => phaseSheet(b.dataset.pp)); };
  $('#mvPrint').onclick = () => { closeSheet(); printRecord(); };
  const c = $('#mvClose'); if (c) c.onclick = async () => { try { await api('closeDispute', { disputeId: S.curId }); closeSheet(); await loadCouncil(true); } catch (e) { toast(e.message); } };
  const ro = $('#mvReopen'); if (ro) ro.onclick = async () => { try { await api('setPhase', { disputeId: S.curId, phase: 'followup' }); closeSheet(); await loadCouncil(true); } catch (e) { toast(e.message); } };
}
function printRecord() {
  const d = S.cur.dispute, r = d.resolution;
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print.'); return; }
  const rows = S.cur.entries.filter(e => !e.private).map(e => `<tr><td>${new Date(e.time).toLocaleString()}</td><td>${esc(e.authorName)}</td><td>${esc(e.kind)}</td><td>${esc(e.text)}</td></tr>`).join('');
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(d.title)} - Family Council record</title><style>body{font-family:Georgia,serif;padding:28px;color:#14161c}h1{color:#1B2951}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccc;padding:6px;vertical-align:top;text-align:left}th{background:#1B2951;color:#fff}.f{margin-top:30px;font-size:11px;color:#666}</style></head><body>
    <h1>Family Council record: ${esc(d.title)}</h1><p>People: ${S.cur.members.map(m => esc(m.name)).join(', ')}. Guide: ${esc((GUIDES[d.guide] || GUIDES.mother).name)}. Printed ${new Date().toLocaleString()}.</p>
    ${r ? `<h2>Resolution (${esc(r.status)})</h2><ol>${r.terms.map(t => `<li><b>${esc(t.who)}</b>: ${esc(t.what)} ${t.by ? '(' + esc(t.by) + ')' : ''}</li>`).join('')}</ol>${r.consequence ? '<p>If broken: ' + esc(r.consequence) + '</p>' : ''}
      <p>Signatures: ${Object.keys(r.signatures || {}).map(k => esc(r.signatures[k].name) + (r.signatures[k].agree ? ' (agreed ' : ' (did not agree ') + new Date(r.signatures[k].time).toLocaleString() + ')').join('; ') || 'none yet'}</p>` : ''}
    <h2>Record</h2><table><tr><th>When</th><th>Who</th><th>Type</th><th>What was said</th></tr>${rows}</table>
    <p class="f">Family Council is a family tool. It is not a court record or legal advice. Private coaching notes are not included.</p></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
}

/* ---------- live listening ---------- */
S.live = { on: false };
function panelLive(panel, force) {
  const L = S.live, members = S.cur.members;
  if (L.on && !force && $('#liveWrap')) { updateConsentList(); return; }
  const allConsent = members.every(m => m.consentLive);
  panel.innerHTML = `<div id="liveWrap">
    <div class="card">
      <h3 style="margin-top:0">Everyone in the room agrees first</h3>
      <p class="muted">Live listening turns speech into text so ${esc((GUIDES[S.cur.dispute.guide] || GUIDES.mother).name)} can step in, coach and keep order. No audio is saved. Each person agrees on their own device (family members on yours).</p>
      <div class="consentlist" id="consentList"></div>
    </div>
    <div class="livehero">
      <button class="bigmic ${L.on ? 'on' : ''}" id="bigMic" ${(!SR || !allConsent) && !L.on ? 'disabled' : ''} aria-label="Start or stop listening">${L.on ? '⏹' : '🎙️'}</button>
      <div style="margin-top:10px;font-weight:800;color:var(--navy)" id="liveState">${!SR ? 'This browser cannot listen. Use Chrome on Android or a computer.' : L.on ? 'Listening… the guide will step in when needed' : allConsent ? 'Tap to start listening' : 'Waiting for everyone to agree'}</div>
      <div class="meter"><i id="meterBar"></i></div><div class="tiny" id="meterLab">Voice level</div>
    </div>
    <div class="row" style="justify-content:center">
      <label class="chk" style="margin:0"><input type="checkbox" id="speakToggle" ${S.speak ? 'checked' : ''}> <span>Guide speaks out loud</span></label>
    </div>
    <div class="flagrow" style="justify-content:center">
      <button class="btn ghost sm" data-flag="interrupting">✋ Interrupted</button>
      <button class="btn ghost sm" data-flag="voices rising">📢 Too loud</button>
      <button class="btn ghost sm" data-flag="off topic">🧭 Off topic</button>
      <button class="btn ghost sm" id="timeout">⏸ Time out</button>
      <button class="btn soft sm" id="liveCoach">🧘 Coach me</button>
    </div>
    <h3>What's being said</h3>
    <p class="tiny">Tap a person above to give them the talking stick 🪶. What's heard is credited to whoever holds it.</p>
    <div class="transcript" id="tx">${(L.lines || []).map(l => `<div class="ln"><b>${esc(l.who)}:</b> ${esc(l.text)}</div>`).join('') || '<span class="muted">Nothing yet.</span>'}<div class="interim" id="interim"></div></div>
    <div id="myTips"></div>
  </div>`;
  updateConsentList();
  $('#bigMic').onclick = () => (S.live.on ? stopLive() : startLive());
  $('#speakToggle').onchange = e => { S.speak = e.target.checked; LS.set('speak', S.speak ? '1' : '0'); };
  $$('[data-flag]').forEach(b => b.onclick = () => { S.live.flags = (S.live.flags || []).concat([b.dataset.flag]); askInterject(true); toast('The guide will step in.'); });
  $('#timeout').onclick = timeOut;
  $('#liveCoach').onclick = async () => { const r = await runAi('coach', $('#liveCoach')); if (r && r.data) showTips(r.data); };
}
function updateConsentList() {
  const el = $('#consentList'); if (!el) return;
  el.innerHTML = S.cur.members.map(m => `<div class="c">${avatar(m.name)}<div class="sp"><b>${esc(m.name)}</b><div class="tiny">${m.consentLive ? 'Agreed to live listening' : m.mine ? 'Tap to agree' : 'Agrees on their own device'}</div></div>
    ${m.consentLive ? '<span class="tag ok">✓ Agreed</span>' : m.mine ? `<button class="btn sm" data-lc="${esc(m.id)}">I agree</button>` : '<span class="tag warn">Waiting</span>'}</div>`).join('');
  $$('[data-lc]').forEach(b => b.onclick = async () => { busy(b, true); try { await api('consent', { disputeId: S.curId, type: 'live', value: true, as: b.dataset.lc }); await loadCouncil(true); refreshCouncil(true); } catch (e) { toast(e.message); busy(b, false); } });
  const all = S.cur.members.every(m => m.consentLive), mic = $('#bigMic');
  if (mic && !S.live.on) { mic.disabled = !SR || !all; $('#liveState').textContent = !SR ? 'This browser cannot listen. Use Chrome on Android or a computer.' : all ? 'Tap to start listening' : 'Waiting for everyone to agree'; }
}
function floorName() { const m = S.cur && S.cur.members.find(x => x.id === S.cur.dispute.floor); return m ? m.name : 'Room'; }
async function startLive() {
  if (!SR) return;
  if (!S.cur.members.every(m => m.consentLive)) { toast('Everyone has to agree first.'); return; }
  const L = S.live; L.on = true; L.lines = L.lines || []; L.pending = ''; L.lastAi = Date.now(); L.lastPost = Date.now(); L.flags = []; L.loudSince = 0;
  const rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true; L.rec = rec;
  rec.onresult = ev => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) heard(r[0].transcript.trim()); else interim += r[0].transcript;
    }
    const im = $('#interim'); if (im) im.textContent = interim ? floorName() + ': ' + interim : '';
  };
  rec.onerror = e => { if (e.error === 'not-allowed') { toast('Microphone permission was blocked.'); stopLive(); } };
  rec.onend = () => { if (L.on && !L.paused) { try { rec.start(); } catch (e) {} } };
  try { rec.start(); } catch (e) {}
  startMeter();
  L.timer = setInterval(liveTick, 5000);
  refreshCouncil(true);
  addLine('—', 'Listening started ' + clock(Date.now()));
}
function stopLive() {
  const L = S.live; L.on = false;
  try { L.rec && L.rec.stop(); } catch (e) {}
  clearInterval(L.timer); stopMeter(); flushTranscript();
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (S.view === 'council' && S.tab === 'live') refreshCouncil(true);
}
function addLine(who, text) {
  const L = S.live; L.lines.push({ who, text }); if (L.lines.length > 200) L.lines.shift();
  const tx = $('#tx'); if (tx) { const d = document.createElement('div'); d.className = 'ln'; d.innerHTML = '<b>' + esc(who) + ':</b> ' + esc(text); tx.insertBefore(d, $('#interim')); tx.scrollTop = tx.scrollHeight; const m = tx.querySelector('.muted'); if (m) m.remove(); }
}
function heard(text) {
  if (!text) return;
  const L = S.live, who = floorName();
  addLine(who, text);
  L.pending += who + ': ' + text + '\n';
  if (SAFETY_RX.test(text)) { S.localSafety = true; L.flags.push('possible safety concern'); refreshCouncil(); askInterject(true); return; }
  if (NAMECALL_RX.test(text)) { L.flags.push('name-calling or harsh words'); askInterject(true); return; }
  if (ABSOLUTE_RX.test(text)) L.flags.push('"always/never" blaming');
  if (L.pending.length > 260) askInterject(false);
}
function liveTick() {
  const L = S.live; if (!L.on) return;
  if (Date.now() - L.lastPost > 20000) flushTranscript();
  if (L.pending && (Date.now() - L.lastAi > 35000 || L.flags.length)) askInterject(false);
}
function flushTranscript() {
  const L = S.live; if (!L.unposted) L.unposted = '';
  const lines = L.lines.slice(L.postedIdx || 0).filter(l => l.who !== '—'); L.postedIdx = L.lines.length; L.lastPost = Date.now();
  if (!lines.length || !S.curId) return;
  api('post', { disputeId: S.curId, kind: 'transcript', text: lines.map(l => l.who + ': ' + l.text).join('\n'), as: S.speakAs }).catch(() => {});
}
async function askInterject(urgent) {
  const L = S.live; if (L.asking) return;
  if (!urgent && Date.now() - L.lastAi < 15000) return;
  L.asking = true; L.lastAi = Date.now();
  const text = L.pending.slice(-2500), flags = Array.from(new Set(L.flags)).join(', ');
  L.pending = ''; L.flags = [];
  try {
    const r = await api('ai', { disputeId: S.curId, mode: 'interject', text: text || '(silence)', flags, as: S.speakAs });
    if (r.data && (r.data.interject || r.data.safety)) {
      if (r.data.safety) S.localSafety = true;
      showInterjection(r.data);
      if (r.data.decorum && r.data.decorum.length) showTips({ tips: r.data.decorum });
    }
  } catch (e) { /* keep listening */ } finally { L.asking = false; }
}
function showInterjection(data) {
  const g = GUIDES[S.cur.dispute.guide] || GUIDES.mother, el = $('#interject');
  el.className = 'toastx on' + (data.safety || data.tone === 'urgent' ? ' urgent' : '');
  el.innerHTML = `<div class="ge">${g.e}</div><div style="flex:1"><div class="lab">${esc(g.name.toUpperCase())} ${data.to && data.to !== 'everyone' ? '→ ' + esc(String(data.to).toUpperCase()) : ''}</div><div style="font-weight:700;font-size:1.05em">${esc(data.say || '')}</div></div><button class="iconbtn" id="ixClose">✕</button>`;
  $('#ixClose').onclick = () => el.classList.remove('on');
  clearTimeout(S.ixT); S.ixT = setTimeout(() => el.classList.remove('on'), 12000);
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  if (S.speak && window.speechSynthesis && data.say) {
    const L = S.live; L.paused = true; try { L.rec && L.rec.stop(); } catch (e) {}
    const u = new SpeechSynthesisUtterance(data.say); u.rate = .95; u.pitch = 1;
    u.onend = u.onerror = () => { L.paused = false; if (L.on) { try { L.rec.start(); } catch (e) {} } };
    speechSynthesis.speak(u);
  }
  loadCouncil(true);
}
function showTips(data) {
  const el = $('#myTips'); if (!el) return;
  el.innerHTML = `<div class="card" style="border-left:6px solid var(--plum)"><h3 style="margin-top:0">🔒 Just for you</h3><ul style="margin:0;padding-left:18px">${(data.tips || []).map(t => '<li>' + esc(t) + '</li>').join('')}</ul>${data.sayInstead ? '<div class="say">' + esc(data.sayInstead) + '</div>' : ''}</div>`;
}
function timeOut() {
  sheet(`<div style="text-align:center"><h2>Time out</h2><p>Everyone breathe together. In for 4, hold for 4, out for 6.</p>
    <div style="font-size:4em;font-weight:900;color:var(--navy)" id="toCount">60</div><p class="muted">When the timer ends, the person with the talking stick goes next.</p>
    <button class="btn wide" id="toEnd">We're ready</button></div>`);
  let n = 60; const t = setInterval(() => { n--; const c = $('#toCount'); if (!c || n <= 0) { clearInterval(t); closeSheet(); return; } c.textContent = n; }, 1000);
  $('#toEnd').onclick = () => { clearInterval(t); closeSheet(); };
}
function startMeter() {
  const L = S.live;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    if (!L.on) { stream.getTracks().forEach(t => t.stop()); return; }
    const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); const src = ac.createMediaStreamSource(stream); const an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
    L.stream = stream; L.ac = ac; const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (!L.on) return;
      an.getByteTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length), pct = Math.min(100, Math.round(rms * 400));
      const bar = $('#meterBar'); if (bar) bar.style.width = pct + '%';
      const lab = $('#meterLab');
      if (pct > 75) { if (!L.loudSince) L.loudSince = Date.now(); if (Date.now() - L.loudSince > 1800) { if (lab) lab.textContent = '📢 Voices are rising'; if (!L.loudFlagged) { L.loudFlagged = true; L.flags.push('voices rising'); askInterject(true); setTimeout(() => { L.loudFlagged = false; }, 30000); } } }
      else { L.loudSince = 0; if (lab) lab.textContent = 'Voice level'; }
      L.raf = requestAnimationFrame(tick);
    };
    tick();
  }).catch(() => {});
}
function stopMeter() { const L = S.live; cancelAnimationFrame(L.raf); if (L.stream) L.stream.getTracks().forEach(t => t.stop()); if (L.ac) L.ac.close().catch(() => {}); L.stream = null; L.ac = null; }

/* ---------- home vs court ---------- */
function vsTable(rows) {
  return `<div class="vs"><div class="hd home">🏠 In our home</div><div class="hd court">⚖️ In a real court</div>
    ${rows.map(r => `<div class="topic">${esc(r[0])}</div><div class="cell home">${esc(r[1])}</div><div class="cell court">${esc(r[2])}</div>`).join('')}</div>`;
}
function panelCourt(panel) {
  const c = S.cur.dispute.court, places = S.cur.members.map(m => esc(m.name) + ' (' + (m.age ? esc(m.age) + ', ' : '') + esc([m.region, m.state].filter(Boolean).join(', ') || 'place not set') + ')').join(' · ');
  panel.innerHTML = `
    <div class="card gold"><h3 style="margin-top:0">Your feelings matter here. In court, the law decides.</h3>
      <p class="muted" style="margin:4px 0">This shows how <b>this exact disagreement</b> would go at home and how a real court would handle it, using each person's state, county and age.</p>
      <p class="tiny">${places}</p>
      <button class="btn" id="courtGo">${c ? '🔄 Look it up again' : '⚖️ Look up the laws for us'}</button>
    </div>
    <div id="courtOut">${c ? courtHtml(c) : ''}</div>
    <h2>How every council compares</h2>
    ${vsTable(PHASES.slice(0, 7).map(p => [p[1], PHASE_HELP[p[0]], p[2]]))}
    <h2>The big differences</h2>${vsTable(HOME_VS_COURT)}`;
  $('#courtGo').onclick = async () => { const r = await runAi('court', $('#courtGo')); if (r && r.data) { S.tab = 'court'; refreshCouncil(true); } };
}
function courtHtml(c) {
  const hear = { yes: ['ok', 'A court could hear this'], no: ['bad', 'A court would not take this'], maybe: ['warn', 'Maybe, depending on details'] }[c.wouldCourtHear] || ['info', 'See below'];
  return `<div class="card">
      <span class="tag ${hear[0]}">${hear[1]}</span>
      <h3>${esc(c.headline || '')}</h3><p>${esc(c.why || '')}</p>
      ${c.court ? '<p><b>Which court:</b> ' + esc(c.court) + '</p>' : ''}
      ${c.forKids ? '<div class="kidbox"><div class="lab">FOR KIDS</div>' + esc(c.forKids) + '</div>' : ''}
    </div>
    ${c.homeVsCourt && c.homeVsCourt.length ? '<h2>This disagreement, side by side</h2>' + vsTable(c.homeVsCourt.map(r => [r.topic, r.home, r.court])) : ''}
    ${c.steps && c.steps.length ? '<h2>If it went to court</h2><ol class="card">' + c.steps.map(s => '<li style="margin:4px 0">' + esc(s) + '</li>').join('') + '</ol>' : ''}
    ${c.laws && c.laws.length ? '<h2>Laws that apply</h2>' + c.laws.map(l => `<div class="law"><div class="nm">${esc(l.name)} ${l.check ? '<span class="tag warn">Verify</span>' : ''}</div>${l.cite ? '<div class="ct">' + esc(l.cite) + '</div>' : ''}<div>${esc(l.plain || '')}</div>${l.link && /^https:\/\//.test(l.link) ? '<a class="tiny" href="' + esc(l.link) + '" target="_blank" rel="noopener noreferrer">Official source ›</a>' : ''}</div>`).join('') : ''}
    ${c.ageNotes ? '<div class="note"><b>Age rules:</b> ' + esc(c.ageNotes) + '</div>' : ''}
    ${c.costTime ? '<div class="note blue"><b>Cost and time in court:</b> ' + esc(c.costTime) + '</div>' : ''}
    <p class="tiny">Looked up by AI on ${c.at ? new Date(c.at).toLocaleDateString() : 'record'}. This is general education, not legal advice. Laws change; anything marked Verify must be checked with the official source or a lawyer.</p>`;
}

/* ---------- advocate ---------- */
function panelAdvocate(panel) {
  const myIds = S.cur.members.filter(m => m.mine).map(m => m.id);
  const notes = S.cur.entries.filter(e => e.private && e.kind === 'advocate' && (myIds.indexOf(e.authorId) >= 0 || true));
  const meM = me();
  panel.innerHTML = `
    <div class="card" style="border-left:6px solid var(--plum)">
      <h3 style="margin-top:0">🧑🏾‍💼 Your private advocate${meM ? ' for ' + esc(meM.name) : ''}</h3>
      <p class="muted">Like a lawyer's assistant, just for you. It helps you tell your side truthfully and strongly, and tells you your weak spots before someone else does. Nobody else in the council sees this.</p>
      <div class="guidebar">
        <button class="btn soft sm" data-q="Help me get ready to say my side.">Get ready</button>
        <button class="btn soft sm" data-q="What is my strongest point, and what can I show to back it up?">My strongest point</button>
        <button class="btn soft sm" data-q="What will the other side probably say, and how should I answer calmly?">What they'll say</button>
        <button class="btn soft sm" data-q="Honestly, what part of this is my fault?">Where I'm wrong</button>
        <button class="btn soft sm" data-q="Is the proposal on the table fair to me? What should I ask for?">Is this fair?</button>
      </div>
      <textarea class="f" id="advQ" placeholder="Ask your advocate anything about this council."></textarea>
      <div class="row end" style="margin-top:8px"><button class="btn" id="advGo">Ask privately</button></div>
    </div>
    <div class="feed">${notes.map(e => entryHtml(e, myIds)).join('') || '<div class="empty muted">Your private notes will show here.</div>'}</div>`;
  const ask = async q => { const b = $('#advGo'); const r = await runAi('advocate', b, q); if (r) { S.tab = 'advocate'; refreshCouncil(true); } };
  $$('[data-q]').forEach(b => b.onclick = () => ask(b.dataset.q));
  $('#advGo').onclick = () => { const q = $('#advQ').value.trim(); if (q) ask(q); };
}

/* ---------- resolution ---------- */
function useOption(entryId, i) {
  const e = S.cur.entries.find(x => x.id === entryId); if (!e || !e.meta || !e.meta.data) return;
  const d = e.meta.data, o = i >= 0 ? d.options[i] : d;
  S.draft = { source: i >= 0 ? 'agreement' : 'ruling', summary: o.summary || o.why || d.summary || '', terms: (o.terms || []).map(t => Object.assign({}, t)),
              consequence: o.consequence || '', repair: o.repair || '', reviewDate: d.reviewDate || '', plainForKids: d.plainForKids || '' };
  S.tab = 'resolution'; refreshCouncil(true);
}
function panelResolution(panel) {
  const d = S.cur.dispute, r = d.resolution, members = S.cur.members;
  if (S.draft && S.draft._auto && r && r.status !== 'appealed') S.draft = null; // someone else posted one: show it
  const ed = S.draft && !S.draft._auto ? S.draft : null;
  let html = '';
  if (r && !ed && r.status !== 'appealed') {
    const signed = Object.keys(r.signatures || {});
    html += `<div class="scroll">${r.status === 'binding' ? '<div class="stamp">BINDING</div>' : ''}
      <div class="tiny" style="text-align:center;letter-spacing:.14em;font-weight:800">${r.source === 'ruling' ? 'RULING OF THE COUNCIL' : 'AGREEMENT OF THE COUNCIL'}</div>
      <h3>${esc(d.title)}</h3>${r.summary ? '<p>' + esc(r.summary) + '</p>' : ''}
      ${r.terms.map((t, i) => `<div class="promise"><div class="n">${i + 1}</div><div><b>${esc(t.who)}</b> will ${esc(t.what)}${t.by ? ' <span class="muted">(' + esc(t.by) + ')</span>' : ''}</div></div>`).join('')}
      ${r.consequence ? '<p><b>If a promise is broken:</b> ' + esc(r.consequence) + '</p>' : ''}${r.repair ? '<p><b>Making it right:</b> ' + esc(r.repair) + '</p>' : ''}
      ${r.reviewDate ? '<p><b>Check-in:</b> ' + esc(r.reviewDate) + '</p>' : ''}
      ${r.plainForKids ? '<div class="kidbox"><div class="lab">FOR KIDS</div>' + esc(r.plainForKids) + '</div>' : ''}
      <h3>Signatures</h3>
      ${members.map(m => { const s = r.signatures[m.id]; return `<div class="sig">${avatar(m.name)}<div style="flex:1">${s ? (s.agree ? '<span class="nm">' + esc(m.name) + '</span> <span class="tag ok">Agreed</span>' : '<b>' + esc(m.name) + '</b> <span class="tag bad">Did not agree</span>' + (s.note ? '<div class="tiny">' + esc(s.note) + '</div>' : '')) : '<b>' + esc(m.name) + '</b> <span class="tiny">has not signed</span>'}</div>
        ${m.mine && r.status !== 'binding' && !(s && s.agree) ? `<button class="btn sm green" data-sign="${esc(m.id)}" data-agree="1">Sign</button><button class="btn sm ghost" data-sign="${esc(m.id)}" data-agree="0">Not yet</button>` : ''}</div>`; }).join('')}
      ${r.status !== 'binding' && r.source === 'ruling' ? '<p class="tiny">Because this is a ruling: if everyone made the council promise, it becomes binding once everyone has signed, even if someone does not agree.</p>' : ''}
      ${r.status !== 'binding' && r.source !== 'ruling' ? '<p class="tiny">An agreement is binding when everyone signs "agree". Can\'t agree? Ask the guide for a final ruling.</p>' : ''}
    </div>
    <div class="row" style="margin-top:10px">
      ${r.status !== 'binding' ? '<button class="btn ghost sm" id="editRes">Change it</button>' : ''}
      ${r.status !== 'binding' && r.source !== 'ruling' ? '<button class="btn sm" data-ai="ruling">⚖️ We can\'t agree: final ruling</button>' : ''}
      ${!d.appealUsed && r.source === 'ruling' ? '<button class="btn ghost sm" id="appeal">Appeal (once)</button>' : ''}
    </div>`;
    if (r.status === 'binding') {
      const mine = members.filter(m => m.mine);
      const fu = d.followUps || [];
      html += `<h2>Keeping the promise</h2><div class="card">
        <p class="muted">Check in honestly. Kept promises build your 🔥 streak and earn Peace Points.</p>
        ${mine.map(m => `<div class="row" style="margin:8px 0"><b style="flex:1">${esc(m.name)}</b><button class="btn sm green" data-ci="${esc(m.id)}" data-kept="1">✅ I kept it</button><button class="btn sm ghost" data-ci="${esc(m.id)}" data-kept="0">I slipped</button></div>`).join('')}
        ${fu.length ? '<div class="board">' + fu.slice(-8).reverse().map(f => `<div class="r">${f.kept ? '✅' : '⚠️'} <b>${esc(f.name)}</b> <span class="muted">${esc(f.note || '')}</span><span class="pts tiny">${ago(f.time)}</span></div>`).join('') + '</div>' : ''}
      </div>`;
    }
  } else {
    const draft = S.draft || { _auto: true, source: 'agreement', terms: [{ who: '', what: '', by: '' }], consequence: '', repair: '', reviewDate: '', summary: '' };
    S.draft = draft;
    if (r && r.status === 'appealed') html += '<div class="note">This was appealed. ' + esc((GUIDES[d.guide] || GUIDES.mother).name) + ' will take a fresh look. Ask for a new ruling or write an agreement.</div>';
    html += `<div class="card">
      <h3 style="margin-top:0">Write the ${draft.source === 'ruling' ? 'ruling' : 'agreement'}</h3>
      <p class="muted">Be specific: who does what, by when. Use a guide suggestion from the Council tab, or write your own.</p>
      <label class="f">Summary</label><textarea class="f" data-dk="summary" style="min-height:60px">${esc(draft.summary || '')}</textarea>
      <label class="f">Promises</label>
      <div id="terms">${draft.terms.map((t, i) => `<div class="term">
        <select class="f" data-ti="${i}" data-tk="who"><option value="">Who</option>${members.map(m => `<option ${t.who === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option ${t.who === 'Everyone' ? 'selected' : ''}>Everyone</option></select>
        <input class="f what" data-ti="${i}" data-tk="what" placeholder="does the dishes Mon, Wed, Fri" value="${esc(t.what)}">
        <input class="f" data-ti="${i}" data-tk="by" placeholder="by 8 pm" value="${esc(t.by)}">
        <button class="btn ghost sm" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>
      <button class="btn soft sm" id="addTerm">＋ Add a promise</button>
      <label class="f">If a promise is broken</label><input class="f" data-dk="consequence" value="${esc(draft.consequence)}" placeholder="Example: take an extra night">
      <label class="f">How to make it right</label><input class="f" data-dk="repair" value="${esc(draft.repair)}" placeholder="Example: apologize and help finish">
      <label class="f">Check-in date</label><input class="f" type="date" data-dk="reviewDate" value="${esc(draft.reviewDate)}">
      <div class="err" id="resErr"></div>
      <div class="row"><button class="btn gold" id="saveRes" style="flex:1">📜 Put it up for signatures</button>${ed ? '<button class="btn ghost" id="cancelRes">Cancel</button>' : ''}</div>
    </div>
    <div class="row"><button class="btn ghost sm" data-ai="propose">💡 Ask the guide for options</button><button class="btn sm" data-ai="ruling">⚖️ Final ruling</button></div>`;
  }
  panel.innerHTML = html;
  $$('#cPanel [data-ai]').forEach(b => b.onclick = async () => { const res = await runAi(b.dataset.ai, b); if (res && res.data && b.dataset.ai === 'ruling') { const ent = S.cur.entries.find(x => x.id === res.entryId); if (ent) useOption(ent.id, -1); } else if (res) { S.tab = 'council'; refreshCouncil(true); } });
  $$('[data-sign]').forEach(b => b.onclick = async () => {
    const agree = b.dataset.agree === '1'; let note = '';
    if (!agree) { note = prompt('What would make it fair for you? (optional)') || ''; }
    busy(b, true);
    try { const res = await api('sign', { disputeId: S.curId, as: b.dataset.sign, agree, note }); if (res.status === 'binding') { confetti(); toast('Binding! Everyone keeps it now. 🕊'); } await loadCouncil(true); refreshCouncil(true); refreshMe(); }
    catch (e) { toast(e.message); busy(b, false); }
  });
  $$('[data-ci]').forEach(b => b.onclick = async () => {
    const kept = b.dataset.kept === '1'; const note = prompt(kept ? 'Anything to add? (optional)' : 'What happened, and what will you do now?') || '';
    try { await api('checkIn', { disputeId: S.curId, as: b.dataset.ci, kept, note }); if (kept) toast('Promise kept! 🔥'); await loadCouncil(true); refreshCouncil(true); refreshMe(); } catch (e) { toast(e.message); }
  });
  const er = $('#editRes'); if (er) er.onclick = () => { S.draft = Object.assign({}, r, { terms: r.terms.map(t => Object.assign({}, t)) }); refreshCouncil(true); };
  const ap = $('#appeal'); if (ap) ap.onclick = async () => { const why = prompt('Why do you want to appeal? A different guide will review it. You only get one appeal.'); if (why === null) return; try { const res = await api('appeal', { disputeId: S.curId, reason: why, as: S.speakAs }); toast('Appealed to ' + (GUIDES[res.guide] || {}).name + '.'); S.draft = null; await loadCouncil(true); refreshCouncil(true); } catch (e) { toast(e.message); } };
  $$('[data-dk]').forEach(el => el.oninput = () => { S.draft[el.dataset.dk] = el.value; S.draft._auto = false; });
  $$('[data-tk]').forEach(el => el.oninput = el.onchange = () => { S.draft.terms[Number(el.dataset.ti)][el.dataset.tk] = el.value; S.draft._auto = false; });
  $$('[data-rm]').forEach(b => b.onclick = () => { S.draft.terms.splice(Number(b.dataset.rm), 1); if (!S.draft.terms.length) S.draft.terms.push({ who: '', what: '', by: '' }); refreshCouncil(true); });
  const at = $('#addTerm'); if (at) at.onclick = () => { S.draft.terms.push({ who: '', what: '', by: '' }); refreshCouncil(true); };
  const cr = $('#cancelRes'); if (cr) cr.onclick = () => { S.draft = null; refreshCouncil(true); };
  const sr = $('#saveRes'); if (sr) sr.onclick = async () => {
    busy(sr, true, 'Saving');
    try { await api('saveResolution', { disputeId: S.curId, resolution: S.draft, as: S.speakAs }); S.draft = null; await loadCouncil(true); refreshCouncil(true); toast('Ready for signatures. ✍️'); }
    catch (e) { $('#resErr').textContent = e.message; busy(sr, false); }
  };
}

/* ============================ board / learn / me ============================ */
async function renderBoard(v) {
  v.innerHTML = '<h1 style="font-size:1.3em;margin-top:6px">🏆 Peace board</h1><p class="muted">Points come from speaking up, apologizing, inviting, reaching resolutions and keeping promises. Not from winning.</p><div class="card board" id="brd"><span class="typing"><i></i><i></i><i></i></span></div>' +
    '<h2>How to earn Peace Points</h2><div class="card"><div class="board">' + [['🗣', 'Say your side', 10], ['↩', 'Respond calmly', 6], ['💚', 'Offer a real apology', 15], ['💡', 'Suggest a fix', 8], ['🌉', 'Invite someone to settle it', 3], ['🕊', 'Reach a binding resolution', 25], ['🤝', 'Keep a promise at check-in', 15]].map(x => `<div class="r"><span style="font-size:1.3em">${x[0]}</span>${esc(x[1])}<span class="pts">+${x[2]}</span></div>`).join('') + '</div></div>';
  try {
    const r = await api('scoreboard'); const b = $('#brd'); if (!b) return;
    b.innerHTML = r.board.map((x, i) => `<div class="r"><div class="rank">${i === 0 ? '👑' : i + 1}</div>${avatar(x.name)}<div><b>${esc(x.name)}${x.me ? ' (you)' : ''}</b><div class="tiny">${esc(x.level)} · 🔥 ${x.streak}</div></div><div class="pts">${x.points} 🕊</div></div>`).join('') || '<div class="muted">Nobody yet.</div>';
  } catch (e) { toast(e.message); }
}
function renderLearn(v) {
  v.innerHTML = `<h1 style="font-size:1.3em;margin-top:6px">⚖️ Home vs. a real court</h1>
    <div class="kidbox"><div class="lab">FOR KIDS</div>At home, how you feel matters, and your family works it out together. A real court is different: a judge follows the law and looks at proof. Being upset, or being louder, doesn't win in court.</div>
    <p class="muted">Inside any council, open the <b>Home vs Court</b> tab to see the laws for your state, county and ages for that exact disagreement.</p>
    <h2>Step by step</h2>${vsTable(PHASES.slice(0, 7).map(p => [p[1], PHASE_HELP[p[0]], p[2]]))}
    <h2>The big differences</h2>${vsTable(HOME_VS_COURT)}
    <h2>When it's not a family-council problem</h2>
    <div class="card"><p>Some things need help right away, not a council: someone hurting you or someone else, threats, touching that isn't okay, or thoughts of hurting yourself.</p>${safetyBox()}</div>`;
}
function renderMe(v) {
  const u = S.user; if (!u) return;
  const hh = u.household || [];
  v.innerHTML = `<div class="hello">${avatar(u.name, 'lg')}<div><h1 style="font-size:1.3em">${esc(u.name)}</h1><div class="muted">${esc(u.email)}</div></div></div>
    <div class="card"><h3 style="margin-top:0">About me</h3>
      <div class="grid2"><div><label class="f" for="pName">First name</label><input class="f" id="pName" value="${esc(u.name)}"></div><div><label class="f" for="pAge">Age</label><input class="f" id="pAge" type="number" value="${esc(u.age)}"></div></div>
      <label class="f" for="pState">State</label><select class="f" id="pState">${stateOptions(u.state)}</select>
      <label class="f" for="pRegion">County and city</label><input class="f" id="pRegion" value="${esc(u.region)}">
      <label class="chk"><input type="checkbox" id="pFaith" ${u.faith ? 'checked' : ''}> <span>Faith mode (guides may share a short scripture)</span></label>
      <button class="btn" id="pSave">Save</button></div>
    <div class="card"><h3 style="margin-top:0">👨‍👩‍👧‍👦 Family members on my account</h3>
      <p class="muted">For kids under 13 and anyone without their own phone. They speak and sign on your device, and earn their own Peace Points.</p>
      <div id="hhList">${hh.map((h, i) => hhRow(h, i)).join('')}</div>
      <div class="row"><button class="btn soft sm" id="hhAdd">＋ Add someone</button><button class="btn sm" id="hhSave">Save family</button></div></div>
    <div class="card"><h3 style="margin-top:0">🔐 Change my PIN</h3>
      <div class="grid2"><input class="f pin" id="pOld" type="password" inputmode="numeric" maxlength="8" placeholder="Current"><input class="f pin" id="pNew" type="password" inputmode="numeric" maxlength="8" placeholder="New"></div>
      <button class="btn ghost sm" id="pPin" style="margin-top:8px">Change PIN</button></div>
    <div class="card"><h3 style="margin-top:0">🔠 Text size</h3><div class="row"><button class="btn ghost sm" id="fsMinus">A− Smaller</button><button class="btn ghost sm" id="fsPlus">A+ Bigger</button></div></div>
    <details class="card"><summary>What you agreed to</summary><ul class="muted" style="padding-left:18px">${CONSENT.map(c => '<li>' + c + '</li>').join('')}</ul></details>
    <details class="card"><summary>Server (for the app owner)</summary><p class="muted">Only change this if the app owner gave you a new server address.</p>
      <input class="f" id="srv" value="${esc(LS.get('relay') || '')}" placeholder="${esc((window.FC_CONFIG && window.FC_CONFIG.RELAY_URL) || 'https://script.google.com/macros/s/.../exec')}">
      <button class="btn ghost sm" id="srvSave" style="margin-top:8px">Save server</button></details>
    <button class="btn red wide" id="out" style="margin-top:10px">Sign out</button>
    <p class="tiny" style="text-align:center;margin-top:14px">Family Council 1.0 · Not a court or legal advice · In danger call 911 · Crisis call or text 988</p>`;
  $('#pSave').onclick = async () => { try { const r = await api('updateProfile', { name: $('#pName').value, age: $('#pAge').value, state: $('#pState').value, region: $('#pRegion').value, faith: $('#pFaith').checked }); setUser(r.user); toast('Saved.'); } catch (e) { toast(e.message); } };
  $('#hhAdd').onclick = () => { const l = $('#hhList'); l.insertAdjacentHTML('beforeend', hhRow({ name: '', age: '', relation: '' }, l.children.length)); };
  $('#hhSave').onclick = async () => {
    const rows = $$('#hhList .hh').map(r => ({ id: r.dataset.id || undefined, name: r.querySelector('[data-h=name]').value, age: r.querySelector('[data-h=age]').value, relation: r.querySelector('[data-h=relation]').value }));
    try { const r = await api('saveHousehold', { household: rows }); setUser(r.user); toast('Family saved.'); renderMe(v); } catch (e) { toast(e.message); }
  };
  $('#hhList').onclick = e => { const b = e.target.closest('[data-hrm]'); if (b) b.closest('.hh').remove(); };
  $('#pPin').onclick = async () => { try { await api('updateProfile', { pin: $('#pOld').value, newPin: $('#pNew').value }); toast('PIN changed.'); $('#pOld').value = $('#pNew').value = ''; } catch (e) { toast(e.message); } };
  $('#srvSave').onclick = () => { const s = $('#srv').value.trim(); if (s && !/^https:\/\/script\.google(usercontent)?\.com\//.test(s) && !/^https?:\/\/localhost/.test(s)) { toast('That is not an Apps Script address.'); return; } if (s) LS.set('relay', s); else LS.del('relay'); toast('Server saved.'); };
  $('#fsMinus').onclick = () => setFs(-1); $('#fsPlus').onclick = () => setFs(1);
  $('#out').onclick = async () => { try { await api('logout'); } catch (e) {} signOutLocal(); };
}
function hhRow(h, i) {
  return `<div class="hh term" data-id="${esc(h.id || '')}"><input class="f" data-h="name" placeholder="Name" value="${esc(h.name)}"><input class="f" data-h="relation" placeholder="Relation" value="${esc(h.relation || '')}"><input class="f" data-h="age" type="number" placeholder="Age" value="${esc(h.age || '')}"><button class="btn ghost sm" data-hrm="${i}" aria-label="Remove">✕</button>${h.points ? '<div class="tiny" style="grid-column:1/-1">🕊 ' + h.points + ' points' + ((h.badges || []).length ? ' · ' + h.badges.map(b => (BADGES[b] || ['🏅'])[0]).join(' ') : '') + '</div>' : ''}</div>`;
}

/* ============================ start ============================ */
async function boot() {
  if (!S.token) { go('welcome'); return; }
  go('loading');
  try { const r = await api('me'); setUser(r.user); go('home'); }
  catch (e) { if (e.code === 'signed_out' || !S.token) { go('welcome'); } else { go('home'); toast(e.message); } return; }
  if (S.pendingJoin) joinSheet(S.pendingJoin);
}
const _renderHome = renderHome;
renderHome = function (v) { _renderHome(v); loadHome().then(okk => { if (okk && S.view === 'home') _renderHome(v); }); };
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
})();

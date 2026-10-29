/**
 * Family Council — server (Google Apps Script)
 * Runs in the owner's own Google account. Stores everything in one private Google Sheet
 * ("Family Council - Private Data") that the script creates on first run.
 *
 * What it does:
 *   - Accounts: email + PIN, with a one-time email code to confirm the email.
 *   - Disputes: create, invite with a join code, join, post sides, phases, talking stick.
 *   - AI guides (Judge, Mother, Elder, Grandmother, Pastor, Mediator), private advocate and
 *     behavior coach for each person, live interjections, proposals, rulings,
 *     and a "home vs. real court" comparison for each person's state, region and age.
 *   - Resolutions everyone signs, follow-up check-ins, Peace Points, streaks and badges.
 *   - Health check for CAIOCC: open the web app URL, it returns {"ok":true,...} and nothing private.
 *
 * Script Properties (Project Settings > Script Properties):
 *   ANTHROPIC_API_KEY  required  your key from console.anthropic.com (all AI use bills to this key)
 *   APP_URL            optional  the GitHub Pages address, used in invite and code emails
 *   SUPPORT_EMAIL      optional  shown in emails; defaults to the Google account running the script
 *   AI_PER_HOUR        optional  AI requests allowed per person per hour (default 40)
 *   MODEL_QUICK        optional  default claude-sonnet-5-5 (live interjections, coaching)
 *   MODEL_DEFAULT      optional  default claude-sonnet-5-5 (guide, advocate, proposals)
 *   MODEL_COMPLEX      optional  default claude-opus-5-5   (rulings, court comparison)
 *   (PEPPER and DATA_SHEET_ID are created automatically. Do not share or change PEPPER.)
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 * "Anyone" lets phones reach it; every data request still needs a signed-in account.
 */

var VERSION = '1.0.0';
var APP_NAME = 'Family Council';
var SHEET_NAME = 'Family Council - Private Data';
var SESSION_DAYS = 30;

var SCHEMA = {
  Users:    ['id','email','name','pinHash','salt','state','region','age','faith','household','points','streak','lastDay','badges','created','fails','lockUntil','stats'],
  Sessions: ['tokenHash','userId','expires','created'],
  Disputes: ['id','title','category','description','guide','createdBy','created','updated','status','phase','floor','joinCode','codeExp','resolution','court','version','followUps','appealUsed'],
  Members:  ['id','disputeId','userId','hostId','name','relation','age','state','region','joined','consentLive','covenant','isGuest'],
  Entries:  ['id','disputeId','authorId','authorName','kind','text','privateTo','phase','time','meta'],
  Audit:    ['time','action','ok','who']
};
var PHASES = ['open','sides','responses','questions','proposals','resolution','followup','closed'];
var CATEGORIES = ['chores','siblings','parent-child','relationship','friends','money','respect','screen-time','school','other'];
var GUIDE_IDS = ['judge','mother','elder','grandmother','pastor','mediator'];

/* ============================ entry points ============================ */
function doGet() {
  return json_({ ok: true, app: APP_NAME + ' Relay', version: VERSION, time: new Date().toISOString(),
                 configured: !!prop_('ANTHROPIC_API_KEY') });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  var action = String(req && req.action || '');
  if (!globalRateOk_()) return json_({ ok: false, error: 'busy', message: 'The council is busy. Try again in a minute.' });
  try {
    var pub = PUBLIC_ACTIONS[action];
    if (pub) { var r = pub(req); audit_(action, r.ok, req.email || ''); return json_(r); }
    var fn = ACTIONS[action];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    var user = auth_(req.token);
    if (!user) { audit_(action, false, ''); return json_({ ok: false, error: 'signed_out', message: 'Please sign in again.' }); }
    if (!userRateOk_(user.id)) return json_({ ok: false, error: 'rate_limited', message: 'Slow down a little and try again.' });
    var out = fn(req, user);
    if (out && out.ok && action !== 'poll' && action !== 'getDispute' && action !== 'me' && action !== 'listDisputes') audit_(action, true, user.id);
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err).slice(0, 300) });
  }
}

var PUBLIC_ACTIONS = {
  ping: function () { return { ok: true, version: VERSION }; },
  sendCode: sendCode_,
  signup: signup_,
  login: login_,
  resetPin: resetPin_
};

var ACTIONS = {
  me: function (req, u) { return { ok: true, user: publicUser_(u) }; },
  logout: logout_,
  updateProfile: updateProfile_,
  saveHousehold: saveHousehold_,
  listDisputes: listDisputes_,
  createDispute: createDispute_,
  invite: invite_,
  join: join_,
  addGuest: addGuest_,
  getDispute: getDispute_,
  poll: poll_,
  post: post_,
  setPhase: setPhase_,
  setFloor: setFloor_,
  consent: consent_,
  ai: ai_,
  saveResolution: saveResolution_,
  sign: sign_,
  appeal: appeal_,
  checkIn: checkIn_,
  closeDispute: closeDispute_,
  scoreboard: scoreboard_
};

/* ============================ accounts ============================ */
function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120; }
function validPin_(p) { return /^\d{4,8}$/.test(String(p || '')); }

function sendCode_(req) {
  var email = normEmail_(req.email), purpose = req.purpose === 'reset' ? 'reset' : 'signup';
  if (!validEmail_(email)) return { ok: false, error: 'bad_email', message: 'Enter a real email address.' };
  var existing = findUserByEmail_(email);
  if (purpose === 'signup' && existing) return { ok: false, error: 'exists', message: 'That email already has an account. Sign in instead.' };
  if (purpose === 'reset' && !existing) return { ok: true, sent: true }; // don't reveal who has accounts
  var c = CacheService.getScriptCache();
  var sentKey = 'codes_' + email, sent = Number(c.get(sentKey) || 0);
  if (sent >= 4) return { ok: false, error: 'too_many_codes', message: 'Too many codes sent. Wait 30 minutes.' };
  c.put(sentKey, String(sent + 1), 1800);
  var code = String(Math.floor(100000 + secureRandom_() * 900000));
  c.put('code_' + purpose + '_' + email, JSON.stringify({ code: code, tries: 0 }), 900);
  sendCodeEmail_(email, code, purpose);
  return { ok: true, sent: true };
}

function checkCode_(email, purpose, code) {
  var c = CacheService.getScriptCache(), k = 'code_' + purpose + '_' + email, raw = c.get(k);
  if (!raw) return 'expired';
  var o = JSON.parse(raw);
  if (o.tries >= 5) { c.remove(k); return 'expired'; }
  if (!safeEqual_(String(code || '').trim(), o.code)) { o.tries++; c.put(k, JSON.stringify(o), 900); return 'wrong'; }
  c.remove(k); return 'ok';
}

function signup_(req) {
  var email = normEmail_(req.email);
  if (!validEmail_(email)) return { ok: false, error: 'bad_email', message: 'Enter a real email address.' };
  if (!validPin_(req.pin)) return { ok: false, error: 'bad_pin', message: 'Your PIN must be 4 to 8 numbers.' };
  var name = clean_(req.name, 40);
  if (!name) return { ok: false, error: 'bad_name', message: 'Enter your first name.' };
  var age = Number(req.age);
  if (!(age >= 1 && age <= 120)) return { ok: false, error: 'bad_age', message: 'Enter your age.' };
  if (age < 13) return { ok: false, error: 'too_young', message: 'Under 13? Ask a parent to add you as a family member on their account.' };
  if (!clean_(req.state, 40)) return { ok: false, error: 'bad_state', message: 'Choose your state.' };
  if (!req.consent) return { ok: false, error: 'consent', message: 'Please read and check the agreement.' };
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    if (findUserByEmail_(email)) return { ok: false, error: 'exists', message: 'That email already has an account. Sign in instead.' };
    var cc = checkCode_(email, 'signup', req.code);
    if (cc !== 'ok') return { ok: false, error: 'bad_code', message: cc === 'wrong' ? 'That code is not right.' : 'That code expired. Send a new one.' };
    var salt = Utilities.getUuid();
    var u = {
      id: 'u_' + shortId_(), email: email, name: name, salt: salt, pinHash: hashPin_(req.pin, salt),
      state: clean_(req.state, 40), region: clean_(req.region, 80), age: age, faith: !!req.faith,
      household: '[]', points: 10, streak: 0, lastDay: '', badges: '["welcome"]', created: Date.now(),
      fails: 0, lockUntil: 0, stats: JSON.stringify({ consentAt: Date.now(), consentVersion: '1' })
    };
    insert_('Users', u);
    return { ok: true, token: newSession_(u.id), user: publicUser_(u) };
  } finally { lock.releaseLock(); }
}

function login_(req) {
  var email = normEmail_(req.email);
  var u = findUserByEmail_(email);
  if (!u) { Utilities.sleep(700); return { ok: false, error: 'bad_login', message: 'Email or PIN is not right.' }; }
  if (Number(u.lockUntil) > Date.now()) return { ok: false, error: 'locked', message: 'Too many wrong PINs. Try again in 15 minutes, or reset your PIN.' };
  if (!safeEqual_(hashPin_(String(req.pin || ''), u.salt), String(u.pinHash))) {
    u.fails = Number(u.fails || 0) + 1;
    if (u.fails >= 5) { u.lockUntil = Date.now() + 15 * 60000; u.fails = 0; }
    update_('Users', u); Utilities.sleep(700);
    return { ok: false, error: 'bad_login', message: 'Email or PIN is not right.' };
  }
  u.fails = 0; u.lockUntil = 0; update_('Users', u);
  return { ok: true, token: newSession_(u.id), user: publicUser_(u) };
}

function resetPin_(req) {
  var email = normEmail_(req.email);
  if (!validPin_(req.pin)) return { ok: false, error: 'bad_pin', message: 'Your PIN must be 4 to 8 numbers.' };
  var u = findUserByEmail_(email);
  var cc = checkCode_(email, 'reset', req.code);
  if (!u || cc !== 'ok') return { ok: false, error: 'bad_code', message: 'That code is not right or expired.' };
  u.salt = Utilities.getUuid(); u.pinHash = hashPin_(req.pin, u.salt); u.fails = 0; u.lockUntil = 0;
  update_('Users', u);
  // sign out every other device
  rows_('Sessions').filter(function (s) { return s.userId === u.id; }).forEach(function (s) { s.expires = 0; update_('Sessions', s); });
  return { ok: true, token: newSession_(u.id), user: publicUser_(u) };
}

function logout_(req, u) {
  var h = sha_(String(req.token));
  rows_('Sessions').forEach(function (s) { if (s.tokenHash === h) { s.expires = 0; update_('Sessions', s); } });
  CacheService.getScriptCache().remove('tok_' + h);
  return { ok: true };
}

function updateProfile_(req, u) {
  if (req.name) u.name = clean_(req.name, 40) || u.name;
  if (req.state) u.state = clean_(req.state, 40);
  if (req.region !== undefined) u.region = clean_(req.region, 80);
  if (req.age) { var a = Number(req.age); if (a >= 13 && a <= 120) u.age = a; }
  if (req.faith !== undefined) u.faith = !!req.faith;
  if (req.newPin) {
    if (!validPin_(req.newPin)) return { ok: false, error: 'bad_pin', message: 'Your PIN must be 4 to 8 numbers.' };
    if (!safeEqual_(hashPin_(String(req.pin || ''), u.salt), String(u.pinHash))) return { ok: false, error: 'bad_pin', message: 'Your current PIN is not right.' };
    u.salt = Utilities.getUuid(); u.pinHash = hashPin_(req.newPin, u.salt);
  }
  update_('Users', u);
  return { ok: true, user: publicUser_(u) };
}

// Family members who don't have their own account (for example, children under 13).
function saveHousehold_(req, u) {
  var list = Array.isArray(req.household) ? req.household.slice(0, 12) : [];
  var old = parse_(u.household, []);
  var out = list.map(function (h) {
    var prev = old.filter(function (o) { return o.id === h.id; })[0] || {};
    var age = Number(h.age);
    return { id: prev.id || ('h_' + shortId_()), name: clean_(h.name, 40), age: age >= 1 && age <= 120 ? age : '', relation: clean_(h.relation, 40),
             points: Number(prev.points || 0), streak: Number(prev.streak || 0), badges: prev.badges || [] };
  }).filter(function (h) { return h.name; });
  u.household = JSON.stringify(out); update_('Users', u);
  return { ok: true, user: publicUser_(u) };
}

function publicUser_(u) {
  return { id: u.id, email: u.email, name: u.name, state: u.state, region: u.region, age: Number(u.age) || '',
           faith: u.faith === true || u.faith === 'TRUE', household: parse_(u.household, []), points: Number(u.points || 0),
           streak: Number(u.streak || 0), badges: parse_(u.badges, []), level: level_(Number(u.points || 0)) };
}

function level_(p) {
  var L = [[0, 'Seedling'], [60, 'Sprout'], [150, 'Olive Branch'], [300, 'Bridge Builder'], [550, 'Peacemaker'], [900, 'Wise Counsel'], [1400, 'Elder']];
  var cur = L[0], next = null;
  for (var i = 0; i < L.length; i++) { if (p >= L[i][0]) { cur = L[i]; next = L[i + 1] || null; } }
  return { name: cur[1], floor: cur[0], next: next ? next[1] : null, nextAt: next ? next[0] : null };
}

/* ============================ sessions ============================ */
function newSession_(userId) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  insert_('Sessions', { tokenHash: sha_(token), userId: userId, expires: Date.now() + SESSION_DAYS * 864e5, created: Date.now() });
  return token;
}
function auth_(token) {
  if (!token || String(token).length < 40) return null;
  var h = sha_(String(token)), c = CacheService.getScriptCache(), uid = c.get('tok_' + h);
  if (!uid) {
    var s = rows_('Sessions').filter(function (x) { return x.tokenHash === h && Number(x.expires) > Date.now(); })[0];
    if (!s) return null;
    uid = s.userId; c.put('tok_' + h, uid, 600);
  }
  return findUser_(uid);
}

/* ============================ disputes ============================ */
function myMemberships_(u) { return rows_('Members').filter(function (m) { return m.userId === u.id || m.hostId === u.id; }); }
function memberOf_(d, u) { return rows_('Members').filter(function (m) { return m.disputeId === d && (m.userId === u.id || m.hostId === u.id); }); }

function listDisputes_(req, u) {
  var ids = {}; myMemberships_(u).forEach(function (m) { ids[m.disputeId] = true; });
  var members = rows_('Members');
  var list = rows_('Disputes').filter(function (d) { return ids[d.id]; }).map(function (d) {
    var res = parse_(d.resolution, null);
    return { id: d.id, title: d.title, category: d.category, guide: d.guide, status: d.status, phase: d.phase, updated: Number(d.updated),
             people: members.filter(function (m) { return m.disputeId === d.id; }).map(function (m) { return m.name; }),
             binding: !!(res && res.status === 'binding'), nextCheck: res && res.reviewDate || '' };
  }).sort(function (a, b) { return b.updated - a.updated; });
  return { ok: true, disputes: list, user: publicUser_(u) };
}

function createDispute_(req, u) {
  var title = clean_(req.title, 90);
  if (!title) return { ok: false, error: 'bad_title', message: 'Give the disagreement a short name, like "Whose turn for dishes".' };
  var d = {
    id: 'd_' + shortId_(), title: title, category: CATEGORIES.indexOf(req.category) >= 0 ? req.category : 'other',
    description: clean_(req.description, 1500), guide: GUIDE_IDS.indexOf(req.guide) >= 0 ? req.guide : 'mother',
    createdBy: u.id, created: Date.now(), updated: Date.now(), status: 'open', phase: 'open', floor: '',
    joinCode: newJoinCode_(), codeExp: Date.now() + 7 * 864e5, resolution: '', court: '', version: 1, followUps: '[]', appealUsed: false
  };
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    insert_('Disputes', d);
    insert_('Members', { id: 'm_' + shortId_(), disputeId: d.id, userId: u.id, hostId: '', name: u.name, relation: clean_(req.relation, 40),
                         age: u.age, state: u.state, region: u.region, joined: Date.now(), consentLive: false, covenant: false, isGuest: false });
    (Array.isArray(req.guests) ? req.guests : []).slice(0, 8).forEach(function (hid) { addHouseholdMember_(d.id, u, hid); });
    addEntry_(d.id, 'system', APP_NAME, 'system', u.name + ' opened this council. Guide: ' + guideName_(d.guide) + '.', '', 'open');
  } finally { lock.releaseLock(); }
  award_(u.id, '', 5, 'first_council');
  return { ok: true, dispute: { id: d.id, joinCode: d.joinCode } };
}

function newJoinCode_() {
  var A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 6; i++) s += A.charAt(Math.floor(secureRandom_() * A.length));
  return s.slice(0, 3) + '-' + s.slice(3);
}

function invite_(req, u) {
  var d = findDispute_(req.disputeId); if (!d || !memberOf_(d.id, u).length) return notFound_();
  if (req.fresh || Number(d.codeExp) < Date.now()) { d.joinCode = newJoinCode_(); d.codeExp = Date.now() + 7 * 864e5; bump_(d); }
  var emailed = false;
  if (req.email) {
    var to = normEmail_(req.email);
    if (!validEmail_(to)) return { ok: false, error: 'bad_email', message: 'That email does not look right.' };
    var c = CacheService.getScriptCache(), k = 'inv_' + u.id, n = Number(c.get(k) || 0);
    if (n >= 10) return { ok: false, error: 'too_many', message: 'You have sent a lot of invites. Try again in an hour.' };
    c.put(k, String(n + 1), 3600);
    sendInviteEmail_(to, u.name, d.title, d.joinCode, clean_(req.note, 300));
    emailed = true;
  }
  award_(u.id, '', 3, 'bridge');
  return { ok: true, joinCode: d.joinCode, expires: Number(d.codeExp), emailed: emailed };
}

function join_(req, u) {
  var code = String(req.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) return { ok: false, error: 'bad_code', message: 'Join codes look like ABC-123.' };
  code = code.slice(0, 3) + '-' + code.slice(3);
  var c = CacheService.getScriptCache(), k = 'join_' + u.id, n = Number(c.get(k) || 0);
  if (n >= 10) return { ok: false, error: 'too_many', message: 'Too many tries. Wait 15 minutes.' };
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var d = rows_('Disputes').filter(function (x) { return x.joinCode === code; })[0];
    if (!d || Number(d.codeExp) < Date.now() || d.status === 'closed') { c.put(k, String(n + 1), 900); return { ok: false, error: 'bad_code', message: 'That code is not working. Ask for a new one.' }; }
    var mine = rows_('Members').filter(function (m) { return m.disputeId === d.id && m.userId === u.id; })[0];
    if (!mine) {
      insert_('Members', { id: 'm_' + shortId_(), disputeId: d.id, userId: u.id, hostId: '', name: u.name, relation: clean_(req.relation, 40),
                           age: u.age, state: u.state, region: u.region, joined: Date.now(), consentLive: false, covenant: false, isGuest: false });
      addEntry_(d.id, 'system', APP_NAME, 'system', u.name + ' joined the council.', '', d.phase);
      bump_(d);
    }
    return { ok: true, disputeId: d.id };
  } finally { lock.releaseLock(); }
}

function addHouseholdMember_(disputeId, u, householdId) {
  var h = parse_(u.household, []).filter(function (x) { return x.id === householdId; })[0];
  if (!h) return null;
  var exists = rows_('Members').filter(function (m) { return m.disputeId === disputeId && m.userId === h.id; })[0];
  if (exists) return exists;
  var m = { id: 'm_' + shortId_(), disputeId: disputeId, userId: h.id, hostId: u.id, name: h.name, relation: h.relation, age: h.age,
            state: u.state, region: u.region, joined: Date.now(), consentLive: false, covenant: false, isGuest: true };
  insert_('Members', m);
  addEntry_(disputeId, 'system', APP_NAME, 'system', h.name + ' joined with ' + u.name + '.', '', '');
  return m;
}

function addGuest_(req, u) {
  var d = findDispute_(req.disputeId); if (!d || !memberOf_(d.id, u).length) return notFound_();
  var m = addHouseholdMember_(d.id, u, req.householdId);
  if (!m) return { ok: false, error: 'not_found', message: 'Add them to your family list first (Me tab).' };
  bump_(d); return { ok: true };
}

// Which members this signed-in person can act as (themselves plus family members they brought).
function actor_(d, u, asId) {
  var mine = memberOf_(d, u);
  if (!mine.length) return null;
  if (asId) { var g = mine.filter(function (m) { return m.id === asId; })[0]; if (g) return g; }
  return mine.filter(function (m) { return m.userId === u.id; })[0] || mine[0];
}

function getDispute_(req, u) {
  var d = findDispute_(req.disputeId); if (!d) return notFound_();
  var mine = memberOf_(d.id, u); if (!mine.length) return notFound_();
  var mineIds = mine.map(function (m) { return m.id; });
  var members = rows_('Members').filter(function (m) { return m.disputeId === d.id; }).map(function (m) {
    return { id: m.id, name: m.name, relation: m.relation, age: Number(m.age) || '', state: m.state, region: m.region, isGuest: m.isGuest === true || m.isGuest === 'TRUE',
             consentLive: m.consentLive === true || m.consentLive === 'TRUE', covenant: m.covenant === true || m.covenant === 'TRUE', mine: mineIds.indexOf(m.id) >= 0,
             hostId: m.hostId || '' };
  });
  var entries = rows_('Entries').filter(function (e) {
    return e.disputeId === d.id && (!e.privateTo || mineIds.indexOf(e.privateTo) >= 0);
  }).map(function (e) {
    return { id: e.id, authorId: e.authorId, authorName: e.authorName, kind: e.kind, text: String(e.text), private: !!e.privateTo, phase: e.phase,
             time: Number(e.time), meta: parse_(e.meta, null) };
  });
  return { ok: true, version: Number(d.version), dispute: {
    id: d.id, title: d.title, category: d.category, description: d.description, guide: d.guide, status: d.status, phase: d.phase, floor: d.floor,
    joinCode: d.joinCode, codeExp: Number(d.codeExp), created: Number(d.created), createdBy: d.createdBy === u.id ? 'me' : 'other',
    resolution: parse_(d.resolution, null), court: parse_(d.court, null), followUps: parse_(d.followUps, []), appealUsed: d.appealUsed === true || d.appealUsed === 'TRUE'
  }, members: members, entries: entries };
}

function poll_(req, u) {
  var c = CacheService.getScriptCache(), v = c.get('v_' + req.disputeId);
  if (v && Number(v) === Number(req.version)) return { ok: true, same: true, version: Number(v) };
  return getDispute_(req, u);
}

function post_(req, u) {
  var d = findDispute_(req.disputeId); if (!d) return notFound_();
  var who = actor_(d.id, u, req.as); if (!who) return notFound_();
  var kinds = ['side', 'response', 'note', 'transcript', 'proposal', 'apology', 'question', 'flag', 'answer'];
  var kind = kinds.indexOf(req.kind) >= 0 ? req.kind : 'note';
  var text = clean_(req.text, 6000); if (!text) return { ok: false, error: 'empty', message: 'Nothing to post.' };
  var e = addEntry_(d.id, who.id, who.name, kind, text, '', d.phase, req.meta || null);
  bump_(d);
  var pts = { side: 10, response: 6, apology: 15, proposal: 8, answer: 4 }[kind] || 0;
  if (pts) award_(who.isGuest === true || who.isGuest === 'TRUE' ? who.hostId : u.id, who.isGuest === true || who.isGuest === 'TRUE' ? who.userId : '', pts,
                  kind === 'apology' ? 'humble_heart' : kind === 'side' ? 'spoke_up' : '');
  return { ok: true, entry: { id: e.id } };
}

function setPhase_(req, u) {
  var d = findDispute_(req.disputeId); if (!d || !memberOf_(d.id, u).length) return notFound_();
  if (PHASES.indexOf(req.phase) < 0) return { ok: false, error: 'bad_phase' };
  d.phase = req.phase; if (req.phase === 'closed') d.status = 'closed'; else if (d.status === 'closed') d.status = 'open';
  addEntry_(d.id, 'system', APP_NAME, 'system', u.name + ' moved the council to: ' + phaseName_(req.phase) + '.', '', req.phase);
  bump_(d); return { ok: true };
}

function setFloor_(req, u) {
  var d = findDispute_(req.disputeId); if (!d || !memberOf_(d.id, u).length) return notFound_();
  d.floor = String(req.memberId || ''); bump_(d); return { ok: true };
}

function consent_(req, u) {
  var d = findDispute_(req.disputeId); if (!d) return notFound_();
  var who = actor_(d.id, u, req.as); if (!who) return notFound_();
  if (req.type === 'covenant') {
    who.covenant = !!req.value;
    if (who.covenant) addEntry_(d.id, who.id, who.name, 'system', who.name + ' promised to follow the council\'s final resolution.', '', d.phase);
  } else {
    who.consentLive = !!req.value;
    addEntry_(d.id, who.id, who.name, 'system', who.name + (who.consentLive ? ' agreed to live listening.' : ' turned off consent for live listening.'), '', d.phase);
  }
  update_('Members', who); bump_(d); return { ok: true };
}

function saveResolution_(req, u) {
  var d = findDispute_(req.disputeId); if (!d) return notFound_();
  var who = actor_(d.id, u, req.as); if (!who) return notFound_();
  var r = req.resolution || {};
  var terms = (Array.isArray(r.terms) ? r.terms : []).slice(0, 15).map(function (t) {
    return { who: clean_(t.who, 60), what: clean_(t.what, 400), by: clean_(t.by, 60) };
  }).filter(function (t) { return t.what; });
  if (!terms.length) return { ok: false, error: 'no_terms', message: 'Add at least one promise (who does what, by when).' };
  var res = {
    source: r.source === 'ruling' ? 'ruling' : 'agreement', summary: clean_(r.summary, 1500), terms: terms,
    consequence: clean_(r.consequence, 500), repair: clean_(r.repair, 500), reviewDate: clean_(r.reviewDate, 20), plainForKids: clean_(r.plainForKids, 600),
    createdBy: who.name, createdAt: Date.now(), signatures: {}, status: 'pending'
  };
  d.resolution = JSON.stringify(res); d.phase = 'resolution';
  addEntry_(d.id, who.id, who.name, 'system', who.name + ' put a ' + (res.source === 'ruling' ? 'ruling' : 'resolution') + ' up for signatures.', '', 'resolution');
  bump_(d); return { ok: true };
}

function sign_(req, u) {
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var d = findDispute_(req.disputeId); if (!d) return notFound_();
    var who = actor_(d.id, u, req.as); if (!who) return notFound_();
    var res = parse_(d.resolution, null); if (!res) return { ok: false, error: 'none', message: 'There is nothing to sign yet.' };
    res.signatures[who.id] = { agree: !!req.agree, time: Date.now(), name: who.name, note: clean_(req.note, 300) };
    var members = rows_('Members').filter(function (m) { return m.disputeId === d.id; });
    var allAgree = members.every(function (m) { var s = res.signatures[m.id]; return s && s.agree; });
    var allCovenant = members.every(function (m) { return m.covenant === true || m.covenant === 'TRUE'; });
    var allSigned = members.every(function (m) { return !!res.signatures[m.id]; });
    var wasBinding = res.status === 'binding';
    if (allAgree) res.status = 'binding';
    else if (res.source === 'ruling' && allCovenant && allSigned) res.status = 'binding'; // everyone promised beforehand to follow the ruling
    else res.status = 'pending';
    d.resolution = JSON.stringify(res);
    addEntry_(d.id, who.id, who.name, 'system', who.name + (req.agree ? ' signed: I agree and will keep it.' : ' did not agree yet' + (req.note ? ': ' + clean_(req.note, 200) : '.')), '', d.phase);
    if (res.status === 'binding' && !wasBinding) {
      d.phase = 'followup';
      addEntry_(d.id, 'system', APP_NAME, 'system', 'The resolution is now binding. Everyone has to keep it. Check in on ' + (res.reviewDate || 'the review date') + '.', '', 'followup');
      members.forEach(function (m) {
        var g = m.isGuest === true || m.isGuest === 'TRUE';
        award_(g ? m.hostId : m.userId, g ? m.userId : '', 25, 'peacemaker');
      });
    }
    bump_(d); return { ok: true, status: res.status };
  } finally { lock.releaseLock(); }
}

function appeal_(req, u) {
  var d = findDispute_(req.disputeId); if (!d) return notFound_();
  var who = actor_(d.id, u, req.as); if (!who) return notFound_();
  if (d.appealUsed === true || d.appealUsed === 'TRUE') return { ok: false, error: 'used', message: 'This council already had its one appeal. The last ruling stands.' };
  var g = GUIDE_IDS.indexOf(req.guide) >= 0 && req.guide !== d.guide ? req.guide : (d.guide === 'elder' ? 'grandmother' : 'elder');
  d.appealUsed = true; d.guide = g; d.phase = 'proposals';
  var res = parse_(d.resolution, null); if (res) { res.status = 'appealed'; d.resolution = JSON.stringify(res); }
  addEntry_(d.id, who.id, who.name, 'system', who.name + ' appealed (once per council). ' + guideName_(g) + ' will review it. Reason: ' + (clean_(req.reason, 300) || 'not given'), '', 'proposals');
  bump_(d); return { ok: true, guide: g };
}

function checkIn_(req, u) {
  var d = findDispute_(req.disputeId); if (!d) return notFound_();
  var who = actor_(d.id, u, req.as); if (!who) return notFound_();
  var list = parse_(d.followUps, []);
  list.push({ by: who.id, name: who.name, kept: !!req.kept, note: clean_(req.note, 400), time: Date.now() });
  d.followUps = JSON.stringify(list.slice(-60));
  addEntry_(d.id, who.id, who.name, 'checkin', (req.kept ? 'Kept my promise. ' : 'Did not keep it this time. ') + clean_(req.note, 400), '', d.phase);
  var g = who.isGuest === true || who.isGuest === 'TRUE';
  if (req.kept) award_(g ? who.hostId : u.id, g ? who.userId : '', 15, 'promise_keeper', true);
  bump_(d); return { ok: true };
}

function closeDispute_(req, u) {
  var d = findDispute_(req.disputeId); if (!d || !memberOf_(d.id, u).length) return notFound_();
  d.status = 'closed'; d.phase = 'closed';
  addEntry_(d.id, 'system', APP_NAME, 'system', u.name + ' closed this council.', '', 'closed');
  bump_(d); return { ok: true };
}

function scoreboard_(req, u) {
  // People you share a council with, plus your family list.
  var myDisputes = {}; myMemberships_(u).forEach(function (m) { myDisputes[m.disputeId] = true; });
  var ids = {}; rows_('Members').forEach(function (m) { if (myDisputes[m.disputeId] && !(m.isGuest === true || m.isGuest === 'TRUE')) ids[m.userId] = true; });
  ids[u.id] = true;
  var board = rows_('Users').filter(function (x) { return ids[x.id]; }).map(function (x) {
    return { name: x.name, points: Number(x.points || 0), streak: Number(x.streak || 0), level: level_(Number(x.points || 0)).name, me: x.id === u.id };
  });
  parse_(u.household, []).forEach(function (h) { board.push({ name: h.name, points: Number(h.points || 0), streak: Number(h.streak || 0), level: level_(Number(h.points || 0)).name, family: true }); });
  board.sort(function (a, b) { return b.points - a.points; });
  return { ok: true, board: board };
}

/* ============================ Peace Points ============================ */
function award_(userId, householdId, pts, badge, countsForStreak) {
  if (!userId) return;
  var u = findUser_(userId); if (!u) return;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Detroit', 'yyyy-MM-dd');
  function streakOf(o) {
    if (!countsForStreak) return;
    if (o.lastDay === today) return;
    var y = Utilities.formatDate(new Date(Date.now() - 864e5), Session.getScriptTimeZone() || 'America/Detroit', 'yyyy-MM-dd');
    o.streak = (o.lastDay === y ? Number(o.streak || 0) : 0) + 1; o.lastDay = today;
  }
  if (householdId) {
    var hh = parse_(u.household, []);
    hh.forEach(function (h) {
      if (h.id !== householdId) return;
      h.points = Number(h.points || 0) + pts; streakOf(h);
      h.badges = h.badges || []; if (badge && h.badges.indexOf(badge) < 0) h.badges.push(badge);
    });
    u.household = JSON.stringify(hh);
  } else {
    u.points = Number(u.points || 0) + pts; streakOf(u);
    var b = parse_(u.badges, []); if (badge && b.indexOf(badge) < 0) b.push(badge);
    u.badges = JSON.stringify(b);
  }
  update_('Users', u);
}

/* ============================ AI ============================ */
var GUIDES = {
  judge: { name: 'Judge Grace', voice: 'You are Judge Grace, a fair, formal family judge. Calm, orderly and brief. You keep turns, you rule on what was actually said and shown, and you explain your reasons. You say "The council finds..." when you decide.' },
  mother: { name: 'Mother', voice: 'You are Mother: warm, firm, and protective of every person equally. You name feelings first, then hold everyone to the standard. You do not side with whoever is louder, older or more upset.' },
  elder: { name: 'The Elder', voice: 'You are The Elder: slow, wise, and focused on the long view. You ask what this will matter in a year, use short proverbs or stories, and work to restore the relationship, not to pick a winner.' },
  grandmother: { name: 'Grandmother', voice: 'You are Grandmother: loving, plainspoken, a little funny, and no-nonsense. You have seen it all. You give everyone a way to save face and still make them do the right thing.' },
  pastor: { name: 'Pastor', voice: 'You are Pastor, a faith-centered counselor: grace and truth together, forgiveness with accountability. When faith mode is on you may use one short King James verse with its reference.' },
  mediator: { name: 'The Mediator', voice: 'You are The Mediator, a neutral professional. You focus on interests instead of positions, help people generate options, and never assign blame.' }
};

var PRINCIPLES = [
  'How this council works (follow every rule):',
  '1. Everyone is heard fully once before anyone answers. No interrupting.',
  '2. Separate FACTS (what happened and can be shown), FEELINGS (real and important, but not proof) and ASSUMPTIONS (guesses about why someone did something). Label them.',
  '3. Evidence over volume: being louder, older or more upset does not win. What is shown and what is agreed decides.',
  '4. Confidence is not evidence. Say what is confirmed and what is assumed.',
  '5. Put it in writing: promises are specific (who does what, by when) and signed. If someone thinks the record is wrong, they raise it in writing and it gets corrected in writing.',
  '6. Accountability without shame: people own their part and apologize for something specific. No groveling, no humiliation, no name-calling.',
  '7. Restore, do not punish: consequences are fair, known ahead of time, and connected to the problem.',
  '8. Age matters: speak to children at their level; adults carry more responsibility. Parents keep their rightful authority over household rules for minors, but children are still heard and treated fairly.',
  '9. Be honest even when it is unwelcome. If someone is wrong, say so kindly and plainly, including the adult or the person who started the council.',
  '10. Home is not court. Feelings matter here; in a real court, the law and evidence decide. Help people, especially children, see that difference.',
  'SAFETY OVERRIDE: if anything suggests abuse, violence, threats, a weapon, self-harm, a child in danger, or sexual contact involving a minor, stop mediating. Set "safety": true (in JSON modes) and say plainly this needs a trusted adult or professional right now. Give: 911 for emergencies, 988 Suicide & Crisis Lifeline (call or text), National Domestic Violence Hotline 1-800-799-7233, Childhelp 1-800-422-4453. Never ask someone being harmed to compromise with the person harming them.',
  'You are not a lawyer, a court, or a therapist, and you never claim to be. Law information is general education that people should verify.',
  'Use plain words. Short sentences. No markdown headings. Use people\'s first names.'
].join('\n');

function aiLimitOk_(uid) {
  var c = CacheService.getScriptCache(), k = 'ai_' + uid + '_' + Math.floor(Date.now() / 3600000), n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 3700); return n <= (Number(prop_('AI_PER_HOUR')) || 40);
}

function context_(d, members, entries, forIds) {
  var lines = [];
  lines.push('COUNCIL: "' + d.title + '" (type: ' + d.category + '). Current step: ' + phaseName_(d.phase) + '.');
  if (d.description) lines.push('How it was described when opened: ' + d.description);
  lines.push('PEOPLE:');
  members.forEach(function (m) {
    lines.push('- ' + m.name + (m.relation ? ' (' + m.relation + ')' : '') + ', age ' + (m.age || 'not given') + ', ' + (m.region ? m.region + ', ' : '') + (m.state || 'state not given') +
      ((m.covenant === true || m.covenant === 'TRUE') ? '; promised to follow the final ruling' : '; has NOT yet promised to follow the ruling'));
  });
  var res = parse_(d.resolution, null);
  if (res) lines.push('CURRENT RESOLUTION (' + res.status + '): ' + res.terms.map(function (t) { return t.who + ': ' + t.what + (t.by ? ' by ' + t.by : ''); }).join('; '));
  var fu = parse_(d.followUps, []); if (fu.length) lines.push('CHECK-INS: ' + fu.slice(-10).map(function (f) { return f.name + (f.kept ? ' kept it' : ' did not keep it') + (f.note ? ' (' + f.note + ')' : ''); }).join('; '));
  lines.push('RECORD (oldest first):');
  var shown = entries.filter(function (e) { return !e.privateTo || (forIds && forIds.indexOf(e.privateTo) >= 0); });
  var txt = shown.map(function (e) {
    var tag = { side: 'SIDE', response: 'RESPONSE', transcript: 'SPOKEN', guide: 'GUIDE', interject: 'GUIDE INTERJECTED', proposal: 'PROPOSAL', apology: 'APOLOGY',
                question: 'QUESTION', answer: 'ANSWER', note: 'NOTE', flag: 'FLAG', checkin: 'CHECK-IN', system: 'EVENT', coach: 'PRIVATE COACHING', advocate: 'PRIVATE ADVOCATE', ruling: 'RULING', court: 'COURT COMPARISON' }[e.kind] || e.kind.toUpperCase();
    return '[' + tag + '] ' + e.authorName + ': ' + String(e.text).slice(0, 1500);
  });
  var joined = txt.join('\n'); if (joined.length > 26000) joined = '...(earlier record trimmed)\n' + joined.slice(-26000);
  lines.push(joined || '(nothing said yet)');
  return lines.join('\n');
}

function ai_(req, u) {
  var key = prop_('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'no_api_key', message: 'The owner has not added the AI key yet.' };
  var d = findDispute_(req.disputeId); if (!d) return notFound_();
  var who = actor_(d.id, u, req.as); if (!who) return notFound_();
  if (!aiLimitOk_(u.id)) return { ok: false, error: 'ai_limit', message: 'That is a lot of AI help for one hour. Take a breath and try again soon.' };
  var members = rows_('Members').filter(function (m) { return m.disputeId === d.id; });
  var entries = rows_('Entries').filter(function (e) { return e.disputeId === d.id; });
  var mineIds = memberOf_(d.id, u).map(function (m) { return m.id; });
  var guide = GUIDES[d.guide] || GUIDES.mother;
  var faith = members.some(function (m) { var x = findUser_(m.userId); return x && (x.faith === true || x.faith === 'TRUE'); });
  var mode = String(req.mode || 'guide');
  var ctx = context_(d, members, entries, mode === 'advocate' || mode === 'coach' ? [who.id] : null);
  var ask = clean_(req.text, 4000);
  var sys = guide.voice + '\nFaith mode: ' + (faith ? 'ON (one short KJV verse is welcome when it truly fits)' : 'OFF (no scripture)') + '.\n' + PRINCIPLES;
  var prompt, tier = 'default', maxT = 1200, isJson = true, kind = 'guide', privateTo = '';

  if (mode === 'opening') {
    isJson = false; maxT = 600;
    prompt = ctx + '\n\nOpen this council in 5 to 8 short sentences as ' + guide.name + ': welcome everyone by name, say what the disagreement is about, set the ground rules (one speaker at a time with the talking stick, I-statements, no name-calling, facts vs feelings), explain that everyone gets to say their side first, and say who should start. Remind them that at the end there will be a written resolution everyone has to keep.';
  } else if (mode === 'questions') {
    prompt = ctx + '\n\nAs ' + guide.name + ', ask the clarifying questions you need before anyone proposes a fix. Return only JSON: {"say":"one or two sentences to the group","questions":[{"to":"first name","q":"question"}],"facts":[{"point":"","type":"fact|feeling|assumption|disputed","by":"name"}],"safety":false}. At most 5 questions, aimed at what is unclear or disputed.';
  } else if (mode === 'interject') {
    tier = 'quick'; maxT = 400;
    prompt = ctx + '\n\nLIVE: this is what was just said out loud (speech-to-text, may have errors). Speaker with the talking stick: ' + (memberName_(members, d.floor) || 'nobody') + '.\n"""' + ask + '"""\nWarning signs the app noticed: ' + (clean_(req.flags, 300) || 'none') + '.\n' +
      'Decide if ' + guide.name + ' should step in right now. Step in only for: rising voices, name-calling, interrupting, blaming without facts, sarcasm, threats, someone shutting down, going off topic, or a good moment to affirm someone. Otherwise stay quiet. ' +
      'Return only JSON: {"interject":true|false,"say":"what you say out loud, 1-2 short sentences, by first name","tone":"calm|firm|warm|urgent","to":"first name or everyone","decorum":["short behavior tip"],"safety":false}';
  } else if (mode === 'coach') {
    tier = 'quick'; maxT = 500; kind = 'coach'; privateTo = who.id;
    prompt = ctx + '\n\nPRIVATE COACHING for ' + who.name + ' only (age ' + (who.age || '?') + '). ' + (ask ? 'They asked: "' + ask + '". ' : '') +
      'Give honest, kind coaching on how they should carry themselves right now: tone, words, body language, what to own, what to let go. If they are in the wrong, tell them. ' +
      'Return only JSON: {"tips":["3 to 5 short tips"],"sayInstead":"one sentence they could say next","ownIt":"the part they should take responsibility for, or empty","calm":"one quick calming step","safety":false}';
  } else if (mode === 'advocate') {
    isJson = false; maxT = 1100; kind = 'advocate'; privateTo = who.id;
    sys = 'You are the private advocate (like a lawyer\'s assistant) for ' + who.name + ' in a family council. You help them present their side truthfully and strongly: organize their facts, name what they can show, predict what the other side will say, and point out their own weak spots before someone else does. You never help them lie, exaggerate, manipulate or hide something relevant. You stay respectful of the other people. You are not a lawyer.\n' + PRINCIPLES;
    prompt = ctx + '\n\n' + who.name + ' asks you privately: "' + (ask || 'Help me get ready to say my side.') + '"\nAnswer in under 220 words. End with one line that starts "Say it like this:" giving a calm sentence they could use.';
  } else if (mode === 'propose') {
    maxT = 1600;
    prompt = ctx + '\n\nAs ' + guide.name + ', sum up and offer fair ways to settle this. Return only JSON: {"summary":"2-3 sentences","findings":[{"point":"","type":"fact|feeling|assumption|disputed","by":"name"}],"options":[{"title":"short","why":"one sentence","terms":[{"who":"first name","what":"specific promise","by":"when"}],"consequence":"what happens if it is broken","repair":"how they make things right"}],"recommend":0,"reviewDate":"YYYY-MM-DD about 1 week out","safety":false}. Give 2 or 3 options. Be specific: dishes means which nights, which dishes, by what time.';
  } else if (mode === 'ruling') {
    tier = 'complex'; maxT = 1800; kind = 'ruling';
    prompt = ctx + '\n\nThe people could not agree. As ' + guide.name + ', make the final ruling. It must be fair to everyone, follow the principles, and be something each person can actually do. Return only JSON: {"summary":"what the council decided and why, 3-5 sentences, citing what was said","findings":[{"point":"","type":"fact|feeling|assumption|disputed","by":"name"}],"terms":[{"who":"first name","what":"specific promise","by":"when"}],"consequence":"","repair":"","reviewDate":"YYYY-MM-DD","plainForKids":"the ruling explained to a 7-year-old in 2 sentences","safety":false}';
  } else if (mode === 'court') {
    tier = 'complex'; maxT = 2200; kind = 'court';
    var places = members.map(function (m) { return m.name + ': age ' + (m.age || '?') + ', ' + (m.region ? m.region + ', ' : '') + (m.state || '?'); }).join('; ');
    prompt = ctx + '\n\nCOMPARE HOME VS. A REAL COURT for this exact disagreement, for these people and places: ' + places + '.\n' +
      'Teach, especially for children, that feelings are not how courts decide. Use the laws of the state(s) named; if people are in different states, say which state\'s law would likely apply and why. Mention age rules (for example: minors usually cannot sue on their own and need a parent or guardian; parents\' rights and duties over minors; age of majority in that state). ' +
      'If no court would take a case like this (like whose turn it is for dishes), say so plainly and explain what kinds of related problems a court WOULD handle (for example: property damage, money owed, custody or parenting time, protective orders, truancy). Only cite laws you are confident exist; give the official name and number, and mark anything uncertain as "check". Link to the state\'s official legislature or courts website. ' +
      'Return only JSON: {"headline":"one sentence","wouldCourtHear":"yes|no|maybe","why":"2-3 sentences","court":"which court (e.g. small claims, family/probate, district)","steps":["how it would go in court, 4-7 steps"],"laws":[{"name":"","cite":"","plain":"what it means in plain words","check":true,"link":"official https url"}],"ageNotes":"","homeVsCourt":[{"topic":"","home":"","court":""}],"forKids":"2-3 sentences for children","costTime":"rough cost and time in court","safety":false}. 5 to 8 rows in homeVsCourt.';
  } else {
    isJson = false; maxT = 700;
    prompt = ctx + '\n\n' + (ask ? who.name + ' asks the guide: "' + ask + '"\n' : '') + 'As ' + guide.name + ', give the next helpful word to the group for the current step (' + phaseName_(d.phase) + '). Under 120 words. End by saying who should speak next or what to do next.';
  }

  var r = claude_(key, tier, sys, prompt, maxT);
  if (!r.ok) return r;
  var data = null, text = r.text;
  if (isJson) {
    data = extractJson_(r.text);
    if (!data) return { ok: false, error: 'ai_format', message: 'The guide stumbled. Try again.' };
    text = mode === 'interject' ? (data.say || '') : mode === 'coach' ? (data.sayInstead || '') : (data.summary || data.say || data.headline || '');
  }
  var store = true;
  if (mode === 'interject') { store = !!data.interject || !!data.safety; kind = 'interject'; }
  if (mode === 'questions') kind = 'guide';
  var entryId = '';
  if (store && (text || data)) {
    var e = addEntry_(d.id, privateTo || 'guide', privateTo ? (kind === 'coach' ? 'Your coach' : 'Your advocate') : guide.name, kind, text || '', privateTo, d.phase, data ? { mode: mode, data: data } : { mode: mode });
    entryId = e.id;
    if (mode === 'court') d.court = JSON.stringify(Object.assign({ at: Date.now() }, data)).slice(0, 45000);
    bump_(d);
  }
  return { ok: true, mode: mode, text: text, data: data, entryId: entryId, model: r.model };
}

function claude_(key, tier, system, prompt, maxTokens) {
  var prop = tier === 'complex' ? 'MODEL_COMPLEX' : tier === 'quick' ? 'MODEL_QUICK' : 'MODEL_DEFAULT';
  var model = prop_(prop) || (tier === 'complex' ? 'claude-opus-5-5' : 'claude-sonnet-5-5');
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: model, max_tokens: maxTokens, system: system, messages: [{ role: 'user', content: prompt }] })
  });
  var code = res.getResponseCode(), out = {};
  try { out = JSON.parse(res.getContentText()); } catch (e) {}
  if (code === 429) return { ok: false, error: 'ai_busy', message: 'The AI is busy. Try again in a moment.' };
  if (code >= 300) return { ok: false, error: 'ai_error', message: (out.error && out.error.message) || ('AI error ' + code) };
  var text = (out.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  return { ok: true, text: text, model: out.model || model };
}

function extractJson_(t) {
  if (!t) return null;
  var s = String(t).replace(/```json|```/g, '');
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

/* ============================ emails ============================ */
function supportEmail_() { return prop_('SUPPORT_EMAIL') || Session.getEffectiveUser().getEmail(); }
function appUrl_() { return prop_('APP_URL') || 'https://crispcleaninc-dot.github.io/family-council/'; }

// Layout follows the myEquifax one-time-passcode email: preheader, logo + sign-in link, title band,
// greeting, bold code, expiry note, security warning with support link, sign-off, legal footer.
function emailShell_(pre, title, bodyHtml) {
  var url = appUrl_(), sup = supportEmail_();
  return '<div style="background:#FAF7F0;padding:0;margin:0;font-family:Arial,Helvetica,sans-serif;color:#14161c">' +
    '<div style="display:none;max-height:0;overflow:hidden">' + esc_(pre) + '</div>' +
    '<div style="background:#1B2951;color:#cfd5e6;font-size:12px;padding:8px 20px;text-align:center">' + esc_(pre) + '</div>' +
    '<table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-collapse:collapse">' +
    '<tr><td style="padding:18px 24px;border-bottom:1px solid #e3dccb"><span style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#1B2951">&#9878; ' + APP_NAME + '</span>' +
    (url ? '<span style="float:right;font-size:13px;line-height:26px"><a href="' + esc_(url) + '" style="color:#1B2951">Sign in</a></span>' : '') + '</td></tr>' +
    '<tr><td style="background:#C9A961;color:#1B2951;padding:16px 24px;font-size:20px;font-weight:bold">' + esc_(title) + '</td></tr>' +
    '<tr><td style="padding:24px;font-size:15px;line-height:1.55">' + bodyHtml + '</td></tr>' +
    '<tr><td style="padding:16px 24px;background:#f4efe3;font-size:11px;color:#5a5f6e;line-height:1.5">' +
    'This is an automated message from ' + APP_NAME + ', a family dispute-resolution app. ' + APP_NAME + ' is not a court, a law firm or a counseling service, and nothing in it is legal advice. ' +
    'Questions or something wrong? Write to <a href="mailto:' + esc_(sup) + '" style="color:#1B2951">' + esc_(sup) + '</a> so it can be corrected in writing.<br>&copy; ' + new Date().getFullYear() + ' ' + APP_NAME + '</td></tr></table></div>';
}

function sendCodeEmail_(email, code, purpose) {
  var title = purpose === 'reset' ? 'Reset your PIN' : 'Confirm your email';
  var body = '<p>Hello,</p><p>Here is your one-time code to ' + (purpose === 'reset' ? 'reset your ' + APP_NAME + ' PIN' : 'finish creating your ' + APP_NAME + ' account') + ':</p>' +
    '<p style="font-size:30px;font-weight:bold;letter-spacing:6px;color:#1B2951;margin:18px 0">' + code + '</p>' +
    '<p style="color:#5a5f6e">This code expires in 15 minutes and can only be used once.</p>' +
    '<div style="border-left:4px solid #a3271f;background:#fbeceb;padding:10px 12px;margin:18px 0;font-size:13px"><b>Keep this code private.</b> ' + APP_NAME + ' will never call or text you to ask for it. If you did not ask for this code, you can ignore this email, or tell us at <a href="mailto:' + esc_(supportEmail_()) + '">' + esc_(supportEmail_()) + '</a>.</div>' +
    '<p>Peace be with you,<br>The ' + APP_NAME + ' team</p>';
  MailApp.sendEmail({ to: email, subject: APP_NAME + ': your code is ' + code, name: APP_NAME, htmlBody: emailShell_('Your one-time ' + APP_NAME + ' code', title, body),
                      body: 'Your ' + APP_NAME + ' code is ' + code + '. It expires in 15 minutes. Never share it.' });
}

function sendInviteEmail_(to, fromName, title, code, note) {
  var url = appUrl_();
  var body = '<p>Hello,</p><p><b>' + esc_(fromName) + '</b> invited you to a family council about <b>"' + esc_(title) + '"</b>. Everyone gets to say their side, a guide helps keep it fair, and together you write a resolution everyone keeps.</p>' +
    (note ? '<p style="background:#f4efe3;padding:10px 12px;border-radius:8px">"' + esc_(note) + '"</p>' : '') +
    '<p>Your join code:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#1B2951;margin:14px 0">' + esc_(code) + '</p>' +
    (url ? '<p><a href="' + esc_(url) + '?join=' + encodeURIComponent(code) + '" style="background:#1B2951;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open ' + APP_NAME + '</a></p>' : '') +
    '<p style="color:#5a5f6e">The code works for 7 days. Make an account with your email and a PIN, then tap <b>Join with a code</b>.</p>' +
    '<div style="border-left:4px solid #C9A961;background:#fffaf0;padding:10px 12px;margin:18px 0;font-size:13px">Only open this if you know ' + esc_(fromName) + '. If this looks wrong, ignore it.</div>' +
    '<p>Peace be with you,<br>The ' + APP_NAME + ' team</p>';
  MailApp.sendEmail({ to: to, subject: fromName + ' invited you to a ' + APP_NAME + ' about "' + title + '"', name: APP_NAME,
                      htmlBody: emailShell_(fromName + ' wants to settle something fairly with you', 'You are invited to a council', body),
                      body: fromName + ' invited you to a ' + APP_NAME + ' about "' + title + '". Join code: ' + code + (url ? ' ' + url : '') });
}

/* ============================ storage ============================ */
function ss_() {
  var id = prop_('DATA_SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create(SHEET_NAME);
  PropertiesService.getScriptProperties().setProperty('DATA_SHEET_ID', ss.getId());
  return ss;
}
var SHEETS_ = {};
function sh_(name) {
  if (SHEETS_[name]) return SHEETS_[name];
  var ss = ss_(), s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, s.getMaxRows(), SCHEMA[name].length).setNumberFormat('@'); // keep everything as plain text
    s.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    s.setFrozenRows(1);
    var def = ss.getSheetByName('Sheet1'); if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  }
  SHEETS_[name] = s; return s;
}
var CACHE_ROWS_ = {};
function rows_(name) {
  if (CACHE_ROWS_[name]) return CACHE_ROWS_[name];
  var s = sh_(name), n = s.getLastRow(), cols = SCHEMA[name];
  if (n < 2) return (CACHE_ROWS_[name] = []);
  var vals = s.getRange(2, 1, n - 1, cols.length).getValues();
  return (CACHE_ROWS_[name] = vals.map(function (r, i) { var o = { _row: i + 2 }; cols.forEach(function (k, j) { o[k] = fromCell_(r[j]); }); return o; }));
}
function toCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  if (v === '') return '';
  return "'" + v.slice(0, 49000); // quote prefix: always stored as plain text, never a formula, date or number

}
function fromCell_(v) {
  if (v === 'TRUE') return true; if (v === 'FALSE') return false;
  return v;
}
function insert_(name, o) {
  var row = SCHEMA[name].map(function (k) { return toCell_(o[k]); });
  var s = sh_(name); s.appendRow(row);
  o._row = s.getLastRow();
  if (CACHE_ROWS_[name]) CACHE_ROWS_[name].push(o);
  return o;
}
function update_(name, o) {
  if (!o._row) throw new Error('row missing');
  sh_(name).getRange(o._row, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name].map(function (k) { return toCell_(o[k]); })]);
}
function findUser_(id) { return rows_('Users').filter(function (u) { return u.id === id; })[0] || null; }
function findUserByEmail_(e) { return rows_('Users').filter(function (u) { return u.email === e; })[0] || null; }
function findDispute_(id) { return rows_('Disputes').filter(function (d) { return d.id === id; })[0] || null; }
function addEntry_(disputeId, authorId, authorName, kind, text, privateTo, phase, meta) {
  var e = { id: 'e_' + shortId_(), disputeId: disputeId, authorId: authorId, authorName: authorName, kind: kind, text: text, privateTo: privateTo || '',
            phase: phase || '', time: Date.now(), meta: meta ? JSON.stringify(meta) : '' };
  insert_('Entries', e); return e;
}
function bump_(d) {
  d.version = Number(d.version || 0) + 1; d.updated = Date.now(); update_('Disputes', d);
  CacheService.getScriptCache().put('v_' + d.id, String(d.version), 21600);
}

/* ============================ security + helpers ============================ */
function pepper_() {
  var P = PropertiesService.getScriptProperties(), p = P.getProperty('PEPPER');
  if (!p) { p = Utilities.getUuid() + Utilities.getUuid(); P.setProperty('PEPPER', p); }
  return p;
}
// Salted, peppered, repeated HMAC so a copied sheet alone cannot reveal PINs.
function hashPin_(pin, salt) {
  var key = pepper_(), h = salt + ':' + pin;
  for (var i = 0; i < 300; i++) h = hex_(Utilities.computeHmacSha256Signature(h, key));
  return h;
}
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }
function hex_(bytes) { return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join(''); }
function safeEqual_(a, b) {
  var ha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(a)), hb = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(b)), d = 0;
  for (var i = 0; i < ha.length; i++) d |= (ha[i] ^ hb[i]);
  return d === 0;
}
function secureRandom_() { // from a random UUID (Apps Script has no crypto RNG API)
  var hx = Utilities.getUuid().replace(/-/g, '').slice(0, 12); return parseInt(hx, 16) / Math.pow(16, 12);
}
function shortId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 14); }
function clean_(s, max) { return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 500); }
function parse_(s, dflt) { if (!s) return dflt; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch (e) { return dflt; } }
function esc_(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function notFound_() { return { ok: false, error: 'not_found', message: 'That council was not found, or you are not part of it.' }; }
function guideName_(g) { return (GUIDES[g] || GUIDES.mother).name; }
function memberName_(members, id) { var m = members.filter(function (x) { return x.id === id; })[0]; return m ? m.name : ''; }
function phaseName_(p) {
  return { open: 'Opening', sides: 'Everyone says their side', responses: 'Responses', questions: 'Guide\'s questions', proposals: 'Ways to settle it',
           resolution: 'Resolution and signatures', followup: 'Keeping the promise', closed: 'Closed' }[p] || p;
}
function globalRateOk_() {
  var c = CacheService.getScriptCache(), k = 'g_' + Math.floor(Date.now() / 60000), n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 120); return n <= 400;
}
function userRateOk_(uid) {
  var c = CacheService.getScriptCache(), k = 'r_' + uid + '_' + Math.floor(Date.now() / 60000), n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 120); return n <= 90;
}
function audit_(action, ok, who) {
  try {
    if (action === 'poll' || action === 'getDispute') return;
    insert_('Audit', { time: Date.now(), action: action, ok: !!ok, who: String(who || '').slice(0, 60) });
  } catch (e) {}
}

/* ---------- run from the editor ---------- */
// 1) Run testSetup once and approve permissions. It creates the private sheet and checks your AI key.
function testSetup() {
  var ss = ss_(); Object.keys(SCHEMA).forEach(sh_);
  Logger.log('Private data sheet: ' + ss.getUrl());
  Logger.log(doGet().getContent());
  Logger.log(JSON.stringify(claude_(prop_('ANTHROPIC_API_KEY') || '', 'quick', 'Reply with OK.', 'Say OK', 10)));
}
// Shows the last 50 requests (time, action, allowed or denied, account id).
function showAccessLog() {
  rows_('Audit').slice(-50).forEach(function (a) { Logger.log(new Date(Number(a.time)).toISOString() + '  ' + a.action + '  ' + (a.ok ? 'ok' : 'DENIED') + '  ' + a.who); });
}

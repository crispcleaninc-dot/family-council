// Runs the real relay/Code.gs against the Apps Script test double. node tests/backend.test.js
const assert = require('assert');
const { createRelay } = require('./mock-gas');
const R = createRelay();
let pass = 0;
function ok(name, cond, extra) { assert.ok(cond, name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); pass++; }
function codeFor(email) { const m = R.outbox.filter(x => x.to === email).pop(); return /code is (\d{6})/.exec(m.subject)[1]; }

// health check reveals nothing private
const h = R.health(); ok('health ok', h.ok && h.configured && !JSON.stringify(h).includes('test-key'));

// sign up mom
let r = R.call('sendCode', { email: 'Mom@Example.com' }); ok('code sent', r.ok);
ok('code email follows OTP layout', /Sign in/.test(R.outbox[0].htmlBody) && /expires in 15 minutes/.test(R.outbox[0].htmlBody) && /Keep this code private/.test(R.outbox[0].htmlBody));
r = R.call('signup', { email: 'mom@example.com', code: '000000', pin: '1234', name: 'Ciarne', age: 40, state: 'Michigan', consent: true });
ok('wrong code rejected', !r.ok && r.error === 'bad_code');
r = R.call('signup', { email: 'mom@example.com', code: codeFor('mom@example.com'), pin: '12', name: 'Ciarne', age: 40, state: 'Michigan', consent: true });
ok('short pin rejected', !r.ok && r.error === 'bad_pin');
r = R.call('signup', { email: 'mom@example.com', code: codeFor('mom@example.com'), pin: '1234', name: 'Ciarne', age: 40, state: 'Michigan', region: 'Oakland County, West Bloomfield', consent: true, faith: true });
ok('signup works', r.ok && r.token && r.user.name === 'Ciarne', r);
const momTok = r.token;
ok('pin not stored in plain text', !JSON.stringify(R.sheet().getSheetByName('Users').data).includes('"1234"'));

// under 13 blocked
R.call('sendCode', { email: 'kid@example.com' });
r = R.call('signup', { email: 'kid@example.com', code: codeFor('kid@example.com'), pin: '1111', name: 'Kid', age: 9, state: 'Michigan', consent: true });
ok('under 13 must be added by parent', !r.ok && r.error === 'too_young');

// teen account
R.call('sendCode', { email: 'caleb@example.com' });
r = R.call('signup', { email: 'caleb@example.com', code: codeFor('caleb@example.com'), pin: '5555', name: 'Caleb', age: 16, state: 'Michigan', region: 'Walled Lake', consent: true });
ok('teen signup', r.ok); const calebTok = r.token;

// login + lockout
r = R.call('login', { email: 'mom@example.com', pin: '9999' }); ok('bad pin', !r.ok);
r = R.call('login', { email: 'MOM@example.com', pin: '1234' }); ok('login works (any case email)', r.ok && r.token);
for (let i = 0; i < 5; i++) R.call('login', { email: 'caleb@example.com', pin: '0000' });
r = R.call('login', { email: 'caleb@example.com', pin: '5555' }); ok('locks after 5 wrong pins', !r.ok && r.error === 'locked');
// reset pin unlocks
R.call('sendCode', { email: 'caleb@example.com', purpose: 'reset' });
r = R.call('resetPin', { email: 'caleb@example.com', code: codeFor('caleb@example.com'), pin: '7777' });
ok('reset pin works', r.ok);
r = R.call('me', { token: calebTok }); ok('old sessions signed out after reset', !r.ok && r.error === 'signed_out');
r = R.call('login', { email: 'caleb@example.com', pin: '7777' }); ok('login with new pin', r.ok);
const caleb = r.token;

// no token = no data
r = R.call('listDisputes', {}); ok('requires sign-in', !r.ok && r.error === 'signed_out');

// household member (child under 13)
r = R.call('saveHousehold', { token: momTok, household: [{ name: 'Charles', age: 8, relation: 'son' }] });
ok('household saved', r.ok && r.user.household.length === 1); const charlesId = r.user.household[0].id;

// create dispute
r = R.call('createDispute', { token: momTok, title: 'Whose turn for dishes', category: 'chores', guide: 'mother', description: '=HYPERLINK("x") sink full again', relation: 'mom', guests: [charlesId] });
ok('dispute created', r.ok && /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(r.dispute.joinCode), r);
const did = r.dispute.id, code = r.dispute.joinCode;

// formula injection blocked (mock throws if a formula is written)
ok('formula text stored safely', R.sheet().getSheetByName('Disputes').data[1].join('|').includes('=HYPERLINK'));

// invite by email
r = R.call('invite', { token: momTok, disputeId: did, email: 'caleb@example.com', note: 'Let us settle this tonight' });
ok('invite email sent', r.ok && r.emailed && R.outbox.some(m => m.to === 'caleb@example.com' && m.htmlBody.includes(code)));

// outsider cannot see it
r = R.call('getDispute', { token: caleb, disputeId: did }); ok('not visible before joining', !r.ok);
r = R.call('join', { token: caleb, code: 'zzz-zzz' }); ok('bad join code', !r.ok);
r = R.call('join', { token: caleb, code: code.toLowerCase().replace('-', ''), relation: 'son' }); ok('join with code (any format)', r.ok && r.disputeId === did, r);

r = R.call('getDispute', { token: caleb, disputeId: did });
ok('three members incl. child', r.ok && r.members.length === 3, r.members);
const members = r.members; const calebM = members.find(m => m.name === 'Caleb'); const charlesM = members.find(m => m.name === 'Charles');
ok('child is a guest brought by mom', charlesM.isGuest && !charlesM.mine);
let v = r.version;

// poll shortcut
r = R.call('poll', { token: caleb, disputeId: did, version: v }); ok('poll unchanged', r.ok && r.same);

// posting sides
r = R.call('post', { token: momTok, disputeId: did, kind: 'side', text: 'The sink was full when I got home.' }); ok('mom posts side', r.ok);
r = R.call('post', { token: momTok, disputeId: did, kind: 'side', text: 'I did mine Monday!', as: charlesM.id }); ok('mom posts for Charles on her device', r.ok);
r = R.call('post', { token: caleb, disputeId: did, kind: 'side', text: 'Monday was not my night.', as: charlesM.id });
ok('caleb cannot post as Charles (falls back to himself)', r.ok);
r = R.call('getDispute', { token: caleb, disputeId: did });
ok('caleb posting as charles became caleb', r.entries.filter(e => e.kind === 'side').map(e => e.authorName).join(',') === 'Ciarne,Charles,Caleb', r.entries.map(e => e.authorName));
r = R.call('poll', { token: caleb, disputeId: did, version: v }); ok('poll sees change', r.ok && !r.same && r.version > v);

// AI guide + private coach/advocate
r = R.call('ai', { token: momTok, disputeId: did, mode: 'opening' }); ok('opening', r.ok && /Welcome/.test(r.text));
r = R.call('ai', { token: caleb, disputeId: did, mode: 'coach' }); ok('coach private', r.ok && r.data.tips.length === 3);
r = R.call('ai', { token: caleb, disputeId: did, mode: 'advocate', text: 'How do I say my side?' }); ok('advocate', r.ok && /Say it like this/.test(r.text));
r = R.call('getDispute', { token: momTok, disputeId: did });
ok('mom cannot see caleb private coach/advocate', !r.entries.some(e => e.kind === 'coach' || e.kind === 'advocate'));
r = R.call('getDispute', { token: caleb, disputeId: did });
ok('caleb sees his own private help', r.entries.filter(e => e.private).length === 2);
const sysPrompt = R.aiCalls[0].system; ok('principles + faith mode in prompt', sysPrompt.includes('Evidence over volume') && sysPrompt.includes('Faith mode: ON') && sysPrompt.includes('988'));
const advPrompt = R.aiCalls[2].messages[0].content; ok('advocate prompt has record', advPrompt.includes('The sink was full'));

// live interjection only stores when it steps in
let n0 = R.call('getDispute', { token: momTok, disputeId: did }).entries.length;
r = R.call('ai', { token: momTok, disputeId: did, mode: 'interject', text: 'okay so I think we can try' }); ok('quiet interject not stored', r.ok && !r.data.interject);
r = R.call('ai', { token: momTok, disputeId: did, mode: 'interject', text: 'you always do this, shut up', flags: 'name-calling' }); ok('interject steps in', r.ok && r.data.interject && r.text);
let n1 = R.call('getDispute', { token: momTok, disputeId: did }).entries.length; ok('one interjection stored', n1 === n0 + 1);
ok('interject uses quick model', R.aiCalls[R.aiCalls.length - 1].model === 'claude-sonnet-5-5');

// propose + court comparison
r = R.call('ai', { token: momTok, disputeId: did, mode: 'propose' }); ok('proposal JSON parsed from fenced block', r.ok && r.data.options.length === 1);
r = R.call('ai', { token: caleb, disputeId: did, mode: 'court' }); ok('court comparison', r.ok && r.data.homeVsCourt.length === 2);
const courtPrompt = R.aiCalls[R.aiCalls.length - 1];
ok('court uses each person state/region/age', courtPrompt.messages[0].content.includes('Charles: age 8, Oakland County, West Bloomfield, Michigan') && courtPrompt.messages[0].content.includes('Caleb: age 16, Walled Lake, Michigan'));
ok('court uses complex model', courtPrompt.model === 'claude-opus-5-5');
r = R.call('getDispute', { token: momTok, disputeId: did }); ok('court saved on dispute', r.dispute.court && r.dispute.court.wouldCourtHear === 'no');

// covenant + ruling binding
R.call('consent', { token: momTok, disputeId: did, type: 'covenant', value: true });
R.call('consent', { token: momTok, disputeId: did, type: 'covenant', value: true, as: charlesM.id });
R.call('consent', { token: caleb, disputeId: did, type: 'covenant', value: true });
r = R.call('ai', { token: momTok, disputeId: did, mode: 'ruling' }); ok('ruling', r.ok && r.data.terms.length === 2);
r = R.call('saveResolution', { token: momTok, disputeId: did, resolution: Object.assign({ source: 'ruling' }, r.data) }); ok('resolution saved', r.ok);
r = R.call('sign', { token: momTok, disputeId: did, agree: true }); ok('mom signs -> pending', r.ok && r.status === 'pending');
r = R.call('sign', { token: momTok, disputeId: did, agree: true, as: charlesM.id }); ok('charles signs on mom device', r.ok && r.status === 'pending');
r = R.call('sign', { token: caleb, disputeId: did, agree: false, note: 'I still think Monday is hers' });
ok('ruling binding because all promised beforehand, even if one disagrees', r.ok && r.status === 'binding');
r = R.call('getDispute', { token: caleb, disputeId: did }); ok('phase moves to followup', r.dispute.phase === 'followup');

// appeal once
r = R.call('appeal', { token: caleb, disputeId: did, reason: 'Monday' }); ok('appeal works', r.ok && r.guide === 'elder');
r = R.call('appeal', { token: caleb, disputeId: did }); ok('only one appeal', !r.ok && r.error === 'used');

// agreement path: everybody agrees
r = R.call('saveResolution', { token: caleb, disputeId: did, resolution: { terms: [{ who: 'Caleb', what: 'Tue/Thu/Sat dishes', by: '8pm' }, { who: 'Ciarne', what: 'Checks the chart Sunday', by: 'Sunday' }], reviewDate: '2026-11-05' } });
ok('agreement saved', r.ok);
R.call('sign', { token: momTok, disputeId: did, agree: true }); R.call('sign', { token: momTok, disputeId: did, agree: true, as: charlesM.id });
r = R.call('sign', { token: caleb, disputeId: did, agree: true }); ok('agreement binding when all agree', r.status === 'binding');

// check-ins, points, streak, scoreboard
r = R.call('checkIn', { token: caleb, disputeId: did, kept: true, note: 'Did Tuesday' }); ok('check-in', r.ok);
r = R.call('me', { token: caleb }); ok('points + streak + badges', r.user.points > 50 && r.user.streak === 1 && r.user.badges.includes('promise_keeper') && r.user.badges.includes('peacemaker'), r.user);
r = R.call('scoreboard', { token: momTok }); ok('scoreboard includes family', r.ok && r.board.some(b => b.name === 'Charles' && b.points > 0) && r.board.some(b => b.name === 'Caleb'));
r = R.call('listDisputes', { token: caleb }); ok('list disputes', r.ok && r.disputes.length === 1 && r.disputes[0].binding);

// live consent
r = R.call('consent', { token: caleb, disputeId: did, type: 'live', value: true }); ok('live consent', r.ok);
r = R.call('getDispute', { token: momTok, disputeId: did }); ok('consent visible', r.members.find(m => m.name === 'Caleb').consentLive);

// profile + logout
r = R.call('updateProfile', { token: caleb, region: 'Commerce Twp', newPin: '8888', pin: '7777' }); ok('update profile + pin', r.ok && r.user.region === 'Commerce Twp');
r = R.call('logout', { token: caleb }); ok('logout', r.ok);
r = R.call('me', { token: caleb }); ok('token dead after logout', !r.ok);

// no secrets in audit/responses
ok('ai key never returned', !JSON.stringify(R.call('getDispute', { token: momTok, disputeId: did })).includes('test-key'));
console.log('backend: ' + pass + ' checks passed');

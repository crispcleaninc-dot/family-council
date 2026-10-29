// End-to-end: two people on two phones, real app + real Code.gs (on the test double), fake AI and fake speech.
// node tests/ui.test.js   (screenshots go to tests/screens/)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { start } = require('./dev-server');
const SHOTS = path.join(__dirname, 'screens'); fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://localhost:8787/';
let n = 0; const errors = [];
function check(name, cond) { if (!cond) throw new Error('FAILED: ' + name); n++; console.log('  ✓ ' + name); }

// Fake speech recognition so live mode can be tested without a microphone.
const FAKE_SR = () => {
  class FakeSR { constructor() { window.__sr = this; } start() { this.running = true; } stop() { this.running = false; this.onend && this.onend(); } }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  window.__say = t => { const r = window.__sr; if (!r || !r.running) return false; const res = [{ transcript: t }]; res.isFinal = true; r.onresult({ resultIndex: 0, results: [res] }); return true; };
  navigator.mediaDevices && (navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('no mic in test')));
  window.speechSynthesis && (window.speechSynthesis.speak = u => setTimeout(() => u.onend && u.onend(), 10));
};

(async () => {
  const { server, relay } = await start(8787);
  const browser = await chromium.launch();
  const codeFor = email => /code is (\d{6})/.exec(relay.outbox.filter(x => x.to === email).pop().subject)[1];
  async function phone(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(FAKE_SR);
    await ctx.addInitScript(() => localStorage.setItem('fc_relay', 'http://localhost:8787/relay'));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
    p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'ok' : undefined));
    return p;
  }
  const shot = (p, f) => p.screenshot({ path: path.join(SHOTS, f + '.png'), fullPage: false });

  // icons from the SVG
  const ip = await browser.newPage();
  for (const s of [192, 512]) {
    await ip.setViewportSize({ width: s, height: s });
    await ip.setContent(`<html><body style="margin:0">${fs.readFileSync(path.join(__dirname, '..', 'icon.svg'), 'utf8').replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    await ip.screenshot({ path: path.join(__dirname, '..', 'icon-' + s + '.png'), omitBackground: true });
  }
  await ip.close();

  async function signup(p, email, name, age, state, region) {
    await p.goto(BASE); await p.waitForSelector('.hero');
    await p.click('.seg button[data-m=signup]');
    await p.fill('#suEmail', email); await p.click('#suSend');
    await p.waitForSelector('#suCode');
    await p.fill('#suCode', codeFor(email)); await p.fill('#suName', name); await p.fill('#suAge', String(age));
    await p.selectOption('#suState', state); await p.fill('#suRegion', region);
    await p.fill('#suPin', '2468'); await p.fill('#suPin2', '2468');
    await p.check('#suConsent'); await p.click('#suGo');
    await p.waitForSelector('.levelcard');
  }

  console.log('Mom signs up');
  const mom = await phone('mom');
  await mom.goto(BASE); await mom.waitForSelector('.hero'); await shot(mom, '01-welcome');
  await signup(mom, 'mom@example.com', 'Ciarne', 40, 'Michigan', 'Oakland County, West Bloomfield');
  check('home shows level + points', (await mom.textContent('.levelcard')).includes('Seedling') && (await mom.textContent('#ptsVal')) === '10');
  await shot(mom, '02-home');

  console.log('Mom adds Charles (8) as a family member');
  await mom.click('[data-go=me]'); await mom.waitForSelector('#hhAdd');
  await mom.click('#hhAdd');
  await mom.fill('#hhList .hh [data-h=name]', 'Charles'); await mom.fill('#hhList .hh [data-h=relation]', 'son'); await mom.fill('#hhList .hh [data-h=age]', '8');
  await mom.click('#hhSave'); await mom.waitForFunction(() => document.querySelector('#hhList .hh [data-h=name]') && document.querySelector('#hhList .hh').dataset.id);
  check('family member saved', true);

  console.log('Mom opens a council');
  await mom.click('.bnav .fab'); await mom.waitForSelector('#wTitle');
  await mom.fill('#wTitle', 'Whose turn for dishes');
  await mom.click('[data-cat=chores]'); await mom.click('[data-guide=grandmother]');
  await mom.fill('#wDesc', 'Sink was full Monday night. Charles and Caleb both say it was not their night.');
  await mom.fill('#wRel', 'mom');
  await mom.check('[data-hh]');
  await shot(mom, '03-new-council');
  await mom.click('#wGo');
  await mom.waitForSelector('#codeBox');
  const joinCode = (await mom.textContent('#codeBox')).trim();
  check('join code shown', /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(joinCode));
  await shot(mom, '04-invite');
  await mom.fill('#invEmail', 'caleb@example.com'); await mom.click('#invSend');
  await mom.waitForFunction(() => !document.querySelector('#sheet').classList.contains('on'));
  check('invite email sent with code', relay.outbox.some(m => m.to === 'caleb@example.com' && m.htmlBody.includes(joinCode)));

  console.log('Caleb signs up on his phone and joins with the code');
  const caleb = await phone('caleb');
  await signup(caleb, 'caleb@example.com', 'Caleb', 16, 'Michigan', 'Walled Lake');
  await caleb.click('#joinBtn'); await caleb.fill('#jCode', joinCode.replace('-', '').toLowerCase()); await caleb.fill('#jRel', 'son');
  await caleb.click('#jGo'); await caleb.waitForSelector('#cPeople .person');
  check('caleb sees all three people', (await caleb.$$('#cPeople .person[data-m]')).length === 3);

  console.log('Promises, opening, sides');
  await mom.waitForSelector('[data-cov]');
  await mom.click('[data-cov]'); await mom.waitForTimeout(400);
  await mom.click('[data-cov]'); await mom.waitForTimeout(400);
  await caleb.waitForSelector('[data-cov]'); await caleb.click('[data-cov]');
  await mom.click('[data-ai=opening]'); await mom.waitForSelector('.msg.guide');
  check('guide opened the council', (await mom.textContent('#feed')).includes('Welcome'));
  // pass talking stick to Charles and post his side from mom's phone
  const charlesId = await mom.$eval('#cPeople .person[data-m]:nth-child(2)', el => el.dataset.m);
  await mom.click(`#cPeople [data-m="${charlesId}"]`);
  await mom.waitForFunction(id => document.querySelector('#as').value === id, charlesId);
  await mom.fill('#say', 'Monday is Caleb night on the chart!'); await mom.click('#send');
  await mom.waitForFunction(() => document.querySelector('#feed').textContent.includes('Monday is Caleb night'));
  check('Charles side posted from mom phone', (await mom.textContent('#feed')).includes('Charles'));
  await caleb.waitForFunction(() => document.querySelector('#feed') && document.querySelector('#feed').textContent.includes('Monday is Caleb night'), null, { timeout: 12000 });
  check('caleb phone updates live (polling)', true);
  await caleb.fill('#say', 'I switched with him last week, so Monday was his.'); await caleb.click('#send');
  await caleb.waitForFunction(() => document.querySelector('#feed').textContent.includes('switched with him'));
  await caleb.click('[data-ai=coach]'); await caleb.waitForSelector('.msg.private');
  check('private coach shows for caleb', (await caleb.textContent('.msg.private')).includes('Own this'));
  await shot(caleb, '05-council-caleb');
  await mom.waitForFunction(() => document.querySelector('#feed').textContent.includes('switched with him'), null, { timeout: 12000 });
  check('mom does not see caleb coaching', !(await mom.textContent('#feed')).includes('Own this'));
  await shot(mom, '06-council-mom');

  console.log('Advocate (private)');
  await caleb.click('#cTabs [data-t=advocate]'); await caleb.click('[data-q^="What is my strongest"]');
  await caleb.waitForFunction(() => document.querySelector('#cPanel').textContent.includes('Say it like this'));
  check('advocate answered privately', true);
  await shot(caleb, '07-advocate');

  console.log('Home vs court');
  await mom.click('#cTabs [data-t=court]'); await mom.click('#courtGo');
  await mom.waitForSelector('.law');
  const courtText = await mom.textContent('#cPanel');
  check('court comparison with laws + verify + kids box', courtText.includes('MCL 722.52') && courtText.includes('Verify') && courtText.includes('FOR KIDS') && courtText.includes('In a real court'));
  check('court prompt used state, county and ages', relay.aiCalls.some(c => c.messages[0].content.includes('Charles: age 8, Oakland County, West Bloomfield, Michigan')));
  await shot(mom, '08-court');
  await mom.evaluate(() => window.scrollTo(0, 900)); await shot(mom, '08b-court-table');

  console.log('Live listening');
  await mom.click('#cTabs [data-t=live]'); await mom.waitForSelector('#consentList');
  check('mic locked until everyone agrees', await mom.$eval('#bigMic', b => b.disabled));
  await mom.click('[data-lc]'); await mom.waitForTimeout(500); await mom.click('[data-lc]');
  await caleb.click('#cTabs [data-t=live]'); await caleb.waitForSelector('[data-lc]'); await caleb.click('[data-lc]');
  await mom.waitForFunction(() => !document.querySelector('#bigMic').disabled, null, { timeout: 12000 });
  await mom.click('#bigMic'); await mom.waitForSelector('#bigMic.on');
  await mom.evaluate(() => window.__say('okay I think Monday was his'));
  await mom.evaluate(() => window.__say('you always do this, shut up'));
  await mom.waitForSelector('#interject.on', { timeout: 8000 });
  check('guide stepped in on name-calling', (await mom.textContent('#interject')).includes('slow down'));
  check('transcript credited to talking-stick holder', (await mom.textContent('#tx')).includes('Charles: okay I think'));
  await shot(mom, '09-live');
  await mom.click('#bigMic'); await mom.waitForSelector('#bigMic:not(.on)');
  await mom.click('#cTabs [data-t=council]');
  await mom.waitForFunction(() => document.querySelector('#feed').textContent.includes('Spoken'), null, { timeout: 8000 });
  check('stopping posts the transcript to the record', (await mom.textContent('#feed')).includes('okay I think Monday was his'));

  console.log('Settle it, sign, keep');
  await mom.click('#cTabs [data-t=council]'); await mom.click('[data-ai=propose]');
  await mom.waitForSelector('[data-useopt]'); await mom.click('[data-useopt]');
  await mom.waitForSelector('#saveRes');
  check('proposal filled the draft', (await mom.inputValue('#terms [data-tk=what]')).includes('Mon, Wed, Fri'));
  await mom.click('#saveRes'); await mom.waitForSelector('[data-sign]');
  await mom.click('[data-sign][data-agree="1"]'); await mom.waitForTimeout(500);
  await mom.click('[data-sign][data-agree="1"]');
  await caleb.click('#cTabs [data-t=resolution]'); await caleb.waitForSelector('[data-sign][data-agree="1"]', { timeout: 12000 });
  await caleb.click('[data-sign][data-agree="1"]');
  await caleb.waitForSelector('.stamp');
  check('resolution is binding', (await caleb.textContent('.scroll')).includes('BINDING'));
  await shot(caleb, '10-binding');
  await caleb.click('[data-ci][data-kept="1"]');
  await caleb.waitForFunction(() => document.querySelector('#cPanel').textContent.includes('✅'));
  await caleb.waitForFunction(() => document.querySelector('#streakVal').textContent === '1', null, { timeout: 8000 });
  check('promise kept builds streak', true);
  await mom.waitForSelector('.stamp', { timeout: 12000 });
  check('mom sees binding too', true);

  console.log('Board, learn, home');
  await caleb.click('[data-go=board]'); await caleb.waitForSelector('#brd .r');
  check('peace board lists people', (await caleb.textContent('#brd')).includes('Caleb'));
  await shot(caleb, '11-board');
  await mom.click('[data-go=learn]'); await mom.waitForSelector('.vs'); await shot(mom, '12-learn');
  await mom.click('[data-go=home]'); await mom.waitForSelector('.dlist .d');
  check('home lists the council as binding', (await mom.textContent('.dlist')).includes('Binding'));
  await shot(mom, '13-home-after');

  console.log('Safety');
  await mom.click('.dlist .d'); await mom.waitForSelector('#say');
  await mom.fill('#say', 'He said he would hit me'); await mom.click('#send');
  await mom.waitForSelector('.safety');
  check('safety resources shown', (await mom.textContent('#cSafety')).includes('988'));

  console.log('Sign out / sign in');
  await mom.click('[data-go=me]'); await mom.click('#out'); await mom.waitForSelector('.hero');
  await mom.fill('#liEmail', 'mom@example.com'); await mom.fill('#liPin', '2468'); await mom.click('#liGo'); await mom.waitForSelector('.levelcard');
  check('sign back in', true);

  check('no page errors', errors.length === 0 || (console.log(errors), false));
  console.log('ui: ' + n + ' checks passed');
  await browser.close(); server.close();
})().catch(async e => { console.error(e.message); console.error(errors.join('\n')); process.exit(1); });

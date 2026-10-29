// Test double for the Google Apps Script services Code.gs uses, so the relay can be run and tested in Node.
// Not shipped to users; used only by tests/backend.test.js and tests/dev-server.js.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');

function signed(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }

function makeSheet(name) {
  const data = []; // rows of arrays (row 1 = header)
  const sheet = {
    name, data,
    getMaxRows: () => 1000,
    getLastRow: () => data.length,
    setFrozenRows() {},
    appendRow(row) { data.push(row.map(store)); },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
        setValues(vals) {
          vals.forEach((row, i) => { const rr = r - 1 + i; while (data.length <= rr) data.push([]); row.forEach((v, j) => { data[rr][c - 1 + j] = store(v); }); });
          return this;
        },
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); }
          return out;
        }
      };
    }
  };
  return sheet;
}
// Like Sheets: a leading apostrophe forces plain text and is not part of the value.
function store(v) {
  if (typeof v === 'string' && v.charAt(0) === "'") return v.slice(1);
  if (typeof v === 'string' && v.charAt(0) === '=') throw new Error('formula written to sheet: ' + v);
  return v;
}

function createRelay(opts = {}) {
  const props = Object.assign({ ANTHROPIC_API_KEY: 'test-key', APP_URL: 'http://localhost:8787/' }, opts.props || {});
  const cache = new Map();
  const outbox = [];
  const aiCalls = [];
  let spreadsheet = null;
  const ctx = {
    console,
    Logger: { log: (...a) => opts.verbose && console.log('[Logger]', ...a) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, String(v)), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'America/Detroit', getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    MailApp: { sendEmail: m => outbox.push(m) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => signed(crypto.createHash('sha256').update(String(s), 'utf8').digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', String(k)).update(String(v), 'utf8').digest()),
      sleep() {},
      formatDate: (d, tz, f) => d.toISOString().slice(0, 10)
    },
    SpreadsheetApp: {
      create(name) {
        const sheets = [makeSheet('Sheet1')];
        spreadsheet = {
          name, getId: () => 'sheet-123', getUrl: () => 'https://docs.google.com/spreadsheets/d/sheet-123',
          getSheets: () => sheets, getSheetByName: n => sheets.find(s => s.name === n) || null,
          insertSheet(n) { const s = makeSheet(n); sheets.push(s); return s; },
          deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1); }
        };
        return spreadsheet;
      },
      openById(id) { if (!spreadsheet) throw new Error('no sheet'); return spreadsheet; }
    },
    UrlFetchApp: {
      fetch(url, o) {
        const body = JSON.parse(o.payload); aiCalls.push(body);
        const text = (opts.ai || defaultAi)(body);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ model: body.model, content: [{ type: 'text', text }] }) };
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'relay', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  function call(action, extra) {
    ctx.CACHE_ROWS_ = {}; // fresh per request, like a new Apps Script execution
    const res = ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ action }, extra || {})) } });
    return JSON.parse(res.getContent());
  }
  function health() { ctx.CACHE_ROWS_ = {}; return JSON.parse(ctx.doGet().getContent()); }
  return { call, health, outbox, aiCalls, props, ctx, sheet: () => spreadsheet };
}

// Fake AI answers, chosen by what the prompt asks for.
function defaultAi(body) {
  const p = body.messages[0].content;
  if (p.includes('LIVE: this is what was just said')) {
    const loud = /stupid|shut up|hate you|always|never/i.test(p);
    return JSON.stringify({ interject: loud, say: loud ? 'Let us slow down. Say what happened, not what kind of person they are.' : '', tone: 'calm', to: 'everyone', decorum: ['Use I-statements'], safety: false });
  }
  if (p.includes('asks you privately')) return 'Your strongest point is the chore chart on the fridge. Your weak spot: you skipped Tuesday too.\nSay it like this: "The chart says Monday is mine and I did Monday."';
  if (p.includes('PRIVATE COACHING for')) return JSON.stringify({ tips: ['Lower your voice', 'Look at them when they talk', 'Own the plate you left'], sayInstead: 'I left my plate out and I can fix that.', ownIt: 'Leaving dishes in the sink', calm: 'Take three slow breaths.', safety: false });
  if (p.includes('offer fair ways to settle')) return '```json\n' + JSON.stringify({ summary: 'Both of you skipped a night.', findings: [{ point: 'Chart says Mon/Wed for Emma', type: 'fact', by: 'Emma' }], options: [{ title: 'Split by nights', why: 'Clear and fair', terms: [{ who: 'Emma', what: 'Dishes Mon, Wed, Fri by 8pm', by: 'every week' }, { who: 'Caleb', what: 'Dishes Tue, Thu, Sat by 8pm', by: 'every week' }], consequence: 'Miss a night, take an extra one.', repair: 'Say sorry and do tonight together.' }], recommend: 0, reviewDate: '2026-11-05', safety: false }) + '\n```';
  if (p.includes('make the final ruling')) return JSON.stringify({ summary: 'The council finds both skipped a night.', findings: [], terms: [{ who: 'Emma', what: 'Dishes Mon, Wed, Fri', by: '8pm' }, { who: 'Caleb', what: 'Dishes Tue, Thu, Sat', by: '8pm' }], consequence: 'Extra night', repair: 'Do tonight together', reviewDate: '2026-11-05', plainForKids: 'You each have your own nights now.', safety: false });
  if (p.includes('COMPARE HOME VS. A REAL COURT')) return JSON.stringify({ headline: 'No court would decide whose night it is for dishes.', wouldCourtHear: 'no', why: 'Household chores are up to parents.', court: 'None', steps: ['File', 'Serve', 'Hearing', 'Judgment'], laws: [{ name: 'Age of majority', cite: 'MCL 722.52', plain: 'You are an adult at 18 in Michigan.', check: true, link: 'https://legislature.mi.gov' }], ageNotes: 'Minors need a parent to sue.', homeVsCourt: [{ topic: 'Who decides', home: 'The family together', court: 'A judge, using the law' }, { topic: 'Feelings', home: 'Heard and respected', court: 'Not evidence' }], forKids: 'A judge would not decide dishes.', costTime: 'Weeks to months; filing fees.', safety: false });
  if (p.includes('clarifying questions')) return JSON.stringify({ say: 'I have two questions.', questions: [{ to: 'Emma', q: 'What does the chart say?' }], facts: [], safety: false });
  if (p.includes('Open this council')) return 'Welcome, everyone. One speaker at a time. Emma, you start.';
  return 'Thank you. Caleb, you are next.';
}

module.exports = { createRelay, defaultAi };

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function createApp(options = {}) {
  const elements = new Map();
  function element(id = '') {
    const node = {
      id, hidden: false, disabled: false, textContent: '', dataset: {}, attributes: {}, children: [], events: {},
      classList: { toggle() {} },
      addEventListener(name, callback) { this.events[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      appendChild(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; },
      click() { if (!this.disabled) this.events.click(); }
    };
    if (id) elements.set(id, node);
    return node;
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) element(match[1]);
  const feeling = element();
  feeling.lastChild = { textContent: 'Happy' };
  const color = element();
  color.attributes['aria-label'] = 'Blue';
  const sound = element();
  const handlers = {};
  const storage = new Map();
  const records = [];
  const metadata = new Map();
  if (options.legacy) storage.set('toddle-cation-check-ins', JSON.stringify(options.legacy));
  const localStorage = {
    getItem(key) { if (options.storageError) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
    setItem(key, value) { if (options.storageError) throw new Error('Storage unavailable'); storage.set(key, value); },
    removeItem(key) { if (options.storageError) throw new Error('Storage unavailable'); storage.delete(key); }
  };
  let request;
  const navigator = { userAgent: '', platform: '' };
  if (!options.noGeolocation) navigator.geolocation = {
    getCurrentPosition(success, failure, settings) { request = { success, failure, settings }; }
  };
  const window = {
    isSecureContext: options.secure !== false,
    matchMedia() { return { matches: false }; },
    addEventListener(name, callback) { handlers[name] = callback; },
    scrollTo() {}, close() {}, confirm() { return true; }
  };
  const database = {
    createObjectStore() {},
    close() {},
    transaction() {
      const transaction = { pending: 0 };
      transaction.objectStore = name => {
        function execute(action) {
          const request = {};
          transaction.pending++;
          queueMicrotask(() => {
            if (options.databaseError) {
              transaction.error = new Error('Database unavailable');
              transaction.onerror();
              return;
            }
            request.result = action();
            if (request.onsuccess) request.onsuccess();
            transaction.pending--;
            if (!transaction.pending) queueMicrotask(() => {
              if (!transaction.pending) transaction.oncomplete();
            });
          });
          return request;
        }
        return {
          add(value) { return execute(() => { records.push(value); return records.length; }); },
          getAll() { return execute(() => records.slice()); },
          clear() { return execute(() => { records.length = 0; }); },
          get(key) { return execute(() => metadata.get(key)); },
          put(value, key) { return execute(() => metadata.set(key, value)); }
        };
      };
      return transaction;
    }
  };
  let created = false;
  const indexedDB = {
    open() {
      const request = { result: database };
      queueMicrotask(() => {
        if (!created) { created = true; request.onupgradeneeded(); }
        request.onsuccess();
      });
      return request;
    }
  };
  const downloads = [];
  const URL = { createObjectURL(blob) { downloads.push(blob); return 'blob:download'; }, revokeObjectURL() {} };
  const Blob = globalThis.Blob;
  const document = {
    getElementById(id) { assert(elements.has(id), `Missing ${id}`); return elements.get(id); },
    querySelectorAll(selector) { return { '.feeling-choice': [feeling], '.color-choice': [color], '.sound': [sound] }[selector]; },
    createElement(tag) {
      const node = element();
      if (tag === 'a') node.click = () => { node.clicked = true; };
      return node;
    }
  };
  vm.runInNewContext(script, { document, window, navigator, localStorage, indexedDB, URL, Blob, setTimeout, console: { error() {} } });
  return { elements, feeling, color, storage, records, downloads, getRequest: () => request };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function select(app) {
  app.feeling.click();
  app.color.click();
}

function position() {
  return { coords: { latitude: 42.12, longitude: -71.34, accuracy: 10 } };
}

test('saves feeling, color, local time and location only after permission succeeds', async () => {
  const app = createApp();
  select(app);
  assert.equal(app.elements.get('location-dialog').open, true);
  assert.equal(app.records.length, 0);
  app.elements.get('save-check-in').click();
  assert.equal(app.getRequest().settings.maximumAge, 0);
  app.getRequest().success(position());
  await flush();
  const [entry] = app.records;
  assert.equal(entry.feeling, 'Happy');
  assert.equal(entry.color, 'Blue');
  assert.ok(entry.localDateTime);
  assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  assert.equal(typeof entry.timeZoneOffsetMinutes, 'number');
  assert.equal(entry.latitude, 42.12);
  assert.equal(entry.longitude, -71.34);
  assert.equal(entry.accuracyMeters, 10);
  assert.equal(app.elements.get('thanks').open, true);
  app.elements.get('open-history').click();
  await flush();
  assert.match(app.elements.get('history-list').children[0].textContent, /Happy, Blue.*42\.12, -71\.34/);
  app.elements.get('download-history').click();
  await flush();
  const csv = await app.downloads[0].text();
  assert.match(csv, /Local date and time/);
  assert.match(csv, /"Happy","Blue","42\.12","-71\.34","10"/);
  app.elements.get('clear-history').click();
  await flush();
  assert.equal(app.records.length, 0);
});

test('denied or unavailable location cannot save and allows retry', async () => {
  const app = createApp();
  select(app);
  app.elements.get('save-check-in').click();
  app.getRequest().failure({ code: 1 });
  assert.match(app.elements.get('location-status').textContent, /denied/i);
  assert.equal(app.records.length, 0);
  assert.equal(app.elements.get('thanks').open, undefined);
  app.elements.get('save-check-in').click();
  app.getRequest().failure({ code: 3 });
  assert.match(app.elements.get('location-status').textContent, /could not get/i);
  app.elements.get('save-check-in').click();
  app.getRequest().success(position());
  await flush();
  assert.equal(app.records.length, 1);
});

test('cancelling while locating prevents a late result from saving', async () => {
  const app = createApp();
  select(app);
  app.elements.get('save-check-in').click();
  const oldRequest = app.getRequest();
  app.elements.get('cancel-save').click();
  select(app);
  app.elements.get('save-check-in').click();
  oldRequest.success(position());
  assert.equal(app.records.length, 0);
  app.getRequest().success(position());
  await flush();
  assert.equal(app.records.length, 1);
});

test('storage failure keeps the check-in unsaved and reports the error', async () => {
  for (const options of [{ storageError: true }, { databaseError: true }]) {
    const app = createApp(options);
    select(app);
    app.elements.get('save-check-in').click();
    app.getRequest().success(position());
    await flush();
    assert.match(app.elements.get('location-status').textContent, /could not save/i);
    assert.equal(app.elements.get('thanks').open, undefined);
    assert.equal(app.elements.get('save-check-in').disabled, false);
  }
});

test('unsupported or insecure location does not save', () => {
  for (const options of [{ noGeolocation: true }, { secure: false }]) {
    const app = createApp(options);
    select(app);
    app.elements.get('save-check-in').click();
    assert.match(app.elements.get('location-status').textContent, /location is unavailable/i);
    assert.equal(app.getRequest(), undefined);
    assert.equal(app.records.length, 0);
  }
});

test('migrates check-ins from earlier local storage and deletes them when cleared', async () => {
  const entry = { feeling: 'Happy', color: 'Blue', localDateTime: 'Today', latitude: 42, longitude: -71, accuracyMeters: 10 };
  const app = createApp({ legacy: [entry] });
  app.elements.get('open-history').click();
  await flush();
  assert.equal(app.records.length, 1);
  assert.equal(app.storage.size, 0);
  app.elements.get('clear-history').click();
  await flush();
  assert.equal(app.records.length, 0);
});

test('install setup requests location only when asked and does not save it', () => {
  const app = createApp();
  app.elements.get('install-button').click();
  assert.equal(app.getRequest(), undefined);
  app.elements.get('install-location').click();
  app.getRequest().success(position());
  assert.match(app.elements.get('install-location-status').textContent, /location is available/i);
  assert.equal(app.records.length, 0);
});

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
      close() { this.open = false; if (this.events.close) this.events.close(); },
      click() { if (!this.disabled) return this.events.click(); }
    };
    if (id) elements.set(id, node);
    return node;
  }
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = element(match[1]);
    node.hidden = /\shidden(?:\s|>)/.test(match[0]);
  }
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
  const navigator = { userAgent: options.userAgent || '', platform: options.platform || '', standalone: options.standalone || false };
  if (options.serviceWorker) navigator.serviceWorker = options.serviceWorker;
  if (!options.noGeolocation) navigator.geolocation = {
    getCurrentPosition(success, failure, settings) { request = { success, failure, settings }; }
  };
  const window = {
    isSecureContext: options.secure !== false,
    matchMedia() { return { matches: !!options.standalone }; },
    addEventListener(name, callback) { handlers[name] = callback; },
    location: { reload() { if (options.onReload) options.onReload(); } },
    scrollTo() {}, close() {}, confirm() { return true; }
  };
  if (options.showDirectoryPicker) window.showDirectoryPicker = options.showDirectoryPicker;
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
  const downloadLinks = [];
  const sessionValues = options.sessionValues || new Map();
  const sessionStorage = {
    getItem(key) { return sessionValues.get(key) ?? null; },
    setItem(key, value) { sessionValues.set(key, value); }
  };
  const URL = { createObjectURL(blob) { downloads.push(blob); return 'blob:download'; }, revokeObjectURL() {} };
  const Blob = globalThis.Blob;
  const document = {
    getElementById(id) { assert(elements.has(id), `Missing ${id}`); return elements.get(id); },
    querySelectorAll(selector) { return { '.feeling-choice': [feeling], '.color-choice': [color], '.sound': [sound] }[selector]; },
    createElement(tag) {
      const node = element();
      if (tag === 'a') node.click = () => { downloadLinks.push(node.download); };
      return node;
    }
  };
  vm.runInNewContext(script, { document, window, navigator, localStorage, sessionStorage, indexedDB, URL, Blob, setTimeout, clearTimeout, console: { error() {} } });
  return { elements, feeling, color, storage, records, downloads, downloadLinks, handlers, getRequest: () => request };
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
  const app = createApp({ userAgent: 'Example Device Browser' });
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
  assert.ok(entry.localDate);
  assert.ok(entry.localTime);
  assert.equal(entry.device, 'Example Device Browser');
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
  assert.match(csv, /Local date","Local time","Mood","Color","Device \/ browser/);
  assert.match(csv, /"Happy","Blue","Example Device Browser","42\.12","-71\.34","10"/);
  assert.deepEqual(app.downloadLinks, ['checkins.csv']);
  app.elements.get('clear-history').click();
  await flush();
  assert.equal(app.records.length, 0);
});

test('exports all entries to a checkins folder in the selected directory', async () => {
  let written;
  const calls = [];
  const handle = {
    async createWritable() {
      return {
        async write(file) { written = await file.text(); },
        async close() { calls.push('closed'); }
      };
    }
  };
  const folder = { async getFileHandle(name, options) { calls.push([name, options.create]); return handle; } };
  const parent = { async getDirectoryHandle(name, options) { calls.push([name, options.create]); return folder; } };
  const app = createApp({ userAgent: 'Device "A", browser', showDirectoryPicker(options) {
    calls.push(['picker', options.mode]);
    return Promise.resolve(parent);
  } });
  select(app);
  app.elements.get('save-check-in').click();
  app.getRequest().success(position());
  await flush();
  app.records.push({ feeling: 'Sad', color: 'Red', timestamp: '2026-01-02T03:04:05.000Z', timeZoneOffsetMinutes: 300, latitude: 1, longitude: 2, accuracyMeters: 3 });
  await app.elements.get('download-history').click();
  assert.deepEqual(calls, [['picker', 'readwrite'], ['checkins', true], ['checkins.csv', true], 'closed']);
  assert.match(written, /"Device ""A"", browser"/);
  assert.match(written, /"2026-01-01","22:04:05","Sad","Red","Not recorded","1","2","3"/);
  assert.match(app.elements.get('history-status').textContent, /saved checkins\/checkins\.csv/i);
  assert.equal(app.downloads.length, 0);
});

test('folder selection cancellation and permission errors are reported without deleting check-ins', async () => {
  for (const [error, expected] of [[Object.assign(new Error('cancelled'), { name: 'AbortError' }), /cancelled/i], [new Error('denied'), /could not export/i]]) {
    const app = createApp({ showDirectoryPicker() { return Promise.reject(error); } });
    app.records.push({ feeling: 'Happy' });
    await app.elements.get('download-history').click();
    assert.match(app.elements.get('history-status').textContent, expected);
    assert.equal(app.records.length, 1);
  }
});

test('a failed file write reports an error and keeps the local database', async () => {
  const app = createApp({ showDirectoryPicker() {
    return Promise.resolve({
      async getDirectoryHandle() {
        return { async getFileHandle() { throw new Error('Permission denied'); } };
      }
    });
  } });
  app.records.push({ feeling: 'Happy', color: 'Red' });
  await app.elements.get('download-history').click();
  assert.match(app.elements.get('history-status').textContent, /could not export/i);
  assert.equal(app.records.length, 1);
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

test('install invitation appears once per session and not in standalone mode', () => {
  const sessionValues = new Map();
  const app = createApp({ sessionValues });
  app.handlers.load();
  assert.equal(app.elements.get('install-invitation').open, true);
  app.elements.get('invite-dismiss').click();
  assert.equal(app.elements.get('install-invitation').open, false);
  const reloaded = createApp({ sessionValues });
  reloaded.handlers.load();
  assert.equal(reloaded.elements.get('install-invitation').open, undefined);
  const installed = createApp({ standalone: true });
  installed.handlers.load();
  assert.equal(installed.elements.get('install-invitation').open, undefined);
  assert.equal(installed.elements.get('install-button').hidden, true);
});

test('popup launches the native install prompt directly on user action', async () => {
  const app = createApp();
  let prompted = 0;
  let prevented = false;
  app.handlers.beforeinstallprompt({
    preventDefault() { prevented = true; },
    prompt() { prompted++; return Promise.resolve({ outcome: 'accepted' }); }
  });
  app.handlers.load();
  app.elements.get('invite-install').click();
  assert.equal(prevented, true);
  assert.equal(prompted, 1);
  await flush();
  assert.match(app.elements.get('install-instructions').textContent, /installation started/i);
  assert.equal(app.elements.get('install-dialog').open, true);
  app.handlers.appinstalled();
  assert.equal(app.elements.get('install-button').hidden, true);
});

test('install help appears immediately when native prompt is unavailable', () => {
  const app = createApp({ userAgent: 'iPhone', platform: 'iPhone' });
  app.handlers.load();
  app.elements.get('invite-install').click();
  assert.equal(app.elements.get('install-dialog').open, true);
  assert.match(app.elements.get('install-instructions').textContent, /Share.*Add to Home Screen/);
});

test('dismissed and failed native prompts do not claim installation succeeded', async () => {
  const dismissed = createApp();
  dismissed.handlers.beforeinstallprompt({ preventDefault() {}, prompt() { return Promise.resolve({ outcome: 'dismissed' }); } });
  await dismissed.elements.get('install-button').click();
  assert.equal(dismissed.elements.get('install-dialog').open, undefined);
  assert.equal(dismissed.elements.get('install-button').hidden, false);
  const failed = createApp();
  failed.handlers.beforeinstallprompt({ preventDefault() {}, prompt() { return Promise.reject(new Error('unavailable')); } });
  await failed.elements.get('install-button').click();
  assert.match(failed.elements.get('install-instructions').textContent, /could not open.*install/i);
  assert.equal(failed.elements.get('install-dialog').open, true);
});

test('offers a waiting update, applies it on request, and keeps saved check-ins', async () => {
  const serviceEvents = {};
  const messages = [];
  let reloaded = false;
  const registration = {
    waiting: { postMessage(message) { messages.push(message.type); } },
    addEventListener() {}
  };
  const serviceWorker = {
    controller: {},
    addEventListener(name, callback) { serviceEvents[name] = callback; },
    register() { return Promise.resolve(registration); }
  };
  const app = createApp({ serviceWorker, onReload() { reloaded = true; } });
  select(app);
  app.elements.get('save-check-in').click();
  app.getRequest().success(position());
  await flush();
  assert.equal(app.records.length, 1);
  assert.equal(app.elements.get('update-notice').hidden, false);
  app.elements.get('update-app').click();
  assert.deepEqual(messages, ['SKIP_WAITING']);
  assert.equal(reloaded, false);
  serviceEvents.controllerchange();
  assert.equal(reloaded, true);
  assert.equal(app.records.length, 1);
});

test('offers a newly installed update but not a first offline installation', async () => {
  for (const controlled of [true, false]) {
    const registrationEvents = {};
    const workerEvents = {};
    const worker = { state: 'installing', addEventListener(name, callback) { workerEvents[name] = callback; } };
    const registration = {
      waiting: null,
      installing: worker,
      addEventListener(name, callback) { registrationEvents[name] = callback; }
    };
    const serviceWorker = {
      controller: controlled ? {} : null,
      addEventListener() {},
      register() { return Promise.resolve(registration); }
    };
    const app = createApp({ serviceWorker });
    await flush();
    assert.equal(app.elements.get('update-notice').hidden, true);
    registrationEvents.updatefound();
    worker.state = 'installed';
    registration.waiting = worker;
    workerEvents.statechange();
    assert.equal(app.elements.get('update-notice').hidden, !controlled);
  }
});

test('reports when the update can no longer be started', async () => {
  const registration = { waiting: {}, addEventListener() {} };
  const serviceWorker = { controller: {}, addEventListener() {}, register() { return Promise.resolve(registration); } };
  const app = createApp({ serviceWorker });
  await flush();
  registration.waiting = null;
  app.elements.get('update-app').click();
  assert.match(app.elements.get('update-status').textContent, /no longer available/i);
});

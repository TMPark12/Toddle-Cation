const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('caches the app and serves its pages and styles when offline', async () => {
  const handlers = {};
  const files = new Map([
    ['./index.html', 'cached page'],
    ['./style.css', 'cached styles']
  ]);
  let precached;
  const cache = {
    addAll(paths) { precached = paths; return Promise.resolve(); },
    match(key) { return Promise.resolve(files.get(typeof key === 'string' ? key : key.path)); }
  };
  const context = {
    self: { location: { origin: 'https://example.test' }, addEventListener(name, callback) { handlers[name] = callback; } },
    caches: { open() { return Promise.resolve(cache); } },
    fetch() { return Promise.reject(new Error('offline')); },
    URL, Response
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8'), context);
  let pending;
  handlers.install({ waitUntil(promise) { pending = promise; } });
  await pending;
  assert.ok(precached.includes('./index.html'));
  assert.ok(precached.includes('./style.css'));
  handlers.fetch({
    request: { method: 'GET', url: 'https://example.test/', mode: 'navigate', path: './' },
    respondWith(promise) { pending = promise; }
  });
  assert.equal(await pending, 'cached page');
  handlers.fetch({
    request: { method: 'GET', url: 'https://example.test/style.css', mode: 'no-cors', path: './style.css' },
    respondWith(promise) { pending = promise; }
  });
  assert.equal(await pending, 'cached styles');
});

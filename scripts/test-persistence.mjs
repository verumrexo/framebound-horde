import assert from 'node:assert/strict';
import { loadSoloRun, saveSoloRun, clearSoloRun } from '../src/core/persistence.js';

// Deterministic IndexedDB event double: request success and transaction commit
// are independent, as they are when a browser aborts after returning a result.
function databaseScenario(mode = 'success') {
  const records = new Map();
  const database = new EventTarget();
  let closed = 0;
  database.close = () => { closed++; };
  database.transaction = () => {
    const tx = new EventTarget();
    tx.objectStore = () => ({
      put(record) { records.set(record.sessionId, structuredClone(record)); queueMicrotask(() => tx.dispatchEvent(new Event('complete'))); },
      delete(id) { records.delete(id); queueMicrotask(() => tx.dispatchEvent(new Event('complete'))); },
      get(id) {
        const request = new EventTarget();
        queueMicrotask(() => {
          request.result = records.get(id);
          request.dispatchEvent(new Event('success'));
          if (mode === 'abort') {
            tx.error = new Error('read aborted');
            tx.dispatchEvent(new Event('abort'));
          } else tx.dispatchEvent(new Event('complete'));
        });
        return request;
      }
    });
    return tx;
  };
  const request = new EventTarget();
  globalThis.indexedDB = { open() {
    queueMicrotask(() => {
      request.result = database;
      request.dispatchEvent(new Event(mode === 'blocked' ? 'blocked' : 'success'));
    });
    return request;
  } };
  return { records, database, request, closed: () => closed };
}

let fixture = databaseScenario();
await saveSoloRun('solo', { tick: 42 }, [{ sequence: 1 }]);
assert.deepEqual((await loadSoloRun('solo')).correction, { tick: 42 });
await clearSoloRun('solo');
assert.equal(await loadSoloRun('solo'), null);
assert.equal(fixture.closed(), 4);
console.log('save/load/delete complete and close connections');

fixture = databaseScenario('abort');
await assert.rejects(loadSoloRun('solo'), /read aborted/);
assert.equal(fixture.closed(), 1);
console.log('request success followed by transaction abort rejects cleanly');

fixture = databaseScenario('blocked');
await assert.rejects(loadSoloRun('solo'), /blocked by another tab/);
fixture.request.dispatchEvent(new Event('success'));
assert.equal(fixture.closed(), 1);
console.log('blocked open rejects; a late connection is closed');

delete globalThis.indexedDB;
await assert.rejects(loadSoloRun('solo'), /unavailable/);
console.log('unavailable storage rejects without hanging');

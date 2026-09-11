const DATABASE_NAME = 'framebound_horde';
const DATABASE_VERSION = 1;
const RUN_STORE = 'solo_runs';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('indexeddb request failed')), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error || new Error('indexeddb transaction aborted')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error || new Error('indexeddb transaction failed')), { once: true });
  });
}

async function openDatabase() {
  if (!globalThis.indexedDB) throw new Error('indexeddb is unavailable');
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener('upgradeneeded', () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(RUN_STORE)) database.createObjectStore(RUN_STORE, { keyPath: 'sessionId' });
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error('indexeddb open timed out')), 10000);
    request.addEventListener('blocked', () => fail(new Error('save database blocked by another tab')), { once: true });
    request.addEventListener('error', () => fail(request.error || new Error('indexeddb open failed')), { once: true });
    request.addEventListener('success', () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      // Cooperate with an upgrade in another tab instead of blocking it forever.
      database.addEventListener('versionchange', () => database.close());
      resolve(database);
    }, { once: true });
  });
}

export async function saveSoloRun(sessionId, correction, commandLog) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RUN_STORE, 'readwrite');
    transaction.objectStore(RUN_STORE).put({
      sessionId,
      savedAt: Date.now(),
      correction,
      commandLog
    });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function loadSoloRun(sessionId) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RUN_STORE, 'readonly');
    // Observe commit/abort before the request resolves, and consume both failures.
    const done = transactionDone(transaction);
    const [result] = await Promise.all([
      requestResult(transaction.objectStore(RUN_STORE).get(sessionId)),
      done
    ]);
    return result || null;
  } finally {
    database.close();
  }
}

export async function clearSoloRun(sessionId) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RUN_STORE, 'readwrite');
    transaction.objectStore(RUN_STORE).delete(sessionId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/**
 * BTC/USDT 5분봉 캔들 로더
 * - Binance REST API에서 직접 fetch
 * - IndexedDB에 캐시 (최초 1회 fetch 후 재사용)
 * - 서버 불필요, 브라우저 단독 동작
 */

const DB_NAME = 'btc-candles';
const DB_VERSION = 1;
const STORE_NAME = 'candles';
const META_STORE = 'meta';

const BINANCE_BASE = 'https://api.binance.com';
const SYMBOL = 'BTCUSDT';
const INTERVAL = '5m';
const LIMIT = 1000;
const START_TIME = new Date('2017-08-17T00:00:00Z').getTime();

// ── IndexedDB helpers ───────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'openTime' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPutBatch(db, candles) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const c of candles) store.put(c);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGetMeta(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  });
}

function idbSetMeta(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Binance API fetch ───────────────────────────────────────────────────────

async function fetchKlines(startTime, endTime) {
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&startTime=${startTime}&endTime=${endTime}&limit=${LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API HTTP ${res.status}`);
  const raw = await res.json();
  return raw.map(k => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    close: parseFloat(k[4]),
  }));
}

// ── Main loader ─────────────────────────────────────────────────────────────

/**
 * Load all BTC/USDT 5m candles.
 * @param {function} onProgress - callback(message: string)
 * @returns {Promise<Array<{openTime: number, open: number, close: number}>>}
 */
async function loadCandles(onProgress = () => {}) {
  const db = await openDB();

  // Check cache freshness (re-fetch if older than 6 hours)
  const lastFetch = await idbGetMeta(db, 'lastFetchTime');
  const cached = await idbGetAll(db);
  const staleMs = 6 * 60 * 60 * 1000;

  if (cached.length > 100000 && lastFetch && (Date.now() - lastFetch) < staleMs) {
    onProgress(`캐시 로드: ${cached.length.toLocaleString()}개 캔들`);
    return cached.sort((a, b) => a.openTime - b.openTime);
  }

  // Determine fetch start point
  let cursor = START_TIME;
  if (cached.length > 0) {
    const maxTime = cached.reduce((m, c) => c.openTime > m ? c.openTime : m, 0);
    cursor = maxTime + 5 * 60 * 1000; // resume from last candle
    onProgress(`기존 ${cached.length.toLocaleString()}개 + 신규 데이터 수신 중...`);
  } else {
    onProgress('Binance에서 전체 데이터 수신 중... (최초 1회, 2~3분 소요)');
  }

  const now = Date.now();
  let page = 0;
  let newCount = 0;
  const BATCH_WRITE = 20000; // write to IDB every 20k candles
  let writeBuf = [];

  while (cursor < now) {
    const endTime = Math.min(cursor + LIMIT * 5 * 60 * 1000 - 1, now);
    const batch = await fetchKlines(cursor, endTime);
    if (batch.length === 0) break;

    writeBuf.push(...batch);
    newCount += batch.length;
    cursor = batch[batch.length - 1].openTime + 5 * 60 * 1000;
    page++;

    if (writeBuf.length >= BATCH_WRITE) {
      await idbPutBatch(db, writeBuf);
      writeBuf = [];
    }

    if (page % 20 === 0) {
      const date = new Date(batch[batch.length - 1].openTime).toISOString().slice(0, 10);
      const pct = Math.min(100, ((cursor - START_TIME) / (now - START_TIME) * 100)).toFixed(0);
      onProgress(`데이터 수신 중... ${pct}% (${date}) — ${(cached.length + newCount).toLocaleString()}개`);
    }

    // Rate limit: small delay every 50 requests
    if (page % 50 === 0) await new Promise(r => setTimeout(r, 300));
  }

  // Flush remaining
  if (writeBuf.length > 0) await idbPutBatch(db, writeBuf);
  await idbSetMeta(db, 'lastFetchTime', Date.now());

  // Read all from IDB (sorted by openTime via keyPath)
  const all = await idbGetAll(db);
  onProgress(`완료: ${all.length.toLocaleString()}개 캔들 로드`);
  return all.sort((a, b) => a.openTime - b.openTime);
}

// Export for use as module or global
if (typeof window !== 'undefined') window.loadCandles = loadCandles;

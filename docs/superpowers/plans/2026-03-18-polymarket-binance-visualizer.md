# Polymarket-Binance BTC Market Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a data collector that streams Polymarket BTC 5-min binary option and Binance BTCUSDT market data into SQLite, with a web dashboard visualizing price overlay, spread comparison, and cross-correlation.

**Architecture:** Single Node.js process running two WebSocket connectors (Polymarket, Binance) that batch-write to SQLite via `better-sqlite3`. An Express server serves a REST API and static HTML dashboard with Chart.js for visualization. All timestamps are dual-recorded (local receive time + packet timestamp).

**Tech Stack:** TypeScript, Node.js, `better-sqlite3`, `ws`, Express, Chart.js (CDN), `tsx` for execution.

**Spec:** `docs/superpowers/specs/2026-03-18-polymarket-binance-visualizer-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts |
| `tsconfig.json` | TypeScript config |
| `.gitignore` | Ignore `data/`, `node_modules/` |
| `src/db.ts` | SQLite init, schema creation, batch INSERT helpers, write buffer flush |
| `src/connectors/binance.ts` | Binance WS connection, subscribe, parse messages, buffer to DB |
| `src/connectors/polymarket.ts` | Gamma API market discovery, WS connection, 5-min rollover, buffer to DB |
| `src/api/routes.ts` | Express REST API routes (`/api/data`, `/api/poly/books`, `/api/bnc/books`, `/api/correlation`) |
| `src/analysis/correlation.ts` | Cross-correlation calculation |
| `src/index.ts` | Entry point: init DB, start connectors, start Express server |
| `public/index.html` | Single-file dashboard: Chart.js charts, timebase toggle, time range picker |
| `tests/db.test.ts` | DB schema and insert helper tests |
| `tests/correlation.test.ts` | Cross-correlation calculation tests |
| `tests/api.test.ts` | REST API endpoint tests |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "poly-test",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.21.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^5.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
data/
*.db
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore package-lock.json
git commit -m "chore: scaffold project with dependencies"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/db.ts`
- Create: `tests/db.test.ts`

- [ ] **Step 1: Write failing tests for DB initialization and insert helpers**

Create `tests/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, createInsertHelpers, flushBuffer, type WriteBuffer } from '../src/db.js';

describe('initDb', () => {
  it('creates all tables and indexes', () => {
    const db = initDb(':memory:');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('poly_books');
    expect(tableNames).toContain('poly_prices');
    expect(tableNames).toContain('bnc_book_tickers');
    expect(tableNames).toContain('bnc_depths');
    expect(tableNames).toContain('bnc_trades');
    db.close();
  });

  it('enables WAL mode', () => {
    const db = initDb(':memory:');
    const result = db.pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
    db.close();
  });
});

describe('insert helpers', () => {
  let db: Database.Database;
  let helpers: ReturnType<typeof createInsertHelpers>;

  beforeEach(() => {
    db = initDb(':memory:');
    helpers = createInsertHelpers(db);
  });

  afterEach(() => db.close());

  it('inserts a poly_books row', () => {
    helpers.insertPolyBook({
      local_ts: 1000, server_ts: 999, market_slug: 'btc-updown-5m-100',
      token_id: 'tok1', side: 'up',
      bids: JSON.stringify([[0.45, 100]]), asks: JSON.stringify([[0.46, 200]]),
      best_bid: 0.45, best_ask: 0.46, last_trade_price: 0.45,
    });
    const rows = db.prepare('SELECT * FROM poly_books').all();
    expect(rows).toHaveLength(1);
  });

  it('inserts a poly_prices row', () => {
    helpers.insertPolyPrice({
      local_ts: 1000, server_ts: 999, market_slug: 'btc-updown-5m-100',
      token_id: 'tok1', side: 'up', price: 0.52, event_type: 'price_change',
    });
    const rows = db.prepare('SELECT * FROM poly_prices').all();
    expect(rows).toHaveLength(1);
  });

  it('inserts a bnc_book_tickers row', () => {
    helpers.insertBncBookTicker({
      local_ts: 1000, bid_price: 84000, bid_qty: 1.5,
      ask_price: 84001, ask_qty: 2.0, update_id: 100,
    });
    const rows = db.prepare('SELECT * FROM bnc_book_tickers').all();
    expect(rows).toHaveLength(1);
  });

  it('inserts a bnc_depths row', () => {
    helpers.insertBncDepth({
      local_ts: 1000, server_ts: null,
      bids: JSON.stringify([[84000, 1.5]]), asks: JSON.stringify([[84001, 2.0]]),
      last_update_id: 100,
    });
    const rows = db.prepare('SELECT * FROM bnc_depths').all();
    expect(rows).toHaveLength(1);
  });

  it('inserts a bnc_trades row', () => {
    helpers.insertBncTrade({
      local_ts: 1000, server_ts: 999, event_ts: 998,
      price: 84000.5, qty: 0.1, is_buyer_maker: true, trade_id: 12345,
    });
    const rows = db.prepare('SELECT * FROM bnc_trades').all();
    expect(rows).toHaveLength(1);
  });
});

describe('write buffer', () => {
  let db: Database.Database;
  let helpers: ReturnType<typeof createInsertHelpers>;

  beforeEach(() => {
    db = initDb(':memory:');
    helpers = createInsertHelpers(db);
  });

  afterEach(() => db.close());

  it('flushes buffered rows in a single transaction', () => {
    const buffer: WriteBuffer = [];
    buffer.push({ type: 'bnc_book_ticker', data: {
      local_ts: 1, bid_price: 84000, bid_qty: 1, ask_price: 84001, ask_qty: 1, update_id: 1,
    }});
    buffer.push({ type: 'bnc_book_ticker', data: {
      local_ts: 2, bid_price: 84002, bid_qty: 1, ask_price: 84003, ask_qty: 1, update_id: 2,
    }});
    flushBuffer(db, helpers, buffer);
    expect(buffer).toHaveLength(0);
    const rows = db.prepare('SELECT * FROM bnc_book_tickers').all();
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — module `../src/db.js` not found

- [ ] **Step 3: Implement `src/db.ts`**

```typescript
import Database from 'better-sqlite3';

export function initDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS poly_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_ts INTEGER NOT NULL,
      server_ts INTEGER,
      market_slug TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL,
      bids JSON NOT NULL,
      asks JSON NOT NULL,
      best_bid REAL,
      best_ask REAL,
      last_trade_price REAL
    );
    CREATE TABLE IF NOT EXISTS poly_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_ts INTEGER NOT NULL,
      server_ts INTEGER,
      market_slug TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      event_type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bnc_book_tickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_ts INTEGER NOT NULL,
      bid_price REAL NOT NULL,
      bid_qty REAL NOT NULL,
      ask_price REAL NOT NULL,
      ask_qty REAL NOT NULL,
      update_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS bnc_depths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_ts INTEGER NOT NULL,
      server_ts INTEGER,
      bids JSON NOT NULL,
      asks JSON NOT NULL,
      last_update_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS bnc_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_ts INTEGER NOT NULL,
      server_ts INTEGER NOT NULL,
      event_ts INTEGER NOT NULL,
      price REAL NOT NULL,
      qty REAL NOT NULL,
      is_buyer_maker BOOLEAN NOT NULL,
      trade_id INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poly_books_slug_local ON poly_books(market_slug, local_ts);
    CREATE INDEX IF NOT EXISTS idx_poly_prices_slug_local ON poly_prices(market_slug, local_ts);
    CREATE INDEX IF NOT EXISTS idx_bnc_book_tickers_local_ts ON bnc_book_tickers(local_ts);
    CREATE INDEX IF NOT EXISTS idx_bnc_depths_local_ts ON bnc_depths(local_ts);
    CREATE INDEX IF NOT EXISTS idx_bnc_trades_local_ts ON bnc_trades(local_ts);
    CREATE INDEX IF NOT EXISTS idx_bnc_trades_server_ts ON bnc_trades(server_ts);
  `);
  return db;
}

export interface PolyBookRow {
  local_ts: number; server_ts: number | null; market_slug: string;
  token_id: string; side: string; bids: string; asks: string;
  best_bid: number | null; best_ask: number | null; last_trade_price: number | null;
}

export interface PolyPriceRow {
  local_ts: number; server_ts: number | null; market_slug: string;
  token_id: string; side: string; price: number; event_type: string;
}

export interface BncBookTickerRow {
  local_ts: number; bid_price: number; bid_qty: number;
  ask_price: number; ask_qty: number; update_id: number | null;
}

export interface BncDepthRow {
  local_ts: number; server_ts: number | null;
  bids: string; asks: string; last_update_id: number | null;
}

export interface BncTradeRow {
  local_ts: number; server_ts: number; event_ts: number;
  price: number; qty: number; is_buyer_maker: boolean; trade_id: number;
}

export function createInsertHelpers(db: Database.Database) {
  const insertPolyBook = db.prepare(`
    INSERT INTO poly_books (local_ts, server_ts, market_slug, token_id, side, bids, asks, best_bid, best_ask, last_trade_price)
    VALUES (@local_ts, @server_ts, @market_slug, @token_id, @side, @bids, @asks, @best_bid, @best_ask, @last_trade_price)
  `);
  const insertPolyPrice = db.prepare(`
    INSERT INTO poly_prices (local_ts, server_ts, market_slug, token_id, side, price, event_type)
    VALUES (@local_ts, @server_ts, @market_slug, @token_id, @side, @price, @event_type)
  `);
  const insertBncBookTicker = db.prepare(`
    INSERT INTO bnc_book_tickers (local_ts, bid_price, bid_qty, ask_price, ask_qty, update_id)
    VALUES (@local_ts, @bid_price, @bid_qty, @ask_price, @ask_qty, @update_id)
  `);
  const insertBncDepth = db.prepare(`
    INSERT INTO bnc_depths (local_ts, server_ts, bids, asks, last_update_id)
    VALUES (@local_ts, @server_ts, @bids, @asks, @last_update_id)
  `);
  const insertBncTrade = db.prepare(`
    INSERT INTO bnc_trades (local_ts, server_ts, event_ts, price, qty, is_buyer_maker, trade_id)
    VALUES (@local_ts, @server_ts, @event_ts, @price, @qty, @is_buyer_maker, @trade_id)
  `);

  return {
    insertPolyBook: (row: PolyBookRow) => insertPolyBook.run(row),
    insertPolyPrice: (row: PolyPriceRow) => insertPolyPrice.run(row),
    insertBncBookTicker: (row: BncBookTickerRow) => insertBncBookTicker.run(row),
    insertBncDepth: (row: BncDepthRow) => insertBncDepth.run(row),
    insertBncTrade: (row: BncTradeRow) => insertBncTrade.run(row),
  };
}

export type BufferEntry =
  | { type: 'poly_book'; data: PolyBookRow }
  | { type: 'poly_price'; data: PolyPriceRow }
  | { type: 'bnc_book_ticker'; data: BncBookTickerRow }
  | { type: 'bnc_depth'; data: BncDepthRow }
  | { type: 'bnc_trade'; data: BncTradeRow };

export type WriteBuffer = BufferEntry[];

export function flushBuffer(
  db: Database.Database,
  helpers: ReturnType<typeof createInsertHelpers>,
  buffer: WriteBuffer,
): void {
  if (buffer.length === 0) return;
  const flush = db.transaction(() => {
    for (const entry of buffer) {
      switch (entry.type) {
        case 'poly_book': helpers.insertPolyBook(entry.data); break;
        case 'poly_price': helpers.insertPolyPrice(entry.data); break;
        case 'bnc_book_ticker': helpers.insertBncBookTicker(entry.data); break;
        case 'bnc_depth': helpers.insertBncDepth(entry.data); break;
        case 'bnc_trade': helpers.insertBncTrade(entry.data); break;
      }
    }
  });
  flush();
  buffer.length = 0;
}

const FLUSH_SIZE = 100;
const FLUSH_INTERVAL_MS = 200;

export function createBufferedWriter(db: Database.Database, helpers: ReturnType<typeof createInsertHelpers>) {
  const buffer: WriteBuffer = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushBuffer(db, helpers, buffer);
    }, FLUSH_INTERVAL_MS);
  }

  return {
    push(entry: BufferEntry) {
      buffer.push(entry);
      if (buffer.length >= FLUSH_SIZE) {
        if (timer) { clearTimeout(timer); timer = null; }
        flushBuffer(db, helpers, buffer);
      } else {
        scheduleFlush();
      }
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      flushBuffer(db, helpers, buffer);
    },
    get pending() { return buffer.length; },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.ts tests/db.test.ts
git commit -m "feat: add database layer with schema, insert helpers, and write batching"
```

---

### Task 3: Binance Connector

**Files:**
- Create: `src/connectors/binance.ts`

This connector connects to the Binance WebSocket, subscribes to `btcusdt@bookTicker`, `btcusdt@trade`, `btcusdt@depth10@100ms`, parses incoming messages, and pushes them to the buffered writer.

- [ ] **Step 1: Implement `src/connectors/binance.ts`**

```typescript
import WebSocket from 'ws';
import type { createBufferedWriter } from '../db.js';

const WS_URL = 'wss://stream.binance.com:9443/ws';
const STREAMS = ['btcusdt@bookTicker', 'btcusdt@trade', 'btcusdt@depth10@100ms'];
const RECONNECT_DELAY_MS = 3000;

export function startBinanceConnector(writer: ReturnType<typeof createBufferedWriter>) {
  let ws: WebSocket | null = null;
  let stopped = false;

  function connect() {
    if (stopped) return;
    console.log('[Binance] Connecting...');
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      console.log('[Binance] Connected. Subscribing to streams...');
      ws!.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: STREAMS,
        id: 1,
      }));
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      const localTs = Date.now();
      try {
        const msg = JSON.parse(raw.toString());

        // Skip subscription confirmation
        if (msg.result !== undefined && msg.id) return;

        // bookTicker — no `e` field, has `u`, `s`, `b`, `B`, `a`, `A`
        if (msg.u !== undefined && msg.s === 'BTCUSDT' && msg.b !== undefined && !msg.e) {
          writer.push({ type: 'bnc_book_ticker', data: {
            local_ts: localTs,
            bid_price: parseFloat(msg.b),
            bid_qty: parseFloat(msg.B),
            ask_price: parseFloat(msg.a),
            ask_qty: parseFloat(msg.A),
            update_id: msg.u,
          }});
          return;
        }

        // trade
        if (msg.e === 'trade') {
          writer.push({ type: 'bnc_trade', data: {
            local_ts: localTs,
            server_ts: msg.T,
            event_ts: msg.E,
            price: parseFloat(msg.p),
            qty: parseFloat(msg.q),
            is_buyer_maker: msg.m,
            trade_id: msg.t,
          }});
          return;
        }

        // depth (partial book) — has `lastUpdateId`, `bids`, `asks`
        if (msg.lastUpdateId !== undefined && msg.bids !== undefined) {
          writer.push({ type: 'bnc_depth', data: {
            local_ts: localTs,
            server_ts: null,
            bids: JSON.stringify(msg.bids),
            asks: JSON.stringify(msg.asks),
            last_update_id: msg.lastUpdateId,
          }});
          return;
        }
      } catch (err) {
        console.error('[Binance] Parse error:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[Binance] Disconnected. Reconnecting in ${RECONNECT_DELAY_MS}ms...`);
      if (!stopped) setTimeout(connect, RECONNECT_DELAY_MS);
    });

    ws.on('error', (err) => {
      console.error('[Binance] WS error:', err.message);
      ws?.close();
    });
  }

  connect();

  return {
    stop() {
      stopped = true;
      ws?.close();
    },
  };
}
```

- [ ] **Step 2: Smoke test manually** (will be tested via integration in Task 6)

Run: `npx tsx -e "import { initDb, createInsertHelpers, createBufferedWriter } from './src/db.js'; import { startBinanceConnector } from './src/connectors/binance.js'; const db = initDb(':memory:'); const w = createBufferedWriter(db, createInsertHelpers(db)); const c = startBinanceConnector(w); setTimeout(() => { c.stop(); w.flush(); console.log('trades:', db.prepare('SELECT COUNT(*) as n FROM bnc_trades').get()); process.exit(0); }, 5000);"`
Expected: Should print a count > 0 (live connection to Binance)

- [ ] **Step 3: Commit**

```bash
git add src/connectors/binance.ts
git commit -m "feat: add Binance WebSocket connector with bookTicker, trade, depth streams"
```

---

### Task 4: Polymarket Connector

**Files:**
- Create: `src/connectors/polymarket.ts`

This connector discovers the current BTC 5-min market via Gamma API, connects to the Polymarket CLOB WebSocket, handles 5-minute rollover, and pushes data to the buffered writer.

- [ ] **Step 1: Implement `src/connectors/polymarket.ts`**

```typescript
import WebSocket from 'ws';
import type { createBufferedWriter } from '../db.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const HEARTBEAT_INTERVAL_MS = 10_000;
const ROLLOVER_DELAY_MS = 3_000;
const ROLLOVER_RETRY_DELAY_MS = 3_000;
const ROLLOVER_MAX_RETRIES = 5;
const RECONNECT_DELAY_MS = 3_000;

interface MarketInfo {
  slug: string;
  upTokenId: string;
  downTokenId: string;
}

function getCurrentWindowTs(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 300);
}

function buildSlug(windowTs: number): string {
  return `btc-updown-5m-${windowTs}`;
}

async function discoverMarket(windowTs: number): Promise<MarketInfo | null> {
  const slug = buildSlug(windowTs);
  try {
    const res = await fetch(`${GAMMA_API}/events?slug=${slug}`);
    if (!res.ok) {
      console.error(`[Polymarket] Gamma API error: ${res.status}`);
      return null;
    }
    const events = await res.json() as any[];
    if (!events.length || !events[0].markets?.length) return null;

    const markets = events[0].markets;
    // Find the two outcomes: typically markets[0] has both token IDs
    // clobTokenIds is a JSON string: '["tokenId1","tokenId2"]'
    const market = markets[0];
    const tokenIds: string[] = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : market.clobTokenIds;

    if (tokenIds.length < 2) return null;

    // Determine Up/Down by checking outcome labels if available
    // Default: first token = Up, second = Down (Polymarket convention)
    const outcomes: string[] = market.outcomes
      ? (typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : market.outcomes)
      : ['Up', 'Down'];
    const upIdx = outcomes.findIndex((o: string) => /up/i.test(o));
    const downIdx = outcomes.findIndex((o: string) => /down/i.test(o));

    return {
      slug,
      upTokenId: tokenIds[upIdx >= 0 ? upIdx : 0],
      downTokenId: tokenIds[downIdx >= 0 ? downIdx : 1],
    };
  } catch (err) {
    console.error('[Polymarket] Market discovery error:', err);
    return null;
  }
}

export function startPolymarketConnector(writer: ReturnType<typeof createBufferedWriter>) {
  let ws: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let rolloverTimer: ReturnType<typeof setTimeout> | null = null;
  let currentMarket: MarketInfo | null = null;
  let stopped = false;

  function subscribe(market: MarketInfo) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      assets_ids: [market.upTokenId, market.downTokenId],
      type: 'market',
      custom_feature_enabled: true,
    }));
    console.log(`[Polymarket] Subscribed to ${market.slug}`);
  }

  function unsubscribe(market: MarketInfo) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      assets_ids: [market.upTokenId, market.downTokenId],
      type: 'market',
      operation: 'unsubscribe',
    }));
  }

  function getSide(tokenId: string): string {
    if (!currentMarket) return 'unknown';
    return tokenId === currentMarket.upTokenId ? 'up' : 'down';
  }

  function handleMessage(raw: WebSocket.RawData) {
    const localTs = Date.now();
    try {
      const msgs = JSON.parse(raw.toString());
      // Polymarket sends arrays of events
      const events = Array.isArray(msgs) ? msgs : [msgs];
      for (const msg of events) {
        if (!currentMarket) continue;
        const assetId = msg.asset_id ?? msg.market;

        if (msg.event_type === 'book') {
          writer.push({ type: 'poly_book', data: {
            local_ts: localTs,
            server_ts: msg.timestamp ? parseInt(msg.timestamp) : null,
            market_slug: currentMarket.slug,
            token_id: assetId,
            side: getSide(assetId),
            bids: JSON.stringify(msg.bids ?? []),
            asks: JSON.stringify(msg.asks ?? []),
            best_bid: msg.bids?.[0]?.[0] ? parseFloat(msg.bids[0][0]) : null,
            best_ask: msg.asks?.[0]?.[0] ? parseFloat(msg.asks[0][0]) : null,
            last_trade_price: msg.last_trade_price ? parseFloat(msg.last_trade_price) : null,
          }});
        } else if (msg.event_type === 'price_change' || msg.event_type === 'last_trade_price' || msg.event_type === 'best_bid_ask') {
          const price = msg.price ?? msg.last_trade_price ?? msg.best_bid ?? msg.bid ?? null;
          if (price !== null) {
            writer.push({ type: 'poly_price', data: {
              local_ts: localTs,
              server_ts: msg.timestamp ? parseInt(msg.timestamp) : null,
              market_slug: currentMarket.slug,
              token_id: assetId,
              side: getSide(assetId),
              price: parseFloat(price),
              event_type: msg.event_type,
            }});
          }
        } else if (msg.event_type === 'tick_size_change') {
          console.log('[Polymarket] Tick size change:', msg);
        }
      }
    } catch (err) {
      // Might be a PONG response or non-JSON
      if (raw.toString() === 'PONG') return;
      console.error('[Polymarket] Parse error:', err);
    }
  }

  async function scheduleRollover() {
    if (stopped) return;
    const now = Math.floor(Date.now() / 1000);
    const currentWindow = now - (now % 300);
    const nextBoundary = currentWindow + 300;
    const msUntilRollover = (nextBoundary * 1000) - Date.now() + ROLLOVER_DELAY_MS;

    rolloverTimer = setTimeout(async () => {
      const newWindowTs = getCurrentWindowTs();
      let newMarket: MarketInfo | null = null;

      for (let i = 0; i < ROLLOVER_MAX_RETRIES; i++) {
        newMarket = await discoverMarket(newWindowTs);
        if (newMarket) break;
        console.warn(`[Polymarket] Rollover retry ${i + 1}/${ROLLOVER_MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, ROLLOVER_RETRY_DELAY_MS));
      }

      if (newMarket) {
        if (currentMarket) unsubscribe(currentMarket);
        currentMarket = newMarket;
        subscribe(newMarket);
      } else {
        console.error('[Polymarket] Failed to discover new market after max retries. Keeping current subscription.');
      }

      scheduleRollover();
    }, msUntilRollover);
  }

  async function start() {
    // Discover initial market
    currentMarket = await discoverMarket(getCurrentWindowTs());
    if (!currentMarket) {
      console.error('[Polymarket] Could not discover initial market. Retrying in 10s...');
      if (!stopped) setTimeout(start, 10_000);
      return;
    }
    console.log(`[Polymarket] Discovered market: ${currentMarket.slug}`);

    // Connect WebSocket
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      console.log('[Polymarket] WS connected.');
      subscribe(currentMarket!);

      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send('PING');
      }, HEARTBEAT_INTERVAL_MS);

      scheduleRollover();
    });

    ws.on('message', handleMessage);

    ws.on('close', () => {
      console.log('[Polymarket] WS disconnected. Reconnecting in 3s...');
      cleanup();
      if (!stopped) setTimeout(start, RECONNECT_DELAY_MS);
    });

    ws.on('error', (err) => {
      console.error('[Polymarket] WS error:', err.message);
      ws?.close();
    });
  }

  function cleanup() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (rolloverTimer) { clearTimeout(rolloverTimer); rolloverTimer = null; }
  }

  start();

  return {
    stop() {
      stopped = true;
      cleanup();
      ws?.close();
    },
  };
}
```

- [ ] **Step 2: Smoke test manually**

Run: `npx tsx -e "import { initDb, createInsertHelpers, createBufferedWriter } from './src/db.js'; import { startPolymarketConnector } from './src/connectors/polymarket.js'; const db = initDb(':memory:'); const w = createBufferedWriter(db, createInsertHelpers(db)); const c = startPolymarketConnector(w); setTimeout(() => { c.stop(); w.flush(); console.log('books:', db.prepare('SELECT COUNT(*) as n FROM poly_books').get()); console.log('prices:', db.prepare('SELECT COUNT(*) as n FROM poly_prices').get()); process.exit(0); }, 15000);"`
Expected: Should show market discovery log and at least some rows (depends on market activity)

- [ ] **Step 3: Commit**

```bash
git add src/connectors/polymarket.ts
git commit -m "feat: add Polymarket connector with Gamma API discovery and 5-min rollover"
```

---

### Task 5: Cross-Correlation Analysis

**Files:**
- Create: `src/analysis/correlation.ts`
- Create: `tests/correlation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/correlation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { crossCorrelation, pearsonCorrelation } from '../src/analysis/correlation.js';

describe('pearsonCorrelation', () => {
  it('returns 1 for perfectly correlated arrays', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r).toBeCloseTo(1.0, 5);
  });

  it('returns -1 for perfectly inversely correlated arrays', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(r).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for uncorrelated arrays', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [5, 5, 5, 5, 5]);
    expect(r).toBeCloseTo(0, 5);
  });

  it('returns null for arrays shorter than 3', () => {
    expect(pearsonCorrelation([1, 2], [3, 4])).toBeNull();
  });
});

describe('crossCorrelation', () => {
  it('computes correlation at each lag', () => {
    // series A leads series B by 1 step
    const tsA = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const valA = [1,    2,   3,   4,   5,   6,   7,   8,   9,   10];
    const tsB = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
    const valB = [1,   2,   3,   4,   5,   6,   7,   8,   9,    10];

    const result = crossCorrelation(
      tsA.map((t, i) => ({ ts: t, value: valA[i] })),
      tsB.map((t, i) => ({ ts: t, value: valB[i] })),
      500, // lag range ms
      100, // step ms
    );

    expect(result.length).toBeGreaterThan(0);
    // Each result should have lag and correlation
    expect(result[0]).toHaveProperty('lag');
    expect(result[0]).toHaveProperty('correlation');
    // Find the peak — should be near lag = -100 (A leads B by 100ms)
    const peak = result.reduce((a, b) =>
      (b.correlation !== null && (a.correlation === null || b.correlation > a.correlation)) ? b : a
    );
    expect(peak.lag).toBe(-100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/correlation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/analysis/correlation.ts`**

```typescript
export interface TimeValue {
  ts: number;   // timestamp in ms
  value: number;
}

export interface CorrelationResult {
  lag: number;        // ms (negative = seriesA leads)
  correlation: number | null;
}

export function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  return num / den;
}

/**
 * Compute cross-correlation between two time series at various lags.
 *
 * For each lag value, seriesB timestamps are shifted by `lag` ms,
 * then both series are resampled to aligned bins and Pearson correlation is computed.
 *
 * @param seriesA - First time series (e.g., Binance prices)
 * @param seriesB - Second time series (e.g., Polymarket prices)
 * @param lagRangeMs - Maximum lag in ms (will test from -lagRange to +lagRange)
 * @param stepMs - Step size for lag values in ms
 */
export function crossCorrelation(
  seriesA: TimeValue[],
  seriesB: TimeValue[],
  lagRangeMs: number,
  stepMs: number,
): CorrelationResult[] {
  const results: CorrelationResult[] = [];

  for (let lag = -lagRangeMs; lag <= lagRangeMs; lag += stepMs) {
    // Shift seriesB timestamps by lag
    const shiftedB = seriesB.map(p => ({ ts: p.ts + lag, value: p.value }));

    // Find overlapping time range
    const minTs = Math.max(
      seriesA[0]?.ts ?? Infinity,
      shiftedB[0]?.ts ?? Infinity,
    );
    const maxTs = Math.min(
      seriesA[seriesA.length - 1]?.ts ?? -Infinity,
      shiftedB[shiftedB.length - 1]?.ts ?? -Infinity,
    );

    if (minTs >= maxTs) {
      results.push({ lag, correlation: null });
      continue;
    }

    // Resample both series to aligned bins
    const binSize = stepMs;
    const alignedA: number[] = [];
    const alignedB: number[] = [];

    let idxA = 0, idxB = 0;
    for (let t = minTs; t <= maxTs; t += binSize) {
      // Find nearest A value at time t
      while (idxA < seriesA.length - 1 && seriesA[idxA + 1].ts <= t) idxA++;
      // Find nearest shifted B value at time t
      while (idxB < shiftedB.length - 1 && shiftedB[idxB + 1].ts <= t) idxB++;

      if (seriesA[idxA].ts <= t && shiftedB[idxB].ts <= t) {
        alignedA.push(seriesA[idxA].value);
        alignedB.push(shiftedB[idxB].value);
      }
    }

    results.push({ lag, correlation: pearsonCorrelation(alignedA, alignedB) });
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/correlation.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/analysis/correlation.ts tests/correlation.test.ts
git commit -m "feat: add cross-correlation analysis with Pearson correlation"
```

---

### Task 6: REST API

**Files:**
- Create: `src/api/routes.ts`
- Create: `tests/api.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/api.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import { initDb, createInsertHelpers } from '../src/db.js';
import { createRouter } from '../src/api/routes.js';

function makeApp(db: Database.Database) {
  const app = express();
  app.use('/api', createRouter(db));
  return app;
}

async function request(app: express.Express, path: string) {
  // Use Node's built-in test server
  return new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, async () => {
      const addr = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
      const body = await res.json();
      server.close();
      resolve({ status: res.status, body });
    });
  });
}

describe('GET /api/data', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = initDb(':memory:');
    const helpers = createInsertHelpers(db);
    // Seed test data
    helpers.insertBncTrade({
      local_ts: 1000, server_ts: 999, event_ts: 998,
      price: 84000, qty: 0.1, is_buyer_maker: false, trade_id: 1,
    });
    helpers.insertPolyPrice({
      local_ts: 1000, server_ts: 999, market_slug: 'btc-updown-5m-0',
      token_id: 'tok1', side: 'up', price: 0.52, event_type: 'price_change',
    });
    app = makeApp(db);
  });

  afterEach(() => db.close());

  it('returns combined price data with default timebase', async () => {
    const { status, body } = await request(app, '/api/data?from=0&to=2000');
    expect(status).toBe(200);
    expect(body.binance).toHaveLength(1);
    expect(body.polymarket).toHaveLength(1);
  });

  it('returns empty arrays for out-of-range query', async () => {
    const { status, body } = await request(app, '/api/data?from=5000&to=6000');
    expect(status).toBe(200);
    expect(body.binance).toHaveLength(0);
    expect(body.polymarket).toHaveLength(0);
  });
});

describe('GET /api/correlation', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = initDb(':memory:');
    const helpers = createInsertHelpers(db);
    // Seed enough correlated data
    for (let i = 0; i < 20; i++) {
      helpers.insertBncTrade({
        local_ts: i * 100, server_ts: i * 100 - 1, event_ts: i * 100 - 2,
        price: 84000 + i, qty: 0.1, is_buyer_maker: false, trade_id: i,
      });
      helpers.insertPolyPrice({
        local_ts: i * 100, server_ts: i * 100 - 1,
        market_slug: 'btc-updown-5m-0', token_id: 'tok1', side: 'up',
        price: 0.50 + i * 0.01, event_type: 'price_change',
      });
    }
    app = makeApp(db);
  });

  afterEach(() => db.close());

  it('returns correlation results', async () => {
    const { status, body } = await request(app, '/api/correlation?from=0&to=2000&lag_range=500');
    expect(status).toBe(200);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toHaveProperty('lag');
    expect(body.results[0]).toHaveProperty('correlation');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/api/routes.ts`**

```typescript
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { crossCorrelation } from '../analysis/correlation.js';

export function createRouter(db: Database.Database): Router {
  const router = Router();

  // GET /api/data — combined Binance trades + Polymarket prices
  router.get('/data', (req, res) => {
    const from = parseInt(req.query.from as string) || 0;
    const to = parseInt(req.query.to as string) || Date.now();
    const timebase = req.query.timebase === 'server' ? 'server' : 'local';

    const bncTsCol = timebase === 'server' ? 'server_ts' : 'local_ts';
    const polyTsCol = timebase === 'server' ? 'COALESCE(server_ts, local_ts)' : 'local_ts';

    const binance = db.prepare(`
      SELECT ${bncTsCol} as ts, price, qty, is_buyer_maker
      FROM bnc_trades
      WHERE ${bncTsCol} BETWEEN ? AND ?
      ORDER BY ${bncTsCol}
    `).all(from, to);

    const polymarket = db.prepare(`
      SELECT ${polyTsCol} as ts, market_slug, side, price, event_type
      FROM poly_prices
      WHERE ${polyTsCol} BETWEEN ? AND ?
      ORDER BY ${polyTsCol}
    `).all(from, to);

    res.json({ binance, polymarket, timebase });
  });

  // GET /api/poly/books — Polymarket orderbook snapshots
  router.get('/poly/books', (req, res) => {
    const from = parseInt(req.query.from as string) || 0;
    const to = parseInt(req.query.to as string) || Date.now();
    const timebase = req.query.timebase === 'server' ? 'server' : 'local';
    const tsCol = timebase === 'server' ? 'COALESCE(server_ts, local_ts)' : 'local_ts';

    const rows = db.prepare(`
      SELECT ${tsCol} as ts, market_slug, side, bids, asks, best_bid, best_ask, last_trade_price
      FROM poly_books
      WHERE ${tsCol} BETWEEN ? AND ?
      ORDER BY ${tsCol}
    `).all(from, to);

    res.json({ rows, timebase });
  });

  // GET /api/bnc/books — Binance depth snapshots + bookTicker
  router.get('/bnc/books', (req, res) => {
    const from = parseInt(req.query.from as string) || 0;
    const to = parseInt(req.query.to as string) || Date.now();

    // bookTicker always uses local_ts (no server_ts)
    const tickers = db.prepare(`
      SELECT local_ts as ts, bid_price, bid_qty, ask_price, ask_qty
      FROM bnc_book_tickers
      WHERE local_ts BETWEEN ? AND ?
      ORDER BY local_ts
    `).all(from, to);

    const timebase = req.query.timebase === 'server' ? 'server' : 'local';
    const depthTsCol = timebase === 'server' ? 'COALESCE(server_ts, local_ts)' : 'local_ts';
    const depths = db.prepare(`
      SELECT ${depthTsCol} as ts, bids, asks
      FROM bnc_depths
      WHERE ${depthTsCol} BETWEEN ? AND ?
      ORDER BY ${depthTsCol}
    `).all(from, to);

    res.json({
      tickers,
      depths,
      timebase,
      tickerTimebaseFallback: timebase === 'server',
    });
  });

  // GET /api/correlation
  router.get('/correlation', (req, res) => {
    const from = parseInt(req.query.from as string) || 0;
    const to = parseInt(req.query.to as string) || Date.now();
    const lagRange = parseInt(req.query.lag_range as string) || 30_000;
    const timebase = req.query.timebase === 'server' ? 'server' : 'local';
    const step = Math.max(100, parseInt(req.query.step as string) || 1000);

    const bncTsCol = timebase === 'server' ? 'server_ts' : 'local_ts';
    const polyTsCol = timebase === 'server' ? 'COALESCE(server_ts, local_ts)' : 'local_ts';

    const bncPrices = db.prepare(`
      SELECT ${bncTsCol} as ts, price as value
      FROM bnc_trades
      WHERE ${bncTsCol} BETWEEN ? AND ?
      ORDER BY ${bncTsCol}
    `).all(from, to) as { ts: number; value: number }[];

    const polyPrices = db.prepare(`
      SELECT ${polyTsCol} as ts, price as value
      FROM poly_prices
      WHERE side = 'up' AND ${polyTsCol} BETWEEN ? AND ?
      ORDER BY ${polyTsCol}
    `).all(from, to) as { ts: number; value: number }[];

    const results = crossCorrelation(bncPrices, polyPrices, lagRange, step);

    res.json({ results, timebase, lagRange, step });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/routes.ts tests/api.test.ts
git commit -m "feat: add REST API routes for data, books, and correlation queries"
```

---

### Task 7: Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

```typescript
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { initDb, createInsertHelpers, createBufferedWriter } from './db.js';
import { startBinanceConnector } from './connectors/binance.js';
import { startPolymarketConnector } from './connectors/polymarket.js';
import { createRouter } from './api/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'market.db');
const PORT = parseInt(process.env.PORT || '3000');
const HOST = '0.0.0.0';

// Ensure data directory exists
import { mkdirSync } from 'fs';
mkdirSync(DATA_DIR, { recursive: true });

// Init DB
const db = initDb(DB_PATH);
const helpers = createInsertHelpers(db);
const writer = createBufferedWriter(db, helpers);

console.log(`[DB] Initialized at ${DB_PATH}`);

// Start connectors
const binance = startBinanceConnector(writer);
const polymarket = startPolymarketConnector(writer);

// Start web server
const app = express();
app.use('/api', createRouter(db));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, HOST, () => {
  console.log(`[Server] Dashboard: http://100.110.54.39:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Stopping...');
  binance.stop();
  polymarket.stop();
  writer.flush();
  db.close();
  console.log('[Shutdown] Done.');
  process.exit(0);
});
```

- [ ] **Step 2: Test that it starts**

Run: `npx tsx src/index.ts`
Expected: Should print DB init, Binance connecting, Polymarket discovering market, server URL. Press Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with graceful shutdown"
```

---

### Task 8: Visualization Dashboard

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create `public/index.html`**

This is a single HTML file with embedded JS. It uses Chart.js from CDN to render three charts:
1. Price overlay (Binance BTC price + Polymarket Up probability)
2. Spread comparison (live Binance vs Polymarket bid/ask)
3. Cross-correlation lag chart

Key UI controls:
- Time range picker (last 5m / 15m / 1h / custom)
- Timebase toggle (Local Time / Server Time)
- Auto-refresh toggle (poll every 5s)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Polymarket-Binance BTC Visualizer</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0a0a0a; color: #e0e0e0; padding: 16px; }
    .controls { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; padding: 12px; background: #1a1a1a; border-radius: 8px; }
    .controls label { font-size: 13px; }
    .controls select, .controls input, .controls button { background: #2a2a2a; color: #e0e0e0; border: 1px solid #444; padding: 4px 8px; border-radius: 4px; font-size: 13px; }
    .controls button { cursor: pointer; }
    .controls button:hover { background: #3a3a3a; }
    .controls button.active { background: #1a6b3a; border-color: #2a8b4a; }
    .radio-group { display: flex; gap: 4px; }
    .radio-group label { padding: 4px 10px; border: 1px solid #444; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .radio-group input { display: none; }
    .radio-group input:checked + span { color: #4ae68a; }
    .radio-group label:has(input:checked) { background: #1a3a2a; border-color: #2a8b4a; }
    .chart-container { background: #1a1a1a; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .chart-container h3 { font-size: 14px; margin-bottom: 8px; color: #888; }
    canvas { width: 100% !important; }
    .spread-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .spread-card { background: #1a1a1a; border-radius: 8px; padding: 16px; }
    .spread-card h3 { font-size: 14px; color: #888; margin-bottom: 12px; }
    .spread-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
    .ask { color: #e55; }
    .bid { color: #4e4; }
    .spread-val { color: #aaa; font-size: 12px; }
    .status { font-size: 12px; color: #666; }
    .fallback-badge { background: #553300; color: #ffaa44; font-size: 11px; padding: 2px 6px; border-radius: 3px; margin-left: 6px; }
    .correlation-peak { font-size: 13px; color: #4ae68a; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="controls">
    <label>Time Range:
      <select id="range">
        <option value="300000">5 min</option>
        <option value="900000" selected>15 min</option>
        <option value="3600000">1 hour</option>
        <option value="21600000">6 hours</option>
      </select>
    </label>
    <div class="radio-group">
      <label><input type="radio" name="timebase" value="local" checked><span>Local Time</span></label>
      <label><input type="radio" name="timebase" value="server"><span>Server Time</span></label>
    </div>
    <button id="refreshBtn" onclick="fetchAll()">Refresh</button>
    <button id="autoBtn" onclick="toggleAuto()">Auto: OFF</button>
    <span class="status" id="status">Ready</span>
  </div>

  <div class="chart-container">
    <h3>Price Overlay — Binance BTC (left) vs Polymarket Up Probability (right)</h3>
    <canvas id="priceChart" height="300"></canvas>
  </div>

  <div class="spread-grid">
    <div class="spread-card">
      <h3>Binance BTCUSDT Spread<span id="bncFallback" class="fallback-badge" style="display:none">local_ts fallback</span></h3>
      <div class="spread-row ask">Ask: <span id="bncAsk">—</span></div>
      <div class="spread-row bid">Bid: <span id="bncBid">—</span></div>
      <div class="spread-row spread-val">Spread: <span id="bncSpread">—</span></div>
    </div>
    <div class="spread-card">
      <h3>Polymarket Up Spread</h3>
      <div class="spread-row ask">Ask: <span id="polyAsk">—</span></div>
      <div class="spread-row bid">Bid: <span id="polyBid">—</span></div>
      <div class="spread-row spread-val">Spread: <span id="polySpread">—</span></div>
    </div>
  </div>

  <div class="chart-container">
    <h3>Cross-Correlation (Binance vs Polymarket, lag -30s to +30s)</h3>
    <canvas id="corrChart" height="250"></canvas>
    <div class="correlation-peak" id="peakInfo">—</div>
  </div>

<script>
  let autoInterval = null;
  let priceChart = null;
  let corrChart = null;

  function getTimebase() {
    return document.querySelector('input[name="timebase"]:checked').value;
  }

  function getRange() {
    return parseInt(document.getElementById('range').value);
  }

  function toggleAuto() {
    const btn = document.getElementById('autoBtn');
    if (autoInterval) {
      clearInterval(autoInterval);
      autoInterval = null;
      btn.textContent = 'Auto: OFF';
      btn.classList.remove('active');
    } else {
      autoInterval = setInterval(fetchAll, 5000);
      btn.textContent = 'Auto: ON';
      btn.classList.add('active');
      fetchAll();
    }
  }

  async function fetchAll() {
    const status = document.getElementById('status');
    status.textContent = 'Fetching...';
    try {
      await Promise.all([fetchPriceData(), fetchSpreadData(), fetchCorrelation()]);
      status.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    }
  }

  async function fetchPriceData() {
    const now = Date.now();
    const from = now - getRange();
    const timebase = getTimebase();
    const res = await fetch(`/api/data?from=${from}&to=${now}&timebase=${timebase}`);
    const data = await res.json();
    renderPriceChart(data);
  }

  function renderPriceChart(data) {
    const ctx = document.getElementById('priceChart').getContext('2d');

    const bncPoints = data.binance.map(r => ({ x: r.ts, y: r.price }));
    const polyPoints = data.polymarket
      .filter(r => r.side === 'up')
      .map(r => ({ x: r.ts, y: r.price }));

    if (priceChart) priceChart.destroy();

    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Binance BTC Price',
            data: bncPoints,
            borderColor: '#f7931a',
            backgroundColor: 'rgba(247,147,26,0.1)',
            yAxisID: 'yBnc',
            pointRadius: 0,
            borderWidth: 1.5,
          },
          {
            label: 'Polymarket Up Prob',
            data: polyPoints,
            borderColor: '#4ae68a',
            backgroundColor: 'rgba(74,230,138,0.1)',
            yAxisID: 'yPoly',
            pointRadius: 0,
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'HH:mm:ss' },
            ticks: { color: '#666' },
            grid: { color: '#222' },
          },
          yBnc: {
            position: 'left',
            ticks: { color: '#f7931a' },
            grid: { color: '#222' },
            title: { display: true, text: 'BTC (USD)', color: '#f7931a' },
          },
          yPoly: {
            position: 'right',
            min: 0, max: 1,
            ticks: { color: '#4ae68a' },
            grid: { display: false },
            title: { display: true, text: 'Up Prob', color: '#4ae68a' },
          },
        },
        plugins: { legend: { labels: { color: '#aaa' } } },
      },
    });
  }

  async function fetchSpreadData() {
    const now = Date.now();
    const timebase = getTimebase();
    const res = await fetch(`/api/bnc/books?from=${now - 60000}&to=${now}&timebase=${timebase}`);
    const data = await res.json();

    // Show fallback badge when using server timebase for bookTicker
    document.getElementById('bncFallback').style.display =
      data.tickerTimebaseFallback ? 'inline' : 'none';

    // Latest Binance bookTicker
    if (data.tickers.length > 0) {
      const t = data.tickers[data.tickers.length - 1];
      document.getElementById('bncBid').textContent = '$' + t.bid_price.toLocaleString();
      document.getElementById('bncAsk').textContent = '$' + t.ask_price.toLocaleString();
      document.getElementById('bncSpread').textContent = '$' + (t.ask_price - t.bid_price).toFixed(2);
    }

    // Latest Polymarket books
    const polyRes = await fetch(`/api/poly/books?from=${now - 60000}&to=${now}&timebase=${timebase}`);
    const polyData = await polyRes.json();
    const upBooks = polyData.rows.filter(r => r.side === 'up');
    if (upBooks.length > 0) {
      const b = upBooks[upBooks.length - 1];
      document.getElementById('polyBid').textContent = b.best_bid?.toFixed(3) ?? '—';
      document.getElementById('polyAsk').textContent = b.best_ask?.toFixed(3) ?? '—';
      document.getElementById('polySpread').textContent =
        (b.best_ask && b.best_bid) ? (b.best_ask - b.best_bid).toFixed(3) : '—';
    }
  }

  async function fetchCorrelation() {
    const now = Date.now();
    const from = now - getRange();
    const timebase = getTimebase();
    const res = await fetch(`/api/correlation?from=${from}&to=${now}&timebase=${timebase}&lag_range=30000&step=1000`);
    const data = await res.json();
    renderCorrChart(data);
  }

  function renderCorrChart(data) {
    const ctx = document.getElementById('corrChart').getContext('2d');
    const points = data.results
      .filter(r => r.correlation !== null)
      .map(r => ({ x: r.lag / 1000, y: r.correlation }));

    if (corrChart) corrChart.destroy();

    corrChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'Cross-Correlation',
          data: points,
          borderColor: '#6ea8fe',
          backgroundColor: 'rgba(110,168,254,0.1)',
          fill: true,
          pointRadius: 2,
          borderWidth: 1.5,
        }],
      },
      options: {
        responsive: true,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Lag (seconds)', color: '#888' },
            ticks: { color: '#666' },
            grid: { color: '#222' },
          },
          y: {
            min: -1, max: 1,
            title: { display: true, text: 'Correlation', color: '#888' },
            ticks: { color: '#666' },
            grid: { color: '#222' },
          },
        },
        plugins: { legend: { display: false } },
      },
    });

    // Show peak
    const validResults = data.results.filter(r => r.correlation !== null);
    if (validResults.length > 0) {
      const peak = validResults.reduce((a, b) => b.correlation > a.correlation ? b : a);
      const lagSec = (peak.lag / 1000).toFixed(1);
      const leader = peak.lag < 0 ? 'Binance leads' : peak.lag > 0 ? 'Polymarket leads' : 'Synchronized';
      document.getElementById('peakInfo').textContent =
        `Peak: r=${peak.correlation.toFixed(3)} at lag=${lagSec}s (${leader})`;
    }
  }

  // Listen for control changes
  document.getElementById('range').addEventListener('change', fetchAll);
  document.querySelectorAll('input[name="timebase"]').forEach(r =>
    r.addEventListener('change', fetchAll)
  );

  // Initial load
  fetchAll();
</script>
</body>
</html>
```

- [ ] **Step 2: Test by running the server and opening in browser**

Run: `npx tsx src/index.ts`
Then open: `http://100.110.54.39:3000`
Expected: Dashboard loads with three chart areas. Data populates after a few seconds of collection.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add visualization dashboard with price overlay, spread, and correlation charts"
```

---

### Task 9: Integration Test & Final Polish

**Files:**
- No modifications needed (all fixes applied in prior tasks)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (db, correlation, api)

- [ ] **Step 3: Full integration smoke test**

Run: `npx tsx src/index.ts`
Verify:
1. Console shows `[DB] Initialized at ...`
2. Console shows `[Binance] Connected. Subscribing...`
3. Console shows `[Polymarket] Discovered market: btc-updown-5m-...`
4. Open `http://100.110.54.39:3000` — dashboard loads
5. After 10-15s: price chart shows Binance data points, Polymarket data may appear
6. Spread cards show latest bid/ask values
7. Ctrl+C: clean shutdown message

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: remove duplicate constant, verify integration"
```

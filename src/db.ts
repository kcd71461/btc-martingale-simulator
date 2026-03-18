import Database from 'better-sqlite3';

// ─── Row interfaces ───────────────────────────────────────────────────────────

export interface PolyBookRow {
  id?: number;
  local_ts: number;
  server_ts: number | null;
  market_slug: string;
  token_id: string;
  side: string;
  bids: string; // JSON
  asks: string; // JSON
  best_bid: number | null;
  best_ask: number | null;
  last_trade_price: number | null;
}

export interface PolyPriceRow {
  id?: number;
  local_ts: number;
  server_ts: number | null;
  market_slug: string;
  token_id: string;
  side: string;
  price: number;
  event_type: string;
}

export interface BncBookTickerRow {
  id?: number;
  local_ts: number;
  bid_price: number;
  bid_qty: number;
  ask_price: number;
  ask_qty: number;
  update_id: number | null;
}

export interface BncDepthRow {
  id?: number;
  local_ts: number;
  server_ts: number | null;
  bids: string; // JSON
  asks: string; // JSON
  last_update_id: number | null;
}

export interface BncTradeRow {
  id?: number;
  local_ts: number;
  server_ts: number;
  event_ts: number;
  price: number;
  qty: number;
  is_buyer_maker: number | boolean; // SQLite stores as 0/1
  trade_id: number;
}

// ─── Buffer types ─────────────────────────────────────────────────────────────

export type BufferEntry =
  | { type: 'poly_book'; data: Omit<PolyBookRow, 'id'> }
  | { type: 'poly_price'; data: Omit<PolyPriceRow, 'id'> }
  | { type: 'bnc_book_ticker'; data: Omit<BncBookTickerRow, 'id'> }
  | { type: 'bnc_depth'; data: Omit<BncDepthRow, 'id'> }
  | { type: 'bnc_trade'; data: Omit<BncTradeRow, 'id'> };

export type WriteBuffer = BufferEntry[];

// ─── DB initialisation ────────────────────────────────────────────────────────

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

// ─── Insert helpers ───────────────────────────────────────────────────────────

export interface InsertHelpers {
  insertPolyBook(row: Omit<PolyBookRow, 'id'>): void;
  insertPolyPrice(row: Omit<PolyPriceRow, 'id'>): void;
  insertBncBookTicker(row: Omit<BncBookTickerRow, 'id'>): void;
  insertBncDepth(row: Omit<BncDepthRow, 'id'>): void;
  insertBncTrade(row: Omit<BncTradeRow, 'id'>): void;
}

export function createInsertHelpers(db: Database.Database): InsertHelpers {
  const stmtPolyBook = db.prepare<Omit<PolyBookRow, 'id'>>(`
    INSERT INTO poly_books
      (local_ts, server_ts, market_slug, token_id, side, bids, asks, best_bid, best_ask, last_trade_price)
    VALUES
      (@local_ts, @server_ts, @market_slug, @token_id, @side, @bids, @asks, @best_bid, @best_ask, @last_trade_price)
  `);

  const stmtPolyPrice = db.prepare<Omit<PolyPriceRow, 'id'>>(`
    INSERT INTO poly_prices
      (local_ts, server_ts, market_slug, token_id, side, price, event_type)
    VALUES
      (@local_ts, @server_ts, @market_slug, @token_id, @side, @price, @event_type)
  `);

  const stmtBncBookTicker = db.prepare<Omit<BncBookTickerRow, 'id'>>(`
    INSERT INTO bnc_book_tickers
      (local_ts, bid_price, bid_qty, ask_price, ask_qty, update_id)
    VALUES
      (@local_ts, @bid_price, @bid_qty, @ask_price, @ask_qty, @update_id)
  `);

  const stmtBncDepth = db.prepare<Omit<BncDepthRow, 'id'>>(`
    INSERT INTO bnc_depths
      (local_ts, server_ts, bids, asks, last_update_id)
    VALUES
      (@local_ts, @server_ts, @bids, @asks, @last_update_id)
  `);

  const stmtBncTrade = db.prepare<Omit<BncTradeRow, 'id'>>(`
    INSERT INTO bnc_trades
      (local_ts, server_ts, event_ts, price, qty, is_buyer_maker, trade_id)
    VALUES
      (@local_ts, @server_ts, @event_ts, @price, @qty, @is_buyer_maker, @trade_id)
  `);

  return {
    insertPolyBook: (row) => { stmtPolyBook.run(row); },
    insertPolyPrice: (row) => { stmtPolyPrice.run(row); },
    insertBncBookTicker: (row) => { stmtBncBookTicker.run(row); },
    insertBncDepth: (row) => { stmtBncDepth.run(row); },
    insertBncTrade: (row) => { stmtBncTrade.run(row); },
  };
}

// ─── Flush buffer ─────────────────────────────────────────────────────────────

export function flushBuffer(
  db: Database.Database,
  helpers: InsertHelpers,
  buffer: WriteBuffer
): void {
  if (buffer.length === 0) return;

  const entries = buffer.slice();
  buffer.length = 0;

  const tx = db.transaction(() => {
    for (const entry of entries) {
      switch (entry.type) {
        case 'poly_book':
          helpers.insertPolyBook(entry.data);
          break;
        case 'poly_price':
          helpers.insertPolyPrice(entry.data);
          break;
        case 'bnc_book_ticker':
          helpers.insertBncBookTicker(entry.data);
          break;
        case 'bnc_depth':
          helpers.insertBncDepth(entry.data);
          break;
        case 'bnc_trade':
          helpers.insertBncTrade(entry.data);
          break;
      }
    }
  });

  tx();
}

// ─── Buffered writer ──────────────────────────────────────────────────────────

export interface BufferedWriter {
  push(entry: BufferEntry): void;
  flush(): void;
  readonly pending: number;
}

const AUTO_FLUSH_SIZE = 100;
const AUTO_FLUSH_INTERVAL_MS = 200;

export function createBufferedWriter(
  db: Database.Database,
  helpers: InsertHelpers
): BufferedWriter {
  const buffer: WriteBuffer = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleTimer() {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flushBuffer(db, helpers, buffer);
    }, AUTO_FLUSH_INTERVAL_MS);
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    flushBuffer(db, helpers, buffer);
  }

  function push(entry: BufferEntry) {
    buffer.push(entry);
    if (buffer.length >= AUTO_FLUSH_SIZE) {
      flush();
    } else {
      scheduleTimer();
    }
  }

  return {
    push,
    flush,
    get pending() {
      return buffer.length;
    },
  };
}

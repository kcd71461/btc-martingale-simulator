import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDb,
  createInsertHelpers,
  flushBuffer,
  type PolyBookRow,
  type PolyPriceRow,
  type BncBookTickerRow,
  type BncDepthRow,
  type BncTradeRow,
  type BufferEntry,
  type WriteBuffer,
} from '../src/db.js';

describe('initDb', () => {
  it('creates all 5 tables', () => {
    const db = initDb(':memory:');
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('poly_books');
    expect(names).toContain('poly_prices');
    expect(names).toContain('bnc_book_tickers');
    expect(names).toContain('bnc_depths');
    expect(names).toContain('bnc_trades');
    db.close();
  });

  it('enables WAL mode', () => {
    const db = initDb(':memory:');
    const row = db.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string;
    };
    expect(row.journal_mode).toBe('memory');
    db.close();
  });

  it('creates all required indexes', () => {
    const db = initDb(':memory:');
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_poly_books_slug_local');
    expect(names).toContain('idx_poly_prices_slug_local');
    expect(names).toContain('idx_bnc_book_tickers_local_ts');
    expect(names).toContain('idx_bnc_depths_local_ts');
    expect(names).toContain('idx_bnc_trades_local_ts');
    expect(names).toContain('idx_bnc_trades_server_ts');
    db.close();
  });
});

describe('insert helpers', () => {
  let db: ReturnType<typeof initDb>;
  let helpers: ReturnType<typeof createInsertHelpers>;

  beforeEach(() => {
    db = initDb(':memory:');
    helpers = createInsertHelpers(db);
  });

  it('insertPolyBook inserts a row correctly', () => {
    const row: Omit<PolyBookRow, 'id'> = {
      local_ts: 1000,
      server_ts: 2000,
      market_slug: 'btc-usd',
      token_id: 'tok1',
      side: 'YES',
      bids: JSON.stringify([[0.5, 100]]),
      asks: JSON.stringify([[0.6, 200]]),
      best_bid: 0.5,
      best_ask: 0.6,
      last_trade_price: 0.55,
    };
    helpers.insertPolyBook(row);
    const inserted = db.prepare('SELECT * FROM poly_books').all() as PolyBookRow[];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].market_slug).toBe('btc-usd');
    expect(inserted[0].local_ts).toBe(1000);
    expect(inserted[0].best_bid).toBe(0.5);
  });

  it('insertPolyPrice inserts a row correctly', () => {
    const row: Omit<PolyPriceRow, 'id'> = {
      local_ts: 1001,
      server_ts: 2001,
      market_slug: 'btc-usd',
      token_id: 'tok1',
      side: 'YES',
      price: 0.52,
      event_type: 'price_change',
    };
    helpers.insertPolyPrice(row);
    const inserted = db.prepare('SELECT * FROM poly_prices').all() as PolyPriceRow[];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].price).toBe(0.52);
    expect(inserted[0].event_type).toBe('price_change');
  });

  it('insertBncBookTicker inserts a row correctly', () => {
    const row: Omit<BncBookTickerRow, 'id'> = {
      local_ts: 1002,
      bid_price: 29000.5,
      bid_qty: 1.5,
      ask_price: 29001.0,
      ask_qty: 0.8,
      update_id: 12345,
    };
    helpers.insertBncBookTicker(row);
    const inserted = db
      .prepare('SELECT * FROM bnc_book_tickers')
      .all() as BncBookTickerRow[];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].bid_price).toBe(29000.5);
    expect(inserted[0].ask_qty).toBe(0.8);
  });

  it('insertBncDepth inserts a row correctly', () => {
    const row: Omit<BncDepthRow, 'id'> = {
      local_ts: 1003,
      server_ts: 2003,
      bids: JSON.stringify([[29000, 1.0]]),
      asks: JSON.stringify([[29001, 0.5]]),
      last_update_id: 99999,
    };
    helpers.insertBncDepth(row);
    const inserted = db.prepare('SELECT * FROM bnc_depths').all() as BncDepthRow[];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].last_update_id).toBe(99999);
  });

  it('insertBncTrade inserts a row correctly', () => {
    const row: Omit<BncTradeRow, 'id'> = {
      local_ts: 1004,
      server_ts: 2004,
      event_ts: 3004,
      price: 29050.0,
      qty: 0.25,
      is_buyer_maker: 0,
      trade_id: 777,
    };
    helpers.insertBncTrade(row);
    const inserted = db.prepare('SELECT * FROM bnc_trades').all() as BncTradeRow[];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].price).toBe(29050.0);
    expect(inserted[0].trade_id).toBe(777);
  });
});

describe('flushBuffer', () => {
  it('inserts multiple rows in a single transaction and clears the buffer', () => {
    const db = initDb(':memory:');
    const helpers = createInsertHelpers(db);

    const buffer: WriteBuffer = [
      {
        type: 'poly_book',
        data: {
          local_ts: 1,
          server_ts: null,
          market_slug: 'btc-usd',
          token_id: 'tok1',
          side: 'YES',
          bids: '[]',
          asks: '[]',
          best_bid: null,
          best_ask: null,
          last_trade_price: null,
        },
      },
      {
        type: 'poly_price',
        data: {
          local_ts: 2,
          server_ts: null,
          market_slug: 'btc-usd',
          token_id: 'tok1',
          side: 'YES',
          price: 0.6,
          event_type: 'last_trade_price',
        },
      },
      {
        type: 'bnc_book_ticker',
        data: {
          local_ts: 3,
          bid_price: 28000,
          bid_qty: 1,
          ask_price: 28001,
          ask_qty: 0.5,
          update_id: null,
        },
      },
      {
        type: 'bnc_depth',
        data: {
          local_ts: 4,
          server_ts: null,
          bids: '[]',
          asks: '[]',
          last_update_id: null,
        },
      },
      {
        type: 'bnc_trade',
        data: {
          local_ts: 5,
          server_ts: 5,
          event_ts: 5,
          price: 28500,
          qty: 0.1,
          is_buyer_maker: 1,
          trade_id: 1,
        },
      },
    ];

    flushBuffer(db, helpers, buffer);

    const books = db.prepare('SELECT * FROM poly_books').all();
    const prices = db.prepare('SELECT * FROM poly_prices').all();
    const tickers = db.prepare('SELECT * FROM bnc_book_tickers').all();
    const depths = db.prepare('SELECT * FROM bnc_depths').all();
    const trades = db.prepare('SELECT * FROM bnc_trades').all();

    expect(books).toHaveLength(1);
    expect(prices).toHaveLength(1);
    expect(tickers).toHaveLength(1);
    expect(depths).toHaveLength(1);
    expect(trades).toHaveLength(1);

    // buffer should be cleared
    expect(buffer).toHaveLength(0);

    db.close();
  });

  it('handles empty buffer gracefully', () => {
    const db = initDb(':memory:');
    const helpers = createInsertHelpers(db);
    const buffer: WriteBuffer = [];
    expect(() => flushBuffer(db, helpers, buffer)).not.toThrow();
    db.close();
  });
});

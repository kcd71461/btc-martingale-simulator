import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import express from 'express';
import { initDb, createInsertHelpers } from '../src/db.js';
import { createRouter } from '../src/api/routes.js';

function makeApp(db: Database.Database) {
  const app = express();
  app.use('/api', createRouter(db));
  return app;
}

async function request(app: express.Express, path: string) {
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
  let db: ReturnType<typeof initDb>;
  let app: express.Express;

  beforeEach(() => {
    db = initDb(':memory:');
    const helpers = createInsertHelpers(db);
    helpers.insertBncTrade({
      local_ts: 1000, server_ts: 999, event_ts: 998,
      price: 84000, qty: 0.1, is_buyer_maker: 0, trade_id: 1,
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
  let db: ReturnType<typeof initDb>;
  let app: express.Express;

  beforeEach(() => {
    db = initDb(':memory:');
    const helpers = createInsertHelpers(db);
    for (let i = 0; i < 20; i++) {
      helpers.insertBncTrade({
        local_ts: i * 100, server_ts: i * 100 - 1, event_ts: i * 100 - 2,
        price: 84000 + i, qty: 0.1, is_buyer_maker: 0, trade_id: i,
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

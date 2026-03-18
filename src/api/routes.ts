import { Router } from 'express';
import type Database from 'better-sqlite3';
import { crossCorrelation } from '../analysis/correlation.js';

export function createRouter(db: Database.Database): Router {
  const router = Router();

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

  router.get('/bnc/books', (req, res) => {
    const from = parseInt(req.query.from as string) || 0;
    const to = parseInt(req.query.to as string) || Date.now();

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

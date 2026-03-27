import { Router } from 'express';
import type Database from 'better-sqlite3';
import { crossCorrelation } from '../analysis/correlation.js';
import { loadCandlesFromCache, filterCandles, runSimulation } from '../analysis/martingale_engine.js';

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

  router.get('/martingale', (req, res) => {
    try {
      const allCandles = loadCandlesFromCache();

      const startMs = req.query.start
        ? new Date(req.query.start as string).getTime()
        : allCandles[0].openTime;
      const endMs = req.query.end
        ? new Date(req.query.end as string).getTime()
        : allCandles[allCandles.length - 1].openTime;
      const minStreak = Math.max(2, Math.min(20, parseInt(req.query.minStreak as string) || 4));
      const maxRounds = Math.max(1, Math.min(15, parseInt(req.query.maxRounds as string) || 10));

      const candles = filterCandles(allCandles, startMs, endMs);
      if (candles.length < 2) {
        res.status(400).json({ error: '해당 기간에 캔들 데이터 없음' });
        return;
      }

      const { equity, stats } = runSimulation(candles, minStreak, maxRounds);

      // 차트용 다운샘플: 포인트가 너무 많으면 50k로 제한
      const MAX_POINTS = 50_000;
      let points = equity;
      if (equity.length > MAX_POINTS) {
        const step = Math.ceil(equity.length / MAX_POINTS);
        points = equity.filter((_, i) => i % step === 0 || i === equity.length - 1);
      }

      res.json({
        equity: points,
        stats,
        meta: {
          candleCount: candles.length,
          startMs,
          endMs,
          minStreak,
          maxRounds,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

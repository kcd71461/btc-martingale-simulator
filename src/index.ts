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

import { mkdirSync } from 'fs';
mkdirSync(DATA_DIR, { recursive: true });

const db = initDb(DB_PATH);
const helpers = createInsertHelpers(db);
const writer = createBufferedWriter(db, helpers);

console.log(`[DB] Initialized at ${DB_PATH}`);

const binance = startBinanceConnector(writer);
const polymarket = startPolymarketConnector(writer);

const app = express();
app.use('/api', createRouter(db));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, HOST, () => {
  console.log(`[Server] Dashboard: http://100.110.54.39:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n[Shutdown] Stopping...');
  binance.stop();
  polymarket.stop();
  writer.flush();
  db.close();
  console.log('[Shutdown] Done.');
  process.exit(0);
});

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
            is_buyer_maker: msg.m ? 1 : 0,
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

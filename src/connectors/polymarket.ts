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

    const market = events[0].markets[0];
    const tokenIds: string[] = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : market.clobTokenIds;

    if (tokenIds.length < 2) return null;

    // Determine Up/Down by checking outcome labels if available
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
    currentMarket = await discoverMarket(getCurrentWindowTs());
    if (!currentMarket) {
      console.error('[Polymarket] Could not discover initial market. Retrying in 10s...');
      if (!stopped) setTimeout(start, 10_000);
      return;
    }
    console.log(`[Polymarket] Discovered market: ${currentMarket.slug}`);

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

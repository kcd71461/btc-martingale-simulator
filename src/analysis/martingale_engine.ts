import fs from 'fs';

export interface Candle {
  openTime: number;
  open: number;
  close: number;
}

export interface EquityPoint {
  t: number;     // trigger candle openTime (ms)
  pnl: number;   // cumulative PnL after this trade
  won: boolean;
  rounds: number;
}

export interface SimStats {
  totalTrades: number;
  wins: number;
  losses: number;
  finalPnl: number;
  mdd: number;
  winRate: number;
  maxConsecLoss: number;
  baseBet: number;
  maxBet: number;
  maxLossPerSeq: number;
}

const CACHE_FILE = './data/btc_5m_candles.json';

let _candles: Candle[] | null = null;

export function loadCandlesFromCache(): Candle[] {
  if (_candles) return _candles;
  if (!fs.existsSync(CACHE_FILE)) throw new Error('캔들 캐시 없음. 먼저 martingale_sim.ts 실행 필요.');
  _candles = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Candle[];
  return _candles;
}

export function filterCandles(candles: Candle[], startMs: number, endMs: number): Candle[] {
  return candles.filter((c) => c.openTime >= startMs && c.openTime <= endMs);
}

export function runSimulation(
  candles: Candle[],
  minStreak: number,
  maxRounds: number,
  baseBet = 1,
): { equity: EquityPoint[]; stats: SimStats } {
  const equity: EquityPoint[] = [];

  let streak = 1;
  let streakDir: 'UP' | 'DOWN' | null = null;

  let inBet = false;
  let betDir: 'UP' | 'DOWN' = 'UP';
  let betRound = 1;
  let triggerTime = 0;
  let cumPnl = 0;

  let wins = 0;
  let losses = 0;
  let peak = 0;
  let mdd = 0;
  let curLoss = 0;
  let maxConsecLoss = 0;

  const bet = (round: number) => baseBet * Math.pow(2, round - 1);
  const maxLossPerSeq = Array.from({ length: maxRounds }, (_, i) => bet(i + 1)).reduce((a, b) => a + b, 0);

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const dir: 'UP' | 'DOWN' | null =
      curr.close > prev.close ? 'UP' :
      curr.close < prev.close ? 'DOWN' : null;

    if (inBet) {
      if (dir === null) continue;

      if (dir === betDir) {
        // 승리
        cumPnl += baseBet;
        if (cumPnl > peak) peak = cumPnl;
        wins++;
        curLoss = 0;
        equity.push({ t: triggerTime, pnl: cumPnl, won: true, rounds: betRound });
        inBet = false;
        streak = 1;
        streakDir = dir;
      } else {
        // 패배
        betRound++;
        if (betRound > maxRounds) {
          cumPnl -= maxLossPerSeq;
          const dd = peak - cumPnl;
          if (dd > mdd) mdd = dd;
          losses++;
          curLoss++;
          if (curLoss > maxConsecLoss) maxConsecLoss = curLoss;
          equity.push({ t: triggerTime, pnl: cumPnl, won: false, rounds: maxRounds });
          inBet = false;
          streak = 1;
          streakDir = dir;
        } else {
          streak = (dir === streakDir) ? streak + 1 : 2;
          streakDir = dir;
        }
      }
      continue;
    }

    // 스트릭 추적
    if (dir === null) continue;
    if (dir === streakDir) {
      streak++;
    } else {
      streak = 1;
      streakDir = dir;
    }

    if (streak === minStreak && streakDir !== null) {
      inBet = true;
      betDir = streakDir === 'UP' ? 'DOWN' : 'UP';
      betRound = 1;
      triggerTime = curr.openTime;
    }
  }

  const totalTrades = wins + losses;
  return {
    equity,
    stats: {
      totalTrades,
      wins,
      losses,
      finalPnl: cumPnl,
      mdd,
      winRate: totalTrades > 0 ? wins / totalTrades : 0,
      maxConsecLoss,
      baseBet,
      maxBet: bet(maxRounds),
      maxLossPerSeq,
    },
  };
}

/**
 * BTC/USDT 5분봉 마틴게일 시뮬레이션
 * 전략: 4연속 streak 이후 반대 포지션, $1 시작, 최대 10회 배팅
 */

import fs from 'fs';

const BINANCE_BASE = 'https://api.binance.com';
const SYMBOL = 'BTCUSDT';
const INTERVAL = '5m';
const LIMIT = 1000;
const START_TIME = new Date('2017-08-17T00:00:00Z').getTime();
const CACHE_FILE = './data/btc_5m_candles.json';

interface Candle {
  openTime: number;
  open: number;
  close: number;
}

// ── Fetch & Cache ──────────────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchKlines(startTime: number, endTime: number): Promise<Candle[]> {
  const url = new URL(`${BINANCE_BASE}/api/v3/klines`);
  url.searchParams.set('symbol', SYMBOL);
  url.searchParams.set('interval', INTERVAL);
  url.searchParams.set('startTime', startTime.toString());
  url.searchParams.set('endTime', endTime.toString());
  url.searchParams.set('limit', LIMIT.toString());

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json() as any[][];
  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    close: parseFloat(k[4]),
  }));
}

async function loadCandles(): Promise<Candle[]> {
  if (fs.existsSync(CACHE_FILE)) {
    process.stdout.write('[cache] 캐시 파일 로드 중...');
    const candles: Candle[] = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(` ${candles.length.toLocaleString()}개 캔들 로드 완료`);
    return candles;
  }

  console.log('[fetch] Binance에서 데이터 수신 중...');
  const all: Candle[] = [];
  let cursor = START_TIME;
  const now = Date.now();
  let page = 0;

  while (cursor < now) {
    const endTime = Math.min(cursor + LIMIT * 5 * 60 * 1000 - 1, now);
    const batch = await fetchKlines(cursor, endTime);
    if (batch.length === 0) break;
    all.push(...batch);
    cursor = batch[batch.length - 1].openTime + 5 * 60 * 1000;
    page++;
    if (page % 100 === 0) {
      console.log(`  ${page}번째 배치, ${all.length.toLocaleString()}개, ${new Date(batch[batch.length - 1].openTime).toISOString().slice(0, 10)}`);
      await sleep(300);
    }
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(all));
  console.log(`[fetch] 완료: ${all.length.toLocaleString()}개 캔들 (캐시 저장됨)`);
  return all;
}

// ── Simulation ─────────────────────────────────────────────────────────────

interface TradeResult {
  triggerTime: number;       // 4연속 마지막 캔들 시각
  triggerDir: 'UP' | 'DOWN'; // streak 방향
  betDir: 'UP' | 'DOWN';     // 반대 포지션
  rounds: number;            // 몇 번째 라운드에서 결판
  won: boolean;              // 최종 승리 여부
  pnl: number;               // 이 트레이드 손익 ($)
  totalBet: number;          // 총 배팅액
}

const MAX_ROUNDS = 10;
const BASE_BET = 1;

// 라운드별 배팅액: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512
function betAmount(round: number) {
  return BASE_BET * Math.pow(2, round - 1);
}

function simulate(candles: Candle[]): TradeResult[] {
  const results: TradeResult[] = [];

  let streak = 1;
  let streakDir: 'UP' | 'DOWN' | null = null;

  // 배팅 상태
  let inBet = false;
  let betDir: 'UP' | 'DOWN' = 'UP';
  let betRound = 1;
  let triggerTime = 0;
  let triggerDir: 'UP' | 'DOWN' = 'UP';
  let totalBet = 0;

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    // 현재 캔들 방향
    const dir: 'UP' | 'DOWN' | null =
      curr.close > prev.close ? 'UP' :
      curr.close < prev.close ? 'DOWN' : null;

    if (inBet) {
      // 배팅 중: 현재 캔들이 betDir 방향인지 확인
      if (dir === betDir) {
        // 승리
        const won = true;
        const bet = betAmount(betRound);
        totalBet += bet;
        results.push({
          triggerTime,
          triggerDir,
          betDir,
          rounds: betRound,
          won,
          pnl: BASE_BET,  // 마틴게일: 항상 base bet만큼 이익
          totalBet,
        });
        inBet = false;
        streak = 1;
        streakDir = dir;
        // streak reset도 같이
        continue;
      } else if (dir !== null && dir !== betDir) {
        // 패배 → 다음 라운드
        totalBet += betAmount(betRound);
        betRound++;
        if (betRound > MAX_ROUNDS) {
          // 10회 초과 → 최대 손실 확정
          const maxLoss = Array.from({ length: MAX_ROUNDS }, (_, i) => betAmount(i + 1)).reduce((a, b) => a + b, 0);
          results.push({
            triggerTime,
            triggerDir,
            betDir,
            rounds: MAX_ROUNDS,
            won: false,
            pnl: -maxLoss,
            totalBet,
          });
          inBet = false;
          streak = 1;
          streakDir = dir;
          continue;
        }
        // 계속 같은 betDir으로 다음 캔들에서 배팅
        if (dir !== null) {
          streak = dir === streakDir ? streak + 1 : 2;
          streakDir = dir;
        }
        continue;
      }
      // dir === null (보합): 배팅 상태 유지
      continue;
    }

    // 배팅 없는 상태: streak 추적
    if (dir === null) continue;

    if (dir === streakDir) {
      streak++;
    } else {
      streak = 2;
      streakDir = dir;
    }

    // 4연속 달성 시 배팅 시작
    if (streak === 4 && streakDir !== null) {
      inBet = true;
      betDir = streakDir === 'UP' ? 'DOWN' : 'UP';
      betRound = 1;
      totalBet = 0;
      triggerTime = curr.openTime;
      triggerDir = streakDir;
    }
  }

  return results;
}

// ── Stats ──────────────────────────────────────────────────────────────────

function pct(n: number, total: number) {
  return ((n / total) * 100).toFixed(2) + '%';
}

function fmt(n: number) {
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
}

function printStats(results: TradeResult[], candles: Candle[]) {
  const total = results.length;
  const wins = results.filter((r) => r.won);
  const losses = results.filter((r) => !r.won);
  const totalPnl = results.reduce((a, r) => a + r.pnl, 0);
  const maxLossPerSeq = Array.from({ length: MAX_ROUNDS }, (_, i) => betAmount(i + 1)).reduce((a, b) => a + b, 0);

  // 라운드별 분포
  const roundDist: Record<number, { win: number; lose: number }> = {};
  for (const r of results) {
    if (!roundDist[r.rounds]) roundDist[r.rounds] = { win: 0, lose: 0 };
    if (r.won) roundDist[r.rounds].win++;
    else roundDist[r.rounds].lose++;
  }

  // 연속 손실 시퀀스 (최대 연속 손실 횟수)
  let maxConsecLoss = 0, curLoss = 0;
  let maxDrawdown = 0, cumPnl = 0;
  const equity: number[] = [0];
  let peak = 0;
  for (const r of results) {
    cumPnl += r.pnl;
    equity.push(cumPnl);
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (!r.won) { curLoss++; if (curLoss > maxConsecLoss) maxConsecLoss = curLoss; }
    else curLoss = 0;
  }

  const dataStart = new Date(candles[0].openTime).toISOString().slice(0, 10);
  const dataEnd = new Date(candles[candles.length - 1].openTime).toISOString().slice(0, 10);

  console.log('\n');
  console.log('='.repeat(72));
  console.log('  BTC/USDT 5분봉 마틴게일 시뮬레이션 결과');
  console.log('='.repeat(72));
  console.log(`  데이터 기간     : ${dataStart} ~ ${dataEnd}`);
  console.log(`  전략            : 4연속 streak → 반대 포지션, $1 시작, 최대 10회`);
  console.log(`  최대 배팅 시퀀스: $${Array.from({ length: MAX_ROUNDS }, (_, i) => betAmount(i + 1)).join(' → $')}`);
  console.log(`  시퀀스당 최대손실: $${maxLossPerSeq.toFixed(0)}`);
  console.log('='.repeat(72));

  console.log('\n[전체 성과]');
  console.log(`  총 트레이드     : ${total.toLocaleString()}회`);
  console.log(`  승리            : ${wins.length.toLocaleString()}회 (${pct(wins.length, total)})`);
  console.log(`  패배(10회 초과) : ${losses.length.toLocaleString()}회 (${pct(losses.length, total)})`);
  console.log(`  최종 손익       : ${fmt(totalPnl)}`);
  console.log(`  최대 낙폭(MDD)  : -$${maxDrawdown.toFixed(2)}`);
  console.log(`  최대 연속 패배  : ${maxConsecLoss}회`);
  console.log(`  트레이드당 기대값: ${fmt(totalPnl / total)}`);

  console.log('\n[라운드별 결판 분포]');
  console.log('  라운드  배팅액    승리    패배    승률     누적배팅액');
  console.log('  ' + '-'.repeat(60));
  for (const r of Object.keys(roundDist).map(Number).sort((a, b) => a - b)) {
    const { win, lose } = roundDist[r];
    const cnt = win + lose;
    const cumBet = Array.from({ length: r }, (_, i) => betAmount(i + 1)).reduce((a, b) => a + b, 0);
    console.log(
      `  ${String(r).padStart(5)}회  $${String(betAmount(r)).padStart(6)}  ${String(win).padStart(5)}회  ${String(lose).padStart(5)}회  ${pct(win, cnt).padStart(7)}  $${cumBet.toFixed(0).padStart(8)}`
    );
  }

  console.log('\n[방향별 성과]');
  for (const dir of ['UP', 'DOWN'] as const) {
    const sub = results.filter((r) => r.triggerDir === dir);
    const subWin = sub.filter((r) => r.won).length;
    const subPnl = sub.reduce((a, r) => a + r.pnl, 0);
    const label = dir === 'UP' ? '↑상승 streak 이후 SHORT' : '↓하락 streak 이후 LONG';
    console.log(`  ${label}`);
    console.log(`    트레이드: ${sub.length}회, 승률: ${pct(subWin, sub.length)}, 손익: ${fmt(subPnl)}`);
  }

  console.log('\n[연도별 성과]');
  console.log('  연도   트레이드  승률       손익');
  const byYear: Record<number, TradeResult[]> = {};
  for (const r of results) {
    const y = new Date(r.triggerTime).getFullYear();
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(r);
  }
  for (const y of Object.keys(byYear).sort()) {
    const arr = byYear[Number(y)];
    const w = arr.filter((r) => r.won).length;
    const p = arr.reduce((a, r) => a + r.pnl, 0);
    console.log(`  ${y}   ${String(arr.length).padStart(7)}회  ${pct(w, arr.length).padStart(7)}   ${fmt(p)}`);
  }

  console.log('\n[에쿼티 커브 요약 (연간 말 기준)]');
  let runPnl = 0;
  const snapshots: { label: string; pnl: number }[] = [];
  for (const r of results) {
    runPnl += r.pnl;
    const y = new Date(r.triggerTime).getFullYear();
    if (!snapshots.find((s) => s.label === String(y))) continue;
  }
  runPnl = 0;
  const yearEnd: Record<number, number> = {};
  for (const r of results) {
    runPnl += r.pnl;
    const y = new Date(r.triggerTime).getFullYear();
    yearEnd[y] = runPnl;
  }
  let prev = 0;
  for (const y of Object.keys(yearEnd).sort()) {
    const cur = yearEnd[Number(y)];
    const diff = cur - prev;
    console.log(`  ${y}: 누적 ${fmt(cur)}  (당해 ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)})`);
    prev = cur;
  }

  console.log('\n' + '='.repeat(72));
}

async function main() {
  const candles = await loadCandles();
  console.log('\n시뮬레이션 실행 중...');
  const results = simulate(candles);
  console.log(`  → 총 ${results.length.toLocaleString()}번 트레이드 발생`);
  printStats(results, candles);
}

main().catch((err) => { console.error(err); process.exit(1); });

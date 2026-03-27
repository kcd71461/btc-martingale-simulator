/**
 * BTC/USDT 5분봉 연속 상승/하락 10회 이상 통계 분석
 * Binance Klines REST API 사용 (최대 기간)
 */

const BINANCE_BASE = 'https://api.binance.com';
const SYMBOL = 'BTCUSDT';
const INTERVAL = '5m';
const LIMIT = 1000; // 요청당 최대 캔들 수
// Binance BTCUSDT 5m 데이터 시작: 2017-08-17
const START_TIME = new Date('2017-08-17T00:00:00Z').getTime();

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StreakEvent {
  direction: 'UP' | 'DOWN';
  length: number;
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  changePct: number;
}

async function fetchKlines(startTime: number, endTime: number): Promise<Candle[]> {
  const url = new URL(`${BINANCE_BASE}/api/v3/klines`);
  url.searchParams.set('symbol', SYMBOL);
  url.searchParams.set('interval', INTERVAL);
  url.searchParams.set('startTime', startTime.toString());
  url.searchParams.set('endTime', endTime.toString());
  url.searchParams.set('limit', LIMIT.toString());

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const raw = await res.json() as any[][];

  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchAllKlines(): Promise<Candle[]> {
  const all: Candle[] = [];
  let cursor = START_TIME;
  const now = Date.now();
  let page = 0;

  console.log(`[fetch] 시작: ${new Date(START_TIME).toISOString()} ~ ${new Date(now).toISOString()}`);

  while (cursor < now) {
    const endTime = Math.min(cursor + LIMIT * 5 * 60 * 1000 - 1, now);
    const batch = await fetchKlines(cursor, endTime);
    if (batch.length === 0) break;

    all.push(...batch);
    cursor = batch[batch.length - 1].openTime + 5 * 60 * 1000;
    page++;

    if (page % 100 === 0) {
      console.log(`  [fetch] ${page}번째 배치, 현재까지 ${all.length.toLocaleString()}개 캔들, ${new Date(batch[batch.length - 1].openTime).toISOString()}`);
    }

    // Rate limit 방지: 100req마다 0.5초 대기
    if (page % 100 === 0) await sleep(500);
  }

  console.log(`[fetch] 완료: 총 ${all.length.toLocaleString()}개 캔들`);
  return all;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function findStreaks(candles: Candle[], minLength = 10): StreakEvent[] {
  const events: StreakEvent[] = [];
  if (candles.length < 2) return events;

  let streakDir: 'UP' | 'DOWN' | null = null;
  let streakStart = 0;
  let streakLen = 1;

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const dir: 'UP' | 'DOWN' | null =
      curr.close > prev.close ? 'UP' :
      curr.close < prev.close ? 'DOWN' :
      null; // 동일가 → 무시

    if (dir === null) {
      // 보합 → 스트릭 유지 (방향 유지하며 계속)
      continue;
    }

    if (dir === streakDir) {
      streakLen++;
    } else {
      // 방향 전환 → 이전 스트릭 체크
      if (streakDir !== null && streakLen >= minLength) {
        const startCandle = candles[streakStart];
        const endCandle = candles[i - 1];
        const changePct = ((endCandle.close - startCandle.open) / startCandle.open) * 100;
        events.push({
          direction: streakDir,
          length: streakLen,
          startTime: startCandle.openTime,
          endTime: endCandle.openTime,
          startPrice: startCandle.open,
          endPrice: endCandle.close,
          changePct,
        });
      }
      streakDir = dir;
      streakStart = i - 1;
      streakLen = 2;
    }
  }

  // 마지막 스트릭
  if (streakDir !== null && streakLen >= minLength) {
    const startCandle = candles[streakStart];
    const endCandle = candles[candles.length - 1];
    const changePct = ((endCandle.close - startCandle.open) / startCandle.open) * 100;
    events.push({
      direction: streakDir,
      length: streakLen,
      startTime: startCandle.openTime,
      endTime: endCandle.openTime,
      startPrice: startCandle.open,
      endPrice: endCandle.close,
      changePct,
    });
  }

  return events;
}

function formatDate(ts: number) {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function printStats(events: StreakEvent[], candles: Candle[]) {
  const upEvents = events.filter((e) => e.direction === 'UP');
  const downEvents = events.filter((e) => e.direction === 'DOWN');

  const totalCandles = candles.length;
  const dataStart = formatDate(candles[0].openTime);
  const dataEnd = formatDate(candles[candles.length - 1].openTime);

  console.log('\n');
  console.log('='.repeat(72));
  console.log('  BTC/USDT 5분봉 연속 상승/하락 10회 이상 통계');
  console.log('='.repeat(72));
  console.log(`  데이터 기간  : ${dataStart} ~ ${dataEnd}`);
  console.log(`  총 캔들 수   : ${totalCandles.toLocaleString()}개  (${(totalCandles * 5 / 60 / 24).toFixed(1)}일)`);
  console.log(`  분석 기준    : close 가격 연속 상승/하락 10개 이상`);
  console.log('='.repeat(72));

  for (const [label, arr] of [['상승(UP)', upEvents], ['하락(DOWN)', downEvents]] as [string, StreakEvent[]][]) {
    if (arr.length === 0) {
      console.log(`\n[${label}] 해당 없음`);
      continue;
    }

    const lengths = arr.map((e) => e.length);
    const changes = arr.map((e) => Math.abs(e.changePct));
    const maxLen = Math.max(...lengths);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const maxChange = Math.max(...changes);
    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;

    // 분포: 10, 11, 12, ... 구간별 카운트
    const dist: Record<number, number> = {};
    for (const l of lengths) dist[l] = (dist[l] ?? 0) + 1;

    const longestEvent = arr.find((e) => e.length === maxLen)!;

    console.log(`\n[${label}]`);
    console.log(`  발생 횟수       : ${arr.length}회`);
    console.log(`  평균 연속 길이  : ${avgLen.toFixed(2)}개`);
    console.log(`  최대 연속 길이  : ${maxLen}개`);
    console.log(`  평균 가격 변화  : ${avgChange.toFixed(3)}%`);
    console.log(`  최대 가격 변화  : ${maxChange.toFixed(3)}%`);
    console.log(`  최장 연속 이벤트:`);
    console.log(`    날짜     : ${formatDate(longestEvent.startTime)} ~ ${formatDate(longestEvent.endTime)}`);
    console.log(`    시작가   : $${longestEvent.startPrice.toFixed(2)}`);
    console.log(`    종료가   : $${longestEvent.endPrice.toFixed(2)}`);
    console.log(`    변화율   : ${longestEvent.changePct.toFixed(3)}%`);
    console.log(`  길이별 분포:`);

    const sortedKeys = Object.keys(dist).map(Number).sort((a, b) => a - b);
    for (const k of sortedKeys) {
      const bar = '#'.repeat(Math.min(dist[k], 50));
      console.log(`    ${String(k).padStart(3)}개: ${String(dist[k]).padStart(4)}회  ${bar}`);
    }
  }

  // Top 10 이벤트 (길이 기준)
  console.log('\n[전체 Top 10 - 가장 긴 연속 스트릭]');
  const top10 = [...events].sort((a, b) => b.length - a.length).slice(0, 10);
  console.log('  #   방향   길이  시작 시각             시작가($)      종료가($)      변화율');
  console.log('  ' + '-'.repeat(85));
  for (let i = 0; i < top10.length; i++) {
    const e = top10[i];
    const dir = e.direction === 'UP' ? '↑상승' : '↓하락';
    console.log(
      `  ${String(i + 1).padStart(2)}  ${dir}  ${String(e.length).padStart(4)}  ${formatDate(e.startTime)}  ${e.startPrice.toFixed(2).padStart(12)}  ${e.endPrice.toFixed(2).padStart(12)}  ${(e.changePct >= 0 ? '+' : '') + e.changePct.toFixed(3)}%`
    );
  }

  // 연도별 발생 현황
  console.log('\n[연도별 발생 횟수]');
  const byYear: Record<number, { up: number; down: number }> = {};
  for (const e of events) {
    const y = new Date(e.startTime).getFullYear();
    if (!byYear[y]) byYear[y] = { up: 0, down: 0 };
    if (e.direction === 'UP') byYear[y].up++;
    else byYear[y].down++;
  }
  console.log('  연도   상승   하락   합계');
  for (const y of Object.keys(byYear).sort()) {
    const { up, down } = byYear[Number(y)];
    console.log(`  ${y}   ${String(up).padStart(4)}   ${String(down).padStart(4)}   ${String(up + down).padStart(4)}`);
  }

  console.log('\n' + '='.repeat(72));
}

async function main() {
  console.log('BTC/USDT 5분봉 연속 스트릭 분석 시작...\n');
  const candles = await fetchAllKlines();

  console.log('\n스트릭 분석 중...');
  const events = findStreaks(candles, 10);
  console.log(`  → 10회 이상 연속 이벤트 총 ${events.length}개 발견`);

  printStats(events, candles);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

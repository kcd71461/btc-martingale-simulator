/**
 * BTC/USDT 5분봉 캔들 로더
 * - 내장 compact 데이터 (candles-compact.json) 로드
 * - 외부 API 의존성 없음, GitHub Pages에서 즉시 동작
 */

/**
 * Load all BTC/USDT 5m candles from embedded compact data.
 * @param {function} onProgress - callback(message: string)
 * @returns {Promise<Array<{openTime: number, open: number, close: number}>>}
 */
async function loadCandles(onProgress = () => {}) {
  onProgress('내장 캔들 데이터 로딩 중...');

  const res = await fetch('./candles-compact.json');
  if (!res.ok) throw new Error('캔들 데이터 로드 실패: ' + res.status);

  onProgress('파싱 중...');
  const compact = await res.json();

  // compact format: { s: startTime, i: interval(ms), g: [[idx, actualTime], ...], d: [[open, close], ...] }
  const startTime = compact.s;
  const interval = compact.i;
  const gaps = new Map(compact.g.map(([idx, ts]) => [idx, ts]));
  const data = compact.d;

  onProgress(`캔들 복원 중... (${data.length.toLocaleString()}개)`);

  const candles = new Array(data.length);
  let time = startTime;

  for (let i = 0; i < data.length; i++) {
    if (i > 0) {
      time = gaps.has(i) ? gaps.get(i) : time + interval;
    }
    candles[i] = { openTime: time, open: data[i][0], close: data[i][1] };
  }

  onProgress(`완료: ${candles.length.toLocaleString()}개 캔들 로드`);
  return candles;
}

if (typeof window !== 'undefined') window.loadCandles = loadCandles;

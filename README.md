# BTC/USDT 5분봉 마틴게일 전략 검증

Polymarket 등 예측 시장에서 마틴게일 전략이 실제로 유효한지 검증하기 위한 분석 도구입니다.
Binance BTC/USDT 5분봉 캔들 데이터(2017년 8월~최신)를 기반으로 전략의 수익성과 리스크를 시뮬레이션합니다.

## GitHub Pages (서버 불필요)

https://kcd71461.github.io/btc-martingale-simulator/

브라우저에서 Binance API로 직접 캔들 데이터를 수집하여 IndexedDB에 캐시합니다.
최초 방문 시 ~2분 소요, 이후 즉시 로드.

## 페이지 구성

| 페이지 | 설명 |
|---|---|
| [마틴게일 시뮬레이터](https://kcd71461.github.io/btc-martingale-simulator/martingale.html) | 변수 조절 가능한 마틴게일 전략 시뮬레이션 + 누적 손익 곡선 + 손실 위험 분석 |
| [Streak 분포](https://kcd71461.github.io/btc-martingale-simulator/streak_dist.html) | streak 길이별 이론 기댓값 vs 실제 발생 횟수 비교 + 이벤트 상세 패널 |
| [조건부 승률](https://kcd71461.github.io/btc-martingale-simulator/streak_analysis.html) | 라운드별 조건부 승률 이론(50%) vs 실제, 가설 검증 (정적 분석) |

## 핵심 기능

### 1. 마틴게일 전략 시뮬레이션
N회 연속 같은 방향 캔들(streak) 발생 시 반대 포지션에 진입하는 마틴게일 전략을 시뮬레이션합니다.

**전략 규칙:**
- `minStreak`회 연속 상승(또는 하락) 감지 → 반대 방향에 `baseBet` 배팅
- 실패 시 배팅 금액을 2배로 증가 (마틴게일)
- 최대 `maxRounds`회까지 배팅 후 실패 → 시퀀스 전체 손실 확정
- 성공 시 → `baseBet` 만큼 순이익

**배팅 시퀀스 예시 (baseBet=$1, maxRounds=10):**
```
Round 1: $1 → Round 2: $2 → Round 3: $4 → ... → Round 10: $512
시퀀스 최대 손실: $1,023
```

### 2. 조작 가능한 변수

| 컨트롤 | 설명 | 범위 | 기본값 |
|---|---|---|---|
| **최소 streak 수** | 마틴게일 진입 트리거 조건 | 2~15 | 4 |
| **최대 배팅 횟수** | 마틴게일 시퀀스 최대 라운드 | 1~15 | 10 |
| **첫 배팅 금액** | 시퀀스 시작 배팅 금액 ($) | 0.01~ | $1 |
| **기간 범위** | 차트 하단 듀얼 슬라이더로 X축 범위 조절 | 전체 데이터 범위 | 전체 |
| **손실 임계값** | 서브 섹션 위험 분석 기준 금액 | 음수 | -$500 |

### 3. 손실 위험 분석
- 각 5분봉을 전략 시작 시점으로 가정
- 해당 시점부터 전략을 운용했을 때 **최저 PnL(최악의 순간)**을 계산
- 입력한 임계값 이하로 떨어지는 시작 시점의 비율을 산출

### 4. Streak 분포 비교
- BTC 가격 움직임이 독립적 동전 던지기(1/2)와 얼마나 다른지 통계적으로 검증
- 실제 막대 클릭 시 해당 이벤트 목록 + TradingView 검증 링크 제공

### 5. 조건부 승률 가설 검증
- 핵심 질문: streak이 길어질수록 반전 확률이 50%보다 높아지는가?
- 라운드별 실제 승률 vs 이론 비교 (정적 분석, 2017-2026 고정)

## 프로젝트 구조

```
├── docs/                               # GitHub Pages (서버 불필요 독립 실행)
│   ├── index.html                      # 랜딩 페이지 (3개 분석 페이지 허브)
│   ├── martingale.html                 # 마틴게일 시뮬레이터
│   ├── streak_dist.html                # Streak 분포: 이론 vs 실제
│   ├── streak_analysis.html            # 조건부 승률 분석 (정적)
│   └── candle-loader.js                # Binance API → IndexedDB 캐시 로더
├── src/                                # 서버 기반 버전
│   ├── index.ts                        # Express 서버 진입점
│   ├── db.ts                           # SQLite DB 스키마 및 버퍼 라이터
│   ├── connectors/
│   │   ├── binance.ts                  # Binance WebSocket 실시간 수집
│   │   └── polymarket.ts               # Polymarket 커넥터
│   ├── analysis/
│   │   ├── btc_streak_stats.ts         # CLI: streak 통계 분석
│   │   ├── martingale_sim.ts           # CLI: 마틴게일 시뮬레이션
│   │   ├── martingale_engine.ts        # 서버용 시뮬레이션 엔진
│   │   └── correlation.ts             # 교차 상관 분석
│   └── api/
│       └── routes.ts                   # REST API 라우트
├── public/                             # 서버 기반 프론트엔드
│   ├── martingale.html                 # 서버 연동 시뮬레이터
│   ├── streak_dist.html                # 서버 연동 streak 분포
│   ├── streak_analysis.html            # 이론 vs 실제 확률 비교
│   └── index.html                      # 기본 대시보드
├── data/                               # 데이터 (gitignore)
│   ├── market.db                       # 실시간 수집 SQLite DB
│   └── btc_5m_candles.json             # 5분봉 캔들 캐시
└── package.json
```

## 실행 방법

### GitHub Pages (권장)
https://kcd71461.github.io/btc-martingale-simulator/ 접속만 하면 됩니다.

### 로컬 서버
```bash
npm install
npx tsx src/analysis/martingale_sim.ts   # 캔들 데이터 수집 (최초 1회)
npm start                                 # 서버 실행
```
- 마틴게일 시뮬레이터: `http://localhost:3000/martingale.html`
- Streak 분포: `http://localhost:3000/streak_dist.html`
- 조건부 승률: `http://localhost:3000/streak_analysis.html`

### CLI 분석
```bash
npx tsx src/analysis/btc_streak_stats.ts    # 10회+ streak 통계
npx tsx src/analysis/martingale_sim.ts      # 마틴게일 시뮬레이션
```

## 기술 스택

- **프론트엔드**: Vanilla JS + Chart.js (브라우저 인메모리 계산)
- **데이터**: Binance REST API (Klines) + IndexedDB 캐시
- **서버 (옵션)**: Node.js + TypeScript + Express + SQLite
- **배포**: GitHub Pages (`docs/` 폴더)

## 주의사항

- 이 시뮬레이터는 **교육 및 연구 목적**입니다
- 수수료, 슬리피지, 자본 회전율이 반영되지 않았습니다
- 과거 데이터 기반 백테스트는 미래 수익을 보장하지 않습니다
- 마틴게일 전략은 이론적으로 **파산 리스크**가 존재합니다
- Polymarket 등 실제 시장에서는 vig(수수료)로 인해 시뮬레이션보다 불리합니다

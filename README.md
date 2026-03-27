# BTC/USDT 5분봉 마틴게일 시뮬레이터

Binance BTC/USDT 5분봉 캔들 데이터(2017년 8월~현재)를 기반으로 마틴게일 전략의 수익성과 리스크를 시뮬레이션하는 인터랙티브 대시보드입니다.

## 핵심 기능

### 1. 연속 상승/하락 (Streak) 통계 분석
- Binance REST API에서 BTC/USDT 5분봉 전체 히스토리(약 90만 개 캔들) 수집
- 10회 이상 연속 상승/하락 이벤트 탐지 및 통계 산출
- 방향별, 연도별, 길이별 분포 출력

### 2. 마틴게일 전략 시뮬레이션
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

### 3. 인터랙티브 대시보드 (`/martingale.html`)

브라우저에서 모든 계산을 수행합니다 (서버 통신 없음, 최초 데이터 로딩 1회 제외).

#### 조작 가능한 변수

| 컨트롤 | 설명 | 범위 | 기본값 |
|---|---|---|---|
| **최소 streak 수** | 마틴게일 진입 트리거 조건 | 2~15 | 4 |
| **최대 배팅 횟수** | 마틴게일 시퀀스 최대 라운드 | 1~15 | 10 |
| **첫 배팅 금액** | 시퀀스 시작 배팅 금액 ($) | 0.01~ | $1 |
| **기간 범위** | 차트 하단 듀얼 슬라이더로 X축 범위 조절 | 전체 데이터 범위 | 전체 |
| **손실 임계값** | 서브 섹션 위험 분석 기준 금액 | 음수 | -$500 |

#### 메인 차트
- X축: 시간 (5분 캔들 기준)
- Y축: 누적 손익 ($)
- 듀얼 핸들 레인지 슬라이더로 기간 범위 즉시 조절

#### 손실 위험 분석 (서브 섹션)
- 각 5분봉을 전략 시작 시점으로 가정
- 해당 시점부터 전략을 운용했을 때 **최저 PnL(최악의 순간)**을 계산
- 입력한 임계값 이하로 떨어지는 시작 시점의 비율을 산출
- 차트: 초록 = 안전, 빨강 = 임계값 돌파, 빨간 점선 = 임계값 기준선

### 4. 이론 vs 실제 확률 비교 (`/streak_analysis.html`)
- 라운드별 조건부 승률: 실제 데이터 vs 이론적 1/2 확률
- 이론 대비 초과 엣지 시각화
- 연간 누적 에쿼티 커브
- 라운드별 도달 횟수 퍼널 차트

## 프로젝트 구조

```
├── src/
│   ├── index.ts                    # Express 서버 진입점
│   ├── db.ts                       # SQLite DB 스키마 및 버퍼 라이터
│   ├── connectors/
│   │   ├── binance.ts              # Binance WebSocket 실시간 수집
│   │   └── polymarket.ts           # Polymarket 커넥터
│   ├── analysis/
│   │   ├── btc_streak_stats.ts     # CLI: streak 통계 분석
│   │   ├── martingale_sim.ts       # CLI: 마틴게일 시뮬레이션 + 캔들 캐시
│   │   ├── martingale_engine.ts    # 서버용 시뮬레이션 엔진
│   │   └── correlation.ts          # 교차 상관 분석
│   └── api/
│       └── routes.ts               # REST API 라우트
├── public/
│   ├── martingale.html             # 메인 인터랙티브 대시보드
│   ├── streak_analysis.html        # 이론 vs 실제 확률 비교 차트
│   └── index.html                  # 기본 대시보드
├── data/
│   ├── market.db                   # 실시간 수집 SQLite DB
│   └── btc_5m_candles.json         # 5분봉 캔들 캐시 (약 40MB)
└── package.json
```

## 실행 방법

### 1. 설치
```bash
npm install
```

### 2. 캔들 데이터 수집 (최초 1회)
```bash
npx tsx src/analysis/martingale_sim.ts
```
- Binance REST API에서 2017-08-17부터 현재까지 5분봉 데이터 수집
- `data/btc_5m_candles.json`에 캐시 저장 (약 40MB)
- 이후 실행 시 캐시 파일 재사용

### 3. 서버 실행
```bash
npm start
# 또는
PORT=3001 npx tsx src/index.ts
```

### 4. 대시보드 접속
- 마틴게일 시뮬레이터: `http://localhost:3000/martingale.html`
- Streak 확률 비교: `http://localhost:3000/streak_analysis.html`

## CLI 분석 도구

### Streak 통계
```bash
npx tsx src/analysis/btc_streak_stats.ts
```
10회 이상 연속 상승/하락 통계를 콘솔에 출력합니다.

### 마틴게일 시뮬레이션
```bash
npx tsx src/analysis/martingale_sim.ts
```
기본 설정(4연속 streak, 최대 10회 배팅, $1)으로 시뮬레이션 결과를 출력합니다.

## 주요 분석 결과 (2017-08-17 ~ 2026-03-27)

### Streak 통계
| | 상승 | 하락 |
|---|---|---|
| 10회+ 발생 횟수 | 421회 | 378회 |
| 최대 연속 길이 | 17개 | **19개** |
| 최대 가격 변화 | 8.08% | **14.97%** |

### 마틴게일 시뮬레이션 (minStreak=4, maxRounds=10, baseBet=$1)
| 항목 | 값 |
|---|---|
| 총 트레이드 | ~110,000회 |
| 승률 | 99.97% |
| 최종 손익 | +$81,706 |
| MDD | -$3,368 |
| 최대 연속 패배 | 1회 |

### 가설 검증: "Streak이 길수록 반전 확률이 높아진다"
- 전 라운드(1~9)에서 실제 조건부 승률 **54~62%** → 이론(50%) 대비 유의미하게 높음
- 라운드 8(12연속 도달 시) 최대 엣지: **+11.8%p**

## 기술 스택

- **런타임**: Node.js + TypeScript (tsx)
- **서버**: Express
- **DB**: SQLite (better-sqlite3) — 실시간 데이터 수집용
- **데이터**: Binance REST API (Klines) + WebSocket
- **프론트엔드**: Vanilla JS + Chart.js
- **계산**: 브라우저 인메모리 (서버 통신 없이 즉시 재계산)

## 주의사항

- 이 시뮬레이터는 **교육 및 연구 목적**입니다
- 수수료, 슬리피지, 자본 회전율이 반영되지 않았습니다
- 과거 데이터 기반 백테스트는 미래 수익을 보장하지 않습니다
- 마틴게일 전략은 이론적으로 **파산 리스크**가 존재합니다

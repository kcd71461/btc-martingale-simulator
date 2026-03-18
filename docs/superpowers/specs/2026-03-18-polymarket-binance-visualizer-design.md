# Polymarket-Binance BTC Market Relationship Visualizer

## Overview

Polymarket BTC 5분 바이너리 옵션 마켓과 Binance BTCUSDT 현물 시장의 시세/호가 데이터를 실시간 스트리밍으로 수집하여 SQLite에 저장하고, 두 시장 간 관계성(가격 오버레이, 호가 스프레드 비교, 시차 상관관계)을 시각화하는 연구/분석 도구.

## Goals

- **주 목적**: 마켓 구조 리서치 — 두 시장의 상관관계, 시차, 호가 구조 차이를 분석적으로 이해
- **운영 규모**: 실험/연구용 — 수동으로 켜고 끄며 수일~수주 데이터 수집
- **시간 기록**: 로컬 수신시각(local_ts)과 패킷 내 타임스탬프(server_ts) 이중 기록
- **시각화 X축**: local time / server time 토글 선택 가능

## Architecture

단일 Node.js 프로세스가 모든 역할을 수행:

```
┌─────────────────────────────────────────────────┐
│                 Node.js Process                  │
│                                                  │
│  ┌──────────────┐       ┌───────────────────┐   │
│  │ Polymarket   │       │ Binance           │   │
│  │ Connector    │       │ Connector         │   │
│  │              │       │                   │   │
│  │ - Gamma API  │       │ - WS: bookTicker  │   │
│  │   (5분 마켓  │       │ - WS: trade       │   │
│  │    발견)     │       │ - WS: depth10     │   │
│  │ - WS: market │       │                   │   │
│  │   (호가/가격)│       │                   │   │
│  └──────┬───────┘       └────────┬──────────┘   │
│         │                        │               │
│         └────────┬───────────────┘               │
│                  ▼                                │
│          ┌──────────────┐                        │
│          │  SQLite DB   │                        │
│          └──────┬───────┘                        │
│                 │                                 │
│          ┌──────▼───────┐                        │
│          │  Web Server  │                        │
│          │  (Express)   │                        │
│          └──────────────┘                        │
└─────────────────────────────────────────────────┘
```

**선택 이유**: 단일 프로세스로 양쪽 WS 수신 시각을 동일 클럭에서 비교 가능. 실험/연구용에 적합한 단순 구조.

## Data Sources

### Polymarket

- **마켓 발견**: Gamma API `GET https://gamma-api.polymarket.com/events?slug=btc-updown-5m-{timestamp}`
  - slug = `btc-updown-5m-` + `floor(now/300)*300`
  - 응답에서 `clobTokenIds` 추출 (Up/Down 각각)
- **실시간 스트리밍**: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
  - 구독: `{ assets_ids: [upTokenId, downTokenId], type: "market" }`
  - 수신 이벤트: `book`, `price_change`, `last_trade_price`
  - Heartbeat: 10초마다 `PING`
- **인증**: 읽기 전용 — 불필요
- **5분 롤오버**: 매 5분 경계 시점에 Gamma API로 새 마켓 조회 → WS 재구독 (미발견 시 3초 후 재시도, 최대 5회)

### Binance

- **스트리밍**: `wss://stream.binance.com:9443/ws`
  - 구독: `btcusdt@bookTicker`, `btcusdt@trade`, `btcusdt@depth10@100ms`
- **인증**: 공개 시장 데이터 — 불필요
- **재연결**: 연결 끊기면 3초 후 재연결 + 자동 재구독

## Database Schema (SQLite)

```sql
-- Polymarket 호가 스냅샷
CREATE TABLE poly_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_ts INTEGER NOT NULL,        -- 로컬 수신시각 (ms, Date.now())
  server_ts INTEGER,                -- 패킷 내 timestamp (ms)
  market_slug TEXT NOT NULL,        -- e.g. "btc-updown-5m-1773583500"
  token_id TEXT NOT NULL,           -- clobTokenId
  side TEXT NOT NULL,               -- 'up' | 'down'
  bids JSON NOT NULL,               -- [[price, size], ...]
  asks JSON NOT NULL,               -- [[price, size], ...]
  best_bid REAL,
  best_ask REAL,
  last_trade_price REAL
);

-- Polymarket 가격 변동 이벤트
CREATE TABLE poly_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_ts INTEGER NOT NULL,
  server_ts INTEGER,
  market_slug TEXT NOT NULL,
  token_id TEXT NOT NULL,
  side TEXT NOT NULL,               -- 'up' | 'down'
  price REAL NOT NULL,
  event_type TEXT NOT NULL          -- 'price_change' | 'last_trade_price'
);

-- Binance 최우선 호가 (bookTicker)
CREATE TABLE bnc_book_tickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_ts INTEGER NOT NULL,
  server_ts INTEGER,                -- Binance event time 없음 (bookTicker엔 E 필드 없음)
  bid_price REAL NOT NULL,
  bid_qty REAL NOT NULL,
  ask_price REAL NOT NULL,
  ask_qty REAL NOT NULL,
  update_id INTEGER
);

-- Binance depth 스냅샷 (depth10, 100ms)
CREATE TABLE bnc_depths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_ts INTEGER NOT NULL,
  server_ts INTEGER,
  bids JSON NOT NULL,               -- [[price, qty], ...] 최대 10레벨
  asks JSON NOT NULL,
  last_update_id INTEGER
);

-- Binance 체결
CREATE TABLE bnc_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_ts INTEGER NOT NULL,
  server_ts INTEGER NOT NULL,       -- trade time (T 필드, ms)
  event_ts INTEGER NOT NULL,        -- event time (E 필드, ms)
  price REAL NOT NULL,
  qty REAL NOT NULL,
  is_buyer_maker BOOLEAN NOT NULL,
  trade_id INTEGER NOT NULL
);

-- 인덱스
CREATE INDEX idx_poly_books_local_ts ON poly_books(local_ts);
CREATE INDEX idx_poly_prices_local_ts ON poly_prices(local_ts);
CREATE INDEX idx_bnc_book_tickers_local_ts ON bnc_book_tickers(local_ts);
CREATE INDEX idx_bnc_depths_local_ts ON bnc_depths(local_ts);
CREATE INDEX idx_bnc_trades_local_ts ON bnc_trades(local_ts);
CREATE INDEX idx_bnc_trades_server_ts ON bnc_trades(server_ts);
```

### 데이터 볼륨 추정

| 소스 | 스트림 | 빈도 | 시간당 행 수 |
|------|--------|------|-------------|
| Binance | bookTicker | 실시간 | ~50,000 |
| Binance | trade | 실시간 | ~30,000 |
| Binance | depth10 | 100ms | ~36,000 |
| Polymarket | book/price | 이벤트 기반 | ~1,000-5,000 |

하루 ~280만 행. SQLite로 수주 수집 충분.

## Collection Logic

### Polymarket Connector

1. 시작 시 Gamma API로 현재 5분 윈도우 마켓 조회
2. WS 연결 및 구독
3. 수신 루프: 이벤트 타입별 DB INSERT (local_ts 찍고 저장)
4. 5분 경계마다 새 마켓 발견 → WS 재구독
5. 10초 heartbeat

### Binance Connector

1. WS 연결 및 3개 스트림 구독
2. 수신 루프: 스트림별 DB INSERT
3. 연결 끊김 시 3초 후 재연결

## Visualization

### Tech Stack

- Express 정적 서빙 + REST API
- 단일 `public/index.html` (vanilla JS + Chart.js CDN)
- 빌드 스텝 없음

### REST API

```
GET /api/data?from={ms}&to={ms}&timebase=local|server
GET /api/poly/books?from={ms}&to={ms}&timebase=local|server
GET /api/bnc/books?from={ms}&to={ms}&timebase=local|server
GET /api/correlation?from={ms}&to={ms}&timebase=local|server&lag_range={ms}
```

모든 API에 `timebase` 파라미터로 X축 기준 선택.

### 차트 구성

**1. 가격 오버레이 차트**
- 좌Y축: Binance BTC 가격 (USD)
- 우Y축: Polymarket Up 확률 (0~1)
- 동일 타임라인에 겹침

**2. 호가 스프레드 비교**
- Polymarket bid/ask 스프레드 vs Binance bid/ask 스프레드
- 실시간 최신 스냅샷 기준

**3. 시차 상관관계 (Cross-correlation)**
- X축: lag (-30s ~ +30s)
- Y축: 상관계수
- peak 위치로 어느 시장이 선행하는지 표시

### X축 기준 토글

UI 상단에 `Local Time` / `Server Time` 라디오 버튼. 전환 시 모든 차트가 해당 기준으로 재정렬. 상관관계 분석에서 두 기준의 결과 차이 비교로 네트워크 지연 영향 파악 가능.

## Project Structure

```
poly-test/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # 진입점
│   ├── db.ts                 # SQLite 초기화 + INSERT 헬퍼
│   ├── connectors/
│   │   ├── polymarket.ts     # Gamma API + WS
│   │   └── binance.ts        # WS
│   ├── api/
│   │   └── routes.ts         # Express REST API
│   └── analysis/
│       └── correlation.ts    # cross-correlation 계산
├── public/
│   └── index.html            # 시각화 UI
└── data/
    └── market.db             # SQLite (gitignore)
```

### Dependencies

- `better-sqlite3` — 동기 SQLite, WAL 모드
- `express` — REST API + 정적 서빙
- `ws` — WebSocket 클라이언트
- `tsx` — TypeScript 직접 실행
- `typescript` — 타입 체크

### 실행

```bash
npx tsx src/index.ts
# 수집 시작 + http://100.110.54.39:3000 대시보드
```

## Non-Goals

- 트레이딩/자동매매 기능
- 상시 운영 (데몬화, 모니터링)
- 복수 마켓 동시 추적 (BTC 5분 단일 마켓만)
- 사용자 인증/멀티유저

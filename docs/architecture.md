# PointBridge: Architecture Diagrams

These are Mermaid diagrams. Paste each block into https://mermaid.live to export a PNG for the report or slides.

## 1. Component diagram: one service, two monoliths

```mermaid
flowchart LR
  subgraph CAFE["Monolith #1: Brew & Bean Café :3001"]
    CUI["Café pages<br/>menu · cart · receipt"]
    CS["Café server<br/>(Express)"]
    CDB[("cafe.db<br/>menu, orders")]
    CUI <--> CS --- CDB
  end

  subgraph CINEMA["Monolith #2: Starlight Cinemas :3002"]
    KUI["Cinema pages<br/>movies · seats · ticket"]
    KS["Cinema server<br/>(Express)"]
    KDB[("cinema.db<br/>movies, shows, bookings")]
    KUI <--> KS --- KDB
  end

  LC["loyalty-client<br/>shared library: REST client +<br/>live feed + browser widget"]

  subgraph SVC["Reusable service"]
    LS["Loyalty Points Service :5001<br/>rules · idempotency · client registry"]
    LDB[("loyalty.db<br/>members, ledger")]
    LS --- LDB
  end

  BUS["Event Bus :5002<br/>publish / subscribe"]

  CS -. uses .-> LC
  KS -. uses .-> LC
  LC -- "REST + X-Client-Id / X-Api-Key" --> LS
  LS -- "publish after commit" --> BUS
  BUS -- "events" --> CS
  BUS -- "events" --> KS
  CS -- "SSE /api/live" --> CUI
  KS -- "SSE /api/live" --> KUI
```

## 2. Sequence: a Café checkout (spending and earning points)

```mermaid
sequenceDiagram
  actor C as Cashier
  participant UI as Café page
  participant CS as Café server
  participant CDB as cafe.db
  participant LS as Loyalty Service
  participant BUS as Event Bus

  C->>UI: 2× Cappuccino, phone, "Use points"
  UI->>CS: POST /api/checkout
  CS->>CS: validate items, total = ₹300
  CS->>LS: GET /members/9876543210 (findOrEnroll)
  LS-->>CS: Priya, balance 37
  CS->>CDB: INSERT order (pending) → id 5
  CS->>LS: POST /redeem {points: 37, reference: cafe-order-5}
  LS->>LS: one transaction: balance ≥ 37? deduct + ledger row
  LS-->>CS: balance 0
  LS->>BUS: PointsRedeemed
  CS->>LS: POST /earn {amount: 263, reference: cafe-order-5}
  LS-->>CS: +26 points, balance 26
  LS->>BUS: PointsEarned
  CS->>CDB: UPDATE order (used 37, paid 263, earned 26, ok)
  CS-->>UI: 201 receipt + member
```

## 3. Sequence: an update in one monolith shows up in the other

```mermaid
sequenceDiagram
  participant KS as Cinema server
  participant LS as Loyalty Service
  participant BUS as Event Bus
  participant CS as Café server
  participant CUI as Café page (open at the counter)

  KS->>LS: POST /members/9876543210/earn {amount: 370}
  LS->>LS: commit balance + ledger
  LS-->>KS: 200 (+37)
  LS->>BUS: PointsEarned {source: cinema, member snapshot}
  BUS-->>CS: event
  CS-->>CUI: SSE data: {...}
  CUI->>CUI: member card flashes → 37 points,<br/>feed: "Priya earned 37 pts at Cinema"
```

## 4. Sequence: the Loyalty Service is down (loose coupling)

```mermaid
sequenceDiagram
  participant UI as Café page
  participant CS as Café server
  participant CDB as cafe.db
  participant LS as Loyalty Service (down)

  UI->>CS: POST /api/checkout (no points used)
  CS->>LS: findOrEnroll
  LS--xCS: connection refused
  CS->>CDB: INSERT order, loyaltyStatus = failed
  CS-->>UI: 201 receipt + "points not applied"
  UI->>CS: POST /api/checkout (usePoints)
  CS->>LS: findOrEnroll
  LS--xCS: connection refused
  CS-->>UI: 503 "points cannot be used right now"
```

## 5. Production architecture (future work)

```mermaid
flowchart LR
  P1["Café chain"] & P2["Cinema chain"] & P3["New partner<br/>(airline, fuel…)"] --> GW["API Gateway<br/>OAuth2 client credentials,<br/>rate limits"]
  GW --> LS["Loyalty Service ×N<br/>(Kubernetes)"]
  LS --> PG[("PostgreSQL")]
  LS -- outbox relay --> K[["Kafka: loyalty-events"]]
  K --> P1 & P2 & P3
  K --> AN["Analytics / fraud detection"]
```

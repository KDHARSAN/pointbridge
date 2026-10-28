# PointBridge: one loyalty service reused by two monolithic apps

SOA assignment for **21CSE457T – Service Oriented Architecture**.

> **Requirement:** build one service and reuse it in two separate monolithic applications, so that an update made through one is reflected in the other.

| Piece | What it is | Port | Its own data |
|---|---|---|---|
| **Loyalty Points Service** | The reusable service. It enrolls members, earns and spends points, and enforces the rules. | 5001 | `loyalty.db`: members, ledger |
| **Brew & Bean Café** | Monolith #1: a coffee shop point-of-sale app with its own server, database and pages | 3001 | `cafe.db`: menu, orders |
| **Starlight Cinemas** | Monolith #2: a movie box office with its own server, database and pages | 3002 | `cinema.db`: movies, shows, bookings |
| **Event Bus** | Publish/subscribe channel that delivers live loyalty updates | 5002 | nothing |
| `loyalty-client/` | The shared client library both monoliths use: the REST client, the live feed relay and the browser widget | – | – |

```
 Café browser ──► Café monolith :3001 ─┐ REST + API key            ┌──► Café monolith ──SSE──► Café browser
                   (menu, orders DB)   ├──────► Loyalty Service ──► Event Bus
 Cinema browser ─► Cinema monolith :3002┘        :5001 (ledger DB)   :5002 └──► Cinema monolith ─SSE─► Cinema browser
                   (shows, bookings DB)
```

## Run it

Requires Node.js 22.13 or newer.

```bash
npm run setup
```

```bash
npm run dev
```

| Open | URL |
|---|---|
| Café | http://localhost:3001 |
| Cinema | http://localhost:3002 |
| Service console (read-only) | http://localhost:5001 |

To reset the demo data, stop the servers and delete `*/*.db`; menus and movies are seeded again on the next start.

To run the tests:

```bash
npm test
```

**`EADDRINUSE` / port already in use** means another copy is still running. Press Ctrl+C in that terminal. If you can't find it, run this in PowerShell:

```powershell
foreach ($p in 3001,3002,5001,5002) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess } }
```

## Live demo script

For the demo, start the service on its own so you can stop it in step 5 without stopping the apps. Use **two terminals** in `pointbridge/`:

```bash
npm run loyalty
```

```bash
npm run dev:apps
```

Put the Café and the Cinema side by side, with the service console (:5001) in a third window. Start from fresh data: stop everything and delete `*/*.db` first.

1. **Join in one app, recognised in the other.** At the Café, add 2 Cappuccinos (₹300), type phone `9876543210` and name `Priya`, then place the order. She joins and earns **30 points**. At the Cinema, type the same phone: Priya shows up with **30** points, and there is no second sign-up.
2. **Cinema → Café.** At the Cinema, pick *Neon Monsoon 18:30*, keep 2 seats, tick **Use points**, and book. That's ₹400 − 30 points = **₹370 paid, +37 points**. The Café's card flashes and shows **37**.
3. **Café → Cinema.** At the Café, add 1 Masala Chai (₹90), tick **Use points**, and place the order. That's 37 points used, **₹53 paid, +5 points**. The Cinema's card flashes and shows **5**.
4. **No double spending.** Run this in a third terminal. The Café and the Cinema spend the same points at the same instant: one gets HTTP 200, the other gets **409 Not enough points**.
   ```bash
   npm run race
   ```
5. **Loose coupling.** Press **Ctrl+C in the `npm run loyalty` terminal**. The cards show *offline*. At the Café, place an order with Priya's phone: it still goes through, and the order list shows **"points not applied"**. Restart with `npm run loyalty`; everything works again.
6. **The service owns the data.** The console at :5001 shows one ledger with rows from both `cafe` and `cinema`.

## Loyalty Service API

Every call needs the headers `X-Client-Id` (`cafe` or `cinema`) and `X-Api-Key`. Errors come back as `{ "error": "..." }`.

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/members` | `{ phone, name }` | 201 new member, or 200 if already a member |
| GET | `/members/:phone` | | the member (404 if unknown) |
| POST | `/members/:phone/earn` | `{ amount, reference }` | 1 point per ₹10 spent |
| POST | `/members/:phone/redeem` | `{ points, reference }` | 409 if the balance is too low |
| GET | `/members/:phone/transactions` | | the ledger, newest first |
| GET | `/health`, `/admin/overview`, `/` | | open, read-only |

Rules: a member becomes **Gold** at 500 lifetime points. A repeated `(client, type, reference)` is applied only once, so retries are safe. Events published: `MemberEnrolled`, `PointsEarned`, `PointsRedeemed`.

# PointBridge: A Reusable Loyalty Points Service Shared by Two Monolithic Applications

**Course:** 21CSE457T – Service Oriented Architecture
**Student:** _your name / register number_

---

## 1. The requirement

> Create one service and reuse it inside two other monolithic applications. An update made through one application must be reflected in the other.

The professor's example was a Login service. PointBridge applies the same idea to a different, real business capability: **partner loyalty points**, as used by coalition programmes such as Payback or airline miles.

| Requirement | Where it is met |
|---|---|
| One reusable service | `loyalty-service/`: the Loyalty Points Service (port 5001) |
| Two monolithic applications | `cafe-app/` (port 3001) and `cinema-app/` (port 3002). Each is a complete app with its own Express server, its own SQLite database and its own pages. |
| Both reuse the service | Both servers call the service through the same library, `loyalty-client/`, and neither app stores points itself |
| Update in one is reflected in the other | Demo steps 1–3: a member enrolled at the Café is recognised at the Cinema, and points earned or spent in either app appear live in the other |

## 2. Why loyalty points?

- **Reuse is the business model.** A coalition programme only works if many independent businesses share one points ledger.
- **It has real business rules to centralise:** the earn rate (1 point per ₹10), the spend rate (1 point = ₹1), no negative balance, and tiers (Gold at 500 lifetime points). Because these live in the service, both apps get identical behaviour without duplicating code.
- **It has real consistency problems:** what happens when two apps spend the same points at once, when a request is retried, or when the service is down. Those problems are what SOA design has to solve.

## 3. Architecture

The diagrams are in `architecture.md`: the component diagram, three sequence diagrams and the production view.

### 3.1 Components

| Component | Responsibility | Owns data | Tech |
|---|---|---|---|
| Loyalty Points Service | Enroll members, earn and spend points, ledger, rules, client registry | `loyalty.db` | Node.js, Express, `node:sqlite` |
| Event Bus | Fan-out of loyalty events to every subscribed application | none | Socket.IO |
| Café monolith | Menu, cart, orders, receipts | `cafe.db` | Express, SQLite, HTML/JS |
| Cinema monolith | Movies, shows, seat inventory, bookings | `cinema.db` | Express, SQLite, HTML/JS |
| `loyalty-client` | Shared client library: the REST client, the shared checkout flow (`settlePurchase`: spend, then earn, with safe retries), the event-feed relay, and the browser member widget | none | Node.js + browser JS |

### 3.2 Service contract

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/members` | `{phone, name}` | 201 new, 200 existing | 400, 401 |
| GET | `/members/:phone` | | 200 Member | 401, 404 |
| POST | `/members/:phone/earn` | `{amount, reference}` | 200 `{member, points}` | 400, 401, 404 |
| POST | `/members/:phone/redeem` | `{points, reference}` | 200 `{member, points}` | 400, 401, 404, 409 |
| GET | `/members/:phone/transactions` | | 200 Ledger[] | 401, 404 |

- **Headers:** `X-Client-Id` and `X-Api-Key` on every call.
- **Member:** `{phone, name, balance, lifetimeEarned, tier, createdAt, updatedAt}`.

### 3.3 Event catalog

| Event | Raised when | Payload |
|---|---|---|
| `MemberEnrolled` | First time a phone joins, in any app | `{id, type, phone, source, points: 0, at, member}` |
| `PointsEarned` | An app records a purchase | same, `points` = points earned |
| `PointsRedeemed` | An app spends points | same, `points` = points spent |

`source` tells subscribers which application caused the change. That is how each app shows "Priya earned 37 pts at Cinema".

## 4. SOA concepts demonstrated (syllabus mapping)

| Syllabus topic | How PointBridge shows it |
|---|---|
| **Unit 1: Service orientation, SOA vs MSA** | One business capability is a service consumed by multiple *existing-style monolithic* applications. That is the classic enterprise SOA situation: legacy apps gain a shared capability without being rewritten as microservices. |
| **Unit 1: Reference architecture** | Consumer layer (two monoliths) → integration layer (client library + Event Bus) → business service layer (Loyalty Service) → data layer (`loyalty.db`). |
| **Unit 2: Service design principles** | **Reusability:** two consumers, zero consumer-specific code in the service. **Loose coupling:** apps know only the contract; the Café keeps selling when the service is down. **Abstraction:** apps never see the ledger tables. **Statelessness:** each request carries its client identity. **Contract:** one documented API plus one shared client library. |
| **Unit 2: Business services vs data services** | The Loyalty Service is both: it owns data (members and the ledger) and enforces business rules (earn and spend rates, no overdraft, tiers). |
| **Unit 2: Composite applications** | Each checkout combines the app's own logic (cart, seats) with the shared service (identity, points). |
| **Unit 3: Service integration** | REST for commands, plus a publish/subscribe Event Bus for notifications, in an ESB style. |
| **Unit 3: Governance (design time and run time)** | **Client registry with API keys:** only registered applications can call the service. **Ledger:** every change is recorded with the app that made it, viewable in the service console. **Idempotency keys:** each change carries a reference so retries can't double-count. |
| **Unit 5: Best practices** | A single source of truth, contract-first design, failure isolation, a shared client library, automated tests per service. |

## 5. Consistency and failure handling

1. **No overspending.** A spend runs `UPDATE members SET balance = balance - ? WHERE phone = ? AND balance >= ?` inside one transaction. If two apps race for the same points, exactly one succeeds and the other gets **409 Not enough points**. This is demonstrated with `npm run race` and covered by a test.
2. **Safe retries (idempotency).** Each earn or spend carries a reference such as `cafe-order-5`. The ledger has `UNIQUE(source, type, reference)`, so if a request is repeated (a network retry or a double click), it returns the original result without changing the balance.
3. **Publish after commit.** Events are sent only after the database commit succeeds, so no app ever shows a change that didn't happen. If the bus is down, the change still succeeds and is still in the ledger.
4. **Graceful degradation (loose coupling).** If the Loyalty Service is unreachable:
   - The monolith still completes the sale using its own database and flags it `loyaltyStatus = failed` ("points not applied").
   - Spending points is refused with HTTP 503 and a clear message, because points can't be verified.
5. **Validate locally first.** Each monolith validates items, seats and phone before calling the service, so a bad order never touches the shared ledger.
6. **Compensation.** If spending points is refused after the Cinema has reserved seats, the seats are released and the booking removed. This is a small, local version of the **Saga** pattern. A *timeout* is different: the spend may already have happened. So the app first repeats the call with the same reference, which is safe because references make it idempotent, and rolls back only if it still can't get an answer.
7. **References stay unique.** Each order's reference is `cafe-order-<id>-<random>`, so clearing one app's database can never make a new order look like a repeat of an old one. The service also refuses (409) a reference that was already used for a different member.
8. **Missed events.** Whenever an app reconnects to the bus, its page reloads the member from the service, so events missed while offline don't leave stale balances.

**Known limit.** If the earn call fails *after* the sale is saved, the customer misses those points. The order is flagged, and its reference makes a later retry safe. A retry worker is future work (§8).

## 6. Testing

| Suite | Tests | What it proves |
|---|---|---|
| Loyalty Service: core | 17 | Enroll/lookup, length and amount limits, malformed JSON, the earn rate, spending, refusing an overdraft, the race between two apps, idempotent retries, refusing a reference reused for another member, every validation rule, API-key auth, tiers, the admin overview never leaking keys |
| Loyalty Service: events | 4 | The right events with the source app and member snapshot; nothing published on replays or refusals; a dead bus doesn't fail writes |
| Event Bus | 2 | Fan-out to several subscribers; rejects bad events |
| `loyalty-client` | 4 | Round-trip against the **real** service; errors mapped to `LoyaltyError`; `findOrEnroll`; unreachable service |
| Café monolith | 18 | Checkout with and without points, a retried earn after a timeout, malformed JSON, a unique reference per order, a retried spend after a timeout, a whole bill paid in points, a refused spend saves nothing, validation happens before any service call, guest checkout, service down, earn failing after a spend |
| Cinema monolith | 10 | Booking maths, malformed JSON, a retried spend after a timeout, seat inventory, oversell refused without touching points, seats released when a spend fails, validation, service down |

Run all 55 tests with `npm test` in `pointbridge/`. The full demo was also run in the browser with both monoliths and the service console open.

## 7. SOA vs microservices, and REST vs SOAP

**SOA vs microservices.** Microservices split *one* application into small, independently deployed services. SOA focuses on *the enterprise*: a capability built once and **reused by many applications**, including monoliths that stay monoliths. PointBridge is SOA in that sense. The Café and Cinema remain monolithic, and only the shared capability, loyalty, is a service. The professor's requirement ("reuse it in two monoliths") describes exactly this.

**REST vs SOAP.** Classic SOA used SOAP/WSDL with an ESB. PointBridge uses REST + JSON for commands and a lightweight pub/sub bus for events, because they are simpler and browser-friendly. The principles are the same: a fixed contract, reuse and loose coupling. The API table plays the role a WSDL would.

## 8. Limitations and future work

- **Security:** use OAuth2 client credentials instead of static API keys, and put the service console behind staff login.
- **Reliability:**
  - a retry worker for orders flagged `failed`
  - a transactional outbox, so events are never lost when the bus is down
  - Kafka instead of the in-memory bus
- **Features:** refunds and cancellations (reversal transactions), point expiry, tier perks, more partners (the API needs no change to add one; just register a new client).
- **Deployment:** Docker/Kubernetes, PostgreSQL, an API gateway with rate limits.

## 9. Screenshots

_Insert: the Café and Cinema side by side before and after a booking, the Café card flashing after a Cinema booking, the `npm run race` output, a "points not applied" order, and the service console ledger._

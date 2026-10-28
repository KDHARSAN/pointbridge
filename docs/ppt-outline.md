# PointBridge: PPT Outline (12 slides)

1. **Title.** "PointBridge: One Loyalty Service, Two Monoliths". Course 21CSE457T, your name. *Visual:* the Café and Cinema screenshots side by side.
2. **The requirement.** Quote it: "Create a service and reuse it in two monolithic applications." Mention that the example was a Login service, and that ours is Loyalty Points. *Visual:* one box feeding two boxes.
3. **Why loyalty points.** Coalition programmes (Payback, air miles) are reuse as a business model. Central rules: earn rate, spend rate, no overdraft, tiers.
4. **Architecture.** Two monoliths with their own databases, the shared client library, the service and the bus. *Visual:* `architecture.md` diagram 1.
5. **Proof the apps are monoliths.** Each has its own server, database and pages, and none of them store points. *Visual:* a table of the three databases and what each owns.
6. **The service contract.** 5 endpoints, API keys, the Member shape. *Visual:* API table.
7. **Reuse in code.** `loyalty-client` is imported by both apps, and the same widget appears in both pages. *Visual:* a code snippet of `createLoyaltyClient(...)` in each `server.js`.
8. **Update in one, reflected in the other.** Event catalog, publish after commit, live relay to each app's page. *Visual:* diagram 3.
9. **Consistency.** No overspending (the race), idempotent retries, compensation, missed-event refresh. *Visual:* `npm run race` output.
10. **Loose coupling.** The service goes down and the Café still sells. *Visual:* diagram 4 plus a "points not applied" badge screenshot.
11. **LIVE DEMO.** Follow the README demo script, steps 1–6.
12. **Results and future work.** 50 automated tests, syllabus mapping. Next: OAuth2, Kafka, a retry worker, more partners. *Visual:* diagram 5.

**Demo tips**
- Before presenting: stop everything and delete `*/*.db`. Then run `npm run loyalty` in one terminal and `npm run dev:apps` in another, so in step 5 you can stop only the service with Ctrl+C.
- Arrange the windows with the Café on the left, the Cinema on the right, and the service console (:5001) behind them.
- Use the phone number `9876543210` and the name Priya so the steps match the script.

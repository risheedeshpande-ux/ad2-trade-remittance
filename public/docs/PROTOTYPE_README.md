# AD2 Trade Remittance — demo notes

This packet's working notes now live in the repository README. In short:

- **Run locally:** `npm install && npm start`, then open <http://localhost:8130>.
- **Walk through it:** open the demo and click **Demo guide** in the yellow bar — 17 steps from registering a business to a released payment (UTR, MT103) and a disposed export receipt (FIRC), each step signing in as the right role.
- **Sign in:** demo accounts use the passcode `demo` unless the deployment sets `DEMO_PASSCODE`; a business registered through the portal uses the password it chose.
- **Purpose codes and documents:** loaded from the business team's Purpose / Doc Policy workbook — AIR, DIR and OTT for outward remittance, TRADE for disposal instructions. See PRD §7 and §8.
- **Approval chain:** SME submits → AD2 Maker verifies → AD2 Checker authorises → AD2 Operations releases or processes. The same person may not act at two stages.

All businesses and transactions are fictional. FX rates, SWIFT, PennyDrop, sanctions screening, SFTP, SAP and document AI are simulated.

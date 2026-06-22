# License order flow — setup

The **Buy License** button on the pricing section opens `order.html`. The buyer
chooses the number of licenses and enters their billing details. On submit, a
Firebase Cloud Function (`createOrder`) generates a **proforma invoice PDF**,
emails it to the buyer (with a copy to the seller), stores the order in
Firestore, and replies with the proforma number.

> License keys are **not** issued automatically — they are sent after the
> payment is confirmed on the bank account.

Price model: **€100 / license is GROSS (includes 23% VAT)** → net €81.30 + VAT €18.70.

---

## 1. Before it works — fill these in

### a) Bank details (on the proforma)
Edit `functions/index.js` → `SELLER.bank`:

```js
bank: {
  accountHolder: "GS SP. Z O.O.",
  bankName: "...",
  iban: "...",      // EUR account
  swift: "...",
}
```

Also confirm `SELLER.mailFrom` / `SELLER.notifyEmail`.

### b) Email sender (SMTP — Gmail)
Mail is sent from `comprobareapp@gmail.com` via Gmail. Host/port/user are hardcoded in
`functions/index.js` (`smtp.gmail.com:465`); only the **password** is a secret.

Gmail requires an **App Password** (not the normal account password):
1. Enable **2-Step Verification** on `comprobareapp@gmail.com`.
2. Google Account → Security → **App passwords** → create one → copy the 16-char value.
3. Set it as the secret:

```bash
firebase functions:secrets:set SMTP_PASS   # paste the 16-char Gmail App Password
```

---

## 2. Deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

Firebase project is already set in `.firebaserc` → `comprobare-ce8a1`.
Cloud Functions require the **Blaze (pay-as-you-go)** plan.

After deploy, copy the function URL printed by the CLI (region
`europe-central2`), e.g.
`https://createorder-xxxxxxxxxx-lm.a.run.app`.

---

## 3. Connect the front-end

Open `order.html`, find the CONFIG block near the bottom and paste the URL:

```js
var ORDER_API_URL = 'https://createorder-xxxxxxxxxx-lm.a.run.app';
```

Commit + push (GitHub Pages will publish it).

### Before the URL is set
If `ORDER_API_URL` is empty, the form still works as a **fallback**: it opens the
buyer's email client pre-filled with the order, addressed to `comprobareapp@gmail.com`,
so no order is lost while the backend is being set up.

---

## 4. Test

1. `order.html` → set quantity, fill details, **Send the order**.
2. Buyer + `notifyEmail` receive the proforma PDF.
3. Check Firestore `orders` collection and the `counters/proforma` sequence.
4. Logs: `firebase functions:log` (or `cd functions && npm run logs`).

## Files
| File | Purpose |
|------|---------|
| `order.html` | Order form (bilingual EN/PL), live totals, submit |
| `functions/index.js` | `createOrder` HTTP function: PDF + email + Firestore |
| `firebase.json`, `.firebaserc` | Firebase config / project |
| `firestore.rules` | Locks Firestore to server-side (Admin SDK) only |

# Track

React Native / Expo implementation of the Simplify Money Track assignment. I chose Expo for a short setup path and one Android/iOS app. The timeline is a single virtualized `FlatList` with locally grouped months.

## Run in five minutes

Requirements: Node 20+, Android Studio with an emulator (or an Android phone), and the supplied mock API repo.

1. From this project root, clone the supplied server into the ignored folder: `git clone https://github.com/Simplify-Money/track-api-mock.git track-api-mock`.
2. Start the API in a terminal: `cd track-api-mock` then `node server.js`.
3. In a second terminal at this project root, run `npm install` then `npm run android`.
4. If using a physical Android phone, copy `.env.example` to `.env`, set `EXPO_PUBLIC_API_URL` to your computer's LAN IP on port 4010, then run `npm start` and open the project in Expo Go. iOS simulator uses `http://localhost:4010`.

The Android emulator default is `http://10.0.2.2:4010`; the browser defaults to `http://localhost:4010`. Keep the API process running while using the app. Commands: `npm run typecheck`, `npm test`.

## Browser version

This project uses the same React Native screen in the browser through React Native Web. Start the mock server in one terminal, then run `npm run web` from the project root and open the local URL printed by Expo. For a static browser export, run `npm run export:web`; the output is written to `dist`. A hosted website and API require public hosting. The assignment asks for an Android build, so include the APK as well if submitting the website as an extra preview.

## Android build link

An EAS preview profile is included in `eas.json` and produces an installable APK with an EAS share link. Sign in to your Expo account, configure the project once, and build:

```sh
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --platform android --profile preview --clear-cache
```

Before building for a physical phone on the same Wi-Fi, set the EAS `preview` environment variable `EXPO_PUBLIC_API_URL` to the computer's LAN address and keep the mock server running. `--clear-cache` is needed when changing this value so the Android JS bundle picks up the updated endpoint. When the build finishes, copy the install URL from the EAS build page into the assignment email. This LAN URL is only reachable on that network; use a publicly hosted API for reviewers on other networks. See [Expo's APK build guide](https://docs.expo.dev/build-reference/apk/) and [internal distribution guide](https://docs.expo.dev/build/internal-distribution/).

## Behavior

- On a fresh install, pages the full snapshot at 100 rows, then immediately fetches every changes page before committing the snapshot and sync token together.
- Uses bounded retries with `Retry-After` for transient 408/429/5xx/network errors. A 410 token expiry causes a new full snapshot followed by its changes feed.
- Normalizes the API's two row formats: canonical fields and legacy `txn_time` / `type` / decimal `amount` / `merchant_name` fields. Decimal rupees are converted to integer paise without float arithmetic.
- Deduplicates the full-list cursor's repeated boundary row by transaction ID. Changes are reconciled by ID and `updated_at`; the latest event wins, including deletion tombstones.
- Persists the last complete snapshot with AsyncStorage. A failed sync keeps that snapshot on screen and after restart. Concurrent refreshes are serialized.
- Uses Asia/Kolkata for month grouping. Internal transfers are excluded only when metadata identifies an own account (or the record explicitly says self transfer). `TRANSFERS_OUT` to other recipients remains a debit.
- Displays the original transaction currency. Month totals use integer INR paise; foreign rows use the API's `fx.inr_minor`, and a missing conversion is surfaced in that month's row count.
- Search works offline over merchant, category, status, and account. Tap a transaction to inspect its returned fields.

## Decision log

1. **Expo:** It keeps setup small and avoids native modules for this assignment. The reviewer can start on Android with the API already supplied.
2. **AsyncStorage:** It is enough for the 4,686 row snapshot and makes offline restart straightforward. For a multi-year history, I would use SQLite for indexed merchant search and smaller transactional writes.
3. **Snapshot, then delta before commit:** The first page's token identifies a snapshot that can still contain pending items. Reading changes immediately is necessary to show the current state; the token is persisted only with the resulting rows.
4. **Retry 429 and transient server/network failures:** The mock intentionally fails requests during full sync and the first changes request. Retrying the same cursor protects users from empty first-launch screens and avoids skipping data.
5. **410 means full resync:** The API says an expired token needs a full sync. I only fall back on 410; a 503 or offline error must not replace the saved snapshot.
6. **Normalize at the boundary:** I initially assumed every row used the documented `occurred_at` and `amount_minor` fields. Fixture inspection showed 2,281 legacy rows, so rendering and money calculations now consume one normalized shape.
7. **Integer paise, with explicit FX:** Decimal legacy rupees use string parsing into integer paise. The 15 USD rows carry `fx.inr_minor`; their original amount remains visible, while monthly INR totals use that supplied equivalent.
8. **Use transfer evidence, not category labels alone:** Fifty `TRANSFER` rows identify an own account via `counterparty.type`, legacy `linked_account`, or clear self-transfer wording. `TRANSFERS_OUT` is a separate category and remains spending because it can be money sent to another person.
9. **Asia/Kolkata month boundary:** Month totals and checkpoint reconcile only when timestamps are grouped in the users' calendar. Slicing the UTC timestamp would put transactions around local midnight into the wrong month.
10. **One list, local search:** Month headers and transactions share a `FlatList`, so React Native mounts a bounded window. Search can work offline without a new server endpoint.

## What the data made me decide

- The initial snapshot has 4,675 rows; applying the changes feed yields 4,686 unique transaction IDs. The full-list endpoint repeats the previous page's boundary row, so appending pages directly is incorrect.
- The data uses two shapes. Legacy rows use `txn_time` in Unix seconds, `DR` / `CR`, decimal rupee strings, and `merchant_name`; 2,281 of the snapshot rows need normalization. Three final records have no category, which is displayed as “Not categorised” instead of hiding the row.
- There are 25 pending rows at snapshot time. The changes feed settles 18 and deletes 7. This is why the first sync requests changes before publishing the result.
- Fifteen USD transactions include `fx.inr_minor`. Using dollar minor units as rupees made the monthly spend wrong. FX-converted totals match the checkpoint.
- Internal transfers are identified by own-account metadata or self-transfer language. There are 50 such rows. Category `TRANSFERS_OUT` is kept in spending.
- Reconciliation: after applying updates and tombstones, all 4,686 IDs are unique, and spend and income exactly match `checkpoint.json` for all 13 listed months. This is covered by `__tests__/checkpoint.test.ts`.
- `summary_months.json` is a snapshot with a separate `computed_at`, so the final checkpoint is the comparison target after the changes feed.

## Task 1 · Track teardown

Not completed. It requires using the real Simplify Money app, connecting a source, and personally testing Track online/offline. I have not invented observations or screenshots. Add the 1–2 page teardown and screenshots after doing that walkthrough.

## Task 3 · PR #412 review

Completed in [PR_REVIEW.md](./PR_REVIEW.md): nine ordered comments, each marked block/allow with rationale. The review includes the mixed fixture schema, duplicate boundary rows, missing changes sync, error behavior, transfer/FX totals, local month boundaries, and absent search/detail flows.

## Task 0 · Product feedback and referrals

Not completed. Profile setup, referrals to three friends, collecting their honest feedback, and following the social accounts require the candidate's own accounts and relationships. Add the one-pager and consented screenshots after those steps; none are claimed here.

## AI disclosure

OpenAI Codex helped scaffold and implement the app and tests. I checked its initial money logic against the supplied fixture and found a concrete mistake:

**Initial version:** it summed `amount_minor` as if every transaction were INR and only understood `occurred_at`, `direction`, and `merchant`.

**Corrected version:** normalize both schemas, exclude own-account transfers using record metadata, and use `fx.inr_minor` for foreign rows in rupee totals.

**Difference:** 2,281 snapshot rows did not have the initial version's expected fields, and USD minor units are not paise. After normalization and FX conversion, all 13 monthly checkpoint spend/income pairs match. I also removed the earlier assumption that every `TRANSFER`-like category should be excluded; only own-account transfers are excluded.

## Checks and remaining work

- Fixture audit was run against the supplied transaction, changes, and checkpoint files. The 4,686 ID count and each checkpoint total match using the implementation's rules.
- `npm test`: 12 passed, including final fixture reconciliation. `npm run typecheck`: passed. `npx expo export --platform android --output-dir dist`: Android bundle exported successfully. The mock server's `/v1/health` returned 200.
- An EAS Android APK was built and installed on a physical phone, but transaction sync still showed Offline. The phone browser could reach the mock API health endpoint; the app itself made no requests to that server in the observed retry. The preview build is configured to use the EAS `preview` environment. A clean-cache rebuild is needed before treating the APK as working.
- Task 0 and the real-app walkthrough required for Task 1 are not complete. TalkBack checks, before/after performance measurements, walkthrough recording, updated CV, public repo publication, and submission email also remain for the candidate.

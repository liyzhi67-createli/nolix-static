# Noliz

Buildless multi-page directory hosted at https://nolix.us.ci through the existing GitHub Pages repository. Branding is Noliz; the existing domain and Supabase `nolix_*` tables are intentionally preserved.

## Pages

- `/`: home
- `/search/`: public search and category filters
- `/submit/`: authenticated creator submission with one-use image CAPTCHA
- `/promote/`: own approved websites, CNY 99 lifetime promotion orders, original WeChat / Alipay receipt codes, payment reports
- `/account/`: profile, password, display preferences, own submissions
- `/login/`: email/password sign-in and registration, no ChatGPT sign-in or email OTP
- `/admin/reviews/`: owner-only review queue
- `/admin/submissions/`: owner-only record editing, filtering, and JSON export
- `/admin/promotions/`: owner-only real-ledger verification, order filtering/pagination, closing orders and stopping promotions
- `/privacy/`: privacy and listing guidelines

Static HTML shells are public on GitHub Pages. They contain no private records. Admin navigation and management content are rendered only after Auth and the `noliz_is_admin` RPC verify the session. Database RLS independently enforces access using the existing verified administrator identity, not editable user metadata or a client-side email comparison.

## Development

Run `node tools/preview.cjs` for http://127.0.0.1:4173. Before publication, run `node tools/prepare-release.cjs` to fingerprint the application, translations, appearance bootstrap, styles and brand asset. Keep old generated assets available for cached HTML. Run `node tools/check.cjs` and `node tools/appearance-check.cjs` for localized routes, role renders, mocked edge checks, display-mode persistence, prepaint behavior, reduced motion and contrast checks. The edge checks use the existing sibling project's TypeScript installation.

The header supports light/dark toggling, and account preferences add a system-following option. Preferences are stored locally under `noliz.appearance`; switching appearance does not recreate forms. A small synchronous self-hosted bootstrap sets the palette before the stylesheet paints. Home motion uses one-time entry sequences, IntersectionObserver reveals and a requestAnimationFrame-throttled depth effect. It respects `prefers-reduced-motion`. Pointer-driven gradient painting, pointer tilt, entry blur and header backdrop blur were removed for smoother interactions. English/Latin text uses self-hosted Inter Variable (OFL license included); Chinese and Japanese use language-specific native font stacks with adjusted weight, spacing and line height. No Apple proprietary fonts or remote font-service calls are required.

Public content starts loading before session validation. The home page uses one public data request for the latest 3 sites and up to 3 randomly selected paid placements; paid status is never trusted from local storage. Search is debounced for 220 ms, cancels obsolete requests, ignores stale responses, and searches / filters on the server with 24 results per page. Payment order lists are also paginated.

## Backend

`backend/security.sql` records the additive upgrade over the existing schema. The remote upgrade was applied through separate Supabase migrations. Do not rerun it blindly. It closes direct client INSERT access, retains administrator-only editing and creates service-only CAPTCHA RPCs. CAPTCHA challenges are bound to the authenticated UID, expire after five minutes, allow one attempt, and are consumed atomically. Limits: 10 challenges and 3 accepted submissions per user per ten minutes. This is basic image-based spam protection, not a managed, risk-scored bot defense. Expired challenge records should be cleaned up by a future scheduled retention job.

`backend/noliz-submit.ts` is deployed as `noliz-submit`. Gateway JWT verification is disabled because the handler independently validates EVERY request against Supabase Auth `/user`, including confirmed email, before accessing backend-only RPCs. Secret keys are read only from the function runtime. Never add them to client code or this repository.

The existing project settings currently enable email/password registration with automatic confirmation. This upgrade does not change those settings or introduce email OTP. General account email ownership is therefore not verified by mail; administrator access remains bound to the previously verified immutable owner UID. Future email confirmation and password recovery require a configured email delivery provider. The current account password form verifies the current password before updating it.

The legacy CNY 19.90/month listing/featured-payment implementation remains disabled and unchanged. The separate promotion product is a one-time CNY 99/site with no scheduled expiry or automatic renewal, using the owner's supplied static WeChat and Alipay receipt codes as explicitly requested. Static personal receipt codes are NOT a merchant payment API and do not provide automatic payment callbacks. Payment-provider rules may restrict remote business collection; approved business collection is recommended. Never attempt to bypass a provider restriction.

`backend/promotions.sql` records the applied additive promotion migration; do not rerun it blindly. Creating an order requires ownership and current approval. A user report only changes an order to `reported`, never `verified`. The bound administrator must inspect the real provider ledger, enter exactly 99 CNY and the matching full transaction reference, and attest to the check. The database fixes the price at 9900 fen, prevents reused channel/transaction pairs and duplicate active orders, and makes verification idempotent. Client INSERT/UPDATE privileges are revoked; private-schema checked actions are exposed through invoker RPC wrappers. Owners can read only their own orders; the bound administrator can read all. The public projection exposes only the approved site's ordinary public fields, not payer details or transaction references. Unlisting or explicit revocation immediately removes eligibility from subsequent public recommendation queries. No traffic or revenue is guaranteed; refunds require separate operator handling.

Run `node tools/promotion-check.cjs` in addition to the normal checks. `tools/promotion-test.sql` tests server-side permissions, amount checks, reference reuse, idempotency, approval and revocation in a transaction that rolls back every fixture and simulated receipt. No real payment was verified during deployment. Browser-based visual QA was unavailable in this environment; HTTP, role-render and database tests were used instead.

Interface strings are keyed in `assets/i18n.js` with matching Chinese, English and Japanese keys. Contributor-authored content is preserved in its original language. Keep `CNAME` unchanged when publishing unless the domain change is explicitly requested.

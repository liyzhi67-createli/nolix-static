# Noliz

Buildless multi-page directory hosted at https://nolix.us.ci through the existing GitHub Pages repository. Branding is Noliz; the existing domain and Supabase `nolix_*` tables are intentionally preserved.

## Pages

- `/`: home
- `/search/`: public search and category filters
- `/submit/`: authenticated creator submission with one-use image CAPTCHA
- `/account/`: profile, password, display preferences, own submissions
- `/login/`: email/password sign-in and registration, no ChatGPT sign-in or email OTP
- `/admin/reviews/`: owner-only review queue
- `/admin/submissions/`: owner-only record editing, filtering, and JSON export
- `/privacy/`: privacy and listing guidelines

Static HTML shells are public on GitHub Pages. They contain no private records. Admin navigation and management content are rendered only after Auth and the `noliz_is_admin` RPC verify the session. Database RLS independently enforces access using the existing verified administrator identity, not editable user metadata or a client-side email comparison.

## Development

Run `node tools/preview.cjs` for http://127.0.0.1:4173 and `node tools/check.cjs` for translation parity, routes and mocked edge checks. The latter uses the existing sibling project's TypeScript installation to check the Edge Function.

## Backend

`backend/security.sql` records the additive upgrade over the existing schema. The remote upgrade was applied through separate Supabase migrations. Do not rerun it blindly. It closes direct client INSERT access, retains administrator-only editing and creates service-only CAPTCHA RPCs. CAPTCHA challenges are bound to the authenticated UID, expire after five minutes, allow one attempt, and are consumed atomically. Limits: 10 challenges and 3 accepted submissions per user per ten minutes. This is basic image-based spam protection, not a managed, risk-scored bot defense. Expired challenge records should be cleaned up by a future scheduled retention job.

`backend/noliz-submit.ts` is deployed as `noliz-submit`. Gateway JWT verification is disabled because the handler independently validates EVERY request against Supabase Auth `/user`, including confirmed email, before accessing backend-only RPCs. Secret keys are read only from the function runtime. Never add them to client code or this repository.

The existing project settings currently enable email/password registration with automatic confirmation. This upgrade does not change those settings or introduce email OTP. General account email ownership is therefore not verified by mail; administrator access remains bound to the previously verified immutable owner UID. Future email confirmation and password recovery require a configured email delivery provider. The current account password form verifies the current password before updating it.

Payments remain disabled. The planned featured placement is CNY 19.90/month; no personal QR code, automatic charge, or renewal is enabled.

Interface strings are keyed in `assets/i18n.js` with matching Chinese, English and Japanese keys. Contributor-authored content is preserved in its original language. Keep `CNAME` unchanged when publishing unless the domain change is explicitly requested.

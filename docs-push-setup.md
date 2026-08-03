# SB Racing — Full iOS Push Setup

## A. Apple Developer

1. developer.apple.com → **Certificates, Identifiers & Profiles**
2. **Identifiers** → your App ID `ca.sbracing.app` → enable **Push Notifications** → Save
3. **Keys** → **+** → name `SB Racing APNs` → enable **Apple Push Notifications service (APNs)** → Continue → Register
4. **Download** the `.p8` file once. Note **Key ID** and your **Team ID** (top right membership).

## B. Xcode

1. Open `ios/App/App.xcworkspace`
2. App target → **Signing & Capabilities** → use your **paid** team
3. **+ Capability** → **Push Notifications**
4. **+ Capability** → **Background Modes** → check **Remote notifications**
5. Bundle ID must match `ca.sbracing.app` (or whatever you used)

## C. npm

```bash
npm install @capacitor/push-notifications
npm run build
npx cap sync
```

Run the app from Xcode on a **real iPhone** (push does not work well on simulator for production APNs).

## D. Supabase SQL

Run `supabase/push_tokens.sql` in the SQL editor.

## E. Edge function secrets

```bash
# install CLI if needed: npm i -g supabase
supabase login
supabase link --project-ref vuqwfpwtwacwvaofqjdp

# Paste full PEM including BEGIN/END lines
supabase secrets set APNS_KEY_ID=your_key_id
supabase secrets set APNS_TEAM_ID=your_team_id
supabase secrets set APNS_BUNDLE_ID=ca.sbracing.app
supabase secrets set APNS_P8="$(cat AuthKey_XXXXXXXX.p8)"
# false while testing with Xcode debug builds; true for TestFlight/App Store
supabase secrets set APNS_PRODUCTION=false

supabase functions deploy notify-event
```

## F. Test

1. Install app on iPhone, allow notifications, open once while logged in (saves token)
2. Confirm a row in `push_tokens`
3. Add a new event → all saved iOS tokens should get a push

## Troubleshooting

- No token in table: permission denied, or Push capability missing, or not a physical device
- 403 from APNs: wrong key/team/bundle, or sandbox vs production mismatch (`APNS_PRODUCTION`)
- 410 Gone: token expired — delete that row; app will re-register on next open

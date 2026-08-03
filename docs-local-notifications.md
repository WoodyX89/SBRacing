# Local notifications (Capacitor)

## Install plugin (on your Mac, in SoggyBottomRacing)

```bash
npm install @capacitor/local-notifications
npx cap sync
```

## iOS permission string

In Xcode → App target → Info → Custom iOS Target Properties  
Add **Privacy — User Notifications Usage Description** (or in Info.plist):

```xml
<key>NSUserNotificationsUsageDescription</key>
<string>SB Racing notifies you when new club events are added.</string>
```

## Rebuild onto phone

```bash
npm run build
npx cap sync
# then Run in Xcode
```

## What works without paid Apple Developer account

- **Local** notifications on *this* phone (when you add an event, or while the app is open and polls for new events).
- **Not** silent background push to all members — that needs Apple Developer + APNs (or OneSignal with native setup).

## Files

- `js/native-notifications.js`
- Called from `js/events.js` after a new event insert

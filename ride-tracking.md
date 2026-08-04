# SB Racing — Offline + Background Ride Tracking

## What was added

- **`js/ride-tracker.js`** — offline-first ride engine
  - Records lat / lng / altitude / accuracy / timestamp
  - Distance, elevation gain/loss, elapsed + moving time
  - Persists active ride to `localStorage` (survives app kill)
  - Exports GeoJSON + GPX
  - Provider stack:
    1. `@capgo/background-geolocation` (true background, App Store ready)
    2. `@capacitor/geolocation` (native permissions)
    3. Browser `watchPosition` (web fallback)

- **Trails page UI** — Start / Pause / Stop / Follow / Save / Export GPX
- Live orange track on the map + “You” marker

## Install (on your Mac, in the project root)

```bash
npm install @capgo/background-geolocation @capacitor/geolocation
npm run build
npx cap sync
```

Then open the native projects and apply the permission changes below.

---

## iOS (required for App Store)

### 1. Info.plist (`ios/App/App/Info.plist`)

Add these keys (keep existing `remote-notification`):

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>SB Racing uses your location to record your mountain bike rides, show you on the map, and calculate distance and elevation.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>SB Racing continues recording your ride in the background so your full track, distance, and elevation are saved even when the screen is locked.</string>

<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>remote-notification</string>
</array>
```

### 2. Xcode capabilities

- App target → **Signing & Capabilities**
- Add **Background Modes** → check **Location updates**
- (Optional but recommended) **Push Notifications** if you already use them

### 3. App Store review notes (paste in App Review Information)

> Location is only used after the rider explicitly taps **Start ride**. Tracking continues in the background solely to record the mountain-bike activity (distance, time, elevation). A clear **Stop** control is always available. Data stays on device until the user chooses to save the ride to their account.

---

## Android

### 1. `android/app/src/main/AndroidManifest.xml`

Inside `<manifest>` (alongside existing permissions):

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

The Capgo plugin adds its own foreground-service declaration when you `cap sync`.

### 2. Runtime flow (already handled in JS)

- When the user taps **Start ride**, the plugin requests location (and notification) permissions.
- Android 10+ will show a second dialog for “Allow all the time” if background is needed.
- A persistent notification (“Ride in progress”) stays visible while recording — required by Google.

---

## capacitor.config.json (optional tweak)

```json
{
  "appId": "ca.sbracing.app",
  "appName": "Soggy Bottom Racing",
  "webDir": "dist",
  "android": {
    "useLegacyBridge": true
  },
  "plugins": {
    "SplashScreen": { ... }
  }
}
```

`useLegacyBridge: true` is recommended by Capgo for reliable background callbacks on Android.

---

## How the rider uses it

1. Open **Trails**
2. Tap **Start ride**
3. Ride (screen can lock / switch apps on native)
4. **Pause** if needed, **Stop** when done
5. **Save ride** (logged-in) or **Export GPX** or **Use track as route**

Interrupted rides are recovered from local storage on next open of Trails.

---

## Accuracy notes

- Points closer than ~4 m are ignored (reduces GPS jitter)
- Elevation changes under ~2.5 m are ignored (GPS altitude is noisy)
- Points with accuracy worse than 45 m are dropped
- Moving time only counts segments where speed ≥ ~1.2 km/h

For even better elevation later you can snap the track to a DEM; GPS altitude is good enough for club-level stats.

---

## Testing checklist

| Scenario | Expected |
|----------|----------|
| Browser HTTPS | Track while tab is open |
| iPhone, screen locked | Continues (Capgo + Background Modes) |
| Android, app in background | Continues + persistent notification |
| Kill app mid-ride | Reopen Trails → recovered points |
| Deny location permission | Toast, no crash |
| Save while logged out | Prompt to log in |
| Export GPX | Downloads valid `.gpx` |

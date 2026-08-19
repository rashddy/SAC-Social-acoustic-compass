# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

This project targets **Expo SDK 54**.

## Two runtimes, and why it matters

| Runtime | Command | Bluetooth | Use it for |
| --- | --- | --- | --- |
| Expo Go | `npm start` | No | UI work and Demo Mode |
| Development build | `npm run build:dev` then `npm run start:dev-client` | Yes | Anything touching the wearables |

`react-native-ble-plx` is a native module, so `NativeModules.BlePlx` is always
`null` in Expo Go. `bleService.isSupported()` returns false there and every
screen falls back to Demo Mode. Do not try to make real BLE work in Expo Go.

For a panel demo with no laptop or Wi-Fi, build the standalone APK with
`npm run build:apk` — the JavaScript is bundled, so it needs no dev server.

## Architecture

- `src/services/bleService.ts` holds **one connection per role** in a
  `Map<DeviceRole, Connection>`, so `SAC-Necklace` and `SAC-Wristband` are
  connected at the same time. Never collapse this back to a single device.
- `src/services/db/` is one repository per ERD table. Screens should use the
  repositories; `dbService.ts` is a legacy facade kept for existing callers.
- `src/services/stt/` is the swappable speech-to-text seam. `SIMULATED` is the
  default; the Vosk and Whisper adapters are deliberate stubs until a native
  module and a trained model exist.
- Database schema must match section 4.7.3 of the capstone document. Changing a
  column means bumping `SCHEMA_VERSION` in `src/services/db/client.ts` and adding
  a migration.

## Conventions

- Every database call goes through `guard()` so a storage failure degrades to a
  fallback value instead of hanging a screen.
- Interactive targets are at least 48dp tall; the primary users rely on visual
  and haptic feedback.
- Run `npx tsc --noEmit` and `npx expo-doctor` before considering work done.

## Windows development note

If the phone cannot load the bundle, the cause is usually the Windows Firewall
scoping Node.js to the `Public` profile while the Wi-Fi network is `Private`. Run
`npm run fix:firewall` once (it self-elevates), or use `npm run start:tunnel`.

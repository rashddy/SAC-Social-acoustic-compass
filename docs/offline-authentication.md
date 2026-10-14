# Offline authentication

Social Acoustic Compass keeps accounts, sessions, and captions on this device. Sign-in is not a cloud identity. A forgotten password cannot be emailed, and the account cannot be restored on another phone.

## What each mechanism does

| Mechanism | What it protects | Where it lives |
| --- | --- | --- |
| Password hashing (Argon2id) | The password. The stored value cannot be reversed into the password or into the transcript key. | `tblUser.passwordHash` |
| Data encryption (AES-256-GCM) | Transcript text, session titles, and location tags. | `tblAcousticEvent.transcription`, session title and location columns |
| Key management | The random data-encryption key, wrapped by a password-derived key and a device key in the platform keystore. | Android Keystore / iOS Keychain through `expo-secure-store`. Not in SQLite, AsyncStorage, source, or env files. |

The Argon2id verifier is `SHA-256` of the Argon2 output. A separate HKDF step produces the wrapping key and is discarded after the data key is unwrapped. Logging in therefore checks the password and only then unlocks captions.

Work factors for new passwords: memory 256 KiB (`m=256`), 1 iteration, parallelism 1, 16-byte salt. Argon2id runs in JavaScript on the phone, so the cost stays low enough that sign-in returns as soon as the password is submitted. Each hash still has its own salt. A password saved with the earlier 19 MiB settings is not checked on the phone, because that check freezes the app. Erase that account from the sign-in screen and create it again.

## Account flow

1. First launch explains the compass, then asks for a username and a password of at least 10 characters. The sign-in screen can switch to **Create a new account**, so more than one person can use this phone. Each account keeps its own password, conversations, and settings.
2. The app generates a data key, wraps it, and stores only the hash, the wrapped key, and the username.
3. Later launches start locked. A process restart does not restore the session.
4. Five wrong attempts start a lockout (30 seconds, doubling up to 15 minutes). Earlier misses add a short delay. Both are stored in `tblUser`, so restarting the app does not reset them.
5. Errors say “Incorrect username or password.” They do not say whether the username exists.
6. After 5 minutes without interaction, or 5 minutes in the background, the session locks and captions are cleared from memory. Direction updates from the wearable can continue; caption text is not recorded while locked.
7. Log out does the same clear. Saved rows stay encrypted.
8. Deleting a session or all saved sessions asks for the password again if the last password or biometric unlock was more than 2 minutes ago.
9. There is one local role, `user`. The app does not grant an administrator role, including if that value is written into the database.

## Recovery

There is no email or cross-device recovery. On the sign-in screen, “Forgot password?” explains that, then offers **Erase local account**. Enter that account’s username and the confirmation word `ERASE`. That deletes only that account and its saved conversations. Other accounts on the phone stay. If that was the last account, the device key is removed too.

If the device key in the keystore is missing or the wrapped key is corrupt, sign-in fails with “Saved data could not be unlocked. Encryption is still on.” The app does not fall back to plaintext.

## Biometrics

Fingerprint or face unlock is optional and is offered only after a password account exists. Turning it on stores the data key in the platform keystore with `requireAuthentication` and stores a tag of that key in SQLite. A canceled or failed prompt does not open the app. The prompt is not a substitute for the password during account creation. Password sign-in remains available.

## Database migration (schema version 3)

Existing installs gain:

- `passwordHash`, `wrappedDek`, `failedAttempts`, `lockedUntil`, `biometricEnabled`, `biometricCheck`, `role` on `tblUser`
- `tblSecurityAudit` (`eventType`, `createdAt` only)

`pinCode` remains because the capstone ERD includes it, and it is cleared. A previous 4-digit PIN no longer signs anyone in; that person creates a password on next launch. Plaintext captions already in the database are encrypted on the first successful sign-in and are not shown before that.

Rollback: installing an older build against this database will show ciphertext in history, because those builds expect plaintext. Restore a database file taken before the upgrade if you need the old build to read old captions. The migration does not delete session rows.

Android Auto Backup is turned off (`allowBackup: false`), and the secure-store plugin excludes keystore items from backup rules.

## Audit

`tblSecurityAudit` records event type and time for sign-in success and failure, lockout, logout, expiry, background lock, deletion, biometric changes, password changes, key failure, and erasure. It does not record passwords, biometrics, audio, or caption text. Rows older than 30 days are removed, and only the latest 200 are kept.

## Platform limits

| Runtime | Password sign-in | Keystore | Biometrics | Bluetooth |
| --- | --- | --- | --- | --- |
| Expo Go on a phone | Yes | Yes (`expo-secure-store` is in Expo Go) | Unreliable. `requireAuthentication` is not supported in Expo Go when biometrics exist. Use the password. | No |
| Development build already on the phone | Yes. Captions stay encrypted with the password. | After the next `npm run build:dev` | After that same rebuild, on a device with a fingerprint or face enrolled | Yes |
| New development build | Yes | Yes | Yes, when a fingerprint or face is enrolled | Yes |
| Web | No. Secure storage is unavailable, and the app will not store the key in the browser. | No | No | No |

The current dev client can sign in without a rebuild. It does not contain `expo-secure-store` or `expo-local-authentication`, so the data key is wrapped with the password only, and fingerprint unlock stays off. `npm run build:dev` adds the hardware keystore and biometric unlock. A copied database from a password-only install can be decrypted with that password; the keystore build adds a device key so the database is not enough on its own.

## Tests

`npm run test:security` runs the offline cases (correct and wrong password, no plaintext password, lockout across a new controller, logout, inactivity, background lock, restart, biometric cancellation, unauthorized deletes, ciphertext inspection, missing keys, and no network calls).

`node --experimental-sqlite scripts/verify-schema.mjs` checks the SQL tables, including the password-hash column.

## Manual checklist

- Create an account, force-stop the app, and confirm it asks for the password again.
- Enter the wrong password four times and confirm the next tries wait. Enter it a fifth time and confirm the lockout survives a force-stop.
- Confirm the error text does not reveal whether the username exists.
- Sign in, leave the phone idle for 5 minutes, and confirm the lock screen returns and live captions are gone.
- Send the app to the background for 5 minutes and confirm the same lock.
- Log out and confirm History does not list captions until sign-in.
- Delete one session and “Clear All Data” after the 2-minute window and confirm the password is required.
- Turn on biometric unlock, cancel the prompt, and confirm the app stays locked. Then unlock with the password.
- Forget the password and confirm the only offered recovery is erasing local data, not email.
- With the compass connected, confirm direction still updates after sign-in, and that a connected wearable does not skip the lock screen.
- Inspect `sac_compass.db` and confirm transcript columns start with `sac1:` and do not contain the spoken words.

import { PermissionsAndroid, Platform } from 'react-native';

type AndroidPermission = Parameters<typeof PermissionsAndroid.check>[0];

export type BlePermissionResult = {
  granted: boolean;
  /** Set when the user chose "Don't ask again"; the app must send them to Settings. */
  blockedPermanently: boolean;
  missing: AndroidPermission[];
};

const ANDROID_12_API_LEVEL = 31;

/**
 * Android 12 (API 31) replaced the location-based Bluetooth permissions with
 * BLUETOOTH_SCAN / BLUETOOTH_CONNECT. Older devices still gate scanning behind
 * fine location, so the required set depends on the OS version.
 */
const requiredAndroidPermissions = (): AndroidPermission[] => {
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);

  if (apiLevel >= ANDROID_12_API_LEVEL) {
    return [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ];
  }

  return [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
};

export const requestBlePermissions = async (): Promise<BlePermissionResult> => {
  if (Platform.OS !== 'android') {
    // iOS surfaces Bluetooth consent through Info.plist on first manager use.
    return { granted: true, blockedPermanently: false, missing: [] };
  }

  const required = requiredAndroidPermissions();

  try {
    const results: Record<string, string> = await PermissionsAndroid.requestMultiple(required);
    const missing = required.filter(
      (permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED,
    );
    const blockedPermanently = required.some(
      (permission) => results[permission] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
    );

    return { granted: missing.length === 0, blockedPermanently, missing };
  } catch (error) {
    console.warn('[blePermissions] request failed', error);
    return { granted: false, blockedPermanently: false, missing: required };
  }
};

export const hasBlePermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;

  try {
    const checks = await Promise.all(
      requiredAndroidPermissions().map((permission) => PermissionsAndroid.check(permission)),
    );
    return checks.every(Boolean);
  } catch {
    return false;
  }
};

export type BiometricAvailability = {
  available: boolean;
  label: string;
};

/**
 * Hardware support only. A successful check here does not authenticate the
 * account; the caller still has to read a key that was stored after a password
 * login.
 */
export async function biometricAvailability(): Promise<BiometricAvailability> {
  try {
    const LocalAuthentication = await import('expo-local-authentication');
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!hardware) return { available: false, label: 'This device has no fingerprint or face sensor.' };
    if (!enrolled) {
      return { available: false, label: 'Enroll a fingerprint or face in the device settings first.' };
    }
    return { available: true, label: 'Fingerprint or face unlock' };
  } catch {
    return { available: false, label: 'Biometric unlock is unavailable on this device.' };
  }
}

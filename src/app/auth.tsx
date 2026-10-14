import '@/services/auth/installRandomValues';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SACButton } from '@/components/SACButton';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { authService } from '@/services/auth/authService';
import { biometricAvailability } from '@/services/auth/biometrics';
import { validateNewPassword } from '@/services/auth/password';

type Screen = 'setup' | 'login' | 'reauth' | 'password';

function safeRedirect(value: string | undefined): '/(tabs)/home' | '/pair' {
  return value === '/pair' ? '/pair' : '/(tabs)/home';
}

export default function AuthScreen() {
  const params = useLocalSearchParams<{ mode?: string; redirect?: string }>();
  const [screen, setScreen] = useState<Screen>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'submit' | 'biometric' | 'erase' | null>(null);
  const [biometricReady, setBiometricReady] = useState(false);
  const [eraseConfirm, setEraseConfirm] = useState('');
  const [showErase, setShowErase] = useState(false);
  const settled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const prepare = async () => {
      if (params.mode === 'reauth') {
        if (!cancelled) setScreen('reauth');
        return;
      }
      if (params.mode === 'password') {
        if (!cancelled) setScreen('password');
        return;
      }
      const exists = await authService.hasAccount();
      if (!cancelled) setScreen(exists ? 'login' : 'setup');
      if (exists) {
        const hardware = await biometricAvailability();
        if (!cancelled) setBiometricReady(hardware.available);
      }
    };
    prepare().catch(() => {
      if (!cancelled) setError('Could not open the lock screen. Try again.');
    });
    return () => {
      cancelled = true;
      if (params.mode === 'reauth' && !settled.current) authService.completeReauth(false);
    };
  }, [params.mode]);

  const leave = (target?: '/(tabs)/home' | '/pair') => {
    settled.current = true;
    if (params.mode === 'reauth' || params.mode === 'password') {
      if (params.mode === 'reauth') authService.completeReauth(true);
      router.back();
      return;
    }
    router.replace(target ?? safeRedirect(params.redirect));
  };

  const submitSetup = async () => {
    if (password !== confirm) {
      setError('Those passwords do not match.');
      setPassword('');
      setConfirm('');
      return;
    }
    setPending('submit');
    setError(null);
    await paintLoading();
    let result;
    try {
      result = await authService.createAccount(username, password);
    } finally {
      setPending(null);
    }
    setPassword('');
    setConfirm('');
    if (!result.ok) {
      setError(result.message ?? 'Could not create the account.');
      return;
    }
    leave();
  };

  const submitLogin = async () => {
    setPending('submit');
    setError(null);
    await paintLoading();
    let result;
    try {
      result = await authService.login(username, password);
    } catch {
      setError('Could not sign in. Try again.');
      return;
    } finally {
      setPending(null);
    }
    setPassword('');
    if (!result?.ok) {
      setError(result.message ?? 'Incorrect username or password.');
      return;
    }
    leave();
  };

  const submitReauth = async () => {
    setPending('submit');
    setError(null);
    await paintLoading();
    let result;
    try {
      result = await authService.confirmPassword(password);
    } finally {
      setPending(null);
    }
    setPassword('');
    if (!result.ok) {
      setError(result.message ?? 'Incorrect username or password.');
      if (result.locked) {
        settled.current = true;
        authService.completeReauth(false);
        router.replace('/auth');
      }
      return;
    }
    leave();
  };

  const submitPasswordChange = async () => {
    if (nextPassword !== confirm) {
      setError('Those passwords do not match.');
      setNextPassword('');
      setConfirm('');
      return;
    }
    setPending('submit');
    setError(null);
    await paintLoading();
    let result;
    try {
      result = await authService.changePassword(password, nextPassword);
    } finally {
      setPending(null);
    }
    setPassword('');
    setNextPassword('');
    setConfirm('');
    if (!result.ok) {
      setError(result.message ?? 'Could not change the password.');
      return;
    }
    settled.current = true;
    router.back();
  };

  const submitBiometric = async () => {
    if (!username.trim()) {
      setError('Enter your username, then use fingerprint or face.');
      return;
    }
    setPending('biometric');
    setError(null);
    await paintLoading();
    let result;
    try {
      result = await authService.unlockWithBiometric(username);
    } finally {
      setPending(null);
    }
    if (!result.ok) {
      setError(result.message ?? 'Biometric unlock was canceled.');
      return;
    }
    leave();
  };

  const erase = async () => {
    if (!username.trim()) {
      setError('Enter the username of the account to erase.');
      return;
    }
    if (eraseConfirm !== 'ERASE') {
      setError('Type ERASE to delete this account.');
      return;
    }
    setPending('erase');
    let result;
    try {
      result = await authService.eraseDevice(username);
    } finally {
      setPending(null);
    }
    setEraseConfirm('');
    if (!result.ok) {
      setError(result.message ?? 'Could not erase this device.');
      return;
    }
    setShowErase(false);
    setScreen('setup');
    setUsername('');
    setPassword('');
  };

  const busy = pending != null;
  const creating = screen === 'setup' || screen === 'password';
  const candidate = screen === 'password' ? nextPassword : password;
  const suitability = creating ? passwordSuitability(candidate, confirm) : null;

  const heading =
    screen === 'setup'
      ? 'Create your account'
      : screen === 'password'
        ? 'Change password'
        : screen === 'reauth'
          ? 'Confirm it is you'
          : 'Sign in';

  const caption =
    screen === 'setup'
      ? 'This password stays on this phone. There is no email reset and no cloud account.'
      : screen === 'login'
        ? 'Sign in with your account. Someone else on this phone can create their own.'
        : 'Enter your password to continue.';

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Ionicons name="lock-closed" size={36} color={Colors.primary} />
            <Text style={styles.title}>{heading}</Text>
            <Text style={styles.caption}>{caption}</Text>
          </View>

          {screen !== 'reauth' && screen !== 'password' ? (
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoComplete="username"
              textContentType="username"
            />
          ) : null}

          <Field
            label={screen === 'password' ? 'Current password' : 'Password'}
            value={password}
            onChangeText={setPassword}
            secure
            autoComplete={screen === 'setup' ? 'new-password' : 'current-password'}
            textContentType={screen === 'setup' ? 'newPassword' : 'password'}
          />

          {screen === 'setup' || screen === 'password' ? (
            <Field
              label={screen === 'password' ? 'New password' : 'Confirm password'}
              value={screen === 'password' ? nextPassword : confirm}
              onChangeText={screen === 'password' ? setNextPassword : setConfirm}
              secure
              autoComplete="new-password"
              textContentType="newPassword"
            />
          ) : null}

          {screen === 'password' ? (
            <Field
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              secure
              autoComplete="new-password"
              textContentType="newPassword"
            />
          ) : null}

          {suitability ? (
            <Text
              style={[
                styles.suitability,
                suitability.tone === 'ok' && styles.suitabilityOk,
                suitability.tone === 'warn' && styles.suitabilityWarn,
              ]}>
              {suitability.text}
            </Text>
          ) : null}

          <Text style={styles.error}>{error ?? ' '}</Text>

          <SACButton
            title={
              pending === 'submit'
                ? screen === 'setup'
                  ? 'Creating account…'
                  : screen === 'password'
                    ? 'Saving password…'
                    : 'Signing in…'
                : screen === 'setup'
                  ? 'Create account'
                  : screen === 'password'
                    ? 'Save password'
                    : 'Continue'
            }
            loading={pending === 'submit'}
            onPress={() => {
              if (screen === 'setup') void submitSetup();
              else if (screen === 'login') void submitLogin();
              else if (screen === 'reauth') void submitReauth();
              else void submitPasswordChange();
            }}
            disabled={busy || (suitability != null && suitability.tone !== 'ok')}
          />

          {screen === 'login' || screen === 'setup' ? (
            <SACButton
              title={screen === 'login' ? 'Create a new account' : 'Sign in instead'}
              onPress={() => {
                setError(null);
                setPassword('');
                setConfirm('');
                setScreen(screen === 'login' ? 'setup' : 'login');
              }}
              variant="ghost"
              disabled={busy}
            />
          ) : null}

          {screen === 'login' && biometricReady ? (
            <SACButton
              title={pending === 'biometric' ? 'Checking…' : 'Unlock with fingerprint or face'}
              onPress={() => void submitBiometric()}
              variant="secondary"
              icon="finger-print"
              loading={pending === 'biometric'}
              disabled={busy}
            />
          ) : null}

          {screen === 'login' ? (
            <SACButton
              title={showErase ? 'Hide erase option' : 'Forgot password?'}
              onPress={() => setShowErase((value) => !value)}
              variant="ghost"
              disabled={busy}
            />
          ) : null}

          {screen === 'login' && showErase ? (
            <View style={styles.eraseBox}>
              <Text style={styles.eraseCopy}>
                There is no remote recovery. Erasing removes the username above and that
                account’s saved conversations. Other accounts on this phone stay. Type ERASE to confirm.
              </Text>
              <Field
                label="Confirmation"
                value={eraseConfirm}
                onChangeText={setEraseConfirm}
                autoCapitalize="characters"
                autoComplete="off"
              />
              <SACButton
                title={pending === 'erase' ? 'Erasing…' : 'Erase local account'}
                onPress={() => void erase()}
                variant="secondary"
                loading={pending === 'erase'}
                disabled={busy}
              />
            </View>
          ) : null}

          {params.mode === 'reauth' || params.mode === 'password' ? (
            <SACButton
              title="Cancel"
              onPress={() => {
                settled.current = true;
                if (params.mode === 'reauth') authService.completeReauth(false);
                router.back();
              }}
              variant="ghost"
              disabled={busy}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function paintLoading(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function passwordSuitability(
  password: string,
  confirmValue: string,
): { text: string; tone: 'idle' | 'warn' | 'ok' } {
  if (!password) {
    return { text: 'At least 10 characters.', tone: 'idle' };
  }
  const issue = validateNewPassword(password);
  if (issue) return { text: `Not suitable. ${issue}`, tone: 'warn' };
  if (!confirmValue) return { text: 'Suitable. Enter it again to confirm.', tone: 'warn' };
  if (password !== confirmValue) {
    return { text: 'Not suitable yet. The two passwords do not match.', tone: 'warn' };
  }
  return { text: 'Suitable.', tone: 'ok' };
}

function Field({
  label,
  value,
  onChangeText,
  secure,
  autoCapitalize,
  autoComplete,
  textContentType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secure?: boolean;
  autoCapitalize?: 'none' | 'characters';
  autoComplete?: 'username' | 'current-password' | 'new-password' | 'off';
  textContentType?: 'username' | 'password' | 'newPassword';
}) {
  const [hidden, setHidden] = useState(true);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure ? hidden : false}
          autoCapitalize={autoCapitalize ?? 'none'}
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={textContentType}
          placeholderTextColor={Colors.textSecondary}
          style={styles.input}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            onPress={() => setHidden((current) => !current)}
            style={styles.eye}>
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={22}
              color={Colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    gap: 12,
  },
  header: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: Colors.textPrimary,
  },
  caption: {
    fontFamily: Fonts.labelRegular,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  field: {
    gap: 6,
  },
  label: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  inputRow: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 48,
    color: Colors.textPrimary,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: Fonts.body,
  },
  eye: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suitability: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  suitabilityOk: {
    color: Colors.success,
  },
  suitabilityWarn: {
    color: Colors.warning,
  },
  error: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.disconnected,
    textAlign: 'center',
    minHeight: 20,
  },
  eraseBox: {
    gap: 12,
    marginTop: 8,
  },
  eraseCopy: {
    fontFamily: Fonts.labelRegular,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});

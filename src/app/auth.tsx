import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SACButton } from '@/components/SACButton';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { userRepo } from '@/services/db';

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

type Stage = 'ENTER' | 'CREATE' | 'CONFIRM';

/**
 * Local PIN gate (Functional Requirement A). The PIN never leaves the device: it
 * is salted and hashed into tblUser.pinCode, so a stolen database file does not
 * reveal it.
 */
export default function AuthScreen() {
  const params = useLocalSearchParams<{ mode?: string; redirect?: string }>();
  const isSetupFlow = params.mode === 'setup';

  const [stage, setStage] = useState<Stage>(isSetupFlow ? 'CREATE' : 'ENTER');
  const [pin, setPin] = useState('');
  const [firstEntry, setFirstEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isSetupFlow) return;
    userRepo.hasPin().then((exists) => {
      if (!exists) setStage('CREATE');
    });
  }, [isSetupFlow]);

  const leave = useCallback(() => {
    if (isSetupFlow) {
      router.back();
      return;
    }
    const redirect = params.redirect;
    router.replace(redirect ? (redirect as never) : '/(tabs)/home');
  }, [isSetupFlow, params.redirect]);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);

      if (stage === 'ENTER') {
        const ok = await userRepo.verifyPin(value);
        setBusy(false);
        if (!ok) {
          setError('Incorrect PIN. Try again.');
          setPin('');
          return;
        }
        leave();
        return;
      }

      if (stage === 'CREATE') {
        setBusy(false);
        setFirstEntry(value);
        setPin('');
        setStage('CONFIRM');
        return;
      }

      if (value !== firstEntry) {
        setBusy(false);
        setError('The PINs did not match. Start again.');
        setPin('');
        setFirstEntry('');
        setStage('CREATE');
        return;
      }

      const saved = await userRepo.setPin(value);
      setBusy(false);
      if (!saved) {
        setError('Could not save your PIN. Try once more.');
        setPin('');
        return;
      }
      leave();
    },
    [firstEntry, leave, stage],
  );

  const press = (key: string) => {
    if (busy) return;
    setError(null);

    if (key === 'del') {
      setPin((prev) => prev.slice(0, -1));
      return;
    }
    if (!key || pin.length >= PIN_LENGTH) return;

    const next = pin + key;
    setPin(next);
    if (next.length === PIN_LENGTH) submit(next);
  };

  const heading =
    stage === 'ENTER'
      ? 'Enter your PIN'
      : stage === 'CREATE'
        ? 'Create a PIN'
        : 'Confirm your PIN';

  const caption =
    stage === 'ENTER'
      ? 'Your conversation logs stay on this device.'
      : stage === 'CREATE'
        ? `Choose ${PIN_LENGTH} digits to protect your saved conversations.`
        : 'Enter the same digits once more.';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="lock-closed" size={40} color={Colors.primary} />
        <Text style={styles.title}>{heading}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>

      <View style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
        ))}
      </View>

      <Text style={styles.error}>{error ?? ' '}</Text>

      <View style={styles.keypad}>
        {KEYS.map((key, index) => (
          <Pressable
            key={`${key}-${index}`}
            onPress={() => press(key)}
            disabled={!key}
            style={({ pressed }) => [
              styles.key,
              !key && styles.keyEmpty,
              pressed && key ? styles.keyPressed : null,
            ]}>
            {key === 'del' ? (
              <Ionicons name="backspace-outline" size={24} color={Colors.textPrimary} />
            ) : (
              <Text style={styles.keyText}>{key}</Text>
            )}
          </Pressable>
        ))}
      </View>

      {isSetupFlow && (
        <SACButton title="Cancel" onPress={() => router.back()} variant="ghost" />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 8,
  },
  header: {
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: Colors.textPrimary,
  },
  caption: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 28,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  dotFilled: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  error: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.disconnected,
    textAlign: 'center',
    marginTop: 12,
    minHeight: 20,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  key: {
    width: '30%',
    minHeight: 64,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyEmpty: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  keyPressed: {
    backgroundColor: `${Colors.primary}22`,
    borderColor: Colors.primary,
  },
  keyText: {
    fontFamily: Fonts.displayMedium,
    fontSize: 24,
    color: Colors.textPrimary,
  },
});

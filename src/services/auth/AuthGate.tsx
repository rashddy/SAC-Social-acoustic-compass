import { usePathname, useRouter, useSegments } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/colors';
import { authService } from './authService';

const PUBLIC = new Set(['index', 'auth']);

function isProtected(segment: string | undefined): boolean {
  if (!segment) return false;
  return !PUBLIC.has(segment);
}

/**
 * Sends locked users to the login screen and covers protected UI immediately,
 * including the frame before navigation finishes.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const [unlocked, setUnlocked] = useState(authService.isUnlocked());

  useEffect(() => {
    const refresh = () => setUnlocked(authService.isUnlocked());
    const timer = setInterval(() => {
      if (authService.expireIfIdle()) refresh();
    }, 5000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') authService.noteAppState('background');
      if (next === 'active') {
        authService.noteAppState('active');
        refresh();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    setUnlocked(authService.isUnlocked());
  }, [pathname]);

  const top = segments[0];
  const blocked = !unlocked && isProtected(top);

  useEffect(() => {
    if (!blocked) return;
    router.replace('/auth');
  }, [blocked, router]);

  return (
    <View
      style={styles.fill}
      onStartShouldSetResponderCapture={() => {
        authService.touch();
        return false;
      }}>
      {children}
      {blocked ? <View style={styles.cover} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.background,
  },
});

import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/colors';
import { settingsService } from '@/services/settingsService';

// Fonts are a nice-to-have: the app must render even if they never arrive.
const FONT_TIMEOUT_MS = 6000;

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [fontsTimedOut, setFontsTimedOut] = useState(false);

  const ready = fontsLoaded || fontError != null || fontsTimedOut;

  // Hand off to JS rendering right away so a stalled asset download can never
  // leave the user staring at a frozen native splash screen.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Restore saved preferences before the first screen paints; a failure here is
  // non-fatal because every repository falls back to defaults.
  useEffect(() => {
    settingsService.hydrate().catch(() => {});
  }, []);

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setFontsTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready) {
    return (
      <View style={styles.fallback}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.fallbackText}>Loading Social Acoustic Compass…</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'fade',
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
        <Stack.Screen name="pair" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="diagnostics" />
        <Stack.Screen name="session/[id]" options={{ presentation: 'modal' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
      <Pressable style={styles.retryButton} onPress={() => retry()}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  fallback: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  fallbackText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.background,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { dbService } from '@/services/dbService';
import type { TranscriptEntry } from '@/store/compassStore';
import { useCompassStore } from '@/store/compassStore';

/** Icon + label, before the system navigation or home-indicator inset. */
const TAB_CONTENT_HEIGHT = 56;

/** Quiet time after the last speech before the chat is filed into History. */
const CONVO_END_MS = 8000;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom;
  const audioState = useCompassStore((s) => s.audioState);
  const logCount = useCompassStore((s) => s.sessionLog.length);
  const replyCount = useCompassStore((s) => s.replies?.length ?? 0);
  const streamingWord = useCompassStore((s) => s.streamingWord);
  const filing = useRef(false);

  useEffect(() => {
    const quiet =
      (audioState === 'SILENCE' || audioState === 'NOISE') && !streamingWord.trim();
    if (logCount === 0 || !quiet || filing.current) return;

    const timer = setTimeout(() => {
      const state = useCompassStore.getState();
      const stillQuiet =
        (state.audioState === 'SILENCE' || state.audioState === 'NOISE') &&
        !state.streamingWord.trim();
      if (!stillQuiet || state.sessionLog.length === 0 || filing.current) return;

      filing.current = true;
      const replies = (state.replies ?? []).map(
        (reply): TranscriptEntry => ({
          id: reply.id,
          text: reply.text,
          doa: 0,
          direction: 'You',
          speakerId: 0,
          audioState: 'SINGLE',
          emotion: 'NEUTRAL',
          confidence: 1,
          speakerCount: 1,
          timestamp: reply.timestamp,
        }),
      );
      const entries = [...state.sessionLog, ...replies].sort(
        (a, b) => a.timestamp - b.timestamp,
      );

      void dbService.saveSession(entries).then((id) => {
        if (!id) return;
        useCompassStore.getState().clearSessionLog();
        router.navigate('/(tabs)/history');
      }).finally(() => {
        filing.current = false;
      });
    }, CONVO_END_MS);

    return () => clearTimeout(timer);
  }, [audioState, logCount, replyCount, streamingWord]);

  return (
    <Tabs
      safeAreaInsets={{ top: insets.top, right: insets.right, bottom: 0, left: insets.left }}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: TAB_CONTENT_HEIGHT + bottomInset,
          paddingTop: 6,
          paddingBottom: bottomInset,
          elevation: 0,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Compass',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'compass' : 'compass-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="transcription"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'time' : 'time-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="wristband"
        options={{
          title: 'Vest',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'shirt' : 'shirt-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabLabel: {
    fontFamily: Fonts.label,
    fontSize: 11,
  },
  tabItem: {
    minHeight: 48,
  },
});

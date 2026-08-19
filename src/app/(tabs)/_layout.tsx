import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
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
              style={focused ? styles.glow : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="transcription"
        options={{
          title: 'Transcript',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'document-text' : 'document-text-outline'}
              size={24}
              color={color}
              style={focused ? styles.glow : undefined}
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
              style={focused ? styles.glow : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="wristband"
        options={{
          title: 'Wristband',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'watch' : 'watch-outline'}
              size={24}
              color={color}
              style={focused ? styles.glow : undefined}
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
              style={focused ? styles.glow : undefined}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 88 : 68,
    paddingTop: 8,
    elevation: 0,
  },
  tabLabel: {
    fontFamily: Fonts.label,
    fontSize: 11,
    marginBottom: Platform.OS === 'ios' ? 0 : 8,
  },
  tabItem: {
    minHeight: 48,
  },
  glow: {
    shadowColor: Colors.primary,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});

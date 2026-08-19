import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmotionBadge } from '@/components/EmotionBadge';
import { SACButton } from '@/components/SACButton';
import { WristbandDiagram } from '@/components/WristbandDiagram';
import { WRISTBAND_COMMANDS } from '@/constants/bleConstants';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { bleService } from '@/services/bleService';
import { settingsService } from '@/services/settingsService';
import type { WristbandIntensity, WristbandPattern } from '@/store/compassStore';
import { toCardinalMotor } from '@/utils/direction';
import { intensityForEmotion } from '@/utils/haptics';
import { useCompassStore } from '@/store/compassStore';

const INTENSITIES: WristbandIntensity[] = ['LOW', 'MEDIUM', 'HIGH'];
const PATTERNS: WristbandPattern[] = ['PULSE', 'TAP', 'HOLD'];

export default function WristbandScreen() {
  const wristbandDirection = useCompassStore((s) => s.wristbandDirection);
  const wristbandFlash = useCompassStore((s) => s.wristbandFlash);
  const wristbandIntensity = useCompassStore((s) => s.wristbandIntensity);
  const wristbandPattern = useCompassStore((s) => s.wristbandPattern);
  const laughterMode = useCompassStore((s) => s.laughterMode);
  const emotion = useCompassStore((s) => s.emotion);
  const emotionConfidence = useCompassStore((s) => s.emotionConfidence);
  const wristbandLink = useCompassStore((s) => s.devices.WRISTBAND);
  const setWristbandIntensity = useCompassStore((s) => s.setWristbandIntensity);
  const setWristbandPattern = useCompassStore((s) => s.setWristbandPattern);
  const setLaughterMode = useCompassStore((s) => s.setLaughterMode);

  useEffect(() => {
    if (wristbandFlash) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [wristbandFlash]);

  const sendIntensity = (level: WristbandIntensity) => {
    setWristbandIntensity(level);
    bleService.sendWristbandCommand(WRISTBAND_COMMANDS.INTENSITY[level]);
    settingsService.persist();
  };

  const sendPattern = (pattern: WristbandPattern) => {
    setWristbandPattern(pattern);
    bleService.sendWristbandCommand(WRISTBAND_COMMANDS.PATTERN[pattern]);
    settingsService.persist();
  };

  const testVibration = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    bleService.sendWristbandCommand(WRISTBAND_COMMANDS.TEST);
  };

  const toggleLaughter = () => {
    const next = !laughterMode;
    setLaughterMode(next);
    bleService.sendWristbandCommand(WRISTBAND_COMMANDS.LAUGHTER_MODE, next ? 1 : 0);
    settingsService.persist();
  };

  const cardinalDir = toCardinalMotor(wristbandDirection);
  const effectiveIntensity = intensityForEmotion(wristbandIntensity, emotion);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Wristband Control</Text>
        <Text style={styles.subtitle}>Haptic feedback direction & patterns</Text>

        <View style={styles.linkRow}>
          <View
            style={[
              styles.linkDot,
              wristbandLink.status === 'CONNECTED' ? styles.linkDotOn : styles.linkDotOff,
            ]}
          />
          <Text style={styles.linkText}>
            {wristbandLink.status === 'CONNECTED'
              ? `${wristbandLink.name ?? 'SAC-Wristband'} connected${
                  wristbandLink.battery != null ? ` · ${wristbandLink.battery}%` : ''
                }`
              : 'SAC-Wristband not connected — changes are saved and applied on reconnect'}
          </Text>
        </View>

        <View style={styles.diagramSection}>
          <WristbandDiagram
            activeDirection={cardinalDir as 'N' | 'E' | 'S' | 'W' | null}
            flash={wristbandFlash}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Detected Emotion</Text>
          <View style={styles.emotionRow}>
            <EmotionBadge emotion={emotion} confidence={emotionConfidence} />
            <Text style={styles.emotionNote}>
              Vibrating at {effectiveIntensity.toLowerCase()} strength
              {effectiveIntensity !== wristbandIntensity ? ' (adjusted for emotion)' : ''}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Baseline Vibration Intensity</Text>
          <View style={styles.optionRow}>
            {INTENSITIES.map((level) => (
              <Pressable
                key={level}
                onPress={() => sendIntensity(level)}
                style={[
                  styles.option,
                  wristbandIntensity === level && styles.optionActive,
                ]}>
                <Text
                  style={[
                    styles.optionText,
                    wristbandIntensity === level && styles.optionTextActive,
                  ]}>
                  {level.charAt(0) + level.slice(1).toLowerCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Pattern</Text>
          <View style={styles.optionRow}>
            {PATTERNS.map((pattern) => (
              <Pressable
                key={pattern}
                onPress={() => sendPattern(pattern)}
                style={[
                  styles.option,
                  wristbandPattern === pattern && styles.optionActive,
                ]}>
                <Text
                  style={[
                    styles.optionText,
                    wristbandPattern === pattern && styles.optionTextActive,
                  ]}>
                  {pattern.charAt(0) + pattern.slice(1).toLowerCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Pressable
            onPress={toggleLaughter}
            style={[styles.toggleRow, laughterMode && styles.toggleRowActive]}>
            <View>
              <Text style={styles.toggleTitle}>Laughter Mode</Text>
              <Text style={styles.toggleSub}>
                Rolling wave pattern when laughter is detected
              </Text>
            </View>
            <View style={[styles.toggle, laughterMode && styles.toggleOn]}>
              <View style={[styles.toggleKnob, laughterMode && styles.toggleKnobOn]} />
            </View>
          </Pressable>
        </View>

        <SACButton title="Test Vibration" onPress={testVibration} icon="pulse" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    padding: 20,
    gap: 24,
    paddingBottom: 32,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: -16,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -8,
  },
  linkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  linkDotOn: {
    backgroundColor: Colors.connected,
  },
  linkDotOff: {
    backgroundColor: Colors.silence,
  },
  linkText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  emotionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  emotionNote: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  diagramSection: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  section: {
    gap: 12,
  },
  sectionLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  optionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  option: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionActive: {
    borderColor: Colors.primary,
    backgroundColor: `${Colors.primary}15`,
  },
  optionText: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  optionTextActive: {
    color: Colors.primary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    minHeight: 72,
  },
  toggleRowActive: {
    borderColor: Colors.warning,
  },
  toggleTitle: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  toggleSub: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    maxWidth: 240,
  },
  toggle: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.silence,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: `${Colors.warning}44`,
  },
  toggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.textSecondary,
  },
  toggleKnobOn: {
    backgroundColor: Colors.warning,
    alignSelf: 'flex-end',
  },
});

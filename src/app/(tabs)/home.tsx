import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioStateBadge } from '@/components/AudioStateBadge';
import { BLEStatusPill } from '@/components/BLEStatusPill';
import { EmotionBadge } from '@/components/EmotionBadge';
import { LiveTranscriptStrip } from '@/components/LiveTranscriptStrip';
import { RadarCompass } from '@/components/RadarCompass';
import { SystemBanners } from '@/components/SystemBanners';
import { WristbandDiagram } from '@/components/WristbandDiagram';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { hapticLabel } from '@/utils/haptics';
import { toCardinalMotor } from '@/utils/direction';
import { useCompassStore } from '@/store/compassStore';

export default function HomeScreen() {
  const audioState = useCompassStore((s) => s.audioState);
  const currentDoa = useCompassStore((s) => s.currentDoa);
  const speakerDots = useCompassStore((s) => s.speakerDots);
  const speakerCount = useCompassStore((s) => s.speakerCount);
  const confidence = useCompassStore((s) => s.confidence);
  const emotion = useCompassStore((s) => s.emotion);
  const emotionConfidence = useCompassStore((s) => s.emotionConfidence);
  const wristbandDirection = useCompassStore((s) => s.wristbandDirection);
  const wristbandFlash = useCompassStore((s) => s.wristbandFlash);
  const wristbandIntensity = useCompassStore((s) => s.wristbandIntensity);
  const compassView = useCompassStore((s) => s.compassView);

  const isSpeaking = audioState === 'SINGLE' || audioState === 'OVERLAP' || audioState === 'LAUGHTER';

  const wristbandCardinal = toCardinalMotor(wristbandDirection);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Social Acoustic Compass</Text>
            <Text style={styles.confidence}>
              Confidence {(confidence * 100).toFixed(0)}%
            </Text>
          </View>
          <BLEStatusPill />
        </Animated.View>

        <SystemBanners />

        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.badgeRow}>
          <AudioStateBadge state={audioState} />
          <EmotionBadge emotion={emotion} confidence={emotionConfidence} />
          {speakerCount > 1 && (
            <View style={styles.speakerChip}>
              <Text style={styles.speakerChipText}>{speakerCount} speakers</Text>
            </View>
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.compassSection}>
          <RadarCompass
            doa={currentDoa}
            speakers={speakerDots}
            isSpeaking={isSpeaking}
            viewMode={compassView}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.transcriptSection}>
          <Text style={styles.sectionLabel}>Live Transcription</Text>
          <LiveTranscriptStrip maxLines={3} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(400).duration(400)} style={styles.wristbandSection}>
          <View style={styles.wristbandHeader}>
            <Text style={styles.sectionLabel}>Wristband Active</Text>
            <Text style={styles.wristbandDir}>
              {wristbandDirection ?? 'Idle'}
            </Text>
          </View>
          <View style={styles.wristbandRow}>
            <WristbandDiagram
              activeDirection={
                wristbandCardinal as 'N' | 'E' | 'S' | 'W' | null
              }
              flash={wristbandFlash}
              compact
            />
            <View style={styles.wristbandInfo}>
              <Text style={styles.wristbandInfoText}>
                {isSpeaking
                  ? `Vibrating toward ${wristbandDirection ?? '—'}`
                  : 'Waiting for speech'}
              </Text>
              <Text style={styles.wristbandSub}>
                DOA {currentDoa.toFixed(0)}° · {hapticLabel(wristbandIntensity, emotion)}
              </Text>
            </View>
          </View>
        </Animated.View>
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
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: 8,
  },
  headerTitle: {
    fontFamily: Fonts.displayMedium,
    fontSize: 18,
    color: Colors.textPrimary,
  },
  confidence: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  speakerChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${Colors.secondary}55`,
    backgroundColor: `${Colors.secondary}15`,
  },
  speakerChipText: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 12,
    color: Colors.secondary,
  },
  compassSection: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  transcriptSection: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  wristbandSection: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 12,
  },
  wristbandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wristbandDir: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.primary,
  },
  wristbandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  wristbandInfo: {
    flex: 1,
    gap: 4,
  },
  wristbandInfoText: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  wristbandSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
  },
});

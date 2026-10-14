import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioStateBadge } from '@/components/AudioStateBadge';
import { BLEStatusPill } from '@/components/BLEStatusPill';
import { EmotionBadge } from '@/components/EmotionBadge';
import { LiveTranscriptStrip } from '@/components/LiveTranscriptStrip';
import { RadarCompass } from '@/components/RadarCompass';
import { SystemBanners } from '@/components/SystemBanners';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { directionLabel, useCompassStore } from '@/store/compassStore';
import { cueNotation } from '@/utils/haptics';

export default function HomeScreen() {
  const audioState = useCompassStore((s) => s.audioState);
  const currentDoa = useCompassStore((s) => s.currentDoa);
  const speakerDots = useCompassStore((s) => s.speakerDots);
  const speakerCount = useCompassStore((s) => s.speakerCount);
  const confidence = useCompassStore((s) => s.confidence);
  const emotion = useCompassStore((s) => s.emotion);
  const emotionConfidence = useCompassStore((s) => s.emotionConfidence);
  const pitchHz = useCompassStore((s) => s.pitchHz);
  const compassView = useCompassStore((s) => s.compassView);

  const isSpeaking = audioState === 'SINGLE' || audioState === 'OVERLAP' || audioState === 'LAUGHTER';

  const zoneLabel = isSpeaking ? directionLabel(currentDoa) : 'Idling';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Compass</Text>
          <BLEStatusPill />
        </View>

        <SystemBanners />

        <View style={styles.badgeRow}>
          <AudioStateBadge state={audioState} />
          <EmotionBadge emotion={emotion} confidence={emotionConfidence} pitchHz={pitchHz} />
          {speakerCount > 1 && (
            <Text style={styles.speakerCount}>{speakerCount} speakers</Text>
          )}
        </View>
        {isSpeaking ? <Text style={styles.cueNote}>{cueNotation(emotion, audioState)}</Text> : null}

        <View style={styles.compassSection}>
          <RadarCompass
            doa={currentDoa}
            speakers={speakerDots}
            isSpeaking={isSpeaking}
            viewMode={compassView}
          />
          <Text style={styles.zone}>{zoneLabel}</Text>
          <Text style={styles.confidence}>
            {isSpeaking
              ? `${currentDoa.toFixed(0)}° · ${Math.round(confidence * 100)}% sure`
              : 'No sound detected'}
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.sectionLabel}>Caption</Text>
          <LiveTranscriptStrip maxLines={3} />
        </View>
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
    alignItems: 'center',
    paddingTop: 8,
    minHeight: 48,
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.textPrimary,
  },
  confidence: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  speakerCount: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
  },
  cueNote: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: -8,
  },
  compassSection: {
    alignItems: 'center',
    paddingVertical: 4,
    gap: 4,
  },
  zone: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.textPrimary,
    marginTop: 8,
  },
  block: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.textSecondary,
  },
});

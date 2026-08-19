import { StyleSheet, Text, View } from 'react-native';

import { EmotionBadge } from '@/components/EmotionBadge';
import { Colors, SpeakerColors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import type { TranscriptEntry } from '@/store/compassStore';

const STATE_TAG_COLORS = {
  SINGLE: Colors.primary,
  OVERLAP: Colors.overlap,
  LAUGHTER: Colors.warning,
  SILENCE: Colors.silence,
  NOISE: Colors.textSecondary,
} as const;

type Props = {
  entry: TranscriptEntry;
  fontSize?: number;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function directionArrow(direction: string): string {
  const map: Record<string, string> = {
    N: '↑',
    NE: '↗',
    E: '→',
    SE: '↘',
    S: '↓',
    SW: '↙',
    W: '←',
    NW: '↖',
  };
  return map[direction] ?? '•';
}

export function TranscriptCard({ entry, fontSize = 15 }: Props) {
  const speakerColor = SpeakerColors[entry.speakerId % SpeakerColors.length];
  const tagColor = STATE_TAG_COLORS[entry.audioState];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.directionRow}>
          <Text style={styles.arrow}>{directionArrow(entry.direction)}</Text>
          <Text style={styles.direction}>{entry.direction}</Text>
          <View style={[styles.speakerDot, { backgroundColor: speakerColor }]} />
        </View>
        <Text style={styles.time}>{formatTime(entry.timestamp)}</Text>
      </View>
      <Text style={[styles.text, { fontSize }]}>{entry.text}</Text>
      <View style={styles.tagRow}>
        <View style={[styles.tag, { borderColor: `${tagColor}44` }]}>
          <Text style={[styles.tagText, { color: tagColor }]}>{entry.audioState}</Text>
        </View>
        <EmotionBadge emotion={entry.emotion ?? 'NEUTRAL'} compact />
        {entry.speakerCount > 1 && (
          <Text style={styles.speakerCount}>{entry.speakerCount} speakers</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  arrow: {
    fontSize: 18,
    color: Colors.secondary,
  },
  direction: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.secondary,
    letterSpacing: 1,
  },
  speakerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
  },
  text: {
    fontFamily: Fonts.body,
    color: Colors.textPrimary,
    lineHeight: 24,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  speakerCount: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textSecondary,
  },
  tagText: {
    fontFamily: Fonts.label,
    fontSize: 11,
    letterSpacing: 1,
  },
});

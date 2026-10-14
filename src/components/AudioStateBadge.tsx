import { StyleSheet, Text, View } from 'react-native';

import { Colors, AudioStateColors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import type { AudioState } from '@/store/compassStore';

const STATE_LABELS: Record<AudioState, string> = {
  SINGLE: 'One speaker',
  OVERLAP: 'Overlapping',
  LAUGHTER: 'Laughter',
  SILENCE: 'Idling',
  NOISE: 'Noise',
};

type Props = {
  state: AudioState;
  compact?: boolean;
};

export function AudioStateBadge({ state, compact }: Props) {
  const color = AudioStateColors[state];

  return (
    <View style={[styles.badge, compact && styles.compact]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.label}>{STATE_LABELS[state]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 6,
    minHeight: 36,
  },
  compact: {
    paddingVertical: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textPrimary,
  },
});

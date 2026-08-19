import { StyleSheet, Text, View } from 'react-native';

import { Colors, AudioStateColors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import type { AudioState } from '@/store/compassStore';

const STATE_LABELS: Record<AudioState, string> = {
  SINGLE: 'SINGLE SPEAKER',
  OVERLAP: 'OVERLAPPING',
  LAUGHTER: 'LAUGHTER',
  SILENCE: 'SILENCE',
  NOISE: 'NOISE',
};

type Props = {
  state: AudioState;
  compact?: boolean;
};

export function AudioStateBadge({ state, compact }: Props) {
  const color = AudioStateColors[state];

  return (
    <View style={[styles.badge, compact && styles.compact, { borderColor: `${color}44` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{STATE_LABELS[state]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    minHeight: 36,
  },
  compact: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

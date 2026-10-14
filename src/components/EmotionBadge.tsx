import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { EmotionName } from '@/constants/bleConstants';
import { Colors, EmotionColors, EmotionIcons } from '@/constants/colors';
import { Fonts } from '@/constants/typography';

const LABELS: Record<EmotionName, string> = {
  NEUTRAL: 'Neutral',
  HAPPY: 'Happy',
  SAD: 'Serious',
  ANGRY: 'Angry',
  URGENT: 'Urgent',
};

type Props = {
  emotion: EmotionName;
  confidence?: number;
  pitchHz?: number;
  compact?: boolean;
};

/** Shows the locked-mic pitch cue, for example "Happy 214 Hz 68%". */
export function EmotionBadge({ emotion, confidence, pitchHz, compact = false }: Props) {
  const color = EmotionColors[emotion];
  const parts = [LABELS[emotion]];
  if (pitchHz != null && pitchHz > 0) parts.push(`${Math.round(pitchHz)} Hz`);
  if (confidence != null && confidence > 0) parts.push(`${Math.round(confidence * 100)}%`);

  return (
    <View style={[styles.badge, compact && styles.badgeCompact]}>
      <Ionicons
        name={EmotionIcons[emotion] as keyof typeof Ionicons.glyphMap}
        size={compact ? 14 : 16}
        color={color}
      />
      <Text style={[styles.label, compact && styles.labelCompact]}>{parts.join(' ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  badgeCompact: {
    paddingVertical: 2,
  },
  label: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  labelCompact: {
    fontSize: 10,
  },
});

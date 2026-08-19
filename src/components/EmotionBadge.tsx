import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { EmotionName } from '@/constants/bleConstants';
import { EmotionColors, EmotionIcons } from '@/constants/colors';
import { Fonts } from '@/constants/typography';

const LABELS: Record<EmotionName, string> = {
  NEUTRAL: 'Neutral',
  HAPPY: 'Happy',
  SAD: 'Sad',
  ANGRY: 'Angry',
  URGENT: 'Urgent',
};

type Props = {
  emotion: EmotionName;
  confidence?: number;
  compact?: boolean;
};

/** Shows the prosodic cue classified by the necklace's TinyML model. */
export function EmotionBadge({ emotion, confidence, compact = false }: Props) {
  const color = EmotionColors[emotion];

  return (
    <View
      style={[
        styles.badge,
        compact && styles.badgeCompact,
        { borderColor: `${color}55`, backgroundColor: `${color}15` },
      ]}>
      <Ionicons
        name={EmotionIcons[emotion] as keyof typeof Ionicons.glyphMap}
        size={compact ? 12 : 14}
        color={color}
      />
      <Text style={[styles.label, compact && styles.labelCompact, { color }]}>
        {LABELS[emotion]}
        {confidence != null && confidence > 0 ? ` ${(confidence * 100).toFixed(0)}%` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeCompact: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  label: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  labelCompact: {
    fontSize: 10,
  },
});

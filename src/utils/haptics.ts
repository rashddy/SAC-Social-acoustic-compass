import type { EmotionName } from '@/constants/bleConstants';
import { WRISTBAND_COMMANDS } from '@/constants/bleConstants';
import type { WristbandIntensity } from '@/store/compassStore';

const LEVELS: WristbandIntensity[] = ['LOW', 'MEDIUM', 'HIGH'];

/**
 * Emotional urgency shifts the vibration strength around the user's baseline, so
 * an angry or urgent utterance is felt more strongly than a neutral one while
 * still respecting their comfort setting.
 */
const EMOTION_OFFSET: Record<EmotionName, number> = {
  NEUTRAL: 0,
  HAPPY: 0,
  SAD: -1,
  ANGRY: 1,
  URGENT: 1,
};

export const intensityForEmotion = (
  baseline: WristbandIntensity,
  emotion: EmotionName,
): WristbandIntensity => {
  const index = LEVELS.indexOf(baseline);
  const shifted = Math.min(LEVELS.length - 1, Math.max(0, index + EMOTION_OFFSET[emotion]));
  return LEVELS[shifted];
};

export const intensityOpcode = (intensity: WristbandIntensity): number =>
  WRISTBAND_COMMANDS.INTENSITY[intensity];

/** Describes the effective strength for the UI, noting when emotion changed it. */
export const hapticLabel = (
  baseline: WristbandIntensity,
  emotion: EmotionName,
): string => {
  const effective = intensityForEmotion(baseline, emotion);
  const label = `${effective.charAt(0)}${effective.slice(1).toLowerCase()} intensity`;
  return effective === baseline ? label : `${label} (emotion-adjusted)`;
};

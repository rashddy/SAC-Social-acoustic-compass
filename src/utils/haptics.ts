import type { AudioStateName, EmotionName } from '@/constants/bleConstants';
import { WRISTBAND_COMMANDS } from '@/constants/bleConstants';
import type { WristbandIntensity, WristbandPattern } from '@/store/compassStore';

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

/** Urgent is always strong. Serious / low energy is always light. */
export const intensityForCue = (
  baseline: WristbandIntensity,
  emotion: EmotionName,
): WristbandIntensity => {
  if (emotion === 'URGENT' || emotion === 'ANGRY') return 'HIGH';
  if (emotion === 'SAD') return 'LOW';
  return intensityForEmotion(baseline, emotion);
};

/** Closest single wristband opcode for the cue. Multi-step patterns stay as text. */
export const patternForCue = (
  emotion: EmotionName,
  state: AudioStateName,
  baseline: WristbandPattern,
): WristbandPattern => {
  if (state === 'LAUGHTER') return 'HOLD';
  if (emotion === 'HAPPY') return 'TAP';
  if (emotion === 'SAD') return 'HOLD';
  if (emotion === 'URGENT' || emotion === 'ANGRY') return 'PULSE';
  return baseline;
};

/** Notation from the cue table, shown on the phone. */
export const cueNotation = (emotion: EmotionName, state: AudioStateName): string => {
  if (state === 'LAUGHTER') return 'Hold, then two taps';
  if (state === 'OVERLAP') return 'Left, right, left';
  switch (emotion) {
    case 'HAPPY':
      return 'Two taps';
    case 'URGENT':
    case 'ANGRY':
      return 'Three fast pulses · high';
    case 'SAD':
      return 'One long hold · low';
    default:
      return 'Direction pulse';
  }
};

/** Describes the effective strength for the UI, noting when emotion changed it. */
export const hapticLabel = (
  baseline: WristbandIntensity,
  emotion: EmotionName,
): string => {
  const effective = intensityForCue(baseline, emotion);
  const label = `${effective.charAt(0)}${effective.slice(1).toLowerCase()} intensity`;
  return effective === baseline ? label : `${label} (emotion-adjusted)`;
};

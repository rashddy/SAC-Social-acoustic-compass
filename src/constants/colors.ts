/**
 * Dark palette taken from iOS system colors (Human Interface Guidelines)
 * and the quiet chrome of Google Live Transcribe: black canvas, gray
 * groups, one blue for actions. Status hues stay reserved for meaning.
 */
export const Colors = {
  background: '#000000',
  surface: '#1C1C1E',
  surfaceGlass: '#2C2C2E',
  primary: '#0A84FF',
  onPrimary: '#FFFFFF',
  secondary: '#64D2FF',
  warning: '#FF9F0A',
  silence: '#3A3A3C',
  overlap: '#FF453A',
  textPrimary: '#FFFFFF',
  textSecondary: '#98989D',
  border: '#38383A',
  success: '#30D158',
  connected: '#30D158',
  disconnected: '#FF453A',
} as const;

export const SpeakerColors = ['#0A84FF', '#64D2FF', '#FF9F0A'] as const;

export const AudioStateColors = {
  SINGLE: Colors.primary,
  OVERLAP: Colors.overlap,
  LAUGHTER: Colors.warning,
  SILENCE: Colors.silence,
  NOISE: Colors.textSecondary,
} as const;

export const EmotionColors = {
  NEUTRAL: Colors.textSecondary,
  HAPPY: Colors.warning,
  SAD: Colors.secondary,
  ANGRY: Colors.overlap,
  URGENT: '#FF9F45',
} as const;

export const EmotionIcons = {
  NEUTRAL: 'remove-outline',
  HAPPY: 'happy-outline',
  SAD: 'sad-outline',
  ANGRY: 'flame-outline',
  URGENT: 'alert-circle-outline',
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 36,
} as const;

export type FontScale = 'SMALL' | 'MEDIUM' | 'LARGE';

export const FontScaleMultiplier: Record<FontScale, number> = {
  SMALL: 0.9,
  MEDIUM: 1,
  LARGE: 1.15,
};

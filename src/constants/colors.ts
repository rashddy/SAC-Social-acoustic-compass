export const Colors = {
  background: '#080C14',
  surface: '#0F1828',
  surfaceGlass: 'rgba(15, 24, 40, 0.85)',
  primary: '#00E5FF',
  secondary: '#7B61FF',
  warning: '#FFD166',
  silence: '#2A3A4A',
  overlap: '#FF6B6B',
  textPrimary: '#E8F4FD',
  textSecondary: '#7A9BB5',
  border: 'rgba(0, 229, 255, 0.08)',
  success: '#00E676',
  connected: '#00E676',
  disconnected: '#FF6B6B',
} as const;

export const SpeakerColors = ['#00E5FF', '#7B61FF', '#FFD166'] as const;

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

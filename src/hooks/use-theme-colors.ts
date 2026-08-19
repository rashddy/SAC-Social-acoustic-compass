import { Colors as BaseColors } from '@/constants/colors';
import { useCompassStore } from '@/store/compassStore';

export function useThemeColors() {
  const highContrast = useCompassStore((s) => s.highContrast);

  if (!highContrast) return BaseColors;

  return {
    ...BaseColors,
    textPrimary: '#FFFFFF',
    textSecondary: '#A8C8E8',
    border: 'rgba(0, 229, 255, 0.2)',
    primary: '#00FFFF',
  };
}

import { Colors as BaseColors } from '@/constants/colors';
import { useCompassStore } from '@/store/compassStore';

export function useThemeColors() {
  const highContrast = useCompassStore((s) => s.highContrast);

  if (!highContrast) return BaseColors;

  return {
    ...BaseColors,
    textPrimary: '#FFFFFF',
    textSecondary: '#EBEBF5',
    border: '#636366',
    primary: '#0A84FF',
  };
}

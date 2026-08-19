import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: ViewStyle;
};

export function SACButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  style,
}: Props) {
  const isPrimary = variant === 'primary';
  const isGhost = variant === 'ghost';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        isPrimary && styles.primary,
        variant === 'secondary' && styles.secondary,
        isGhost && styles.ghost,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      hitSlop={8}>
      {icon && (
        <Ionicons
          name={icon}
          size={20}
          color={isPrimary ? Colors.background : Colors.primary}
        />
      )}
      <Text
        style={[
          styles.label,
          isPrimary && styles.primaryLabel,
          !isPrimary && styles.secondaryLabel,
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primary: {
    backgroundColor: Colors.primary,
  },
  secondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
  },
  primaryLabel: {
    color: Colors.background,
  },
  secondaryLabel: {
    color: Colors.primary,
  },
});

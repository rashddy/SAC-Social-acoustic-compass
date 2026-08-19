import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import type { WristbandDirection } from '@/store/compassStore';

type Props = {
  activeDirection: WristbandDirection;
  flash?: boolean;
  compact?: boolean;
};

const MOTORS: { key: WristbandDirection; label: string; style: object }[] = [
  { key: 'N', label: 'N', style: { top: 8, alignSelf: 'center' } },
  { key: 'E', label: 'E', style: { right: 8, top: '45%' } },
  { key: 'S', label: 'S', style: { bottom: 8, alignSelf: 'center' } },
  { key: 'W', label: 'W', style: { left: 8, top: '45%' } },
];

export function WristbandDiagram({ activeDirection, flash, compact }: Props) {
  const size = compact ? 100 : 180;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.band,
          { width: size, height: size, borderRadius: size / 2 },
          flash && styles.flash,
        ]}>
        <View style={styles.innerRing} />
        {MOTORS.map((motor) => {
          const isActive = activeDirection === motor.key;
          return (
            <View
              key={motor.key}
              style={[
                styles.motor,
                motor.style as object,
                isActive && styles.motorActive,
              ]}>
              <Text style={[styles.motorLabel, isActive && styles.motorLabelActive]}>
                {motor.label}
              </Text>
            </View>
          );
        })}
        <View style={styles.center}>
          <Text style={styles.centerText}>WRIST</Text>
        </View>
      </View>
      {!compact && (
        <Text style={styles.hint}>
          {activeDirection
            ? `Motor ${activeDirection} active`
            : 'No vibration'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    gap: 12,
  },
  band: {
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  flash: {
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  innerRing: {
    position: 'absolute',
    width: '70%',
    height: '70%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  motor: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.silence,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  motorActive: {
    backgroundColor: `${Colors.primary}33`,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  motorLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  motorLabelActive: {
    color: Colors.primary,
  },
  center: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerText: {
    fontFamily: Fonts.label,
    fontSize: 9,
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  hint: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
});

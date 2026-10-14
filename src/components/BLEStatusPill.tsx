import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { useCompassStore } from '@/store/compassStore';

type Props = {
  showLabel?: boolean;
};

export function BLEStatusPill({ showLabel = true }: Props) {
  const devices = useCompassStore((s) => s.devices);

  const compassUp = devices.COMPASS.status === 'CONNECTED';
  const necklaceUp = devices.NECKLACE.status === 'CONNECTED';
  const wristbandUp = devices.WRISTBAND.status === 'CONNECTED';
  const connected = compassUp || necklaceUp || wristbandUp;
  const dotColor = connected ? Colors.connected : Colors.textSecondary;

  const label = compassUp
    ? 'Connected'
    : necklaceUp || wristbandUp
      ? `${Number(necklaceUp) + Number(wristbandUp)} linked`
      : 'Not connected';

  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      {showLabel && (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 32,
    maxWidth: 180,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
  },
});

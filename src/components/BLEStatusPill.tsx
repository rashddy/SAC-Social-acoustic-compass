import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { useCompassStore } from '@/store/compassStore';

type Props = {
  showLabel?: boolean;
};

export function BLEStatusPill({ showLabel = true }: Props) {
  const devices = useCompassStore((s) => s.devices);
  const isDemoMode = useCompassStore((s) => s.isDemoMode);

  const necklaceUp = devices.NECKLACE.status === 'CONNECTED';
  const wristbandUp = devices.WRISTBAND.status === 'CONNECTED';
  const linkCount = Number(necklaceUp) + Number(wristbandUp);
  const connected = linkCount > 0 || isDemoMode;
  const dotColor = connected ? Colors.connected : Colors.disconnected;

  const label = isDemoMode
    ? 'Demo Mode · 2 devices'
    : linkCount === 0
      ? 'Disconnected'
      : `${linkCount}/2 linked`;

  return (
    <View style={[styles.pill, { borderColor: `${dotColor}33` }]}>
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    maxWidth: 180,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontFamily: Fonts.label,
    fontSize: 11,
    color: Colors.textSecondary,
  },
});

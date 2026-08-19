import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DEVICE_LABEL, DEVICE_ROLES, type DeviceRole } from '@/constants/bleConstants';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { bleService } from '@/services/bleService';
import { useCompassStore } from '@/store/compassStore';

/** Threshold for the low-battery warning required by Functional Requirement D. */
const LOW_BATTERY = 20;

type BannerProps = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
};

function Banner({ icon, color, text, actionLabel, onAction }: BannerProps) {
  return (
    <View
      style={[styles.banner, { borderColor: `${color}44`, backgroundColor: `${color}12` }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.text}>{text}</Text>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={[styles.action, { color }]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Surfaces device health warnings on the home screen: a dropped link, a low
 * wearable battery, or a microphone array that needs re-calibration.
 */
export function SystemBanners() {
  const devices = useCompassStore((s) => s.devices);
  const isDemoMode = useCompassStore((s) => s.isDemoMode);
  const micCalibrationFault = useCompassStore((s) => s.micCalibrationFault);

  const lowBattery = DEVICE_ROLES.filter((role: DeviceRole) => {
    const battery = devices[role].battery;
    return battery != null && battery <= LOW_BATTERY;
  });

  const necklaceDown = devices.NECKLACE.status !== 'CONNECTED' && !isDemoMode;

  if (!necklaceDown && lowBattery.length === 0 && !micCalibrationFault) return null;

  return (
    <View style={styles.stack}>
      {necklaceDown && (
        <Banner
          icon="bluetooth-outline"
          color={Colors.disconnected}
          text={
            bleService.isSupported()
              ? 'SAC-Necklace is not connected. Direction and speech data are paused.'
              : 'No wearable connected. Bluetooth needs a development build — use Demo Mode.'
          }
          actionLabel="Pair"
          onAction={() => router.push('/pair')}
        />
      )}

      {lowBattery.map((role) => (
        <Banner
          key={role}
          icon="battery-dead-outline"
          color={Colors.warning}
          text={`${DEVICE_LABEL[role]} battery is at ${devices[role].battery}%. Charge it soon.`}
        />
      ))}

      {micCalibrationFault && (
        <Banner
          icon="mic-off-outline"
          color={Colors.warning}
          text="Microphone array calibration is stale. Direction accuracy may be reduced."
          actionLabel="Calibrate"
          onAction={() => bleService.requestMicCalibration()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: {
    flex: 1,
    fontFamily: Fonts.label,
    fontSize: 12,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  action: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 12,
  },
});

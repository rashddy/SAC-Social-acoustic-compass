import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SACButton } from '@/components/SACButton';
import {
  DEVICE_DESCRIPTION,
  DEVICE_LABEL,
  PAIR_ROLES,
  type DeviceRole,
} from '@/constants/bleConstants';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { bleService } from '@/services/bleService';
import { requestBlePermissions } from '@/services/blePermissions';
import { deviceRepo } from '@/services/db';
import { useCompassStore, type ConnectionStatus } from '@/store/compassStore';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  IDLE: 'Not connected',
  SCANNING: 'Scanning…',
  FOUND: 'Found',
  CONNECTING: 'Connecting…',
  CONNECTED: 'Connected',
  DISCONNECTED: 'Disconnected',
};

const ROLE_ICON: Record<DeviceRole, keyof typeof Ionicons.glyphMap> = {
  COMPASS: 'compass-outline',
  NECKLACE: 'mic-outline',
  WRISTBAND: 'watch-outline',
};

function SignalBars({ rssi }: { rssi: number }) {
  const bars = rssi > -50 ? 4 : rssi > -65 ? 3 : rssi > -80 ? 2 : 1;
  return (
    <View style={styles.signalBars}>
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={[styles.signalBar, { height: 4 + i * 3, opacity: i <= bars ? 1 : 0.2 }]}
        />
      ))}
    </View>
  );
}

export default function PairScreen() {
  const scanStatus = useCompassStore((s) => s.scanStatus);
  const discoveredDevices = useCompassStore((s) => s.discoveredDevices);
  const devices = useCompassStore((s) => s.devices);
  const setHasCompletedOnboarding = useCompassStore((s) => s.setHasCompletedOnboarding);

  const [permissionDenied, setPermissionDenied] = useState(false);
  const [lastCompassId, setLastCompassId] = useState<string | null>(null);
  const [lastCompassName, setLastCompassName] = useState<string>(DEVICE_LABEL.COMPASS);
  const pulse = useSharedValue(1);
  const scanningRef = useRef(false);
  const bleSupported = bleService.isSupported();

  const compassLink = devices.COMPASS;
  const compassReady = compassLink.status === 'CONNECTED';

  const compassDevices = discoveredDevices.filter(
    (d) =>
      d.role === 'COMPASS' ||
      /^sac[-_]/i.test(d.name) ||
      /compass/i.test(d.name),
  );

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.3, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  useEffect(() => {
    void (async () => {
      const row = await deviceRepo.findByRole('COMPASS');
      if (row?.macaddress) {
        setLastCompassId(row.macaddress);
        setLastCompassName(row.deviceNAME || DEVICE_LABEL.COMPASS);
      }
    })();
  }, []);

  const startScan = useCallback(async () => {
    if (!bleSupported || scanningRef.current) return;
    scanningRef.current = true;

    const permission = await requestBlePermissions();
    if (!permission.granted) {
      setPermissionDenied(true);
      scanningRef.current = false;
      return;
    }
    setPermissionDenied(false);

    if (!(await bleService.isPoweredOn())) {
      Alert.alert('Bluetooth is off', 'Turn on Bluetooth to scan for SAC-Compass.');
      scanningRef.current = false;
      return;
    }

    // App reload leaves a ghost GATT link → ESP stops advertising until released
    // (handled inside startScan / prepareForDiscovery).
    await bleService.startScan();
    scanningRef.current = false;
  }, [bleSupported]);

  useEffect(() => {
    startScan();
    return () => {
      bleService.stopScan();
    };
  }, [startScan]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: 2 - pulse.value,
  }));

  const connectDevice = async (id: string, _role?: DeviceRole) => {
    const ok = await bleService.connectToDevice(id, 'COMPASS');
    if (!ok) {
      Alert.alert(
        'Connection failed',
        'Could not connect to SAC-Compass. After a reload, wait a second and tap Scan Again (ghost links are cleared automatically). Make sure the ESP32 is advertising and not bonded in phone Bluetooth settings.',
      );
      return;
    }

    const link = useCompassStore.getState().devices.COMPASS;
    setLastCompassId(id);
    setLastCompassName(link.name ?? DEVICE_LABEL.COMPASS);
    await deviceRepo.upsert({
      deviceName: link.name ?? DEVICE_LABEL.COMPASS,
      deviceType: 'COMPASS',
      macAddress: id,
      firmwareVersion: link.firmware,
      batteryLevel: link.battery,
      passkeyBonded: true,
    });
  };

  const reconnectLast = async () => {
    if (!lastCompassId) return;
    await bleService.prepareForDiscovery([lastCompassId]);
    await connectDevice(lastCompassId, 'COMPASS');
  };

  const enterApp = () => {
    setHasCompletedOnboarding(true);
    router.replace('/(tabs)/home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.replace('/')} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>

        <Text style={styles.title}>Connect Compass</Text>
        <Text style={styles.subtitle}>
          {bleSupported
            ? 'Scan for SAC-Compass, tap to connect, then Continue. Do not pair in system Bluetooth settings.'
            : 'Bluetooth connection'}
        </Text>

        {!bleSupported && (
          <View style={styles.banner}>
            <Ionicons name="information-circle" size={22} color={Colors.warning} />
            <Text style={styles.bannerText}>{bleService.getUnavailableReason()}</Text>
          </View>
        )}

        {permissionDenied && (
          <View style={styles.banner}>
            <Ionicons name="warning" size={22} color={Colors.overlap} />
            <Text style={styles.bannerText}>
              Bluetooth permissions were denied. Allow Nearby devices and Location in Android
              Settings, turn Location ON, then tap Scan Again.
            </Text>
          </View>
        )}

        <View style={styles.slots}>
          {PAIR_ROLES.map((role) => {
            const link = devices[role];
            const connected = link.status === 'CONNECTED';
            return (
              <View
                key={role}
                style={[styles.slot, connected && styles.slotConnected]}>
                <View style={styles.slotHeader}>
                  <Ionicons
                    name={ROLE_ICON[role]}
                    size={22}
                    color={connected ? Colors.connected : Colors.textSecondary}
                  />
                  <View style={styles.slotHeaderText}>
                    <Text style={styles.slotTitle}>{DEVICE_LABEL[role]}</Text>
                    <Text style={styles.slotDesc}>{DEVICE_DESCRIPTION[role]}</Text>
                  </View>
                  <View
                    style={[styles.statusDot, connected ? styles.dotOn : styles.dotOff]}
                  />
                </View>
                <View style={styles.slotFooter}>
                  <Text style={[styles.slotStatus, connected && styles.slotStatusOn]}>
                    {connected ? 'Connected' : STATUS_LABELS[link.status]}
                  </Text>
                  {link.battery != null && (
                    <Text style={styles.slotMeta}>{link.battery}%</Text>
                  )}
                  {connected && (
                    <Pressable onPress={() => bleService.disconnectRole(role)} hitSlop={8}>
                      <Text style={styles.slotAction}>Disconnect</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {bleSupported && (
          <View style={styles.scanArea}>
            <Animated.View style={[styles.pulseRing, pulseStyle]} />
            <View style={styles.scanCore}>
              <Ionicons name="bluetooth" size={36} color={Colors.primary} />
            </View>
          </View>
        )}

        <Text style={styles.scanStatus}>
          {bleSupported ? STATUS_LABELS[scanStatus] : 'Bluetooth needs a development build'}
        </Text>

        <View style={styles.list}>
          {compassDevices.length === 0 ? (
            <Text style={styles.empty}>
              {!bleSupported
                ? 'Expo Go cannot talk to the ESP32. Build a development client (npm run build:dev), install it, then run npm run start:dev-client.'
                : scanStatus === 'SCANNING'
                  ? 'Searching for SAC-Compass…'
                  : 'No SAC-Compass found. After a reload, ghost links are cleared on Scan Again — wait ~1s for the ESP to advertise. If nRF Connect also cannot see it, reflash firmware/sac_compass and check Serial for “Advertising as SAC-Compass”. Location ON; forget SAC-* bonds.'}
            </Text>
          ) : (
            compassDevices.map((item) => {
              const connected = devices.COMPASS.id === item.id;
              return (
                <Pressable
                  key={item.id}
                  style={styles.deviceCard}
                  disabled={connected || devices.COMPASS.status === 'CONNECTING'}
                  onPress={() => connectDevice(item.id, item.role)}>
                  <Ionicons
                    name={ROLE_ICON.COMPASS}
                    size={24}
                    color={connected ? Colors.connected : Colors.secondary}
                  />
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{item.name}</Text>
                    <Text style={styles.deviceRssi}>
                      Compass · {item.rssi} dBm
                    </Text>
                  </View>
                  <SignalBars rssi={item.rssi} />
                  <Ionicons
                    name={connected ? 'checkmark-circle' : 'chevron-forward'}
                    size={20}
                    color={connected ? Colors.connected : Colors.textSecondary}
                  />
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.actions}>
          {bleSupported && (
            <>
              <SACButton
                title="Scan Again"
                onPress={startScan}
                variant="secondary"
                icon="refresh"
              />
              {lastCompassId && !compassReady && (
                <SACButton
                  title={`Reconnect ${lastCompassName}`}
                  onPress={reconnectLast}
                  variant="secondary"
                  icon="bluetooth"
                  disabled={compassLink.status === 'CONNECTING'}
                />
              )}
              <SACButton
                title="Continue"
                onPress={enterApp}
                icon="arrow-forward"
                disabled={!compassReady}
              />
              {!compassReady && (
                <Text style={styles.hint}>
                  Connect SAC-Compass before continuing. After a reload, tap Scan Again — do not
                  pair in the phone’s Bluetooth settings.
                </Text>
              )}
            </>
          )}
          {!compassReady && (
            <SACButton
              title="Open compass"
              onPress={enterApp}
              variant={bleSupported ? 'ghost' : 'primary'}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  backBtn: {
    marginTop: 8,
    width: 48,
    height: 48,
    justifyContent: 'center',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.textPrimary,
    marginTop: 8,
  },
  subtitle: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: `${Colors.warning}15`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${Colors.warning}44`,
    padding: 14,
    marginTop: 16,
  },
  bannerText: {
    flex: 1,
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  slots: {
    gap: 12,
    marginTop: 20,
  },
  slot: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 12,
  },
  slotConnected: {
    borderColor: `${Colors.connected}66`,
  },
  slotHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  slotHeaderText: {
    flex: 1,
  },
  slotTitle: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  slotDesc: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  dotOn: {
    backgroundColor: Colors.connected,
  },
  dotOff: {
    backgroundColor: Colors.silence,
  },
  slotFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  slotStatus: {
    flex: 1,
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  slotStatusOn: {
    color: Colors.connected,
  },
  slotMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
  },
  slotAction: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.primary,
  },
  scanArea: {
    alignSelf: 'center',
    marginVertical: 28,
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  scanCore: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanStatus: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  list: {
    gap: 12,
    paddingVertical: 16,
  },
  empty: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 24,
    lineHeight: 22,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    minHeight: 72,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  deviceRssi: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  signalBar: {
    width: 4,
    backgroundColor: Colors.primary,
    borderRadius: 1,
  },
  actions: {
    gap: 8,
  },
  hint: {
    fontFamily: Fonts.label,
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});

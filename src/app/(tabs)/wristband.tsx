import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { VestDiagram } from '@/components/VestDiagram';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { doaToVestZone, VEST_ZONE_LABEL } from '@/utils/vest';
import { useCompassStore } from '@/store/compassStore';

export default function WristbandScreen() {
  const audioState = useCompassStore((s) => s.audioState);
  const currentDoa = useCompassStore((s) => s.currentDoa);
  const wristbandFlash = useCompassStore((s) => s.wristbandFlash);
  const wristbandLink = useCompassStore((s) => s.devices.WRISTBAND);

  useEffect(() => {
    if (wristbandFlash) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [wristbandFlash]);

  const isSpeaking = audioState === 'SINGLE' || audioState === 'OVERLAP' || audioState === 'LAUGHTER';
  const vestZone = isSpeaking ? doaToVestZone(currentDoa) : null;
  const shownZone = vestZone && vestZone !== 'BACK' ? vestZone : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Vest</Text>
        <Text style={styles.subtitle}>
          {shownZone
            ? `Buzzing at the ${VEST_ZONE_LABEL[shownZone].toLowerCase()}`
            : 'Shows which pad on the vest is vibrating'}
        </Text>

        <View style={styles.linkRow}>
          <View
            style={[
              styles.linkDot,
              wristbandLink.status === 'CONNECTED' ? styles.linkDotOn : styles.linkDotOff,
            ]}
          />
          <Text style={styles.linkText}>
            {wristbandLink.status === 'CONNECTED'
              ? `Vest connected${
                  wristbandLink.battery != null ? ` · ${wristbandLink.battery}%` : ''
                }`
              : 'Vest is not connected'}
          </Text>
        </View>

        <View style={styles.diagramSection}>
          <VestDiagram zone={shownZone} flash={wristbandFlash} />
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
    padding: 20,
    gap: 24,
    paddingBottom: 32,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: -16,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -8,
  },
  linkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  linkDotOn: {
    backgroundColor: Colors.connected,
  },
  linkDotOff: {
    backgroundColor: Colors.silence,
  },
  linkText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  diagramSection: {
    alignItems: 'center',
    paddingVertical: 8,
  },
});

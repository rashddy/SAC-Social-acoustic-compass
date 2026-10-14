import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SACButton } from '@/components/SACButton';
import {
  DEVICE_LABEL,
  DEVICE_ROLES,
  type DeviceRole,
} from '@/constants/bleConstants';
import { Colors, type FontScale } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { authService } from '@/services/auth/authService';
import { biometricAvailability } from '@/services/auth/biometrics';
import { bleService } from '@/services/bleService';
import { auditRepo, userRepo, type AuditEvent } from '@/services/db';
import { demoService } from '@/services/demoService';
import { settingsService } from '@/services/settingsService';
import { speechService } from '@/services/speechService';
import type { CompassView, SttEngine } from '@/store/compassStore';
import { useCompassStore } from '@/store/compassStore';

export default function SettingsScreen() {
  const devices = useCompassStore((s) => s.devices);
  const sttEngine = useCompassStore((s) => s.sttEngine);
  const compassView = useCompassStore((s) => s.compassView);
  const fontScale = useCompassStore((s) => s.fontScale);
  const highContrast = useCompassStore((s) => s.highContrast);
  const setSttEngine = useCompassStore((s) => s.setSttEngine);
  const setCompassView = useCompassStore((s) => s.setCompassView);
  const setFontScale = useCompassStore((s) => s.setFontScale);
  const setHighContrast = useCompassStore((s) => s.setHighContrast);
  const reset = useCompassStore((s) => s.reset);

  const [username, setUsername] = useState('Local account');
  const [biometricLabel, setBiometricLabel] = useState('Unavailable on this device');
  const [biometricOn, setBiometricOn] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);

  const refreshSecurity = useCallback(() => {
    Promise.all([userRepo.findSignedIn(), biometricAvailability(), auditRepo.recent()]).then(
      ([account, hardware, audit]) => {
        setUsername(account?.username ?? authService.username() ?? 'Local account');
        setBiometricOn(Boolean(account?.biometricEnabled));
        setBiometricLabel(hardware.label);
        setEvents(audit);
      },
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshSecurity();
    }, [refreshSecurity]),
  );

  /** Every preference change is written to tblDeviceSettings immediately. */
  const commit = (apply: () => void) => {
    apply();
    settingsService.persist();
  };

  const disconnectAll = async () => {
    demoService.exit();
    await bleService.disconnectAll();
    reset();
  };

  const clearData = () => {
    Alert.alert(
      'Clear All Data',
      'This will delete all saved sessions and performance logs. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            let result = await authService.deleteSavedSessions();
            if (result === 'reauth') {
              const allowed = await authService.ensureRecentAuth();
              if (!allowed) return;
              result = await authService.deleteSavedSessions();
            }
            if (result !== 'ok') {
              Alert.alert('Not deleted', 'Saved conversations are still protected.');
              return;
            }
            reset();
            Alert.alert('Done', 'All data cleared.');
            refreshSecurity();
          },
        },
      ],
    );
  };

  const toggleBiometric = async () => {
    const allowed = await authService.ensureRecentAuth();
    if (!allowed) return;
    const result = biometricOn
      ? await authService.disableBiometrics()
      : await authService.enableBiometrics();
    if (!result.ok) {
      Alert.alert('Biometrics', result.message ?? 'Biometric unlock was not changed.');
    }
    refreshSecurity();
  };

  const logout = () => {
    authService.logout();
    router.replace('/auth');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>

        <Section title="Compass">
          {DEVICE_ROLES.filter((role) => {
            // Always show the compass. Show a legacy slot only when it is linked.
            if (role === 'COMPASS') return true;
            const link = devices[role];
            return link.status === 'CONNECTED' || link.id != null;
          }).map((role: DeviceRole) => {
            const link = devices[role];
            const connected = link.status === 'CONNECTED';
            return (
              <View key={role} style={styles.deviceRow}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.value}>{link.name ?? DEVICE_LABEL[role]}</Text>
                  <Text style={styles.deviceMeta}>
                    {connected ? 'Connected' : 'Not connected'}
                    {link.battery != null ? ` · ${link.battery}% battery` : ''}
                    {link.firmware ? ` · fw ${link.firmware}` : ''}
                  </Text>
                </View>
                <View
                  style={[styles.connectedDot, !connected && styles.disconnectedDot]}
                />
              </View>
            );
          })}
          <View style={styles.row}>
            <SACButton
              title="Re-pair"
              onPress={() => router.push('/pair')}
              variant="secondary"
              style={styles.halfBtn}
            />
            <SACButton
              title="Disconnect"
              onPress={disconnectAll}
              variant="ghost"
              style={styles.halfBtn}
            />
          </View>
        </Section>

        <Section title="Speech-to-Text Engine">
          <ToggleRow<SttEngine>
            options={['VOSK', 'WHISPER']}
            value={sttEngine}
            onChange={(v) =>
              commit(() => {
                setSttEngine(v);
                speechService.setEngine(v);
              })
            }
            labels={{ VOSK: 'Vosk', WHISPER: 'Whisper' }}
          />
          <Text style={styles.hint}>{speechService.getEngineNote()}</Text>
        </Section>

        <Section title="Compass Display">
          <ToggleRow<CompassView>
            options={['RADAR', 'ARROW']}
            value={compassView}
            onChange={(v) => commit(() => setCompassView(v))}
            labels={{ RADAR: 'Radar', ARROW: 'Arrow' }}
          />
        </Section>

        <Section title="Font Size">
          <ToggleRow<FontScale>
            options={['SMALL', 'MEDIUM', 'LARGE']}
            value={fontScale}
            onChange={(v) => commit(() => setFontScale(v))}
            labels={{ SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' }}
          />
        </Section>

        <Section title="Accessibility">
          <Pressable
            style={styles.switchRow}
            onPress={() => commit(() => setHighContrast(!highContrast))}>
            <Text style={styles.value}>High Contrast Mode</Text>
            <View style={[styles.toggle, highContrast && styles.toggleOn]}>
              <View style={[styles.knob, highContrast && styles.knobOn]} />
            </View>
          </Pressable>
        </Section>

        <Section title="Security">
          <Text style={styles.value}>Signed in as {username}</Text>
          <Text style={styles.hint}>
            This sign-in protects conversations on this phone. It is not a cloud account, and a
            forgotten password cannot be recovered by email.
          </Text>
          <SACButton
            title="Change password"
            onPress={() => router.push('/auth?mode=password')}
            variant="secondary"
            icon="lock-closed-outline"
          />
          <SACButton
            title={biometricOn ? 'Turn off biometric unlock' : 'Turn on biometric unlock'}
            onPress={() => void toggleBiometric()}
            variant="secondary"
            icon="finger-print"
          />
          <Text style={styles.hint}>{biometricLabel}</Text>
          <SACButton title="Log out" onPress={logout} variant="ghost" />
          {events.length > 0 ? (
            <View style={styles.auditList}>
              {events.map((event) => (
                <Text key={event.auditID} style={styles.hint}>
                  {event.eventType.replace(/_/g, ' ')} · {new Date(event.createdAt).toLocaleString()}
                </Text>
              ))}
            </View>
          ) : null}
        </Section>

        <Section title="Research">
          <SACButton
            title="Performance Diagnostics"
            onPress={() => router.push('/diagnostics')}
            variant="secondary"
            icon="pulse-outline"
          />
          <SACButton
            title="Calibrate Microphone Array"
            onPress={async () => {
              const ok = await bleService.requestMicCalibration();
              Alert.alert(
                ok ? 'Calibration started' : 'Not available',
                ok
                  ? 'The compass is re-calibrating its microphone array. Keep the area quiet for a few seconds.'
                  : 'Connect the SAC-Compass to run a calibration.',
              );
            }}
            variant="ghost"
            icon="options-outline"
          />
        </Section>

        <Section title="Data">
          <SACButton title="Clear All Data" onPress={clearData} variant="secondary" />
        </Section>

        <Section title="About">
          <Text style={styles.aboutTitle}>Social Acoustic Compass</Text>
          <Text style={styles.aboutText}>WMSU Department of IT</Text>
          <Text style={styles.aboutText}>
            Version {Constants.expoConfig?.version ?? '1.0.0'}
          </Text>
          <Text style={styles.aboutSub}>
            Offline assistive system for Deaf and Hard-of-Hearing individuals.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function ToggleRow<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          onPress={() => onChange(opt)}
          style={[styles.option, value === opt && styles.optionActive]}>
          <Text style={[styles.optionText, value === opt && styles.optionTextActive]}>
            {labels[opt]}
          </Text>
        </Pressable>
      ))}
    </View>
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
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  sectionBody: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  value: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.connected,
  },
  disconnectedDot: {
    backgroundColor: Colors.silence,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  halfBtn: {
    flex: 1,
    paddingHorizontal: 12,
  },
  optionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  option: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionActive: {
    borderColor: Colors.primary,
    backgroundColor: `${Colors.primary}15`,
  },
  optionText: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  optionTextActive: {
    color: Colors.primary,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  toggle: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.silence,
    padding: 3,
  },
  toggleOn: {
    backgroundColor: `${Colors.primary}44`,
  },
  knob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.textSecondary,
  },
  knobOn: {
    backgroundColor: Colors.primary,
    alignSelf: 'flex-end',
  },
  aboutTitle: {
    fontFamily: Fonts.displayMedium,
    fontSize: 18,
    color: Colors.textPrimary,
  },
  aboutText: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
  },
  aboutSub: {
    fontFamily: Fonts.labelRegular,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginTop: 4,
  },
  auditList: {
    gap: 4,
  },
});

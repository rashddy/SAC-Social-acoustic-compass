import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SACButton } from '@/components/SACButton';
import { DEVICE_LABEL, DEVICE_ROLES, type DeviceRole } from '@/constants/bleConstants';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import {
  EMPTY_SUMMARY,
  performanceRepo,
  type MetricSummary,
  type PerformanceLogRow,
  type PerformanceSummary,
} from '@/services/db';
import { useCompassStore } from '@/store/compassStore';

/** Targets quoted in the capstone document's performance requirements. */
const TARGETS = {
  inference: 100,
  tdoa: 50,
  bleLatency: 200,
};

function MetricCard({
  title,
  unit,
  summary,
  target,
}: {
  title: string;
  unit: string;
  summary: MetricSummary;
  target?: number;
}) {
  const withinTarget = target == null || summary.average <= target;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.cardValueRow}>
        <Text style={[styles.cardValue, !withinTarget && styles.cardValueWarn]}>
          {summary.average}
        </Text>
        <Text style={styles.cardUnit}>{unit}</Text>
      </View>
      <Text style={styles.cardMeta}>
        min {summary.min} · peak {summary.peak}
        {target != null ? ` · target ≤ ${target}${unit}` : ''}
      </Text>
      {target != null && (
        <Text style={[styles.verdict, withinTarget ? styles.verdictOk : styles.verdictWarn]}>
          {withinTarget ? 'Within target' : 'Above target'}
        </Text>
      )}
    </View>
  );
}

/** Sparkline-style battery trend drawn with plain views, so no chart dependency. */
function BatteryTrend({ rows }: { rows: PerformanceLogRow[] }) {
  const series = rows.slice(0, 30).reverse();
  if (series.length === 0) {
    return <Text style={styles.empty}>No battery samples recorded yet.</Text>;
  }

  return (
    <View style={styles.trend}>
      {series.map((row, index) => (
        <View
          key={row.logID ?? index}
          style={[
            styles.trendBar,
            {
              height: Math.max(3, (row.batteryLevel / 100) * 64),
              backgroundColor: row.batteryLevel <= 20 ? Colors.warning : Colors.primary,
            },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * Research Developer / Administrator view from the User Characteristics table.
 * Reads tblPerformanceLog so latency and inference claims in the paper can be
 * cited from real measurements rather than estimates.
 */
export default function DiagnosticsScreen() {
  const devices = useCompassStore((s) => s.devices);
  const isDemoMode = useCompassStore((s) => s.isDemoMode);

  const [summary, setSummary] = useState<PerformanceSummary>(EMPTY_SUMMARY);
  const [rows, setRows] = useState<PerformanceLogRow[]>([]);

  const load = useCallback(async () => {
    const [nextSummary, nextRows] = await Promise.all([
      performanceRepo.summary(),
      performanceRepo.recent(60),
    ]);
    setSummary(nextSummary);
    setRows(nextRows);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const clear = () => {
    Alert.alert('Clear performance log', 'Delete all recorded metrics?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await performanceRepo.clear();
          await load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Diagnostics</Text>
        </View>

        <Text style={styles.caption}>
          {summary.sampleCount} samples recorded
          {isDemoMode ? ' · simulated hardware' : ''}
        </Text>

        <View style={styles.grid}>
          <MetricCard
            title="TinyML inference"
            unit="ms"
            summary={summary.inference}
            target={TARGETS.inference}
          />
          <MetricCard
            title="TDOA localization"
            unit="ms"
            summary={summary.tdoa}
            target={TARGETS.tdoa}
          />
          <MetricCard
            title="BLE latency"
            unit="ms"
            summary={summary.bleLatency}
            target={TARGETS.bleLatency}
          />
          <MetricCard title="Battery level" unit="%" summary={summary.battery} />
        </View>

        <Text style={styles.sectionLabel}>Device Links</Text>
        <View style={styles.deviceBlock}>
          {DEVICE_ROLES.map((role: DeviceRole) => {
            const link = devices[role];
            return (
              <View key={role} style={styles.deviceRow}>
                <Text style={styles.deviceName}>{DEVICE_LABEL[role]}</Text>
                <Text style={styles.deviceMeta}>
                  {link.status}
                  {link.rssi != null ? ` · ${link.rssi} dBm` : ''}
                  {link.battery != null ? ` · ${link.battery}%` : ''}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Battery Trend</Text>
        <View style={styles.trendBlock}>
          <BatteryTrend rows={rows} />
        </View>

        <SACButton
          title="Clear Performance Log"
          onPress={clear}
          variant="ghost"
          icon="trash-outline"
        />
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
    gap: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.textPrimary,
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 4,
  },
  cardTitle: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  cardValue: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.primary,
  },
  cardValueWarn: {
    color: Colors.warning,
  },
  cardUnit: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  cardMeta: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textSecondary,
  },
  verdict: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 10,
    marginTop: 2,
  },
  verdictOk: {
    color: Colors.success,
  },
  verdictWarn: {
    color: Colors.warning,
  },
  sectionLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  deviceBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  deviceName: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  deviceMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
  },
  trendBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    minHeight: 96,
    justifyContent: 'flex-end',
  },
  trend: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 64,
  },
  trendBar: {
    flex: 1,
    borderRadius: 2,
    minWidth: 3,
  },
  empty: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});

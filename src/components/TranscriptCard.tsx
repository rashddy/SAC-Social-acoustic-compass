import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import type { TranscriptEntry } from '@/store/compassStore';

type Props = {
  entry: TranscriptEntry;
  fontSize?: number;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function TranscriptCard({ entry, fontSize = 15 }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.meta}>
        <Text style={styles.direction}>{entry.direction}</Text>
        <Text style={styles.time}>{formatTime(entry.timestamp)}</Text>
      </View>
      <Text style={[styles.text, { fontSize, lineHeight: fontSize * 1.45 }]}>{entry.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: 6,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  direction: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
  },
  text: {
    fontFamily: Fonts.body,
    color: Colors.textPrimary,
  },
});

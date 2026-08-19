import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { dbService, type SavedSession } from '@/services/dbService';

type FilterType = 'ALL' | 'SINGLE' | 'OVERLAP' | 'LAUGHTER';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(start: number, end: number): string {
  const mins = Math.round((end - start) / 60000);
  return mins < 1 ? '< 1 min' : `${mins} min`;
}

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [filter, setFilter] = useState<FilterType>('ALL');

  const loadSessions = useCallback(async () => {
    const data = await dbService.getAllSessions(filter === 'ALL' ? undefined : filter);
    setSessions(data);
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [loadSessions]),
  );

  const deleteSession = async (id: string) => {
    await dbService.deleteSession(id);
    loadSessions();
  };

  const filters: FilterType[] = ['ALL', 'SINGLE', 'OVERLAP', 'LAUGHTER'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Session History</Text>

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={loadSessions}
        refreshing={false}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filter === 'ALL'
              ? 'No sessions saved yet. Start a conversation.'
              : `No saved sessions contain ${filter.toLowerCase()} speech.`}
          </Text>
        }
        renderItem={({ item }) => (
          <Swipeable
            renderRightActions={() => (
              <Pressable
                style={styles.deleteAction}
                onPress={() => deleteSession(item.id)}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            )}>
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/session/${item.id}`)}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardDate}>{formatDate(item.startedAt)}</Text>
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>
                  {formatDuration(item.startedAt, item.endedAt)}
                </Text>
                <Text style={styles.metaDot}>•</Text>
                <Text style={styles.metaText}>{item.utteranceCount} utterances</Text>
                <Text style={styles.metaDot}>•</Text>
                <Text style={styles.metaText}>{item.locationTag}</Text>
              </View>
            </Pressable>
          </Swipeable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.textPrimary,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 36,
    justifyContent: 'center',
  },
  filterChipActive: {
    borderColor: Colors.primary,
    backgroundColor: `${Colors.primary}15`,
  },
  filterText: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  filterTextActive: {
    color: Colors.primary,
  },
  list: {
    padding: 20,
    gap: 12,
    paddingTop: 4,
  },
  empty: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingTop: 48,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    minHeight: 72,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  cardDate: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  metaText: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  metaDot: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  deleteAction: {
    backgroundColor: Colors.overlap,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginLeft: 8,
  },
  deleteText: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.textPrimary,
  },
});

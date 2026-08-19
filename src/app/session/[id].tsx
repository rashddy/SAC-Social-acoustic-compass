import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TranscriptCard } from '@/components/TranscriptCard';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { dbService, type SavedSession } from '@/services/dbService';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<SavedSession | null>(null);

  useEffect(() => {
    if (id) dbService.getSession(id).then(setSession);
  }, [id]);

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loading}>Loading session…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="close" size={28} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{session.title}</Text>
          <Text style={styles.meta}>
            {session.utteranceCount} utterances • {session.locationTag}
          </Text>
        </View>
      </View>

      <FlatList
        data={session.entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <TranscriptCard entry={item} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  back: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.displayMedium,
    fontSize: 18,
    color: Colors.textPrimary,
  },
  meta: {
    fontFamily: Fonts.label,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  list: {
    padding: 20,
    gap: 12,
  },
});

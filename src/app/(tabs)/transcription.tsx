import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SACButton } from '@/components/SACButton';
import { TranscriptCard } from '@/components/TranscriptCard';
import { Colors, FontScaleMultiplier } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { dbService } from '@/services/dbService';
import type { TranscriptEntry } from '@/store/compassStore';
import { directionLabel, useCompassStore } from '@/store/compassStore';

export default function TranscriptionScreen() {
  const sessionLog = useCompassStore((s) => s.sessionLog);
  const liveTranscript = useCompassStore((s) => s.liveTranscript);
  const streamingWord = useCompassStore((s) => s.streamingWord);
  const transcriptionPaused = useCompassStore((s) => s.transcriptionPaused);
  const fontScale = useCompassStore((s) => s.fontScale);
  const currentDoa = useCompassStore((s) => s.currentDoa);
  const audioState = useCompassStore((s) => s.audioState);
  const emotion = useCompassStore((s) => s.emotion);
  const confidence = useCompassStore((s) => s.confidence);
  const speakerCount = useCompassStore((s) => s.speakerCount);
  const clearSessionLog = useCompassStore((s) => s.clearSessionLog);
  const setTranscriptionPaused = useCompassStore((s) => s.setTranscriptionPaused);
  const listRef = useRef<FlatList>(null);
  const fontSize = 15 * FontScaleMultiplier[fontScale];

  const allEntries: TranscriptEntry[] = [
    ...sessionLog,
    ...(liveTranscript
      ? [
          {
            id: 'live',
            text: `${liveTranscript}${streamingWord ? ` ${streamingWord}` : ''}`,
            doa: currentDoa,
            direction: directionLabel(currentDoa),
            speakerId: 0,
            audioState,
            emotion,
            confidence,
            speakerCount,
            timestamp: Date.now(),
          },
        ]
      : []),
  ];

  useEffect(() => {
    if (!transcriptionPaused && allEntries.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [allEntries.length, transcriptionPaused]);

  const copyAll = async () => {
    const text = sessionLog.map((e) => `[${e.direction}] ${e.text}`).join('\n\n');
    await Clipboard.setStringAsync(text || 'No transcript yet.');
    Alert.alert('Copied', 'Full transcript copied to clipboard.');
  };

  const saveSession = async () => {
    if (sessionLog.length === 0) {
      Alert.alert('Nothing to save', 'Start a conversation first.');
      return;
    }
    const id = await dbService.saveSession(sessionLog);
    if (!id) {
      Alert.alert('Save failed', 'The session could not be written to local storage.');
      return;
    }
    Alert.alert('Saved', `Session #${id} saved with ${sessionLog.length} entries.`, [
      { text: 'Keep Transcript', style: 'cancel' },
      { text: 'Start New Session', onPress: clearSessionLog },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Transcription</Text>
        <Pressable
          onPress={() => setTranscriptionPaused(!transcriptionPaused)}
          style={[styles.pauseBtn, transcriptionPaused && styles.pauseBtnActive]}
          hitSlop={8}>
          <Text style={styles.pauseText}>{transcriptionPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={allEntries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Transcription will appear here as speech is detected.
          </Text>
        }
        renderItem={({ item }) => (
          <TranscriptCard entry={item} fontSize={fontSize} />
        )}
      />

      <View style={styles.actions}>
        <SACButton title="Copy All" onPress={copyAll} variant="secondary" icon="copy-outline" />
        <SACButton title="Save Session" onPress={saveSession} icon="save-outline" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.textPrimary,
  },
  pauseBtn: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  pauseBtnActive: {
    borderColor: Colors.warning,
  },
  pauseText: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.primary,
  },
  list: {
    padding: 20,
    gap: 12,
    paddingBottom: 8,
  },
  empty: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingTop: 48,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
});

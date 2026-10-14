import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, FontScaleMultiplier } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { directionLabel, useCompassStore } from '@/store/compassStore';

type ChatRow = {
  id: string;
  from: 'them' | 'me' | 'live';
  text: string;
  label: string;
  timestamp: number;
};

function prettyDirection(direction: string): string {
  const cleaned = direction.trim().toLowerCase();
  if (!cleaned) return 'Someone';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function TranscriptionScreen() {
  const sessionLog = useCompassStore((s) => s.sessionLog);
  const replies = useCompassStore((s) => s.replies) ?? [];
  const addReply = useCompassStore((s) => s.addReply);
  const streamingWord = useCompassStore((s) => s.streamingWord);
  const transcriptionPaused = useCompassStore((s) => s.transcriptionPaused);
  const setTranscriptionPaused = useCompassStore((s) => s.setTranscriptionPaused);
  const fontScale = useCompassStore((s) => s.fontScale);
  const currentDoa = useCompassStore((s) => s.currentDoa);

  const [draft, setDraft] = useState('');
  const [showing, setShowing] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const listRef = useRef<FlatList<ChatRow>>(null);
  const insets = useSafeAreaInsets();
  const fontSize = 16 * FontScaleMultiplier[fontScale];

  const rows = useMemo(() => {
    const heard: ChatRow[] = sessionLog.map((entry) => ({
      id: entry.id,
      from: 'them',
      text: entry.text,
      label: prettyDirection(entry.direction),
      timestamp: entry.timestamp,
    }));
    const mine: ChatRow[] = replies.map((reply) => ({
      id: reply.id,
      from: 'me',
      text: reply.text,
      label: 'You',
      timestamp: reply.timestamp,
    }));
    const partial = streamingWord.trim();
    const live: ChatRow[] = partial
      ? [
          {
            id: 'live',
            from: 'live',
            text: partial,
            label: prettyDirection(directionLabel(currentDoa)),
            timestamp: Date.now(),
          },
        ]
      : [];
    return [...heard, ...mine].sort((a, b) => a.timestamp - b.timestamp).concat(live);
  }, [sessionLog, replies, streamingWord, currentDoa]);

  useEffect(() => {
    if (sessionLog.length === 0 && replies.length === 0) setShowing(null);
  }, [sessionLog.length, replies.length]);

  useEffect(() => {
    if (rows.length === 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 40);
    return () => clearTimeout(timer);
  }, [rows.length]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    addReply(text);
    setDraft('');
    Keyboard.dismiss();
    setShowing(text);
  };

  const keyboardLift = keyboardHeight > 0 ? Math.max(0, keyboardHeight - insets.bottom - 56) : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Chat</Text>
          <Text style={styles.subtitle}>Hear them. Type back. Show your phone.</Text>
        </View>
        <Pressable
          onPress={() => setTranscriptionPaused(!transcriptionPaused)}
          style={styles.pauseBtn}
          hitSlop={8}>
          <Text style={styles.pauseText}>{transcriptionPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.empty}>
              Words from the room show up on the left. Type a reply on the right, then turn the
              phone so the other person can read it.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const mine = item.from === 'me';
          return (
            <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
              <Text style={[styles.who, mine && styles.whoMine]}>{item.label}</Text>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text
                  style={[
                    styles.bubbleText,
                    mine && styles.bubbleTextMine,
                    item.from === 'live' && styles.bubbleLive,
                    { fontSize, lineHeight: fontSize * 1.4 },
                  ]}>
                  {item.text}
                </Text>
              </View>
              <Text style={[styles.time, mine && styles.timeMine]}>{formatTime(item.timestamp)}</Text>
            </View>
          );
        }}
      />

      <View style={[styles.composer, { marginBottom: keyboardLift }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a reply"
          placeholderTextColor={Colors.textSecondary}
          style={[styles.input, { fontSize }]}
          multiline
          maxLength={400}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={send}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim()}
          style={[styles.send, !draft.trim() && styles.sendDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Send reply">
          <Ionicons name="arrow-up" size={22} color={Colors.onPrimary} />
        </Pressable>
      </View>

      <Modal visible={showing != null} animationType="fade" onRequestClose={() => setShowing(null)}>
        <SafeAreaView style={styles.show}>
          <Text style={styles.showLabel}>Show this to them</Text>
          <Text style={styles.showText}>{showing}</Text>
          <Pressable onPress={() => setShowing(null)} style={styles.showDone}>
            <Text style={styles.showDoneText}>Back to chat</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
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
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  pauseBtn: {
    minHeight: 48,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: Colors.surface,
  },
  pauseText: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.primary,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexGrow: 1,
    gap: 14,
  },
  emptyWrap: {
    paddingTop: 64,
    paddingHorizontal: 12,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  empty: {
    fontFamily: Fonts.labelRegular,
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  bubbleRow: {
    alignItems: 'flex-start',
    maxWidth: '86%',
    gap: 4,
  },
  bubbleRowMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  who: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 13,
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  whoMine: {
    marginLeft: 0,
    marginRight: 4,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleTheirs: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontFamily: Fonts.labelRegular,
    color: Colors.textPrimary,
  },
  bubbleTextMine: {
    color: Colors.onPrimary,
  },
  bubbleLive: {
    fontStyle: 'italic',
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  timeMine: {
    marginLeft: 0,
    marginRight: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    color: Colors.textPrimary,
    fontFamily: Fonts.labelRegular,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 14 : 10,
    paddingBottom: Platform.OS === 'ios' ? 14 : 10,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.35,
  },
  show: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
    paddingVertical: 24,
  },
  showLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  showText: {
    fontFamily: Fonts.display,
    fontSize: 40,
    lineHeight: 48,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  showDone: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showDoneText: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 17,
    color: Colors.primary,
  },
});

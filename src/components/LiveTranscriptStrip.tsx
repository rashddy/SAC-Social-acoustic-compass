import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontScaleMultiplier } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { useCompassStore } from '@/store/compassStore';

type Props = {
  maxLines?: number;
};

export function LiveTranscriptStrip({ maxLines = 3 }: Props) {
  const liveTranscript = useCompassStore((s) => s.liveTranscript);
  const streamingWord = useCompassStore((s) => s.streamingWord);
  const fontScale = useCompassStore((s) => s.fontScale);
  const fontSize = 15 * FontScaleMultiplier[fontScale];

  const words = liveTranscript.split(' ').filter(Boolean);
  const displayWords = words.slice(-maxLines * 8);

  return (
    <View style={styles.strip}>
      <Text style={[styles.text, { fontSize, lineHeight: fontSize * 1.6 }]}>
        {displayWords.map((word, i) => {
          const isLast = i === displayWords.length - 1 && streamingWord === word;
          return (
            <Text key={`${word}-${i}`} style={isLast ? styles.highlight : undefined}>
              {word}{' '}
            </Text>
          );
        })}
        {streamingWord && !words.includes(streamingWord) && (
          <Text style={styles.highlight}>{streamingWord}</Text>
        )}
        {!liveTranscript && !streamingWord && (
          <Text style={styles.placeholder}>Listening for speech…</Text>
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    minHeight: 72,
  },
  text: {
    fontFamily: Fonts.body,
    color: Colors.textPrimary,
  },
  highlight: {
    color: Colors.primary,
    fontFamily: Fonts.bodyMedium,
  },
  placeholder: {
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
});

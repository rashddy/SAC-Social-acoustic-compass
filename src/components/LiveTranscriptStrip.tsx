import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontScaleMultiplier } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { useCompassStore } from '@/store/compassStore';

type Props = {
  maxLines?: number;
};

/**
 * Shows only the in-progress partial. Finished lines go to the session log.
 */
export function LiveTranscriptStrip({ maxLines = 3 }: Props) {
  const streamingWord = useCompassStore((s) => s.streamingWord);
  const lastFinal = useCompassStore((s) => s.sessionLog[s.sessionLog.length - 1]?.text ?? '');
  const sttHint = useCompassStore((s) => s.sttHint);
  const fontScale = useCompassStore((s) => s.fontScale);
  const compassUp = useCompassStore((s) => s.devices.COMPASS.status === 'CONNECTED');
  const fontSize = 15 * FontScaleMultiplier[fontScale];

  const live = streamingWord.trim();
  const partial = live && live !== '…' ? live : lastFinal.trim();
  const words = partial.split(/\s+/).filter(Boolean);
  const display = words.slice(-(maxLines * 8)).join(' ');

  let placeholder = 'Waiting for speech…';
  if (!compassUp) {
    placeholder = 'Connect the compass to start transcription';
  } else if (sttHint) {
    placeholder = sttHint;
  }

  return (
    <View style={styles.strip}>
      <Text style={[styles.text, { fontSize, lineHeight: fontSize * 1.5 }]}>
        {display ? display : <Text style={styles.placeholder}>{placeholder}</Text>}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  text: {
    fontFamily: Fonts.labelRegular,
    color: Colors.textPrimary,
  },
  placeholder: {
    color: Colors.textSecondary,
  },
});

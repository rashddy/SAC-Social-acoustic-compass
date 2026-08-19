import type { SttEngine, SttResult } from './types';

const DEMO_SENTENCES = [
  'Hello, how are you doing today?',
  'I think the presentation starts at three.',
  'Can you hear me from over here?',
  'That joke was really funny!',
  'Wait, two people are talking at once.',
  'The room is quiet now.',
  'There is some background noise.',
];

const DEMO_WORDS = DEMO_SENTENCES.flatMap((sentence) => sentence.split(' '));

const isSentenceEnd = (word: string): boolean => /[.?!]$/.test(word);

/**
 * Default engine. Emits scripted words so every screen, session record, and
 * use-case walkthrough works before the wearables and the trained models exist.
 */
export const createSimulatedEngine = (): SttEngine => {
  let wordIndex = 0;
  let handler: ((result: SttResult) => void) | null = null;

  return {
    id: 'SIMULATED',
    label: 'Simulated (demo)',
    isAvailable: () => true,
    unavailableReason: () => '',

    async load() {
      wordIndex = 0;
      return true;
    },

    async unload() {
      handler = null;
    },

    pushAudio() {
      const word = DEMO_WORDS[wordIndex % DEMO_WORDS.length];
      wordIndex += 1;
      handler?.({
        text: word,
        isFinal: isSentenceEnd(word),
        confidence: 0.8 + Math.random() * 0.15,
      });
    },

    onResult(next) {
      handler = next;
    },
  };
};

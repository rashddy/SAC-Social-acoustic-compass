import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SACButton } from '@/components/SACButton';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { authService } from '@/services/auth/authService';
import { bleService } from '@/services/bleService';
import { dbService } from '@/services/dbService';
import { useCompassStore } from '@/store/compassStore';

const SPLASH_DURATION_MS = 1200;

const INTRO_SLIDES = [
  {
    id: '1',
    icon: 'compass' as const,
    title: 'Where speech is',
    body: 'The dial points to the person talking: in front of you, to your left, or to your right.',
  },
  {
    id: '2',
    icon: 'document-text' as const,
    title: 'Captions on this phone',
    body: 'Words show up as they are spoken. Nothing is sent off the phone.',
  },
  {
    id: '3',
    icon: 'shirt' as const,
    title: 'A buzz on the vest',
    body: 'The vest vibrates on the front, left, right, or back, so you can feel where the voice is coming from.',
  },
];

type Phase = 'splash' | 'intro' | 'ready';

export default function OnboardingScreen() {
  const { hub } = useLocalSearchParams<{ hub?: string }>();
  const [phase, setPhase] = useState<Phase>(hub === '1' ? 'ready' : 'splash');
  const [activeIndex, setActiveIndex] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const setHasCompletedOnboarding = useCompassStore((s) => s.setHasCompletedOnboarding);
  const width = Dimensions.get('window').width;

  useEffect(() => {
    if (hub === '1') {
      setPhase('ready');
      return;
    }

    let cancelled = false;

    const finishSplash = async () => {
      let completed: string | null = null;
      let account = false;
      try {
        [completed, account] = await Promise.all([
          dbService.getSetting('onboarding_complete'),
          authService.hasAccount(),
          new Promise<void>((resolve) => setTimeout(resolve, SPLASH_DURATION_MS)),
        ]).then(([done, hasAccount]) => [done, hasAccount] as [string | null, boolean]);
      } catch {
        // Never let a storage failure trap the user on the splash screen.
      }
      if (cancelled) return;

      if (account) {
        router.replace('/auth');
        return;
      }
      setPhase(completed === 'true' ? 'ready' : 'intro');
    };

    finishSplash();
    return () => {
      cancelled = true;
    };
  }, [hub]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) setActiveIndex(viewableItems[0].index);
  }).current;

  const goToReady = async () => {
    await dbService.setSetting('onboarding_complete', 'true');
    setHasCompletedOnboarding(true);
    setPhase('ready');
  };

  const handleNextSlide = () => {
    if (activeIndex < INTRO_SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      goToReady();
    }
  };

  const connectWearables = () => {
    router.push('/auth?redirect=/pair');
  };

  const openApp = () => {
    setHasCompletedOnboarding(true);
    router.replace('/auth?redirect=/(tabs)/home');
  };

  if (phase === 'splash') {
    return (
      <View style={styles.splashContainer}>
        <View style={styles.splashContent}>
          <Ionicons name="compass" size={40} color={Colors.textPrimary} />
          <Text style={styles.splashTitle}>Social Acoustic Compass</Text>
          <Text style={styles.splashSub}>WMSU Department of IT</Text>
        </View>
      </View>
    );
  }

  if (phase === 'intro') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.introHeader}>
          <Text style={styles.introLabel}>How it works</Text>
          <Text style={styles.introStep}>
            {activeIndex + 1} of {INTRO_SLIDES.length}
          </Text>
        </View>

        <FlatList
          ref={flatRef}
          data={INTRO_SLIDES}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
          renderItem={({ item }) => (
            <View style={[styles.slide, { width: width - 48 }]}>
              <Ionicons name={item.icon} size={32} color={Colors.textPrimary} />
              <Text style={styles.slideTitle}>{item.title}</Text>
              <Text style={styles.slideBody}>{item.body}</Text>
            </View>
          )}
          style={styles.carousel}
        />

        <View style={styles.dots}>
          {INTRO_SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.introFooter}>
          <SACButton
            title={activeIndex < INTRO_SLIDES.length - 1 ? 'Next' : 'Continue'}
            onPress={handleNextSlide}
            icon="arrow-forward"
          />
          <SACButton title="Skip" onPress={goToReady} variant="ghost" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.readyScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.readyHero}>
          <Text style={styles.appName}>Compass</Text>
          <Text style={styles.tagline}>
            Wear the compass. This phone shows where speech is coming from and writes it down.
          </Text>
        </View>

        {!bleService.isSupported() && (
          <Text style={styles.note}>
            Pairing the compass needs the installed app build. You can still open the screens here.
          </Text>
        )}

        <View style={styles.readyActions}>
          <SACButton title="Connect compass" onPress={connectWearables} icon="bluetooth" />
          <SACButton title="Open compass" onPress={openApp} variant="secondary" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashContent: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  splashTitle: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  splashSub: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
  },
  introHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
  },
  introLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.textSecondary,
  },
  introStep: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textSecondary,
  },
  carousel: {
    flexGrow: 0,
    marginTop: 32,
  },
  slide: {
    paddingHorizontal: 8,
    gap: 16,
    paddingTop: 8,
  },
  slideTitle: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.textPrimary,
  },
  slideBody: {
    fontFamily: Fonts.labelRegular,
    fontSize: 17,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.silence,
  },
  dotActive: {
    backgroundColor: Colors.primary,
    width: 20,
  },
  introFooter: {
    marginTop: 'auto',
    paddingBottom: 24,
    gap: 8,
  },
  readyScroll: {
    paddingBottom: 40,
    paddingTop: 48,
    gap: 28,
  },
  readyHero: {
    gap: 12,
  },
  appName: {
    fontFamily: Fonts.display,
    fontSize: 34,
    color: Colors.textPrimary,
  },
  tagline: {
    fontFamily: Fonts.labelRegular,
    fontSize: 17,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
  note: {
    fontFamily: Fonts.labelRegular,
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  readyActions: {
    gap: 12,
  },
});

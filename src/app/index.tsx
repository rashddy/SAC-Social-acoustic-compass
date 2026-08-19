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
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SACButton } from '@/components/SACButton';
import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { bleService } from '@/services/bleService';
import { userRepo } from '@/services/db';
import { dbService } from '@/services/dbService';
import { demoService } from '@/services/demoService';
import { useCompassStore } from '@/store/compassStore';

const SPLASH_DURATION_MS = 3500;

const INTRO_SLIDES = [
  {
    id: '1',
    icon: 'compass' as const,
    color: Colors.primary,
    title: 'Spatial Radar Compass',
    body: 'A live polar radar shows where speech comes from — a glowing dot moves in real time so you always know who is talking and from which direction.',
  },
  {
    id: '2',
    icon: 'document-text' as const,
    color: Colors.primary,
    title: 'Live Transcription',
    body: 'Speech is captioned word-by-word, offline. Each utterance shows direction, timestamp, and audio state — speech, laughter, or overlap.',
  },
  {
    id: '3',
    icon: 'watch' as const,
    color: Colors.secondary,
    title: 'Haptic Wristband',
    body: 'The SAC-Wristband vibrates toward the speaker — North, East, South, or West — so you feel the conversation, not just read it.',
  },
  {
    id: '4',
    icon: 'time' as const,
    color: Colors.secondary,
    title: 'Session History',
    body: 'Save and replay full conversations. Review transcripts by date, filter by audio state, and export for later reading.',
  },
  {
    id: '5',
    icon: 'mic' as const,
    color: Colors.warning,
    title: 'Wearable Necklace Mic',
    body: 'The SAC-Necklace captures room audio and direction-of-arrival data, sent to your phone via Bluetooth Low Energy — no internet needed.',
  },
  {
    id: '6',
    icon: 'shield-checkmark' as const,
    color: Colors.primary,
    title: '100% Offline',
    body: 'All processing stays on your device. No cloud, no API calls. Built for Deaf and Hard-of-Hearing users who need reliable, private assistive tech.',
  },
];

const FEATURES = [
  { icon: 'compass' as const, label: 'Compass', color: Colors.primary },
  { icon: 'document-text' as const, label: 'Transcript', color: Colors.primary },
  { icon: 'watch' as const, label: 'Wristband', color: Colors.secondary },
  { icon: 'time' as const, label: 'History', color: Colors.secondary },
  { icon: 'bluetooth' as const, label: 'BLE Link', color: Colors.warning },
  { icon: 'cloud-offline' as const, label: 'Offline', color: Colors.primary },
];

type Phase = 'splash' | 'intro' | 'ready';

export default function OnboardingScreen() {
  const { hub } = useLocalSearchParams<{ hub?: string }>();
  const [phase, setPhase] = useState<Phase>(hub === '1' ? 'ready' : 'splash');
  const [activeIndex, setActiveIndex] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const setHasCompletedOnboarding = useCompassStore((s) => s.setHasCompletedOnboarding);
  const setDemoMode = useCompassStore((s) => s.setDemoMode);
  const width = Dimensions.get('window').width;

  const pulse = useSharedValue(1);
  const ringOpacity = useSharedValue(0.3);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 1200 }),
        withTiming(1, { duration: 1200 }),
      ),
      -1,
      false,
    );
    ringOpacity.value = withRepeat(
      withSequence(
        withTiming(0.8, { duration: 1200 }),
        withTiming(0.2, { duration: 1200 }),
      ),
      -1,
      false,
    );
  }, [pulse, ringOpacity]);

  useEffect(() => {
    if (hub === '1') {
      setPhase('ready');
      return;
    }

    let cancelled = false;

    const finishSplash = async () => {
      let completed: string | null = null;
      let pinRequired = false;
      try {
        [completed, pinRequired] = await Promise.all([
          dbService.getSetting('onboarding_complete'),
          userRepo.hasPin(),
          new Promise<void>((resolve) => setTimeout(resolve, SPLASH_DURATION_MS)),
        ]).then(([done, hasPin]) => [done, hasPin] as [string | null, boolean]);
      } catch {
        // Never let a storage failure trap the user on the splash screen.
      }
      if (cancelled) return;

      // A configured PIN gates everything past the splash (Functional Req. A).
      if (completed === 'true' && pinRequired) {
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

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: pulse.value }],
  }));

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
    router.push('/pair');
  };

  const enterDemoMode = () => {
    demoService.start();
    setDemoMode(true);
    setHasCompletedOnboarding(true);
    router.replace('/(tabs)/home');
  };

  if (phase === 'splash') {
    return (
      <View style={styles.splashContainer}>
        <Animated.View style={[styles.splashRingOuter, ringStyle]} />
        <Animated.View style={[styles.splashRingInner, ringStyle]} />
        {/* First paint stays free of entering animations so the branding is
            always visible, even on a cold start over a slow dev server. */}
        <View style={styles.splashContent}>
          <Animated.View style={[styles.iconRing, pulseStyle]}>
            <Ionicons name="compass" size={56} color={Colors.primary} />
          </Animated.View>
          <Text style={styles.splashTitle}>Social Acoustic Compass</Text>
          <Text style={styles.splashTagline}>Hear the room. Feel the direction.</Text>
          <Text style={styles.splashSub}>WMSU · Department of IT · Capstone 2026</Text>
        </View>
        <View style={styles.splashLoader}>
          <View style={styles.loaderBar}>
            <Animated.View style={[styles.loaderFill, pulseStyle]} />
          </View>
        </View>
      </View>
    );
  }

  if (phase === 'intro') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.introHeader}>
          <Text style={styles.introLabel}>What this app does</Text>
          <Text style={styles.introStep}>
            {activeIndex + 1} / {INTRO_SLIDES.length}
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
              <View style={[styles.slideIconWrap, { borderColor: `${item.color}44` }]}>
                <Ionicons name={item.icon} size={36} color={item.color} />
              </View>
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
          <SACButton title="Skip to Get Started" onPress={goToReady} variant="ghost" />
        </View>
      </SafeAreaView>
    );
  }

  // phase === 'ready' — Get Started hub for panel demo
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.readyScroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(500)} style={styles.readyHero}>
          <View style={styles.iconRing}>
            <Ionicons name="compass" size={44} color={Colors.primary} />
          </View>
          <Text style={styles.appName}>Social Acoustic Compass</Text>
          <Text style={styles.tagline}>Assistive system for Deaf & Hard-of-Hearing users</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>WMSU · Capstone Project · 100% Offline</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(150).duration(500)}>
          <Text style={styles.sectionLabel}>App Features</Text>
          <View style={styles.featureGrid}>
            {FEATURES.map((f) => (
              <View key={f.label} style={styles.featureCard}>
                <Ionicons name={f.icon} size={24} color={f.color} />
                <Text style={styles.featureLabel}>{f.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(300).duration(500)} style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>How it works</Text>
          <Text style={styles.summaryBody}>
            Wear the SAC-Necklace mic and SAC-Wristband. The app receives direction-of-arrival
            data over Bluetooth, shows a live radar compass, captions speech in real time, and
            sends haptic feedback toward the active speaker — all without internet.
          </Text>
        </Animated.View>

        {!bleService.isSupported() && (
          <View style={styles.expoNote}>
            <Ionicons name="information-circle" size={18} color={Colors.warning} />
            <Text style={styles.expoNoteText}>
              Running in Expo Go — Bluetooth requires a dev build. Use Demo Mode to preview all
              features for your presentation.
            </Text>
          </View>
        )}

        <Animated.View entering={FadeInDown.delay(450).duration(500)} style={styles.readyActions}>
          <Text style={styles.sectionLabel}>Get Started</Text>
          <SACButton
            title="Connect Wearables (Bluetooth)"
            onPress={connectWearables}
            icon="bluetooth"
          />
          <SACButton
            title="Try Demo Mode"
            onPress={enterDemoMode}
            variant="secondary"
            icon="play-circle"
          />
          <Text style={styles.demoHint}>
            Demo Mode simulates live compass, transcription, and wristband — perfect for
            showcasing the app to your panel.
          </Text>
        </Animated.View>
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
  splashRingOuter: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  splashRingInner: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: `${Colors.primary}66`,
  },
  splashContent: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  splashTitle: {
    fontFamily: Fonts.display,
    fontSize: 32,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginTop: 8,
  },
  splashTagline: {
    fontFamily: Fonts.label,
    fontSize: 16,
    color: Colors.primary,
    textAlign: 'center',
  },
  splashSub: {
    fontFamily: Fonts.label,
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  splashLoader: {
    position: 'absolute',
    bottom: 80,
    width: 120,
  },
  loaderBar: {
    height: 3,
    backgroundColor: Colors.silence,
    borderRadius: 2,
    overflow: 'hidden',
  },
  loaderFill: {
    width: '60%',
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
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
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  introStep: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.primary,
  },
  carousel: {
    flexGrow: 0,
    marginTop: 16,
  },
  slide: {
    paddingHorizontal: 8,
    gap: 16,
    paddingTop: 8,
  },
  slideIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideTitle: {
    fontFamily: Fonts.displayMedium,
    fontSize: 22,
    color: Colors.textPrimary,
  },
  slideBody: {
    fontFamily: Fonts.labelRegular,
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    flexWrap: 'wrap',
    paddingHorizontal: 16,
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
    gap: 24,
  },
  readyHero: {
    alignItems: 'center',
    paddingTop: 24,
    gap: 10,
  },
  iconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  appName: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  tagline: {
    fontFamily: Fonts.label,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  badge: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: `${Colors.primary}15`,
    borderWidth: 1,
    borderColor: `${Colors.primary}33`,
  },
  badgeText: {
    fontFamily: Fonts.label,
    fontSize: 11,
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  sectionLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  featureCard: {
    width: '30%',
    flexGrow: 1,
    minWidth: 96,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    alignItems: 'center',
    gap: 8,
    minHeight: 80,
  },
  featureLabel: {
    fontFamily: Fonts.label,
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 8,
  },
  summaryTitle: {
    fontFamily: Fonts.displayMedium,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  summaryBody: {
    fontFamily: Fonts.labelRegular,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  expoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: `${Colors.warning}12`,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${Colors.warning}33`,
    padding: 12,
  },
  expoNoteText: {
    flex: 1,
    fontFamily: Fonts.label,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  readyActions: {
    gap: 12,
  },
  demoHint: {
    fontFamily: Fonts.label,
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
});

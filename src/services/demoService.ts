import {
  DEVICE_LABEL,
  EMOTIONS,
  type AudioStateName,
  type EmotionName,
} from '@/constants/bleConstants';
import { performanceRepo } from '@/services/db';
import { speechService } from '@/services/speechService';
import { useCompassStore } from '@/store/compassStore';

const AUDIO_STATES: AudioStateName[] = ['SINGLE', 'OVERLAP', 'LAUGHTER', 'SILENCE', 'NOISE'];

const TICK_MS = 2000;

/** Emotion is biased by acoustic state so the simulation reads plausibly. */
const emotionForState = (state: AudioStateName, index: number): EmotionName => {
  if (state === 'LAUGHTER') return 'HAPPY';
  if (state === 'SILENCE') return 'NEUTRAL';
  if (state === 'NOISE') return 'URGENT';
  return EMOTIONS[index % EMOTIONS.length];
};

let demoInterval: ReturnType<typeof setInterval> | null = null;
let stateIndex = 0;
/** Cycles LEFT → FRONT → RIGHT (matches the three mics). */
const DEMO_ZONES = [-90, 0, 90] as const;
let zoneIndex = 0;
let compassBattery = 92;
let wristbandBattery = 88;
let ticks = 0;

const jitter = (base: number, spread: number): number =>
  Math.round((base + (Math.random() - 0.5) * spread) * 10) / 10;

export const demoService = {
  isRunning: (): boolean => demoInterval != null,

  /**
   * Drives the whole app from simulated hardware: compass link up, a rotating
   * direction of arrival, all five acoustic states, emotion cues, battery drain,
   * and latency figures that populate the diagnostics screen. Used for panel
   * demos while the wearables are still being fabricated.
   */
  start() {
    demoService.stop();

    const store = useCompassStore.getState();
    store.setDemoMode(true);

    compassBattery = 92;
    wristbandBattery = 88;
    ticks = 0;

    store.setDeviceLink('COMPASS', {
      status: 'CONNECTED',
      id: 'DEMO-COMPASS',
      name: `${DEVICE_LABEL.COMPASS} (Demo)`,
      rssi: -52,
      battery: compassBattery,
      firmware: '1.0.0-demo',
      lastConnected: Date.now(),
      fault: null,
    });
    store.setDeviceLink('WRISTBAND', {
      status: 'CONNECTED',
      id: 'DEMO-WRISTBAND',
      name: `${DEVICE_LABEL.WRISTBAND} (Demo)`,
      rssi: -58,
      battery: wristbandBattery,
      firmware: '1.0.0-demo',
      lastConnected: Date.now(),
      fault: null,
    });

    speechService.startDemoStream();

    demoInterval = setInterval(() => {
      const s = useCompassStore.getState();
      ticks += 1;

      zoneIndex = (zoneIndex + 1) % DEMO_ZONES.length;
      const doaAngle = DEMO_ZONES[zoneIndex]!;
      stateIndex = (stateIndex + 1) % AUDIO_STATES.length;
      const state = AUDIO_STATES[stateIndex];

      // Roughly 1% per minute, so a demo visibly trends downward.
      if (ticks % 15 === 0) {
        compassBattery = Math.max(5, compassBattery - 1);
        wristbandBattery = Math.max(5, wristbandBattery - 1);
        s.setDeviceLink('COMPASS', { battery: compassBattery });
        s.setDeviceLink('WRISTBAND', { battery: wristbandBattery });
      }

      const speakers =
        state === 'OVERLAP'
          ? [
              { doa: -90, id: 0 },
              { doa: 0, id: 1 },
              { doa: 90, id: 2 },
            ]
          : [{ doa: doaAngle, id: 0 }];

      const inferenceMs = jitter(38, 12);
      const tdoaMs = jitter(11, 5);
      const bleLatencyMs = jitter(45, 20);

      s.handleBlePacket({
        doa: doaAngle,
        state,
        confidence: 0.75 + Math.random() * 0.2,
        emotion: emotionForState(state, ticks),
        emotionConfidence: 0.6 + Math.random() * 0.35,
        speakerCount: speakers.length,
        speakers,
        battery: compassBattery,
        firmware: '1.0.0-demo',
        deviceTs: Date.now() - bleLatencyMs,
        inferenceMs,
        tdoaMs,
      });

      performanceRepo.record({
        tinyMLInferenceTime: inferenceMs,
        tdoaComputeTime: tdoaMs,
        bleLatency: bleLatencyMs,
        batteryLevel: compassBattery,
      });
    }, TICK_MS);
  },

  stop() {
    if (demoInterval) {
      clearInterval(demoInterval);
      demoInterval = null;
    }
    speechService.stopDemoStream();
    performanceRepo.flush();
  },

  /** Leaves demo mode and clears the simulated links. */
  exit() {
    demoService.stop();
    const store = useCompassStore.getState();
    store.setDemoMode(false);
    store.resetDevice('COMPASS');
    store.resetDevice('NECKLACE');
    store.resetDevice('WRISTBAND');
  },
};

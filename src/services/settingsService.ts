import { bleService } from '@/services/bleService';
import { settingsRepo, type SacSettings } from '@/services/db';
import { speechService } from '@/services/speechService';
import { useCompassStore } from '@/store/compassStore';

/** Reads the current preferences out of the store in ERD shape. */
const snapshot = (): SacSettings => {
  const s = useCompassStore.getState();
  return {
    hapticIntensity: s.wristbandIntensity,
    vibrationPattern: s.wristbandPattern,
    compassMode: s.compassView,
    speechEngine: s.sttEngine,
    fontSize: s.fontScale,
    highContrast: s.highContrast,
    laughterMode: s.laughterMode,
  };
};

export const settingsService = {
  /** Restores saved preferences on launch so nothing resets between sessions. */
  async hydrate(): Promise<void> {
    const saved = await settingsRepo.load();
    const store = useCompassStore.getState();

    store.setWristbandIntensity(saved.hapticIntensity);
    store.setWristbandPattern(saved.vibrationPattern);
    store.setCompassView(saved.compassMode);
    store.setSttEngine(saved.speechEngine);
    store.setFontScale(saved.fontSize);
    store.setHighContrast(saved.highContrast);
    store.setLaughterMode(saved.laughterMode);

    speechService.setEngine(saved.speechEngine);
  },

  /**
   * Writes preferences to tblDeviceSettings and mirrors the hardware-relevant
   * ones into the necklace's non-volatile storage, so the wearables keep the
   * user's configuration across power cycles (Functional Requirement B).
   */
  async persist(): Promise<void> {
    const settings = snapshot();
    await settingsRepo.save(settings);

    if (bleService.isRoleConnected('NECKLACE')) {
      await bleService.pushSettings({
        hapticIntensity: settings.hapticIntensity,
        vibrationPattern: settings.vibrationPattern,
        compassMode: settings.compassMode,
        laughterMode: settings.laughterMode,
      });
    }
  },
};

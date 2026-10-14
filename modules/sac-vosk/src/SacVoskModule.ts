import { NativeModule, requireNativeModule } from 'expo';

import type { SacVoskModuleEvents, SacVoskPushResult } from './SacVosk.types';

declare class SacVoskModule extends NativeModule<SacVoskModuleEvents> {
  DEFAULT_SAMPLE_RATE: number;
  DEFAULT_MODEL_ASSET: string;
  isLoaded(): boolean;
  loadModel(assetName?: string | null, sampleRate?: number | null): Promise<boolean>;
  pushAudio(base64Pcm: string): SacVoskPushResult;
  flush(): SacVoskPushResult;
  unload(): Promise<void>;
}

export default requireNativeModule<SacVoskModule>('SacVosk');

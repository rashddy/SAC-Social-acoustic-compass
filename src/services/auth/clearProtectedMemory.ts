import { useCompassStore } from '@/store/compassStore';

/** Drops captions and typed replies. Device links stay so a lock does not drop Bluetooth. */
export function clearProtectedMemory(): void {
  const store = useCompassStore.getState();
  store.clearSessionLog();
  store.setLiveTranscript('');
  store.setStreamingWord('');
}

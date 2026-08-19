import type { AudioStateName, EmotionName } from '@/constants/bleConstants';
import { appStateRepo, sessionRepo } from '@/services/db';
import type { TranscriptEntry } from '@/store/compassStore';

/**
 * Thin facade over the ERD repositories in `./db`, kept so screens can read and
 * write sessions without knowing the six-table layout. New code should prefer
 * the repositories directly.
 */

export type SavedSession = {
  id: string;
  title: string;
  locationTag: string;
  startedAt: number;
  endedAt: number;
  utteranceCount: number;
  entries: TranscriptEntry[];
};

export const dbService = {
  async saveSession(
    entries: TranscriptEntry[],
    options?: { title?: string; locationTag?: string },
  ): Promise<string | null> {
    if (entries.length === 0) return null;

    const startTime = entries[0]?.timestamp ?? Date.now();
    const endTime = entries[entries.length - 1]?.timestamp ?? Date.now();
    const totalSpeakers = Math.max(
      1,
      ...entries.map((entry) => entry.speakerCount || 1),
    );

    const sessionID = await sessionRepo.save({
      title: options?.title ?? `Session ${new Date(startTime).toLocaleDateString()}`,
      locationTag: options?.locationTag ?? 'General',
      startTime,
      endTime,
      totalSpeakers,
      events: entries.map((entry) => ({
        transcription: entry.text,
        audioState: entry.audioState as AudioStateName,
        emotion: (entry.emotion ?? 'NEUTRAL') as EmotionName,
        speakerDirection: entry.direction,
        doa: entry.doa,
        confidenceScore: entry.confidence ?? 0,
        speakerCount: entry.speakerCount || 1,
        eventTime: entry.timestamp,
      })),
    });

    return sessionID == null ? null : String(sessionID);
  },

  /** Optionally narrowed to sessions containing a given acoustic state. */
  async getAllSessions(audioState?: AudioStateName): Promise<SavedSession[]> {
    const rows = audioState
      ? await sessionRepo.listByAudioState(audioState)
      : await sessionRepo.list();

    return rows.map((row) => ({
      id: String(row.sessionID),
      title: row.title ?? 'Session',
      locationTag: row.locationTag ?? 'General',
      startedAt: row.startTime,
      endedAt: row.endTime,
      utteranceCount: row.eventCount,
      entries: [],
    }));
  },

  async getSession(id: string): Promise<SavedSession | null> {
    const session = await sessionRepo.findById(Number(id));
    if (!session) return null;

    return {
      id: String(session.sessionID),
      title: session.title ?? 'Session',
      locationTag: session.locationTag ?? 'General',
      startedAt: session.startTime,
      endedAt: session.endTime,
      utteranceCount: session.eventCount,
      entries: session.events.map((event) => ({
        id: String(event.eventID),
        text: event.transcription ?? '',
        doa: event.doa,
        direction: event.speakerDirection,
        speakerId: 0,
        audioState: event.audioState,
        emotion: event.emotion,
        confidence: event.confidenceScore,
        speakerCount: event.speakerCount ?? 1,
        timestamp: event.eventTime ?? session.startTime,
      })),
    };
  },

  async deleteSession(id: string): Promise<void> {
    await sessionRepo.remove(Number(id));
  },

  async clearAllData(): Promise<void> {
    await sessionRepo.clearAll();
  },

  async getSetting(key: string): Promise<string | null> {
    return appStateRepo.get(key);
  },

  async setSetting(key: string, value: string): Promise<void> {
    await appStateRepo.set(key, value);
  },
};

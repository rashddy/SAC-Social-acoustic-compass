import { guard, openDb } from './client';
import type { PerformanceLogRow } from './types';

export type PerformanceInput = {
  sessionID?: number | null;
  tinyMLInferenceTime: number;
  tdoaComputeTime: number;
  bleLatency: number;
  batteryLevel: number;
};

export type MetricSummary = {
  average: number;
  peak: number;
  min: number;
};

export type PerformanceSummary = {
  sampleCount: number;
  inference: MetricSummary;
  tdoa: MetricSummary;
  bleLatency: MetricSummary;
  battery: MetricSummary;
};

const EMPTY_METRIC: MetricSummary = { average: 0, peak: 0, min: 0 };

export const EMPTY_SUMMARY: PerformanceSummary = {
  sampleCount: 0,
  inference: EMPTY_METRIC,
  tdoa: EMPTY_METRIC,
  bleLatency: EMPTY_METRIC,
  battery: EMPTY_METRIC,
};

/** Buffers writes so a 10 Hz telemetry stream doesn't hit SQLite per frame. */
const pending: PerformanceInput[] = [];
const FLUSH_SIZE = 20;

export const performanceRepo = {
  /** Queues one sample; the batch is written once FLUSH_SIZE accumulates. */
  async record(sample: PerformanceInput): Promise<void> {
    pending.push(sample);
    if (pending.length >= FLUSH_SIZE) await performanceRepo.flush();
  },

  async flush(): Promise<void> {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);

    await guard(async () => {
      const db = await openDb();
      await db.withTransactionAsync(async () => {
        for (const sample of batch) {
          await db.runAsync(
            `INSERT INTO tblPerformanceLog
               (sessionID, tinyMLInferenceTime, tdoaComputeTime, bleLatency,
                batteryLevel, recordedAt)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              sample.sessionID ?? null,
              sample.tinyMLInferenceTime,
              sample.tdoaComputeTime,
              sample.bleLatency,
              sample.batteryLevel,
              new Date().toISOString(),
            ],
          );
        }
      });
    }, undefined);
  },

  async summary(): Promise<PerformanceSummary> {
    await performanceRepo.flush();

    return guard(async () => {
      const db = await openDb();
      const row = await db.getFirstAsync<{
        sampleCount: number;
        avgInference: number | null;
        maxInference: number | null;
        minInference: number | null;
        avgTdoa: number | null;
        maxTdoa: number | null;
        minTdoa: number | null;
        avgLatency: number | null;
        maxLatency: number | null;
        minLatency: number | null;
        avgBattery: number | null;
        maxBattery: number | null;
        minBattery: number | null;
      }>(
        `SELECT COUNT(*) AS sampleCount,
                AVG(tinyMLInferenceTime) AS avgInference,
                MAX(tinyMLInferenceTime) AS maxInference,
                MIN(tinyMLInferenceTime) AS minInference,
                AVG(tdoaComputeTime) AS avgTdoa,
                MAX(tdoaComputeTime) AS maxTdoa,
                MIN(tdoaComputeTime) AS minTdoa,
                AVG(bleLatency) AS avgLatency,
                MAX(bleLatency) AS maxLatency,
                MIN(bleLatency) AS minLatency,
                AVG(batteryLevel) AS avgBattery,
                MAX(batteryLevel) AS maxBattery,
                MIN(batteryLevel) AS minBattery
           FROM tblPerformanceLog`,
      );

      if (!row || row.sampleCount === 0) return EMPTY_SUMMARY;

      const metric = (
        average: number | null,
        peak: number | null,
        min: number | null,
      ): MetricSummary => ({
        average: Math.round((average ?? 0) * 10) / 10,
        peak: Math.round((peak ?? 0) * 10) / 10,
        min: Math.round((min ?? 0) * 10) / 10,
      });

      return {
        sampleCount: row.sampleCount,
        inference: metric(row.avgInference, row.maxInference, row.minInference),
        tdoa: metric(row.avgTdoa, row.maxTdoa, row.minTdoa),
        bleLatency: metric(row.avgLatency, row.maxLatency, row.minLatency),
        battery: metric(row.avgBattery, row.maxBattery, row.minBattery),
      };
    }, EMPTY_SUMMARY);
  },

  async recent(limit = 60): Promise<PerformanceLogRow[]> {
    await performanceRepo.flush();
    return guard(async () => {
      const db = await openDb();
      return db.getAllAsync<PerformanceLogRow>(
        'SELECT * FROM tblPerformanceLog ORDER BY logID DESC LIMIT ?',
        [limit],
      );
    }, []);
  },

  async clear(): Promise<void> {
    pending.length = 0;
    await guard(async () => {
      const db = await openDb();
      await db.execAsync('DELETE FROM tblPerformanceLog');
    }, undefined);
  },
};

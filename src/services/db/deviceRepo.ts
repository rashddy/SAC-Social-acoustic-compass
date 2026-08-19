import type { DeviceRole } from '@/constants/bleConstants';

import { guard, openDb } from './client';
import type { DeviceRow } from './types';
import { userRepo } from './userRepo';

export type DeviceUpsert = {
  deviceName: string;
  deviceType: DeviceRole;
  macAddress: string;
  firmwareVersion?: string | null;
  batteryLevel?: number | null;
  passkeyBonded?: boolean;
};

export const deviceRepo = {
  /** Records a paired wearable, keyed on MAC so re-pairing updates in place. */
  async upsert(device: DeviceUpsert): Promise<number | null> {
    return guard(async () => {
      const db = await openDb();
      const userID = await userRepo.currentUserId();
      if (userID == null) return null;

      await db.runAsync(
        `INSERT INTO tblDevice
           (userID, deviceNAME, deviceType, macaddress, firmwareVersion,
            batteryLevel, lastConnected, passkeyBonded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(macaddress) DO UPDATE SET
           deviceNAME = excluded.deviceNAME,
           deviceType = excluded.deviceType,
           firmwareVersion = COALESCE(excluded.firmwareVersion, tblDevice.firmwareVersion),
           batteryLevel = COALESCE(excluded.batteryLevel, tblDevice.batteryLevel),
           lastConnected = excluded.lastConnected,
           passkeyBonded = MAX(excluded.passkeyBonded, tblDevice.passkeyBonded)`,
        [
          userID,
          device.deviceName,
          device.deviceType,
          device.macAddress,
          device.firmwareVersion ?? null,
          device.batteryLevel ?? null,
          Date.now(),
          device.passkeyBonded ? 1 : 0,
        ],
      );

      const row = await db.getFirstAsync<{ deviceID: number }>(
        'SELECT deviceID FROM tblDevice WHERE macaddress = ?',
        [device.macAddress],
      );
      return row?.deviceID ?? null;
    }, null);
  },

  async list(): Promise<DeviceRow[]> {
    return guard(async () => {
      const db = await openDb();
      return db.getAllAsync<DeviceRow>('SELECT * FROM tblDevice ORDER BY deviceType');
    }, []);
  },

  async findByRole(role: DeviceRole): Promise<DeviceRow | null> {
    return guard(async () => {
      const db = await openDb();
      const row = await db.getFirstAsync<DeviceRow>(
        'SELECT * FROM tblDevice WHERE deviceType = ? ORDER BY lastConnected DESC LIMIT 1',
        [role],
      );
      return row ?? null;
    }, null);
  },

  async isBonded(macAddress: string): Promise<boolean> {
    return guard(async () => {
      const db = await openDb();
      const row = await db.getFirstAsync<{ passkeyBonded: number }>(
        'SELECT passkeyBonded FROM tblDevice WHERE macaddress = ?',
        [macAddress],
      );
      return row?.passkeyBonded === 1;
    }, false);
  },

  async markBonded(macAddress: string): Promise<void> {
    await guard(async () => {
      const db = await openDb();
      await db.runAsync('UPDATE tblDevice SET passkeyBonded = 1 WHERE macaddress = ?', [
        macAddress,
      ]);
    }, undefined);
  },

  async updateTelemetry(
    macAddress: string,
    telemetry: { batteryLevel?: number | null; firmwareVersion?: string | null },
  ): Promise<void> {
    await guard(async () => {
      const db = await openDb();
      await db.runAsync(
        `UPDATE tblDevice
            SET batteryLevel = COALESCE(?, batteryLevel),
                firmwareVersion = COALESCE(?, firmwareVersion),
                lastConnected = ?
          WHERE macaddress = ?`,
        [telemetry.batteryLevel ?? null, telemetry.firmwareVersion ?? null, Date.now(), macAddress],
      );
    }, undefined);
  },

  async remove(macAddress: string): Promise<void> {
    await guard(async () => {
      const db = await openDb();
      await db.runAsync('DELETE FROM tblDevice WHERE macaddress = ?', [macAddress]);
    }, undefined);
  },
};

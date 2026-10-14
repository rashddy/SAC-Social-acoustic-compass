import { decodeBase64ToBytes } from '@/utils/base64';

/**
 * Parse BLE advertising / scan-response fields from Android `rawScanRecord`.
 * ESP32 often puts the Complete Local Name only in the scan response; the first
 * callback can have null `name`/`localName` until these bytes are merged.
 */
export const parseRawScanRecord = (
  rawBase64?: string | null,
): { localName: string | null; serviceUuids: string[] } => {
  if (!rawBase64) return { localName: null, serviceUuids: [] };

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64ToBytes(rawBase64);
  } catch {
    return { localName: null, serviceUuids: [] };
  }

  let localName: string | null = null;
  const serviceUuids: string[] = [];
  let i = 0;

  while (i < bytes.length) {
    const length = bytes[i]!;
    if (length === 0) break;
    if (i + length >= bytes.length) break;

    const type = bytes[i + 1]!;
    const data = bytes.subarray(i + 2, i + 1 + length);
    i += 1 + length;

    // 0x08 Shortened Local Name, 0x09 Complete Local Name
    if ((type === 0x08 || type === 0x09) && data.length > 0) {
      let name = '';
      for (let n = 0; n < data.length; n += 1) {
        const c = data[n]!;
        if (c === 0) break;
        name += String.fromCharCode(c);
      }
      name = name.trim();
      if (name) localName = name;
    }

    // 0x06 Incomplete List of 128-bit Service UUIDs, 0x07 Complete List
    if ((type === 0x06 || type === 0x07) && data.length >= 16) {
      for (let offset = 0; offset + 16 <= data.length; offset += 16) {
        serviceUuids.push(uuidFromAd128(data.subarray(offset, offset + 16)));
      }
    }
  }

  return { localName, serviceUuids };
};

/** AD 128-bit UUIDs are little-endian byte arrays. */
const uuidFromAd128 = (le: Uint8Array): string => {
  const b = Array.from(le);
  const be = b.reverse();
  const hex = be.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Compare BLE UUIDs ignoring dashes and case. */
export const uuidsEqual = (a?: string | null, b?: string | null): boolean => {
  if (!a || !b) return false;
  return a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase();
};

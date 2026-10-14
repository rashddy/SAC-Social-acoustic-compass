/** Vibration pads. The phone shows left, front, and right. */
export type VestZone = 'FRONT' | 'LEFT' | 'RIGHT' | 'BACK';

export const VEST_ZONE_LABEL: Record<VestZone, string> = {
  FRONT: 'Front',
  LEFT: 'Left',
  RIGHT: 'Right',
  BACK: 'Back',
};

/**
 * Map direction-of-arrival to a vest pad.
 * 0° is straight ahead. Behind the wearer is the back pad.
 */
export function doaToVestZone(doa: number): VestZone {
  let n = ((doa % 360) + 360) % 360;
  if (n > 180) n -= 360;
  if (n >= -45 && n <= 45) return 'FRONT';
  if (n > 45 && n <= 135) return 'RIGHT';
  if (n < -45 && n >= -135) return 'LEFT';
  return 'BACK';
}

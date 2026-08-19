import type { WristbandDirection } from '@/store/compassStore';

export function toCardinalMotor(direction: WristbandDirection): 'N' | 'E' | 'S' | 'W' | null {
  if (!direction) return null;
  if (direction === 'N' || direction === 'NE' || direction === 'NW') return 'N';
  if (direction === 'E') return 'E';
  if (direction === 'S' || direction === 'SE' || direction === 'SW') return 'S';
  if (direction === 'W') return 'W';
  return null;
}

import { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import type { SpeakerDot } from '@/store/compassStore';
import { doaToMicZone, type MicZone } from '@/store/compassStore';

/** Fixed mic zones on the dial (degrees from north / front). */
const ZONE_ANGLE: Record<MicZone, number> = {
  FRONT: 0,
  RIGHT: 90,
  LEFT: 270,
};

const ZONE_LABELS: { zone: MicZone; angle: number; label: string }[] = [
  { zone: 'FRONT', angle: 0, label: 'Front' },
  { zone: 'RIGHT', angle: 90, label: 'Right' },
  { zone: 'LEFT', angle: 270, label: 'Left' },
];

type Props = {
  doa: number;
  speakers: SpeakerDot[];
  isSpeaking: boolean;
  viewMode?: 'RADAR' | 'ARROW';
};

function polarToXY(cx: number, cy: number, r: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return {
    x: cx + r * Math.sin(rad),
    y: cy - r * Math.cos(rad),
  };
}

export function RadarCompass({ doa, speakers, isSpeaking, viewMode = 'RADAR' }: Props) {
  const { width } = useWindowDimensions();
  const size = Math.min(width * 0.78, 320);
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 36;

  const pulseScale = useSharedValue(1);

  const activeZone = isSpeaking ? doaToMicZone(doa) : null;

  useEffect(() => {
    if (isSpeaking) {
      pulseScale.value = withRepeat(
        withTiming(1.08, { duration: 420, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      pulseScale.value = withTiming(1, { duration: 120 });
    }
  }, [isSpeaking, pulseScale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const tipAngle = activeZone ? ZONE_ANGLE[activeZone] : 0;
  const tip = polarToXY(cx, cy, maxR * 0.62, tipAngle);

  if (viewMode === 'ARROW') {
    return (
      <View style={[styles.container, { width: size, height: size }]}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={maxR} stroke={Colors.border} strokeWidth={1.5} fill={Colors.surface} />
          {ZONE_LABELS.map(({ label, angle }) => {
            const pos = polarToXY(cx, cy, maxR + 18, angle);
            return (
              <SvgText
                key={label}
                x={pos.x}
                y={pos.y + 4}
                fill={Colors.textSecondary}
                fontSize={11}
                fontFamily={Fonts.label}
                textAnchor="middle">
                {label}
              </SvgText>
            );
          })}
          {isSpeaking ? (
            <>
              <Line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={Colors.primary} strokeWidth={3} />
              <Circle cx={tip.x} cy={tip.y} r={9} fill={Colors.primary} />
            </>
          ) : null}
          <Circle cx={cx} cy={cy} r={isSpeaking ? 5 : 10} fill={Colors.primary} opacity={isSpeaking ? 0.7 : 1} />
        </Svg>
        {!isSpeaking ? (
          <View style={styles.centerLogoWrap} pointerEvents="none">
            <Text style={styles.you}>You</Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={cx} cy={cy} r={maxR} stroke={Colors.border} strokeWidth={1.5} fill={Colors.surface} />
        <Circle
          cx={cx}
          cy={cy}
          r={maxR * 0.55}
          stroke={Colors.border}
          strokeWidth={1}
          fill="none"
        />

        {ZONE_LABELS.map(({ zone, label, angle }) => {
          const pos = polarToXY(cx, cy, maxR + 20, angle);
          const tickOuter = polarToXY(cx, cy, maxR, angle);
          const tickInner = polarToXY(cx, cy, maxR - 14, angle);
          const active = activeZone === zone;
          return (
            <G key={zone}>
              <Line
                x1={tickInner.x}
                y1={tickInner.y}
                x2={tickOuter.x}
                y2={tickOuter.y}
                stroke={active ? Colors.primary : Colors.border}
                strokeWidth={active ? 3 : 1.5}
              />
              <SvgText
                x={pos.x}
                y={pos.y + 4}
                fill={active ? Colors.primary : Colors.textSecondary}
                fontSize={12}
                fontFamily={Fonts.labelSemiBold}
                textAnchor="middle">
                {label}
              </SvgText>
            </G>
          );
        })}

        {isSpeaking ? (
          <Circle cx={cx} cy={cy} r={4} fill={Colors.textSecondary} opacity={0.5} />
        ) : null}
      </Svg>

      {isSpeaking ? (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, pulseStyle]} pointerEvents="none">
            <Svg width={size} height={size}>
              {(speakers.length ? speakers : [{ doa, id: 0 }]).map((speaker) => {
                const zone = doaToMicZone(speaker.doa);
                const halo = polarToXY(cx, cy, maxR * 0.72, ZONE_ANGLE[zone]);
                return (
                  <Circle
                    key={`halo-${speaker.id}-${zone}`}
                    cx={halo.x}
                    cy={halo.y}
                    r={18}
                    fill={Colors.primary}
                    opacity={0.22}
                  />
                );
              })}
            </Svg>
          </Animated.View>
          <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
            {(speakers.length ? speakers : [{ doa, id: 0 }]).map((speaker) => {
              const zone = doaToMicZone(speaker.doa);
              const pos = polarToXY(cx, cy, maxR * 0.72, ZONE_ANGLE[zone]);
              return (
                <Circle
                  key={`spk-${speaker.id}-${zone}`}
                  cx={pos.x}
                  cy={pos.y}
                  r={12}
                  fill={Colors.primary}
                />
              );
            })}
          </Svg>
        </>
      ) : (
        <View style={styles.centerLogoWrap} pointerEvents="none">
          <Text style={styles.you}>You</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerLogoWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  you: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.textSecondary,
  },
});

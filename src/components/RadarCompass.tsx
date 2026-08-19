import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';

import { Colors, SpeakerColors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import type { SpeakerDot } from '@/store/compassStore';

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

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
  const size = width * 0.8;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 28;

  const sweepRotation = useSharedValue(0);
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    sweepRotation.value = withRepeat(
      withTiming(360, { duration: 4000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [sweepRotation]);

  useEffect(() => {
    if (isSpeaking) {
      pulseScale.value = withRepeat(
        withTiming(1.15, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      pulseScale.value = withTiming(1, { duration: 300 });
    }
  }, [isSpeaking, pulseScale]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sweepRotation.value}deg` }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  if (viewMode === 'ARROW') {
    const tip = polarToXY(cx, cy, maxR * 0.7, doa);
    return (
      <View style={[styles.container, { width: size, height: size }]}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={maxR} stroke={Colors.border} strokeWidth={1} fill={Colors.surface} />
          <Line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={Colors.primary} strokeWidth={3} />
          <Circle cx={tip.x} cy={tip.y} r={10} fill={Colors.primary} />
          <Circle cx={cx} cy={cy} r={6} fill={Colors.secondary} />
        </Svg>
      </View>
    );
  }

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.View style={[StyleSheet.absoluteFill, pulseStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={Colors.primary} stopOpacity={0.08} />
              <Stop offset="100%" stopColor={Colors.background} stopOpacity={0} />
            </RadialGradient>
          </Defs>

          <Circle cx={cx} cy={cy} r={maxR + 10} fill="url(#glow)" />

          {[1, 0.66, 0.33].map((scale, i) => (
            <Circle
              key={i}
              cx={cx}
              cy={cy}
              r={maxR * scale}
              stroke={Colors.primary}
              strokeOpacity={0.12 - i * 0.03}
              strokeWidth={1}
              fill="none"
            />
          ))}

          {DIRECTIONS.map((label, i) => {
            const angle = i * 45;
            const pos = polarToXY(cx, cy, maxR + 16, angle);
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

          {Array.from({ length: 8 }).map((_, i) => {
            const angle = i * 45;
            const outer = polarToXY(cx, cy, maxR, angle);
            return (
              <Line
                key={`tick-${i}`}
                x1={cx}
                y1={cy}
                x2={outer.x}
                y2={outer.y}
                stroke={Colors.border}
                strokeWidth={1}
              />
            );
          })}

          {speakers.map((speaker) => {
            const pos = polarToXY(cx, cy, maxR * 0.75, speaker.doa);
            const color = SpeakerColors[speaker.id % SpeakerColors.length];
            return (
              <G key={`speaker-${speaker.id}`}>
                <Circle cx={pos.x} cy={pos.y} r={14} fill={color} opacity={0.2} />
                <Circle cx={pos.x} cy={pos.y} r={8} fill={color} />
                <Circle cx={pos.x} cy={pos.y} r={4} fill="#FFFFFF" opacity={0.9} />
              </G>
            );
          })}

          <Circle cx={cx} cy={cy} r={5} fill={Colors.primary} opacity={0.6} />
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            justifyContent: 'center',
            alignItems: 'center',
          },
          sweepStyle,
        ]}>
        <Svg width={size} height={size}>
          <G rotation={0} origin={`${cx}, ${cy}`}>
            <Circle
              cx={cx}
              cy={cy}
              r={maxR}
              stroke={isSpeaking ? Colors.primary : Colors.silence}
              strokeWidth={2}
              strokeOpacity={isSpeaking ? 0.5 : 0.15}
              fill="none"
              strokeDasharray={`${maxR * 0.5} ${maxR * 5}`}
            />
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

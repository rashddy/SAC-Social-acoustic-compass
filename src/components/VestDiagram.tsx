import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { Colors } from '@/constants/colors';
import { Fonts } from '@/constants/typography';
import { VEST_ZONE_LABEL, type VestZone } from '@/utils/vest';

type Props = {
  zone: VestZone | null;
  flash?: boolean;
};

const WIDTH = 300;
const HEIGHT = 340;

/** Front of the vest, neck hole, and both armholes. Rear pad is not shown. */
const VEST = [
  'M108 50',
  'C124 24 176 24 192 50',
  'L252 68',
  'C282 82 290 118 272 156',
  'C258 184 234 194 210 188',
  'L226 304',
  'C226 322 74 322 74 304',
  'L90 188',
  'C66 194 42 184 28 156',
  'C10 118 18 82 48 68',
  'Z',
  'M126 54',
  'C126 84 174 84 174 54',
  'C174 38 126 38 126 54',
  'Z',
  'M36 104',
  'C18 126 20 178 52 190',
  'C68 170 66 126 50 104',
  'C44 94 40 94 36 104',
  'Z',
  'M264 104',
  'C282 126 280 178 248 190',
  'C232 170 234 126 250 104',
  'C256 94 260 94 264 104',
  'Z',
].join(' ');

const PADS: { zone: Exclude<VestZone, 'BACK'>; style: object }[] = [
  { zone: 'LEFT', style: { left: 72, top: 146, width: 68 } },
  { zone: 'FRONT', style: { left: 115, top: 210, width: 70 } },
  { zone: 'RIGHT', style: { right: 72, top: 146, width: 68 } },
];

export function VestDiagram({ zone, flash }: Props) {
  const shown = zone && zone !== 'BACK' ? zone : null;
  const lit = Boolean(flash && shown);

  return (
    <View style={styles.wrapper}>
      <View style={styles.stage}>
        <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <Path
            d={VEST}
            fill={Colors.surface}
            fillRule="evenodd"
            stroke={lit ? Colors.primary : Colors.border}
            strokeWidth={lit ? 3 : 2}
          />
          <Line
            x1="150"
            y1="88"
            x2="150"
            y2="292"
            stroke={Colors.border}
            strokeWidth={2}
          />
          <Line x1="126" y1="56" x2="58" y2="78" stroke={Colors.border} strokeWidth={2} />
          <Line x1="174" y1="56" x2="242" y2="78" stroke={Colors.border} strokeWidth={2} />
        </Svg>
        {PADS.map((pad) => {
          const active = shown === pad.zone;
          return (
            <View key={pad.zone} style={[styles.pad, pad.style, active && styles.padActive]}>
              <Text style={[styles.padLabel, active && styles.padLabelActive]}>
                {VEST_ZONE_LABEL[pad.zone]}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.hint}>
        {shown ? `Vibrating on the ${VEST_ZONE_LABEL[shown].toLowerCase()}` : 'No vibration'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    gap: 16,
  },
  stage: {
    width: WIDTH,
    height: HEIGHT,
    alignItems: 'center',
  },
  pad: {
    position: 'absolute',
    minHeight: 48,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: Colors.silence,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  padActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  padLabel: {
    fontFamily: Fonts.labelSemiBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  padLabelActive: {
    color: Colors.onPrimary,
  },
  hint: {
    fontFamily: Fonts.label,
    fontSize: 17,
    color: Colors.textPrimary,
  },
});

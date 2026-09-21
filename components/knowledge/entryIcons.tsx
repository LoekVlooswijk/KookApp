import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

type IconProps = {
  size?: number;
  stroke?: number;
  color?: string;
  style?: any;
};

function Base({
  size = 22,
  stroke = 1.7,
  color = '#000',
  style,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {children}
    </Svg>
  );
}

export function IconEdit(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </Base>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Base {...p}>
      <Path d="M3 6h18" />
      <Path d="M8 6V4h8v2" />
      <Path d="M6 6l1 16h10l1-16" />
      <Rect x="9" y="10" width="0" height="7" />
      <Path d="M10 10v7M14 10v7" />
    </Base>
  );
}

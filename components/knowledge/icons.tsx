import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = {
  size?: number;
  stroke?: number;
  color?: string;
  style?: any;
};

function BaseIcon({
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

export function IconBrain(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10v1a3 3 0 0 0 1 2.2V14a3 3 0 0 0 2 2.8V18a3 3 0 0 0 5 2.2A3 3 0 0 0 17 18v-1.2A3 3 0 0 0 19 14v-.8a3 3 0 0 0 1-2.2v-1a3 3 0 0 0-2-2.5V7a3 3 0 0 0-3-3 3 3 0 0 0-3 1.5A3 3 0 0 0 9 4z" />
      <Path d="M12 5.5v15" />
    </BaseIcon>
  );
}

export function IconHerb(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M12 21v-7" />
      <Path d="M12 14c0-4 3-7 8-7-1 5-4 8-8 8z" />
      <Path d="M12 14c0-3-2-6-6-6 .5 4 2.5 6 6 6z" />
      <Path d="M12 14c-1-2 0-5 3-6" />
    </BaseIcon>
  );
}

export function IconScale(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M12 4v16" />
      <Path d="M8 20h8" />
      <Path d="M5 4h14" />
      <Path d="M5 4l-3 6a3 3 0 0 0 6 0L5 4z" />
      <Path d="M19 4l-3 6a3 3 0 0 0 6 0l-3-6z" />
    </BaseIcon>
  );
}

export function IconThermometer(p: IconProps) {
  const color = p.color ?? '#000';
  return (
    <BaseIcon {...p}>
      <Path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z" />
      <Circle cx="12" cy="17" r="1.5" fill={color} stroke="none" />
      <Path d="M12 8v6" />
    </BaseIcon>
  );
}

export function IconSwap(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M4 8h13l-3-3" />
      <Path d="M20 16H7l3 3" />
    </BaseIcon>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-4-4" />
    </BaseIcon>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M12 5v14M5 12h14" />
    </BaseIcon>
  );
}

export function IconArrowLeft(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M19 12H5M12 5l-7 7 7 7" />
    </BaseIcon>
  );
}

export function IconClose(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M6 6l12 12M18 6L6 18" />
    </BaseIcon>
  );
}

export function IconPin(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M12 17v5" />
      <Path d="M9 3h6l-1 5 3 4H7l3-4-1-5z" />
    </BaseIcon>
  );
}

export function IconTag(p: IconProps) {
  const color = p.color ?? '#000';
  return (
    <BaseIcon {...p}>
      <Path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
      <Circle cx="7.5" cy="7.5" r="1.2" fill={color} stroke="none" />
    </BaseIcon>
  );
}

export function IconBook(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5z" />
      <Path d="M6 19h12" />
      <Path d="M8 7h6" />
      <Path d="M8 10h4" />
    </BaseIcon>
  );
}

export function IconGear(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </BaseIcon>
  );
}

export function IconCalendar(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Rect x="3" y="5" width="18" height="16" rx="2" />
      <Path d="M3 9h18" />
      <Path d="M8 3v4" />
      <Path d="M16 3v4" />
      <Path d="M8 14l2 2 4-4" />
    </BaseIcon>
  );
}

export function IconBasket(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M3 9h18l-2 11H5L3 9z" />
      <Path d="M8 9l3-5" />
      <Path d="M16 9l-3-5" />
      <Path d="M9 13v4" />
      <Path d="M15 13v4" />
    </BaseIcon>
  );
}

export function IconKnife(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M4 18L18 4l2 2-4 4-9 11-3-3z" />
      <Path d="M14 8l-9 11" />
    </BaseIcon>
  );
}

export function IconFlame(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 3 0z" />
    </BaseIcon>
  );
}

export function IconClock(p: IconProps) {
  return (
    <BaseIcon {...p}>
      <Circle cx="12" cy="13" r="8" />
      <Path d="M12 9v4l2.5 2.5" />
      <Path d="M9 2.5h6" />
    </BaseIcon>
  );
}

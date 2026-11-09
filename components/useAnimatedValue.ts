import { useState } from 'react';
import { Animated } from 'react-native';

/**
 * Animated.Value zonder ref-toegang tijdens render (vriendelijk voor react-hooks/refs).
 * Het Animated-object wordt één keer per component-instance aangemaakt via useState.
 */
export function useAnimatedValue(initialValue = 0): Animated.Value {
  const [value] = useState(() => new Animated.Value(initialValue));
  return value;
}

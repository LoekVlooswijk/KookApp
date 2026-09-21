import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  style: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** Bottom-sheet keyboard handling: iOS padding on the sheet only; Android uses window resize. */
export function ChatSheetKeyboardWrap({ style, children }: Props) {
  const sheet = <View style={style}>{children}</View>;

  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
        {sheet}
      </KeyboardAvoidingView>
    );
  }

  return sheet;
}

const styles = {
  wrap: { width: '100%' as const, zIndex: 2 },
};

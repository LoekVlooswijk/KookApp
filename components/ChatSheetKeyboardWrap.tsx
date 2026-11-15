import type { ReactNode } from 'react';
import { KeyboardAvoidingView, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  style: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * Bottom-sheet keyboard handling: de wrap neemt de volledige hoogte in (flex: 1), zodat
 * de toetsenbord-padding de inhoud daadwerkelijk verkleint en de typbalk boven het
 * toetsenbord uitkomt. Op Android is window-resize de primary fix, maar de padding is
 * een veilige fallback binnen een Modal (RN kapt de overlap af op 0 als het window al
 * geresized is, dus geen dubbele offset).
 */
export function ChatSheetKeyboardWrap({ style, children }: Props) {
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
      <View style={style}>{children}</View>
    </KeyboardAvoidingView>
  );
}

const styles = {
  wrap: { flex: 1, width: '100%' as const, zIndex: 2 },
};

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from './ThemeContext';

export type ConfirmDialogOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type InternalState = {
  opts: Required<Pick<ConfirmDialogOptions, 'title'>> &
    Pick<ConfirmDialogOptions, 'message' | 'destructive'> & {
      confirmText: string;
      cancelText: string;
    };
  resolve: (v: boolean) => void;
};

export function useConfirmDialog(): {
  confirm: (opts: ConfirmDialogOptions) => Promise<boolean>;
  ConfirmDialog: () => ReactElement | null;
  busy: boolean;
} {
  const theme = useAppTheme();
  const [state, setState] = useState<InternalState | null>(null);

  const confirm = useCallback((opts: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({
        opts: {
          title: opts.title,
          message: opts.message,
          destructive: opts.destructive,
          confirmText: opts.confirmText ?? 'OK',
          cancelText: opts.cancelText ?? 'Annuleren',
        },
        resolve,
      });
    });
  }, []);

  const onCancel = useCallback(() => {
    setState((cur) => {
      if (!cur) return cur;
      cur.resolve(false);
      return null;
    });
  }, []);

  const onConfirm = useCallback(() => {
    setState((cur) => {
      if (!cur) return cur;
      cur.resolve(true);
      return null;
    });
  }, []);

  const destructiveTextColor = '#b00020';
  const destructiveBg = '#fff';
  const destructiveBorder = '#f5c6cb';

  const confirmBtnStyle = useMemo(() => {
    if (!state?.opts.destructive) return [styles.btnPrimary, { backgroundColor: theme.accent }];
    return [styles.btnOutline, { backgroundColor: destructiveBg, borderColor: destructiveBorder }];
  }, [state?.opts.destructive, theme.accent]);

  const confirmBtnTextStyle = useMemo(() => {
    if (!state?.opts.destructive) return styles.btnPrimaryText;
    return [styles.btnOutlineText, { color: destructiveTextColor }];
  }, [state?.opts.destructive]);

  const ConfirmDialog = useCallback(() => {
    if (!state) return null;
    return (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={onCancel}
      >
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropPressable} onPress={onCancel} />
          <View style={[styles.card, { backgroundColor: theme.background }]}>
            <Text style={styles.title}>{state.opts.title}</Text>
            {state.opts.message ? <Text style={styles.message}>{state.opts.message}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={styles.btnGhost} onPress={onCancel}>
                <Text style={styles.btnGhostText}>{state.opts.cancelText}</Text>
              </Pressable>
              <Pressable style={confirmBtnStyle} onPress={onConfirm}>
                <Text style={confirmBtnTextStyle}>{state.opts.confirmText}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }, [confirmBtnStyle, confirmBtnTextStyle, onCancel, onConfirm, state, theme.background]);

  return { confirm, ConfirmDialog, busy: state != null };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  title: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 8 },
  message: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 14 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
  },
  btnPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnOutline: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  btnOutlineText: { fontWeight: '800', fontSize: 15 },
  btnGhost: { paddingHorizontal: 10, paddingVertical: 10 },
  btnGhostText: { fontWeight: '800', fontSize: 15, color: '#666' },
});


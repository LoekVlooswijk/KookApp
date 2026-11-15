import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';
import {
  shareLocalFileAsync,
  exportSerializedBackupFileAsync,
  pickAndRestoreDatabaseBackupAsync,
  wipeAllLocalDatabaseDataAsync,
} from '../../lib/dataBackup';
import { exportAllDataAsJsonFileAsync } from '../../lib/dataJsonExport';
import { hydrateAiPrefsFromDb } from '../../lib/aiPrefs';
import { ensureDatabaseAsync } from '../../lib/db';

export default function DataSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useI18n();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';

  const [dataBusy, setDataBusy] = useState(false);

  const reloadAfterImportOrWipe = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateAiPrefsFromDb();
      await theme.reloadThemeFromDatabase();
    })();
  }, [theme]);

  useFocusEffect(
    useCallback(() => {
      // Ensure DB is ready when opening this submenu.
      reloadAfterImportOrWipe();
    }, [reloadAfterImportOrWipe])
  );

  const onExportBackup = useCallback(() => {
    if (web) return;
    void (async () => {
      setDataBusy(true);
      try {
        const f = await exportSerializedBackupFileAsync();
        await shareLocalFileAsync(f.uri, {
          mimeType: 'application/x-sqlite3',
          dialogTitle: t('settings.dataPage.backupShareTitle'),
        });
        Alert.alert(
          t('settings.dataPage.backupReadyTitle'),
          t('settings.dataPage.backupReadyMessage')
        );
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.dataPage.exportFailed')
        );
      } finally {
        setDataBusy(false);
      }
    })();
  }, [t, web]);

  const onExportJson = useCallback(() => {
    if (web) return;
    void (async () => {
      setDataBusy(true);
      try {
        const f = await exportAllDataAsJsonFileAsync();
        await shareLocalFileAsync(f.uri, {
          mimeType: 'application/json',
          dialogTitle: t('settings.dataPage.jsonShareTitle'),
        });
        Alert.alert(t('settings.dataPage.jsonReadyTitle'), t('settings.dataPage.jsonReadyMessage'));
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.dataPage.exportFailed')
        );
      } finally {
        setDataBusy(false);
      }
    })();
  }, [t, web]);

  const runImportAfterConfirm = useCallback(() => {
    void (async () => {
      setDataBusy(true);
      try {
        await pickAndRestoreDatabaseBackupAsync();
        reloadAfterImportOrWipe();
        // Give a moment for the database to be ready
        await new Promise((resolve) => setTimeout(resolve, 200));
        Alert.alert(t('settings.dataPage.doneTitle'), t('settings.dataPage.doneMessage'));
      } catch (e) {
        const msg = e instanceof Error ? e.message : t('settings.dataPage.importFailed');
        if (msg !== 'Geen bestand gekozen.') {
          Alert.alert(t('settings.shared.errorTitle'), msg);
        }
      } finally {
        setDataBusy(false);
      }
    })();
  }, [reloadAfterImportOrWipe, t]);

  const onImportBackup = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: t('settings.dataPage.importTitle'),
        message: t('settings.dataPage.importMessage'),
        confirmText: t('settings.dataPage.importAction'),
        cancelText: t('common.confirm.cancel'),
        destructive: true,
      });
      if (!ok) return;
      runImportAfterConfirm();
    })();
  }, [confirm, runImportAfterConfirm, t, web]);

  const onWipeAllData = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: t('settings.dataPage.wipeTitle'),
        message: t('settings.dataPage.wipeMessage'),
        confirmText: t('settings.dataPage.wipeAction'),
        cancelText: t('common.confirm.cancel'),
        destructive: true,
      });
      if (!ok) return;
      setDataBusy(true);
      try {
        await wipeAllLocalDatabaseDataAsync();
        reloadAfterImportOrWipe();
        Alert.alert(t('settings.dataPage.wipedTitle'), t('settings.dataPage.wipedMessage'));
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.dataPage.wipeFailed')
        );
      } finally {
        setDataBusy(false);
      }
    })();
  }, [confirm, reloadAfterImportOrWipe, t, web]);

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ConfirmDialog />
      <Text style={styles.section}>{t('settings.dataPage.title')}</Text>

      {web ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{t('settings.dataPage.webNotice')}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>{t('settings.dataPage.lead')}</Text>

          <Pressable
            style={[
              styles.btnPrimary,
              { backgroundColor: theme.accent },
              dataBusy && styles.btnDisabled,
            ]}
            onPress={onExportBackup}
            disabled={dataBusy}
          >
            <Text style={styles.btnPrimaryText}>{t('settings.dataPage.exportBackup')}</Text>
          </Pressable>
          <Pressable
            style={[
              styles.btnOutline,
              { borderColor: theme.accent },
              dataBusy && styles.btnDisabled,
            ]}
            onPress={onExportJson}
            disabled={dataBusy}
          >
            <Text style={[styles.btnOutlineText, { color: theme.accent }]}>
              {t('settings.dataPage.exportJson')}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.btnOutline,
              { borderColor: theme.accent },
              dataBusy && styles.btnDisabled,
            ]}
            onPress={onImportBackup}
            disabled={dataBusy}
          >
            <Text style={[styles.btnOutlineText, { color: theme.accent }]}>
              {t('settings.dataPage.importBackup')}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.btnDangerSolid, dataBusy && styles.btnDisabled]}
            onPress={onWipeAllData}
            disabled={dataBusy}
          >
            <Text style={styles.btnDangerSolidText}>{t('settings.dataPage.wipeAll')}</Text>
          </Pressable>

          {dataBusy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.busyHint}>{t('settings.shared.busy')}</Text>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  notice: {
    backgroundColor: '#fff8e6',
    borderWidth: 1,
    borderColor: '#f0d78c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { fontSize: 14, color: '#6b5a1e', lineHeight: 20 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 10 },
  btnPrimary: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  btnOutline: {
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  btnOutlineText: { fontWeight: '700', fontSize: 15 },
  btnDangerSolid: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    backgroundColor: '#8b1538',
    alignSelf: 'flex-start',
  },
  btnDangerSolidText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  busyHint: { fontSize: 14, color: '#666' },
});

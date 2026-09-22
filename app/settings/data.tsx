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
          dialogTitle: 'Kookapp Database Backup',
        });
        Alert.alert(
          'Backup klaar',
          `Database opgeslagen in je Files-app als kook-backup-…\n\n` +
            `Je kunt het bestand delen of verplaatsen naar Nextcloud.`
        );
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Exporteren mislukt.');
      } finally {
        setDataBusy(false);
      }
    })();
  }, [web]);

  const onExportJson = useCallback(() => {
    if (web) return;
    void (async () => {
      setDataBusy(true);
      try {
        const f = await exportAllDataAsJsonFileAsync();
        await shareLocalFileAsync(f.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Kookapp JSON Export',
        });
        Alert.alert(
          'JSON-export klaar',
          `Alle gegevens opgeslagen in je Files-app als kook-export-…\n\n` +
            `Let op: AI-sleutels staan in beveiligde opslag en zitten niet in deze export.`
        );
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Exporteren mislukt.');
      } finally {
        setDataBusy(false);
      }
    })();
  }, [web]);

  const runImportAfterConfirm = useCallback(() => {
    void (async () => {
      setDataBusy(true);
      try {
        await pickAndRestoreDatabaseBackupAsync();
        reloadAfterImportOrWipe();
        // Give a moment for the database to be ready
        await new Promise(resolve => setTimeout(resolve, 200));
        Alert.alert(
          'Klaar',
          'De backup is ingelezen. Als ergens nog oude gegevens staan, sluit die schermen of herstart de app.'
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Importeren mislukt.';
        if (msg !== 'Geen bestand gekozen.') {
          Alert.alert('Fout', msg);
        }
      } finally {
        setDataBusy(false);
      }
    })();
  }, [reloadAfterImportOrWipe]);

  const onImportBackup = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: 'Backup importeren?',
        message:
          'Alle huidige gegevens in de app-database (recepten, lijsten, weekmenu, voorkeuren in de database) worden vervangen. Dit kun je niet ongedaan maken.',
        confirmText: 'Importeren',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      runImportAfterConfirm();
    })();
  }, [confirm, runImportAfterConfirm, web]);

  const onWipeAllData = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: 'Alles wissen?',
        message:
          'Alle recepten, lijsten, weekmenu, boodschappen en kookvoortgang worden verwijderd. Voorkeuren die in de database staan (zoals model en eenheden) gaan terug naar de standaard. Je AI-sleutels blijven in de beveiligde opslag staan, tenzij je ze apart verwijdert.',
        confirmText: 'Alles wissen',
        cancelText: 'Annuleren',
        destructive: true,
      });
      if (!ok) return;
      setDataBusy(true);
      try {
        await wipeAllLocalDatabaseDataAsync();
        reloadAfterImportOrWipe();
        Alert.alert('Gewist', 'Alle lokale databasegegevens zijn verwijderd.');
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Wissen mislukt.');
      } finally {
        setDataBusy(false);
      }
    })();
  }, [confirm, reloadAfterImportOrWipe, web]);

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ConfirmDialog />
      <Text style={styles.section}>Databeheer</Text>

      {web ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Backup en importeren werken alleen in de iOS- of Android-app, niet in de webversie.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>
            Recepten en lijsten staan in een lokaal databasebestand. Gebruik een backup vóór grote
            wijzigingen of als je van telefoon wisselt. Importeren vervangt alles in de database; je
            AI-sleutels blijven in de beveiligde opslag staan tenzij je ze apart wist.
          </Text>

          <Pressable
            style={[
              styles.btnPrimary,
              { backgroundColor: theme.accent },
              dataBusy && styles.btnDisabled,
            ]}
            onPress={onExportBackup}
            disabled={dataBusy}
          >
            <Text style={styles.btnPrimaryText}>Backup maken en delen</Text>
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
              Exporteer alles als JSON
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
              Importeer van backupbestand
            </Text>
          </Pressable>

          <Pressable
            style={[styles.btnDangerSolid, dataBusy && styles.btnDisabled]}
            onPress={onWipeAllData}
            disabled={dataBusy}
          >
            <Text style={styles.btnDangerSolidText}>Alle lokale data wissen</Text>
          </Pressable>

          {dataBusy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.busyHint}>Even geduld…</Text>
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

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';
import { type TranslationKey } from '../../lib/i18n';
import { hydrateBioScoreEnabledFromDb, isBioScoreEnabled } from '../../lib/bioScoreEnabledPrefs';
import type { BioScoreOverride } from '../../lib/bioScoreOverridesPrefs';
import {
  getBioScoreOverridesList,
  hydrateBioScoreOverridesPrefsFromDb,
  removeBioScoreOverride,
  upsertBioScoreOverride,
} from '../../lib/bioScoreOverridesPrefs';
import { ensureDatabaseAsync } from '../../lib/db';

const LOCALITY_OPTIONS: { id: BioScoreOverride['l']; labelKey: TranslationKey }[] = [
  { id: 'G', labelKey: 'settings.bioScoreOverridesPage.localityNlBeDe' },
  { id: 'O', labelKey: 'settings.bioScoreOverridesPage.localityEurope' },
  { id: 'R', labelKey: 'settings.bioScoreOverridesPage.localityWorld' },
];

const PESTICIDE_OPTIONS: { id: BioScoreOverride['p']; labelKey: TranslationKey }[] = [
  { id: 'L', labelKey: 'settings.bioScoreOverridesPage.pesticideLow' },
  { id: 'M', labelKey: 'settings.bioScoreOverridesPage.pesticideMedium' },
  { id: 'H', labelKey: 'settings.bioScoreOverridesPage.pesticideHigh' },
];

export default function BioScoreOverridesSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useI18n();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';

  const [overrides, setOverrides] = useState<BioScoreOverride[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [nameInput, setNameInput] = useState('');
  const [locality, setLocality] = useState<BioScoreOverride['l']>('G');
  const [pesticide, setPesticide] = useState<BioScoreOverride['p']>('L');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateBioScoreOverridesPrefsFromDb();
      await hydrateBioScoreEnabledFromDb();
      setEnabled(isBioScoreEnabled());
      setOverrides([...getBioScoreOverridesList()]);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const onAdd = useCallback(() => {
    if (web) return;
    const n = nameInput.trim();
    if (!n) {
      Alert.alert(
        t('settings.bioScoreOverridesPage.nameMissingTitle'),
        t('settings.bioScoreOverridesPage.nameMissingMessage')
      );
      return;
    }
    void (async () => {
      await upsertBioScoreOverride({ n, l: locality, p: pesticide });
      setNameInput('');
      reload();
    })();
  }, [locality, nameInput, pesticide, reload, t, web]);

  const onRemove = useCallback(
    (name: string) => {
      if (web) return;
      void (async () => {
        const ok = await confirm({
          title: t('settings.bioScoreOverridesPage.deleteTitle'),
          message: t('settings.bioScoreOverridesPage.deleteMessage', { name }),
          confirmText: t('settings.shared.delete'),
          cancelText: t('common.confirm.cancel'),
          destructive: true,
        });
        if (!ok) return;
        await removeBioScoreOverride(name);
        reload();
      })();
    },
    [confirm, reload, t, web]
  );

  const chipOn = { backgroundColor: theme.accentSoft, borderColor: theme.accent };
  const chipTextOn = { color: theme.accentSoftText };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ConfirmDialog />

      {!enabled ? (
        <View style={styles.offNotice}>
          <Text style={styles.offNoticeText}>{t('settings.bioScoreOverridesPage.offNotice')}</Text>
        </View>
      ) : null}

      <View style={!enabled && styles.disabledSection} pointerEvents={enabled ? 'auto' : 'none'}>
        <Text style={styles.lead}>{t('settings.bioScoreOverridesPage.lead')}</Text>

        {web ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{t('settings.shared.webNotice')}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>{t('settings.bioScoreOverridesPage.nameLabel')}</Text>
        <TextInput
          style={[styles.input, web && styles.inputDisabled]}
          value={nameInput}
          onChangeText={setNameInput}
          placeholder={t('settings.bioScoreOverridesPage.namePlaceholder')}
          placeholderTextColor="#999"
          editable={!web && enabled}
        />

        <Text style={styles.subLabel}>{t('settings.bioScoreOverridesPage.localityLabel')}</Text>
        <View style={styles.chipRow}>
          {LOCALITY_OPTIONS.map((opt) => {
            const on = locality === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={[styles.chip, on && chipOn]}
                onPress={() => setLocality(opt.id)}
                disabled={web || !enabled}
              >
                <Text style={[styles.chipText, on && chipTextOn]}>
                  {opt.id} · {t(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.subLabel}>{t('settings.bioScoreOverridesPage.pesticideLabel')}</Text>
        <View style={styles.chipRow}>
          {PESTICIDE_OPTIONS.map((opt) => {
            const on = pesticide === opt.id;
            return (
              <Pressable
                key={opt.id}
                style={[styles.chip, on && chipOn]}
                onPress={() => setPesticide(opt.id)}
                disabled={web || !enabled}
              >
                <Text style={[styles.chipText, on && chipTextOn]}>
                  {opt.id} · {t(opt.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={[styles.btnPrimary, { backgroundColor: theme.accent }, web && styles.btnDisabled]}
          onPress={onAdd}
          disabled={web || !enabled}
        >
          <Text style={styles.btnPrimaryText}>{t('settings.bioScoreOverridesPage.upsert')}</Text>
        </Pressable>

        <Text style={styles.section}>{t('settings.bioScoreOverridesPage.savedTitle')}</Text>
        {overrides.length === 0 ? (
          <Text style={styles.empty}>{t('settings.bioScoreOverridesPage.empty')}</Text>
        ) : (
          overrides.map((ov) => (
            <View key={ov.n} style={[styles.overrideRow, { borderColor: theme.accentBorderMuted }]}>
              <View style={styles.overrideMain}>
                <Text style={styles.overrideName}>{ov.n}</Text>
                <Text style={styles.overrideMeta}>
                  {t('settings.bioScoreOverridesPage.metaLine', { l: ov.l, p: ov.p })}
                </Text>
              </View>
              <Pressable
                style={styles.removeBtn}
                onPress={() => onRemove(ov.n)}
                disabled={web || !enabled}
                accessibilityRole="button"
                accessibilityLabel={t('settings.bioScoreOverridesPage.deleteAccessible', {
                  name: ov.n,
                })}
              >
                <Text style={styles.removeBtnText}>
                  {t('settings.bioScoreOverridesPage.deleteShort')}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 16 },
  notice: {
    backgroundColor: '#fff8e6',
    borderWidth: 1,
    borderColor: '#f0d78c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { fontSize: 14, color: '#6b5a1e', lineHeight: 20 },
  offNotice: {
    backgroundColor: '#fdeeee',
    borderWidth: 1,
    borderColor: '#e3b9b9',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  offNoticeText: { fontSize: 14, color: '#7a3232', lineHeight: 20 },
  disabledSection: { opacity: 0.45 },
  label: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  subLabel: { fontSize: 14, fontWeight: '700', color: '#444', marginTop: 8, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  inputDisabled: { opacity: 0.45 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 13, fontWeight: '700', color: '#444' },
  btnPrimary: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 20,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },
  empty: { fontSize: 14, color: '#888' },
  overrideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  overrideMain: { flex: 1, minWidth: 0 },
  overrideName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  overrideMeta: { fontSize: 13, color: '#666', marginTop: 4 },
  removeBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  removeBtnText: { fontSize: 13, fontWeight: '700', color: '#b00020' },
});

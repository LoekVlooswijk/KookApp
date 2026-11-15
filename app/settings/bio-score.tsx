import { useFocusEffect, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation/elements';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';
import { computeMissingBioScores } from '../../lib/bioScoreBulk';
import {
  hydrateBioScoreEnabledFromDb,
  isBioScoreEnabled,
  setBioScoreEnabled,
} from '../../lib/bioScoreEnabledPrefs';
import {
  bioScoreExcludeListToText,
  bioScoreExcludeTextToList,
  getBioScoreExcludeList,
  hydrateBioScoreExcludePrefsFromDb,
  setBioScoreExcludeList,
} from '../../lib/bioScoreExcludePrefs';
import {
  getBioScoreThresholds,
  hydrateBioScoreThresholdsFromDb,
  normalizeBioScoreThresholds,
  resetBioScoreThresholdsToDefaults,
  setBioScoreThresholds,
} from '../../lib/bioScoreThresholdsPrefs';
import { ensureDatabaseAsync } from '../../lib/db';

/** Parse a positive whole number from text input; null when invalid/empty. */
function parsePositiveInt(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

export default function BioScoreSettingsScreen() {
  const theme = useAppTheme();
  const { t, languageId } = useI18n();
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';
  const headerHeight = useHeaderHeight();

  const [orangeText, setOrangeText] = useState('3');
  const [redText, setRedText] = useState('4');
  const [excludeText, setExcludeText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadedRef = useRef(false);
  const nextExcludeTextRef = useRef('');
  const nextOrangeTextRef = useRef('');
  const nextRedTextRef = useRef('');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateBioScoreThresholdsFromDb();
      await hydrateBioScoreExcludePrefsFromDb();
      await hydrateBioScoreEnabledFromDb();
      setEnabled(isBioScoreEnabled());
      const thresholds = getBioScoreThresholds();
      setOrangeText(String(thresholds.orangeMin));
      setRedText(String(thresholds.redMin));
      setExcludeText(bioScoreExcludeListToText(getBioScoreExcludeList()));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    nextExcludeTextRef.current = excludeText;
  }, [excludeText]);

  useEffect(() => {
    nextOrangeTextRef.current = orangeText;
  }, [orangeText]);

  useEffect(() => {
    nextRedTextRef.current = redText;
  }, [redText]);

  useFocusEffect(
    useCallback(() => {
      reload();
      return () => {
        if (web || !loadedRef.current) return;
        void (async () => {
          // Drempels: opslaan bij teruggaan; ongeldige invoer wordt genegeerd
          // (de getoonde waarden herstellen zich bij het opnieuw focussen).
          const oRaw = parsePositiveInt(nextOrangeTextRef.current);
          const rRaw = parsePositiveInt(nextRedTextRef.current);
          if (oRaw != null && rRaw != null && rRaw > oRaw) {
            await setBioScoreThresholds(
              normalizeBioScoreThresholds({ orangeMin: oRaw, redMin: rRaw })
            );
          }
          await setBioScoreExcludeList(bioScoreExcludeTextToList(nextExcludeTextRef.current));
        })();
      };
    }, [reload, web])
  );

  const onToggleEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    void (async () => {
      await ensureDatabaseAsync();
      await setBioScoreEnabled(next);
    })();
  }, []);

  const onResetDefaults = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: t('settings.bioScorePage.resetTitle'),
        message: t('settings.bioScorePage.resetMessage'),
        confirmText: t('settings.bioScorePage.resetAction'),
        cancelText: t('common.confirm.cancel'),
      });
      if (!ok) return;
      await resetBioScoreThresholdsToDefaults();
      reload();
    })();
  }, [confirm, reload, t, web]);

  const onClearExclude = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: t('settings.bioScorePage.clearTitle'),
        message: t('settings.bioScorePage.clearMessage'),
        confirmText: t('settings.shared.clearList'),
        cancelText: t('common.confirm.cancel'),
        destructive: true,
      });
      if (!ok) return;
      await setBioScoreExcludeList([]);
      reload();
    })();
  }, [confirm, reload, t, web]);

  const onComputeMissing = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: t('settings.bioScorePage.computeTitle'),
        message: t('settings.bioScorePage.computeMessage'),
        confirmText: t('settings.bioScorePage.computeAction'),
        cancelText: t('common.confirm.cancel'),
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await computeMissingBioScores(languageId ?? 'nl');
        Alert.alert(
          t('settings.bioScorePage.doneTitle'),
          t('settings.bioScorePage.doneMessage', { updated: res.updated, failed: res.failed })
        );
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.bioScorePage.computeFailed')
        );
      } finally {
        setBusy(false);
      }
    })();
  }, [confirm, t, web, languageId]);

  const chipOutline = { borderColor: theme.accentBorderMuted };

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={web ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={web ? 0 : headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />

        <View style={styles.toggleRow}>
          <View style={styles.toggleRowMain}>
            <Text style={styles.toggleTitle}>{t('settings.bioScorePage.enabledLabel')}</Text>
            <Text style={styles.toggleSubtitle}>{t('settings.bioScorePage.enabledHint')}</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={onToggleEnabled}
            disabled={web || !loaded}
            accessibilityLabel={t('settings.bioScorePage.enabledLabel')}
          />
        </View>

        <Text style={styles.lead}>
          {t('settings.bioScorePage.scoreIntro')}
          <Text style={styles.bold}>{t('settings.bioScorePage.scoreOriginOrange')}</Text>
          {t('settings.bioScorePage.scoreOr')}
          <Text style={styles.bold}>{t('settings.bioScorePage.scorePesticideMedium')}</Text>
          {t('settings.bioScorePage.scoreCountsOne')}
          <Text style={styles.bold}>{t('settings.bioScorePage.scoreOriginWorld')}</Text>
          {t('settings.bioScorePage.scoreOr')}
          <Text style={styles.bold}>{t('settings.bioScorePage.scorePesticideHigh')}</Text>
          {t('settings.bioScorePage.scoreCountsTwo')}
        </Text>

        {web ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{t('settings.shared.webNotice')}</Text>
          </View>
        ) : null}

        <View style={!enabled && styles.disabledSection} pointerEvents={enabled ? 'auto' : 'none'}>
          <Text style={styles.section}>{t('settings.bioScorePage.thresholdsTitle')}</Text>
          <Text style={styles.label}>{t('settings.bioScorePage.orangeLabel')}</Text>
          <TextInput
            style={[styles.input, web && styles.inputDisabled]}
            value={orangeText}
            onChangeText={setOrangeText}
            keyboardType="number-pad"
            editable={!web && loaded && enabled}
            placeholder="3"
            placeholderTextColor="#999"
          />

          <Text style={styles.label}>{t('settings.bioScorePage.redLabel')}</Text>
          <TextInput
            style={[styles.input, web && styles.inputDisabled]}
            value={redText}
            onChangeText={setRedText}
            keyboardType="number-pad"
            editable={!web && loaded && enabled}
            placeholder="4"
            placeholderTextColor="#999"
          />
          <Text style={styles.lead}>{t('settings.bioScorePage.thresholdsHint')}</Text>

          <View style={styles.row}>
            <Pressable
              style={[styles.btnOutline, chipOutline, web && styles.btnDisabled]}
              onPress={onResetDefaults}
              disabled={web || !loaded || !enabled}
            >
              <Text style={[styles.btnOutlineText, { color: theme.accent }]}>
                {t('settings.bioScorePage.resetDefaults')}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.section}>{t('settings.bioScorePage.excludeTitle')}</Text>
          <Text style={styles.lead}>{t('settings.bioScorePage.excludeHint')}</Text>
          <TextInput
            style={[styles.input, styles.multiline, web && styles.inputDisabled]}
            value={excludeText}
            onChangeText={setExcludeText}
            placeholder={t('settings.bioScorePage.excludePlaceholder')}
            placeholderTextColor="#999"
            multiline
            editable={!web && loaded && enabled}
          />
          <View style={styles.row}>
            <Pressable
              style={[styles.btnOutline, chipOutline, web && styles.btnDisabled]}
              onPress={onClearExclude}
              disabled={web || !loaded || !enabled}
            >
              <Text style={[styles.btnOutlineText, { color: '#b00020' }]}>
                {t('settings.shared.clearList')}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.section}>{t('settings.bioScorePage.overridesTitle')}</Text>
          <Text style={styles.lead}>{t('settings.bioScorePage.overridesHint')}</Text>
          <Pressable
            style={[styles.navRow, chipOutline]}
            onPress={() => router.push('/settings/bio-score-overrides' as never)}
          >
            <MaterialIcons name="tune" size={22} color={theme.accent} />
            <View style={styles.navRowMain}>
              <Text style={styles.navRowTitle}>{t('settings.bioScorePage.overridesNavTitle')}</Text>
              <Text style={styles.navRowSubtitle}>
                {t('settings.bioScorePage.overridesNavSubtitle')}
              </Text>
            </View>
            <Text style={[styles.navRowHint, { color: theme.accent }]}>›</Text>
          </Pressable>

          <Text style={styles.section}>{t('settings.bioScorePage.bulkTitle')}</Text>
          <Pressable
            style={[styles.btnOutline, chipOutline, (web || busy) && styles.btnDisabled]}
            onPress={onComputeMissing}
            disabled={web || busy || !loaded || !enabled}
          >
            <Text style={[styles.btnOutlineText, { color: theme.accent }]}>
              {t('settings.bioScorePage.computeButton')}
            </Text>
          </Pressable>
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.busyHint}>{t('settings.shared.busy')}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 14,
    marginBottom: 14,
  },
  toggleRowMain: { flex: 1, minWidth: 0 },
  toggleTitle: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  toggleSubtitle: { fontSize: 13, color: '#8a8a8a', lineHeight: 18, marginTop: 2 },
  disabledSection: { opacity: 0.45 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 14 },
  bold: { fontWeight: '800', color: '#1a1a1a' },
  notice: {
    backgroundColor: '#fff8e6',
    borderWidth: 1,
    borderColor: '#f0d78c',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { fontSize: 14, color: '#6b5a1e', lineHeight: 20 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 22, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  inputDisabled: { opacity: 0.45 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 4 },
  btnPrimary: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  btnOutline: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  btnOutlineText: { fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  navRowMain: { flex: 1, minWidth: 0, gap: 2 },
  navRowTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  navRowSubtitle: { fontSize: 13, color: '#8a8a8a', lineHeight: 18 },
  navRowHint: { fontSize: 18, fontWeight: '900' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  busyHint: { fontSize: 14, color: '#666' },
});

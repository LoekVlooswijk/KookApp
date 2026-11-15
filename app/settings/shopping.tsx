import { useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation/elements';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { ensureDatabaseAsync } from '../../lib/db';
import {
  getShoppingOrganicAlwaysList,
  hydrateShoppingOrganicPrefsFromDb,
  organicListToText,
  organicTextToList,
  setShoppingOrganicAlwaysList,
} from '../../lib/shoppingOrganicPrefs';
import {
  getShoppingStaplesExcludeList,
  hydrateShoppingStaplesPrefsFromDb,
  setShoppingStaplesExcludeList,
  staplesListToText,
  staplesTextToList,
} from '../../lib/shoppingStaplesPrefs';

export default function ShoppingSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useI18n();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';
  const headerHeight = useHeaderHeight();

  const [text, setText] = useState('');
  const [organicText, setOrganicText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const nextTextRef = useRef('');
  const nextOrganicTextRef = useRef('');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateShoppingStaplesPrefsFromDb();
      await hydrateShoppingOrganicPrefsFromDb();
      setText(staplesListToText(getShoppingStaplesExcludeList()));
      setOrganicText(organicListToText(getShoppingOrganicAlwaysList()));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    nextTextRef.current = text;
    nextOrganicTextRef.current = organicText;
  }, [text, organicText]);

  useFocusEffect(
    useCallback(() => {
      reload();
      return () => {
        if (web || !loadedRef.current) return;
        void (async () => {
          const list = staplesTextToList(nextTextRef.current);
          await setShoppingStaplesExcludeList(list);

          const organicList = organicTextToList(nextOrganicTextRef.current);
          await setShoppingOrganicAlwaysList(organicList);
        })();
      };
    }, [reload, web])
  );

  const onReset = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: t('settings.shoppingPage.resetTitle'),
        message: t('settings.shoppingPage.resetMessage'),
        confirmText: t('settings.shoppingPage.reset'),
        cancelText: t('common.confirm.cancel'),
        destructive: true,
      });
      if (!ok) return;
      await setShoppingStaplesExcludeList(['zout', 'peper', 'olie', 'water']);
      reload();
    })();
  }, [confirm, reload, t, web]);

  const onClearOrganic = useCallback(() => {
    if (web) return;
    void (async () => {
      const ok = await confirm({
        title: t('settings.shoppingPage.clearTitle'),
        message: t('settings.shoppingPage.clearMessage'),
        confirmText: t('settings.shared.clearList'),
        cancelText: t('common.confirm.cancel'),
        destructive: true,
      });
      if (!ok) return;
      await setShoppingOrganicAlwaysList([]);
      reload();
    })();
  }, [confirm, reload, t, web]);

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={web ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={web ? 0 : headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />
        <Text style={styles.lead}>
          {t('settings.shoppingPage.staplesLeadStart')}
          <Text style={styles.bold}>{t('settings.shoppingPage.staplesNotBold')}</Text>
          {t('settings.shoppingPage.staplesLeadEnd')}
        </Text>
        {!web ? (
          <Text style={styles.autoSaveHint}>{t('settings.shoppingPage.autoSaveHint')}</Text>
        ) : null}

        {web ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{t('settings.shared.webNotice')}</Text>
          </View>
        ) : null}

        <Text style={styles.section}>{t('settings.shoppingPage.staplesTitle')}</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={text}
          onChangeText={setText}
          placeholder={t('settings.shoppingPage.staplesPlaceholder')}
          placeholderTextColor="#999"
          multiline
          editable={!web}
        />

        <View style={styles.row}>
          <Pressable
            style={[styles.btnOutline, web && styles.btnDisabled]}
            onPress={onReset}
            disabled={web}
          >
            <Text style={[styles.btnOutlineText, { color: '#b00020' }]}>
              {t('settings.shoppingPage.reset')}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.section, { marginTop: 18 }]}>
          {t('settings.shoppingPage.organicTitle')}
        </Text>
        <Text style={styles.lead}>
          {t('settings.shoppingPage.organicLeadStart')}
          <Text style={styles.bold}>{t('settings.shoppingPage.organicLeafBold')}</Text>
          {t('settings.shoppingPage.organicLeadEnd')}
        </Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={organicText}
          onChangeText={setOrganicText}
          placeholder={t('settings.shoppingPage.organicPlaceholder')}
          placeholderTextColor="#999"
          multiline
          editable={!web}
        />
        <View style={styles.row}>
          <Pressable
            style={[styles.btnOutline, web && styles.btnDisabled]}
            onPress={onClearOrganic}
            disabled={web}
          >
            <Text style={[styles.btnOutlineText, { color: '#b00020' }]}>
              {t('settings.shared.clearList')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 16 },
  autoSaveHint: {
    fontSize: 13,
    color: '#666',
    lineHeight: 19,
    marginBottom: 16,
    fontStyle: 'italic',
  },
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
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 6, marginBottom: 8 },
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
  multiline: { minHeight: 140, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 6 },
  btnOutline: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f5c6cb',
    backgroundColor: '#fff',
  },
  btnOutlineText: { fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
});

import { useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation/elements';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {
  addManagedCategory,
  deleteManagedCategoryEverywhere,
  getManagedCategoryUsageCount,
  listManagedCategories,
} from '../../lib/categoriesRepo';
import { addCustomDiet, getCustomDiets, removeCustomDiet } from '../../lib/dietPrefs';
import { ensureDatabaseAsync } from '../../lib/db';
import { cleanupAllRecipeMetadata } from '../../lib/recipeCleanup';
import {
  addManagedTag,
  deleteManagedTagEverywhere,
  getManagedTagUsageCount,
  listManagedTags,
} from '../../lib/tagsRepo';

export default function ManageMetadataSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useI18n();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';
  const headerHeight = useHeaderHeight();

  const [busy, setBusy] = useState(false);

  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [diets, setDiets] = useState<string[]>([]);

  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [newDietInput, setNewDietInput] = useState('');

  const reload = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      const [cat, tagList, d] = await Promise.all([
        listManagedCategories(),
        listManagedTags(),
        getCustomDiets(),
      ]);
      setCategories(cat);
      setTags(tagList);
      setDiets(d.map((x) => x.name));
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.localeCompare(b, 'nl')),
    [categories]
  );
  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.localeCompare(b, 'nl')), [tags]);
  const sortedDiets = useMemo(() => [...diets].sort((a, b) => a.localeCompare(b, 'nl')), [diets]);

  const onCleanupRecipes = useCallback(() => {
    void (async () => {
      const ok = await confirm({
        title: t('settings.beherenPage.cleanupConfirmTitle'),
        message: t('settings.beherenPage.cleanupConfirmMessage'),
        confirmText: t('settings.beherenPage.cleanupAction'),
        cancelText: t('common.confirm.cancel'),
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await cleanupAllRecipeMetadata();
        Alert.alert(
          t('settings.beherenPage.doneTitle'),
          t('settings.beherenPage.doneMessage', {
            updated: res.updatedRecipes,
            removed: res.removedTagLinks,
          })
        );
        reload();
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.beherenPage.cleanupFailed')
        );
      } finally {
        setBusy(false);
      }
    })();
  }, [confirm, reload, t]);

  const onAddCategory = useCallback(() => {
    const n = newCategoryInput.trim();
    if (!n) return;
    void (async () => {
      try {
        const next = await addManagedCategory(n);
        setCategories(next);
        setNewCategoryInput('');
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.shared.addFailed')
        );
      }
    })();
  }, [newCategoryInput, t]);

  const onRemoveCategory = useCallback(
    (name: string) => {
      void (async () => {
        try {
          const usage = await getManagedCategoryUsageCount(name);
          const usageLine =
            usage > 0
              ? t('settings.beherenPage.deleteCategoryUsed', { count: usage })
              : t('settings.beherenPage.deleteCategoryUnused');
          const ok = await confirm({
            title: t('settings.beherenPage.deleteCategoryTitle'),
            message: `${usageLine}\n\n${t('settings.shared.deleteNameQuestion', { name })}`,
            confirmText: t('settings.shared.delete'),
            cancelText: t('common.confirm.cancel'),
            destructive: true,
          });
          if (!ok) return;
          try {
            await deleteManagedCategoryEverywhere(name);
            setCategories(await listManagedCategories());
          } catch (e) {
            Alert.alert(
              t('settings.shared.errorTitle'),
              e instanceof Error ? e.message : t('settings.shared.deleteFailed')
            );
          }
        } catch (e) {
          Alert.alert(
            t('settings.shared.errorTitle'),
            e instanceof Error ? e.message : t('settings.shared.deleteFailed')
          );
        }
      })();
    },
    [confirm, t]
  );

  const onAddTag = useCallback(() => {
    const n = newTagInput.trim();
    if (!n) return;
    void (async () => {
      try {
        const next = await addManagedTag(n);
        setTags(next);
        setNewTagInput('');
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.shared.addFailed')
        );
      }
    })();
  }, [newTagInput, t]);

  const onRemoveTag = useCallback(
    (name: string) => {
      void (async () => {
        try {
          const usage = await getManagedTagUsageCount(name);
          const usageLine =
            usage > 0
              ? t('settings.tagsPage.deleteUsed', { count: usage })
              : t('settings.tagsPage.deleteUnused');
          const ok = await confirm({
            title: t('settings.tagsPage.deleteTitle'),
            message: `${usageLine}\n\n${t('settings.shared.deleteNameQuestion', { name })}`,
            confirmText: t('settings.shared.delete'),
            cancelText: t('common.confirm.cancel'),
            destructive: true,
          });
          if (!ok) return;
          try {
            await deleteManagedTagEverywhere(name);
            setTags(await listManagedTags());
          } catch (e) {
            Alert.alert(
              t('settings.shared.errorTitle'),
              e instanceof Error ? e.message : t('settings.shared.deleteFailed')
            );
          }
        } catch (e) {
          Alert.alert(
            t('settings.shared.errorTitle'),
            e instanceof Error ? e.message : t('settings.shared.deleteFailed')
          );
        }
      })();
    },
    [confirm, t]
  );

  const onAddDiet = useCallback(() => {
    const n = newDietInput.trim();
    if (!n) return;
    void (async () => {
      try {
        const next = await addCustomDiet(n);
        setDiets(next.map((d) => d.name));
        setNewDietInput('');
      } catch (e) {
        Alert.alert(
          t('settings.shared.errorTitle'),
          e instanceof Error ? e.message : t('settings.shared.addFailed')
        );
      }
    })();
  }, [newDietInput, t]);

  const onRemoveDiet = useCallback(
    (name: string) => {
      void (async () => {
        const ok = await confirm({
          title: t('settings.dietsPage.deleteTitle'),
          message: t('settings.dietsPage.deleteMessage', { name }),
          confirmText: t('settings.shared.delete'),
          cancelText: t('common.confirm.cancel'),
          destructive: true,
        });
        if (!ok) return;
        const next = await removeCustomDiet(name);
        setDiets(next.map((d) => d.name));
      })();
    },
    [confirm, t]
  );

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={web ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={web ? 0 : headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />
        <Text style={styles.section}>{t('settings.beherenPage.title')}</Text>
        <Text style={styles.hint}>
          {t('settings.beherenPage.hint')}
          {web ? t('settings.beherenPage.hintWebSuffix') : ''}
        </Text>

        <Text style={styles.subSection}>{t('settings.beherenPage.categoriesTitle')}</Text>
        <Text style={styles.hint}>{t('settings.beherenPage.categoriesHint')}</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder={t('settings.beherenPage.categoryPlaceholder')}
            value={newCategoryInput}
            onChangeText={setNewCategoryInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.btnPrimary, { backgroundColor: theme.accent }]}
            onPress={onAddCategory}
            disabled={!newCategoryInput.trim()}
          >
            <Text style={styles.btnPrimaryText}>{t('settings.shared.add')}</Text>
          </Pressable>
        </View>
        {sortedCategories.length > 0 ? (
          <View style={styles.chipRow}>
            {sortedCategories.map((c) => (
              <Pressable key={c} style={styles.chip} onPress={() => onRemoveCategory(c)}>
                <Text style={styles.chipText}>{c} ×</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.statusMuted}>{t('settings.beherenPage.categoriesEmpty')}</Text>
        )}

        <Text style={styles.subSection}>{t('settings.beherenPage.tagsTitle')}</Text>
        <Text style={styles.hint}>{t('settings.beherenPage.tagsHint')}</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder={t('settings.tagsPage.placeholder')}
            value={newTagInput}
            onChangeText={setNewTagInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.btnPrimary, { backgroundColor: theme.accent }]}
            onPress={onAddTag}
            disabled={!newTagInput.trim()}
          >
            <Text style={styles.btnPrimaryText}>{t('settings.shared.add')}</Text>
          </Pressable>
        </View>
        {sortedTags.length > 0 ? (
          <View style={styles.chipRow}>
            {sortedTags.map((tag) => (
              <Pressable key={tag} style={styles.chip} onPress={() => onRemoveTag(tag)}>
                <Text style={styles.chipText}>{tag} ×</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.statusMuted}>{t('settings.tagsPage.empty')}</Text>
        )}

        <Text style={styles.subSection}>{t('settings.beherenPage.dietsTitle')}</Text>
        <Text style={styles.hint}>{t('settings.dietsPage.hint')}</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder={t('settings.dietsPage.placeholder')}
            value={newDietInput}
            onChangeText={setNewDietInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[styles.btnPrimary, { backgroundColor: theme.accent }]}
            onPress={onAddDiet}
            disabled={!newDietInput.trim()}
          >
            <Text style={styles.btnPrimaryText}>{t('settings.shared.add')}</Text>
          </Pressable>
        </View>
        {sortedDiets.length > 0 ? (
          <View style={styles.chipRow}>
            {sortedDiets.map((d) => (
              <Pressable key={d} style={styles.chip} onPress={() => onRemoveDiet(d)}>
                <Text style={styles.chipText}>{d} ×</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.statusMuted}>{t('settings.dietsPage.empty')}</Text>
        )}

        <View style={styles.divider} />

        <Pressable
          style={[styles.btnOutline, { borderColor: theme.accent }, busy && styles.btnDisabled]}
          onPress={onCleanupRecipes}
          disabled={busy}
        >
          <Text style={[styles.btnOutlineText, { color: theme.accent }]}>
            {t('settings.beherenPage.cleanupButton')}
          </Text>
        </Pressable>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text style={styles.busyHint}>{t('settings.shared.busy')}</Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 20, marginBottom: 8 },
  subSection: { fontSize: 15, fontWeight: '800', color: '#1a1a1a', marginTop: 18, marginBottom: 6 },
  hint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 10 },
  statusMuted: { fontSize: 14, color: '#888', marginBottom: 8 },
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 },
  flex1: { flex: 1, minWidth: 180 },
  btnPrimary: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 14, color: '#444', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#e8e4dc', marginTop: 18, marginBottom: 12 },
  btnDisabled: { opacity: 0.45 },
  btnOutline: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  btnOutlineText: { fontWeight: '700', fontSize: 15 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  busyHint: { fontSize: 14, color: '#666' },
});

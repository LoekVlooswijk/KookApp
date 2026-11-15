import { useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation/elements';
import { useCallback, useState } from 'react';
import {
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
import Slider from '@react-native-community/slider';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { useI18n } from '../../components/I18nContext';
import { type TranslationKey } from '../../lib/i18n';
import {
  addAiApiKey,
  deleteAiApiKey,
  listAiApiKeys,
  type AiApiKeyEntry,
} from '../../lib/aiKeyring';
import {
  AI_MODEL_TASKS,
  getActiveAiKeyId,
  getAiModelPresetKey,
  getAiModelTaskPresetKey,
  getAiPreferLatestModelAlias,
  hydrateAiPrefsFromDb,
  setActiveAiKeyId,
  setAiModelPresetKey,
  setAiModelTaskPresetKey,
  setAiPreferLatestModelAlias,
  type AiModelTask,
} from '../../lib/aiPrefs';
import {
  AI_MODEL_PRESETS,
  AI_PROVIDERS,
  listAiProviders,
  type AiProviderId,
} from '../../lib/aiProviders';
import {
  getImportAhSiteSearchEnabled,
  setImportAhSiteSearchEnabled,
} from '../../lib/aiAhSearchPrefs';
import {
  getImportExtractConcurrency,
  setImportExtractConcurrency,
} from '../../lib/aiImportConcurrencyPrefs';
import { getImportWebSearchEnabled, setImportWebSearchEnabled } from '../../lib/aiImportPrefs';
import { ensureDatabaseAsync } from '../../lib/db';

/** Volgorde voor “nieuwe sleutel”: één rij, Mistral tweede, OpenAI laatste. */
const NEW_API_KEY_PROVIDER_ORDER: readonly AiProviderId[] = [
  'anthropic',
  'mistral',
  'gemini',
  'openai',
];

const AI_TASK_UI: Record<AiModelTask, { titleKey: TranslationKey; hintKey: TranslationKey }> = {
  import: {
    titleKey: 'settings.aiPage.tasks.import.title',
    hintKey: 'settings.aiPage.tasks.import.hint',
  },
  adjust: {
    titleKey: 'settings.aiPage.tasks.adjust.title',
    hintKey: 'settings.aiPage.tasks.adjust.hint',
  },
  weekplan: {
    titleKey: 'settings.aiPage.tasks.weekplan.title',
    hintKey: 'settings.aiPage.tasks.weekplan.hint',
  },
};

export default function AiSettingsScreen() {
  const theme = useAppTheme();
  const { t } = useI18n();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';
  const headerHeight = useHeaderHeight();

  const [keys, setKeys] = useState<AiApiKeyEntry[]>([]);
  const [activeKeyId, setActiveKeyIdState] = useState<string | null>(null);
  const [newProvider, setNewProvider] = useState<AiProviderId>('anthropic');
  const [newLabel, setNewLabel] = useState('');
  const [newKeyInput, setNewKeyInput] = useState('');

  const [modelPresetKey, setModelPresetKeyState] = useState<string>('');
  const [preferLatestAlias, setPreferLatestAliasState] = useState(true);
  const [importWebSearch, setImportWebSearchState] = useState(false);
  const [importAhSearch, setImportAhSearchState] = useState(true);
  const [importConcurrency, setImportConcurrencyState] = useState(6);

  const [taskPresets, setTaskPresets] = useState<Record<AiModelTask, string>>({
    import: '',
    adjust: '',
    weekplan: '',
  });

  const chipOnStyle = { backgroundColor: theme.accentSoft, borderColor: theme.accent };
  const chipTextOnStyle = { color: theme.accentSoftText };

  const reloadPrefs = useCallback(() => {
    void (async () => {
      await ensureDatabaseAsync();
      await hydrateAiPrefsFromDb();

      const list = await listAiApiKeys();
      setKeys(list);

      let active = getActiveAiKeyId();
      if (!active && list.length > 0) {
        active = list[0].id;
        await setActiveAiKeyId(active);
      }
      setActiveKeyIdState(active);

      const activeEntry = active ? list.find((k) => k.id === active) : null;
      const provider: AiProviderId | null = activeEntry?.provider ?? null;
      if (provider) {
        setModelPresetKeyState(getAiModelPresetKey(provider));
        const nextTaskP: Record<AiModelTask, string> = {
          import: '',
          adjust: '',
          weekplan: '',
        };
        for (const task of AI_MODEL_TASKS) {
          nextTaskP[task] = getAiModelTaskPresetKey(task, provider);
        }
        setTaskPresets(nextTaskP);
      } else {
        setModelPresetKeyState('');
        setTaskPresets({ import: '', adjust: '', weekplan: '' });
      }

      setPreferLatestAliasState(await getAiPreferLatestModelAlias());

      setImportWebSearchState(await getImportWebSearchEnabled());
      setImportAhSearchState(await getImportAhSiteSearchEnabled());
      setImportConcurrencyState(await getImportExtractConcurrency());
      setNewKeyInput('');
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reloadPrefs();
    }, [reloadPrefs])
  );

  const onAddApiKey = useCallback(async () => {
    try {
      const entry = await addAiApiKey({
        provider: newProvider,
        label: newLabel,
        apiKey: newKeyInput,
      });
      const next = await listAiApiKeys();
      setKeys(next);
      if (!activeKeyId) {
        await setActiveAiKeyId(entry.id);
        setActiveKeyIdState(entry.id);
      }
      setNewLabel('');
      setNewKeyInput('');
      Alert.alert(t('settings.aiPage.savedTitle'), t('settings.aiPage.savedMessage'));
    } catch (e) {
      Alert.alert(
        t('settings.shared.errorTitle'),
        e instanceof Error ? e.message : t('settings.aiPage.saveFailed')
      );
    }
  }, [activeKeyId, newKeyInput, newLabel, newProvider, t]);

  const onSelectKey = useCallback(
    (id: string) => {
      void (async () => {
        await setActiveAiKeyId(id);
        setActiveKeyIdState(id);
        const entry = keys.find((k) => k.id === id) ?? null;
        const provider = entry?.provider ?? null;
        if (provider) {
          setModelPresetKeyState(getAiModelPresetKey(provider));
          const nextTaskP: Record<AiModelTask, string> = {
            import: '',
            adjust: '',
            weekplan: '',
          };
          for (const task of AI_MODEL_TASKS) {
            nextTaskP[task] = getAiModelTaskPresetKey(task, provider);
          }
          setTaskPresets(nextTaskP);
        } else {
          setModelPresetKeyState('');
          setTaskPresets({ import: '', adjust: '', weekplan: '' });
        }
      })();
    },
    [keys]
  );

  const onDeleteKey = useCallback(
    (id: string) => {
      const entry = keys.find((k) => k.id === id);
      const label = entry?.label?.trim() || t('settings.aiPage.deleteConfirmLabelDefault');
      void (async () => {
        const ok = await confirm({
          title: t('settings.aiPage.deleteConfirmTitle'),
          message: t('settings.aiPage.deleteConfirmMessage', { label }),
          confirmText: t('settings.shared.delete'),
          cancelText: t('common.confirm.cancel'),
          destructive: true,
        });
        if (!ok) return;
        await deleteAiApiKey(id);
        const next = await listAiApiKeys();
        setKeys(next);
        if (activeKeyId === id) {
          const newActive = next[0]?.id ?? null;
          await setActiveAiKeyId(newActive);
          setActiveKeyIdState(newActive);
        }
      })();
    },
    [activeKeyId, confirm, keys, t]
  );

  const pickModelPreset = useCallback((provider: AiProviderId, presetKey: string) => {
    void (async () => {
      await setAiModelPresetKey(provider, presetKey);
      setModelPresetKeyState(presetKey);
    })();
  }, []);

  const onTogglePreferLatestAlias = useCallback((on: boolean) => {
    void (async () => {
      await setAiPreferLatestModelAlias(on);
      setPreferLatestAliasState(on);
    })();
  }, []);

  const onToggleImportWebSearch = useCallback((on: boolean) => {
    void (async () => {
      await setImportWebSearchEnabled(on);
      setImportWebSearchState(on);
    })();
  }, []);

  const onToggleImportAhSearch = useCallback((on: boolean) => {
    void (async () => {
      await setImportAhSiteSearchEnabled(on);
      setImportAhSearchState(on);
    })();
  }, []);

  const onSetImportConcurrency = useCallback((n: number) => {
    void (async () => {
      const v = Math.max(1, Math.min(10, Math.round(n)));
      await setImportExtractConcurrency(v);
      setImportConcurrencyState(v);
    })();
  }, []);

  const activeEntry = activeKeyId ? keys.find((k) => k.id === activeKeyId) : null;
  const activeProvider: AiProviderId | null = activeEntry?.provider ?? null;
  const providerInfo = activeProvider
    ? listAiProviders().find((p) => p.id === activeProvider)
    : null;
  const modelPresets = activeProvider ? AI_MODEL_PRESETS[activeProvider] : [];

  const clearTaskModelOverride = useCallback(
    (task: AiModelTask) => {
      if (!activeProvider || web) return;
      void (async () => {
        await setAiModelTaskPresetKey(task, activeProvider, '');
        setTaskPresets((p) => ({ ...p, [task]: '' }));
      })();
    },
    [activeProvider, web]
  );

  const pickTaskPreset = useCallback(
    (task: AiModelTask, presetKey: string) => {
      if (!activeProvider || web) return;
      void (async () => {
        await setAiModelTaskPresetKey(task, activeProvider, presetKey);
        setTaskPresets((p) => ({ ...p, [task]: presetKey }));
      })();
    },
    [activeProvider, web]
  );

  return (
    <KeyboardAvoidingView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      behavior={web ? undefined : Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={web ? 0 : headerHeight}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ConfirmDialog />
        <Text style={styles.lead}>{t('settings.aiPage.lead')}</Text>

        {web ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{t('settings.aiPage.webNotice')}</Text>
          </View>
        ) : null}

        <Text style={styles.section}>{t('settings.aiPage.sections.keys')}</Text>
        {keys.length > 0 ? (
          <Text style={styles.statusOk}>
            {t('settings.aiPage.keysStatus', {
              count: keys.length,
              plural: keys.length === 1 ? '' : 's',
            })}
          </Text>
        ) : (
          <Text style={styles.statusMuted}>{t('settings.aiPage.keysEmpty')}</Text>
        )}

        {keys.length > 0 ? (
          <View style={styles.keyList}>
            {keys.map((k) => {
              const selected = k.id === activeKeyId;
              const providerLabel =
                listAiProviders().find((p) => p.id === k.provider)?.label ??
                (k.provider === 'anthropic'
                  ? 'Anthropic'
                  : k.provider === 'openai'
                    ? 'OpenAI'
                    : k.provider === 'gemini'
                      ? 'Google Gemini'
                      : 'Mistral');
              return (
                <View key={k.id} style={[styles.keyRow, selected ? styles.keyRowSelected : null]}>
                  <Pressable style={styles.keyMain} onPress={() => onSelectKey(k.id)}>
                    <Text style={styles.keyTitle} numberOfLines={1}>
                      {k.label.trim() || t('settings.aiPage.apiKeyDefault')}
                    </Text>
                    <Text style={styles.keyMeta} numberOfLines={1}>
                      {providerLabel}
                      {selected ? t('settings.aiPage.activeSuffix') : ''}
                    </Text>
                  </Pressable>
                  {!web ? (
                    <Pressable style={styles.keyDeleteBtn} onPress={() => onDeleteKey(k.id)}>
                      <Text style={styles.keyDeleteText}>{t('settings.shared.delete')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.subLabel}>{t('settings.aiPage.newKeyLabel')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScrollOuter}
          contentContainerStyle={styles.chipScrollRow}
          keyboardShouldPersistTaps="handled"
        >
          {NEW_API_KEY_PROVIDER_ORDER.map((id) => {
            const p = AI_PROVIDERS[id];
            return (
              <Pressable
                key={p.id}
                style={[
                  styles.chip,
                  styles.chipNoShrink,
                  newProvider === p.id ? { ...chipOnStyle, opacity: p.enabled ? 1 : 0.6 } : null,
                ]}
                onPress={() => setNewProvider(p.id)}
              >
                <Text style={[styles.chipText, newProvider === p.id ? chipTextOnStyle : null]}>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <TextInput
          style={styles.input}
          placeholder={t('settings.aiPage.namePlaceholder')}
          placeholderTextColor="#999"
          value={newLabel}
          onChangeText={setNewLabel}
          editable={!web}
        />
        <TextInput
          style={styles.input}
          placeholder={t('settings.aiPage.keyPlaceholder')}
          placeholderTextColor="#999"
          value={newKeyInput}
          onChangeText={setNewKeyInput}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!web}
        />
        <View style={styles.row}>
          <Pressable
            style={[
              styles.btnPrimary,
              { backgroundColor: theme.accent },
              (web || !newKeyInput.trim()) && styles.btnDisabled,
            ]}
            onPress={() => {
              if (!web) void onAddApiKey();
            }}
            disabled={web || !newKeyInput.trim()}
          >
            <Text style={styles.btnPrimaryText}>{t('settings.aiPage.save')}</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>{t('settings.aiPage.sections.model')}</Text>
        {activeProvider ? (
          <>
            <Text style={styles.hint}>
              {t('settings.aiPage.activeProviderHint', {
                provider: providerInfo?.label ?? activeProvider,
              })}
            </Text>
            {!providerInfo?.enabled ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>{t('settings.aiPage.providerDisabledNotice')}</Text>
              </View>
            ) : null}
            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={styles.switchLabel}>{t('settings.aiPage.preferLatestLabel')}</Text>
                <Text style={styles.hint}>{t('settings.aiPage.preferLatestHint')}</Text>
              </View>
              <Switch
                value={preferLatestAlias && !web}
                onValueChange={(v) => {
                  if (!web) onTogglePreferLatestAlias(v);
                }}
                disabled={web}
                trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
                thumbColor={preferLatestAlias && !web ? theme.accent : '#f4f3f4'}
              />
            </View>
            <View style={styles.chipRow}>
              {modelPresets.map((p) => (
                <Pressable
                  key={p.key}
                  style={[styles.chip, modelPresetKey === p.key ? chipOnStyle : null]}
                  onPress={() => pickModelPreset(activeProvider, p.key)}
                >
                  <Text
                    style={[styles.chipText, modelPresetKey === p.key ? chipTextOnStyle : null]}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.statusMuted}>{t('settings.aiPage.pickKeyFirstModel')}</Text>
        )}

        <Text style={styles.section}>{t('settings.aiPage.sections.taskModels')}</Text>
        {activeProvider && providerInfo?.enabled ? (
          <>
            <Text style={styles.hint}>{t('settings.aiPage.taskModelsHint')}</Text>
            {AI_MODEL_TASKS.map((task) => {
              const ui = AI_TASK_UI[task];
              const inherit = !taskPresets[task]?.trim();
              return (
                <View key={task} style={styles.taskModelBlock}>
                  <Text style={styles.taskModelTitle}>{t(ui.titleKey)}</Text>
                  <Text style={styles.hint}>{t(ui.hintKey)}</Text>
                  <View style={styles.chipRow}>
                    <Pressable
                      style={[styles.chip, inherit ? chipOnStyle : null]}
                      onPress={() => {
                        if (!web) clearTaskModelOverride(task);
                      }}
                      disabled={web}
                    >
                      <Text style={[styles.chipText, inherit ? chipTextOnStyle : null]}>
                        {t('settings.aiPage.inheritLabel')}
                      </Text>
                    </Pressable>
                    {modelPresets.map((p) => (
                      <Pressable
                        key={`${task}-${p.key}`}
                        style={[styles.chip, taskPresets[task] === p.key ? chipOnStyle : null]}
                        onPress={() => {
                          if (!web) pickTaskPreset(task, p.key);
                        }}
                        disabled={web}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            taskPresets[task] === p.key ? chipTextOnStyle : null,
                          ]}
                        >
                          {p.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        ) : activeProvider && !providerInfo?.enabled ? (
          <Text style={styles.statusMuted}>{t('settings.aiPage.providerNoCalls')}</Text>
        ) : (
          <Text style={styles.statusMuted}>{t('settings.aiPage.pickKeyFirstTaskModels')}</Text>
        )}

        <Text style={styles.section}>{t('settings.aiPage.sections.photoImport')}</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchTextCol}>
            <Text style={styles.switchLabel}>{t('settings.aiPage.ahSearchLabel')}</Text>
            <Text style={styles.hint}>{t('settings.aiPage.ahSearchHint')}</Text>
          </View>
          <Switch
            value={importAhSearch && !web}
            onValueChange={(v) => {
              if (!web) onToggleImportAhSearch(v);
            }}
            disabled={web}
            trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
            thumbColor={importAhSearch && !web ? theme.accent : '#f4f3f4'}
          />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchTextCol}>
            <Text style={styles.switchLabel}>{t('settings.aiPage.webSearchLabel')}</Text>
            <Text style={styles.hint}>{t('settings.aiPage.webSearchHint')}</Text>
            {activeProvider && activeProvider !== 'anthropic' ? (
              <Text style={styles.hint}>{t('settings.aiPage.webSearchAnthropicOnly')}</Text>
            ) : null}
          </View>
          <Switch
            value={importWebSearch && !web && activeProvider === 'anthropic'}
            onValueChange={(v) => {
              if (!web && activeProvider === 'anthropic') onToggleImportWebSearch(v);
            }}
            disabled={web || activeProvider !== 'anthropic'}
            trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
            thumbColor={
              importWebSearch && !web && activeProvider === 'anthropic' ? theme.accent : '#f4f3f4'
            }
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.switchLabel}>{t('settings.aiPage.concurrencyLabel')}</Text>
          <Text style={styles.hint}>{t('settings.aiPage.concurrencyHint')}</Text>
          <Text style={styles.statusMuted}>
            {t('settings.aiPage.concurrencyCurrent', { count: importConcurrency })}
          </Text>
          <Slider
            minimumValue={1}
            maximumValue={10}
            step={1}
            value={importConcurrency}
            onValueChange={(v) => {
              if (!web) onSetImportConcurrency(v);
            }}
            disabled={web}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor="#ddd"
            thumbTintColor={theme.accent}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 10 },
  subLabel: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 4 },
  statusOk: { fontSize: 14, color: '#2d6a3e', marginBottom: 8 },
  statusMuted: { fontSize: 14, color: '#888', marginBottom: 8 },
  keyList: { marginBottom: 12 },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  keyRowSelected: { borderColor: '#1a1a1a' },
  keyMain: { flex: 1, minWidth: 0 },
  keyTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  keyMeta: { marginTop: 2, fontSize: 12, color: '#666' },
  keyDeleteBtn: { paddingVertical: 8, paddingHorizontal: 8 },
  keyDeleteText: { color: '#b00020', fontWeight: '700', fontSize: 13 },
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
  btnPrimary: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipScrollOuter: { flexGrow: 0 },
  chipScrollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
    flexWrap: 'nowrap',
  },
  chipNoShrink: { flexShrink: 0 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 14, color: '#444', fontWeight: '600' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  switchTextCol: { flex: 1, minWidth: 0 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  card: {
    marginTop: 10,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  taskModelBlock: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  taskModelTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
});

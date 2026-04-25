import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useConfirmDialog } from '../../components/ConfirmDialog';
import { useAppTheme } from '../../components/ThemeContext';
import { addAiApiKey, deleteAiApiKey, listAiApiKeys, type AiApiKeyEntry } from '../../lib/aiKeyring';
import {
  getActiveAiKeyId,
  getAiCustomModelId,
  getAiModelPresetKey,
  hydrateAiPrefsFromDb,
  resolveAiModelId,
  setActiveAiKeyId,
  setAiCustomModelId,
  setAiModelPresetKey,
} from '../../lib/aiPrefs';
import { AI_MODEL_PRESETS, listAiProviders, type AiProviderId } from '../../lib/aiProviders';
import { getImportWebSearchEnabled, setImportWebSearchEnabled } from '../../lib/aiImportPrefs';
import { ensureDatabaseAsync } from '../../lib/db';

export default function AiSettingsScreen() {
  const theme = useAppTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const web = Platform.OS === 'web';

  const [keys, setKeys] = useState<AiApiKeyEntry[]>([]);
  const [activeKeyId, setActiveKeyIdState] = useState<string | null>(null);
  const [newProvider, setNewProvider] = useState<AiProviderId>('anthropic');
  const [newLabel, setNewLabel] = useState('');
  const [newKeyInput, setNewKeyInput] = useState('');

  const [modelPresetKey, setModelPresetKeyState] = useState<string>('');
  const [customModelId, setCustomModelIdState] = useState<string>('');
  const [resolvedModelId, setResolvedModelIdState] = useState<string | null>(null);
  const [importWebSearch, setImportWebSearchState] = useState(false);

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
        setCustomModelIdState(getAiCustomModelId(provider));
        setResolvedModelIdState(resolveAiModelId(provider));
      } else {
        setModelPresetKeyState('');
        setCustomModelIdState('');
        setResolvedModelIdState(null);
      }

      setImportWebSearchState(await getImportWebSearchEnabled());
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
      const entry = await addAiApiKey({ provider: newProvider, label: newLabel, apiKey: newKeyInput });
      const next = await listAiApiKeys();
      setKeys(next);
      if (!activeKeyId) {
        await setActiveAiKeyId(entry.id);
        setActiveKeyIdState(entry.id);
      }
      setNewLabel('');
      setNewKeyInput('');
      Alert.alert('Opgeslagen', 'Je API-sleutel is veilig opgeslagen op dit apparaat.');
    } catch (e) {
      Alert.alert('Fout', e instanceof Error ? e.message : 'Opslaan mislukt.');
    }
  }, [activeKeyId, newKeyInput, newLabel, newProvider]);

  const onSelectKey = useCallback(
    (id: string) => {
      void (async () => {
        await setActiveAiKeyId(id);
        setActiveKeyIdState(id);
        const entry = keys.find((k) => k.id === id) ?? null;
        const provider = entry?.provider ?? null;
        if (provider) {
          setModelPresetKeyState(getAiModelPresetKey(provider));
          setCustomModelIdState(getAiCustomModelId(provider));
          setResolvedModelIdState(resolveAiModelId(provider));
        } else {
          setModelPresetKeyState('');
          setCustomModelIdState('');
          setResolvedModelIdState(null);
        }
      })();
    },
    [keys]
  );

  const onDeleteKey = useCallback(
    (id: string) => {
      const entry = keys.find((k) => k.id === id);
      const label = entry?.label?.trim() || 'deze sleutel';
      void (async () => {
        const ok = await confirm({
          title: 'API-sleutel verwijderen?',
          message: `Weet je zeker dat je ${label} wilt verwijderen? Je kunt daarna AI-functies niet gebruiken met deze sleutel.`,
          confirmText: 'Verwijderen',
          cancelText: 'Annuleren',
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
    [activeKeyId, confirm, keys]
  );

  const pickModelPreset = useCallback((provider: AiProviderId, presetKey: string) => {
    void (async () => {
      await setAiModelPresetKey(provider, presetKey);
      setModelPresetKeyState(presetKey);
      setResolvedModelIdState(resolveAiModelId(provider));
    })();
  }, []);

  const onSaveCustomModelId = useCallback(
    (provider: AiProviderId) => {
      void (async () => {
        await setAiCustomModelId(provider, customModelId);
        setCustomModelIdState(customModelId);
        setResolvedModelIdState(resolveAiModelId(provider));
      })();
    },
    [customModelId]
  );

  const onToggleImportWebSearch = useCallback((on: boolean) => {
    void (async () => {
      await setImportWebSearchEnabled(on);
      setImportWebSearchState(on);
    })();
  }, []);

  const activeEntry = activeKeyId ? keys.find((k) => k.id === activeKeyId) : null;
  const activeProvider: AiProviderId | null = activeEntry?.provider ?? null;
  const providerInfo = activeProvider ? listAiProviders().find((p) => p.id === activeProvider) : null;
  const modelPresets = activeProvider ? AI_MODEL_PRESETS[activeProvider] : [];

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ConfirmDialog />
      <Text style={styles.lead}>
        AI wordt gebruikt voor URL-import en andere slimme functies. API-sleutels verlaten je apparaat alleen bij een
        API-aanroep die jij start.
      </Text>

      {web ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Op web wordt de API-sleutel niet opgeslagen. Gebruik iOS of Android om een sleutel vast te leggen.
          </Text>
        </View>
      ) : null}

      <Text style={styles.section}>AI-sleutels</Text>
      {keys.length > 0 ? (
        <Text style={styles.statusOk}>
          {keys.length} sleutel{keys.length === 1 ? '' : 's'} opgeslagen. Tik op een sleutel om die actief te maken.
        </Text>
      ) : (
        <Text style={styles.statusMuted}>Nog geen sleutels ingesteld.</Text>
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
                    {k.label.trim() || 'API-sleutel'}
                  </Text>
                  <Text style={styles.keyMeta} numberOfLines={1}>
                    {providerLabel}
                    {selected ? ' · Actief' : ''}
                  </Text>
                </Pressable>
                {!web ? (
                  <Pressable style={styles.keyDeleteBtn} onPress={() => onDeleteKey(k.id)}>
                    <Text style={styles.keyDeleteText}>Verwijderen</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.subLabel}>Nieuwe sleutel toevoegen</Text>
      <View style={styles.chipRow}>
        {listAiProviders().map((p) => (
          <Pressable
            key={p.id}
            style={[styles.chip, newProvider === p.id ? { ...chipOnStyle, opacity: p.enabled ? 1 : 0.6 } : null]}
            onPress={() => setNewProvider(p.id)}
          >
            <Text style={[styles.chipText, newProvider === p.id ? chipTextOnStyle : null]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder="Naam (bijv. Persoonlijk, Werk, Test)…"
        placeholderTextColor="#999"
        value={newLabel}
        onChangeText={setNewLabel}
        editable={!web}
      />
      <TextInput
        style={styles.input}
        placeholder="API-sleutel plakken…"
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
          style={[styles.btnPrimary, { backgroundColor: theme.accent }, (web || !newKeyInput.trim()) && styles.btnDisabled]}
          onPress={() => {
            if (!web) void onAddApiKey();
          }}
          disabled={web || !newKeyInput.trim()}
        >
          <Text style={styles.btnPrimaryText}>Opslaan</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Model</Text>
      {activeProvider ? (
        <>
          <Text style={styles.hint}>
            Actieve provider: {providerInfo?.label ?? activeProvider}. Kies een preset, of vul een eigen model-id in.
          </Text>
          {!providerInfo?.enabled ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                Deze provider staat als optie klaar, maar is nog niet geïmplementeerd voor API-aanroepen in de app.
              </Text>
            </View>
          ) : null}
          <View style={styles.chipRow}>
            {modelPresets.map((p) => (
              <Pressable
                key={p.key}
                style={[styles.chip, modelPresetKey === p.key ? chipOnStyle : null]}
                onPress={() => pickModelPreset(activeProvider, p.key)}
              >
                <Text style={[styles.chipText, modelPresetKey === p.key ? chipTextOnStyle : null]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.subLabel}>Eigen model-id (optioneel)</Text>
          <TextInput
            style={styles.input}
            placeholder="bijv. gpt-4o-mini / gemini-… (of laat leeg en kies een preset)"
            placeholderTextColor="#999"
            value={customModelId}
            onChangeText={setCustomModelIdState}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!web}
          />
          <View style={styles.row}>
            <Pressable
              style={[styles.btnOutline, { borderColor: theme.accent }, web && styles.btnDisabled]}
              onPress={() => {
                if (!web) onSaveCustomModelId(activeProvider);
              }}
              disabled={web}
            >
              <Text style={[styles.btnOutlineText, { color: theme.accent }]}>Bewaar model-id</Text>
            </Pressable>
          </View>
          {resolvedModelId ? (
            <Text style={styles.statusOk}>Huidig model-id: {resolvedModelId}</Text>
          ) : (
            <Text style={styles.statusMuted}>Nog geen model-id ingesteld.</Text>
          )}
        </>
      ) : (
        <Text style={styles.statusMuted}>Kies eerst een actieve API-sleutel om een model te selecteren.</Text>
      )}

      <Text style={styles.section}>Foto-import</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchTextCol}>
          <Text style={styles.switchLabel}>Web search ook bij eerste resolve</Text>
          <Text style={styles.hint}>
            Zonder zichtbare URL in de foto zoekt de app aan het eind automatisch met web search, met het model hierboven.
            Met deze optie aan gebeurt dat ook meteen bij de eerste resolve — vaak sneller, wel meer API-kosten.
          </Text>
          {activeProvider && activeProvider !== 'anthropic' ? (
            <Text style={styles.hint}>Let op: web search werkt alleen met Anthropic.</Text>
          ) : null}
        </View>
        <Switch
          value={importWebSearch && !web && activeProvider === 'anthropic'}
          onValueChange={(v) => {
            if (!web && activeProvider === 'anthropic') onToggleImportWebSearch(v);
          }}
          disabled={web || activeProvider !== 'anthropic'}
          trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
          thumbColor={importWebSearch && !web && activeProvider === 'anthropic' ? theme.accent : '#f4f3f4'}
        />
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
});


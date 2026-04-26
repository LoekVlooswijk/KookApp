import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import { useAppTheme } from '../../components/ThemeContext';
import type { AiImageMediaType } from '../../lib/aiClient';
import { hasActiveAiKey } from '../../lib/aiClient';
import { getImportAhSiteSearchEnabled, setImportAhSiteSearchEnabled } from '../../lib/aiAhSearchPrefs';
import { getImportExtractConcurrency } from '../../lib/aiImportConcurrencyPrefs';
import { registerImportSession } from '../../lib/importDraft';
import {
  buildManualFallbackImportPayload,
  discoverRecipesFromPhoto,
  fetchAndExtractOneRecipe,
  resolveRecipeUrlFromSearchQuery,
  resolveRecipeUrlsForPhotoImport,
  type PhotoImportRow,
} from '../../lib/recipeImportFromPhoto';
import { createRecipe } from '../../lib/recipesRepo';
import type { RecipeSavePayload } from '../../lib/types';

type UrlPhase = 'idle' | 'loading' | 'preview' | 'error';

/** Directe link (http(s) of www…) vs. vrije zoekterm voor web search + import. */
function classifyUrlImportInput(raw: string): { kind: 'direct'; url: string } | { kind: 'search'; query: string } {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return { kind: 'direct', url: t };
  }
  if (lower.startsWith('www.')) {
    return { kind: 'direct', url: `https://${t}` };
  }
  return { kind: 'search', query: t };
}

function mimeToAiMediaType(mime: string | undefined): AiImageMediaType {
  if (mime === 'image/png') return 'image/png';
  if (mime === 'image/webp') return 'image/webp';
  if (mime === 'image/gif') return 'image/gif';
  return 'image/jpeg';
}

async function downscaleForVision(asset: ImagePicker.ImagePickerAsset): Promise<{
  base64: string;
  mediaType: AiImageMediaType;
}> {
  // Vision token use scales with image size. For screenshots, a resized JPEG keeps OCR quality
  // while cutting input tokens significantly.
  if (asset.uri) {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1100 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (manipulated.base64) {
        return { base64: manipulated.base64, mediaType: 'image/jpeg' };
      }
    } catch {
      // Fall back to picker base64.
    }
  }
  const b64 = asset.base64;
  if (!b64) {
    throw new Error('Kon de afbeelding niet lezen. Probeer een andere foto.');
  }
  return { base64: b64, mediaType: mimeToAiMediaType(asset.mimeType) };
}

export default function ImportRecipeScreen() {
  const theme = useAppTheme();
  const navigation = useNavigation();
  const router = useRouter();
  const params = useLocalSearchParams<{ saved?: string | string[] }>();
  const [tab, setTab] = useState<'url' | 'foto'>('url');

  const chipOnStyle = useMemo(
    () => ({ backgroundColor: theme.accentSoft, borderColor: theme.accent }),
    [theme.accentSoft, theme.accent]
  );
  const chipTextOnStyle = useMemo(() => ({ color: theme.accentSoftText }), [theme.accentSoftText]);

  const [url, setUrl] = useState('');
  const [urlPhase, setUrlPhase] = useState<UrlPhase>('idle');
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  const [rawDebug, setRawDebug] = useState<string | null>(null);
  const [payload, setPayload] = useState<RecipeSavePayload | null>(null);

  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoRows, setPhotoRows] = useState<PhotoImportRow[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoAhSearch, setPhotoAhSearch] = useState(true);

  const lastUrlImportFetchRef = useRef<string | null>(null);
  const importBusy = urlPhase === 'loading' || photoBusy;

  useEffect(() => {
    const raw = Array.isArray(params.saved) ? params.saved[0] : params.saved;
    if (raw !== '1') return;
    // Clear URL-import preview state after saving from the preview screen.
    setUrlPhase('idle');
    setPayload(null);
    setUrlMessage(null);
    setRawDebug(null);
    // Keep the input URL text; user might want to import another similar URL.
  }, [params.saved]);

  useEffect(() => {
    void (async () => {
      try {
        setPhotoAhSearch(await getImportAhSiteSearchEnabled());
      } catch {
        setPhotoAhSearch(true);
      }
    })();
  }, []);

  const onTogglePhotoAhSearch = useCallback((v: boolean) => {
    void (async () => {
      try {
        await setImportAhSiteSearchEnabled(v);
        setPhotoAhSearch(v);
      } catch (e) {
        Alert.alert('Fout', e instanceof Error ? e.message : 'Opslaan mislukt.');
      }
    })();
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (!importBusy) return;
      e.preventDefault();
      Alert.alert(
        'Even wachten',
        'De assistent is nog bezig met importeren. Wacht tot dit klaar is.'
      );
    });
    return unsub;
  }, [importBusy, navigation]);

  const runExtractUrl = useCallback(async () => {
    const okKey = await hasActiveAiKey();
    if (!okKey) {
      setUrlMessage('Geen API-sleutel ingesteld. Voeg die toe bij Instellingen.');
      setUrlPhase('error');
      setRawDebug(null);
      return;
    }

    const u = url.trim();
    if (!u) {
      setUrlMessage('Plak een URL of tik een zoekterm.');
      setUrlPhase('error');
      setRawDebug(null);
      return;
    }

    setUrlPhase('loading');
    setUrlMessage(null);
    setRawDebug(null);
    setPayload(null);
    lastUrlImportFetchRef.current = null;

    try {
      const classified = classifyUrlImportInput(u);
      let fetchUrl: string;
      if (classified.kind === 'direct') {
        fetchUrl = classified.url;
      } else {
        const found = await resolveRecipeUrlFromSearchQuery(classified.query);
        if (!found) {
          setUrlMessage(
            'Geen recept-URL gevonden voor deze zoekterm. Probeer specifiezer te zijn (bijv. titel + site) of plak een directe link.'
          );
          setUrlPhase('error');
          return;
        }
        fetchUrl = found;
      }

      lastUrlImportFetchRef.current = fetchUrl;
      const result = await fetchAndExtractOneRecipe(fetchUrl);
      if (!result.ok) {
        setUrlMessage(result.message);
        setRawDebug(result.rawModelText ?? result.debugSnippet ?? null);
        setUrlPhase('error');
        return;
      }
      setPayload(result.payload);
      setUrlPhase('preview');
    } catch (e) {
      setUrlMessage(e instanceof Error ? e.message : 'Er ging iets mis.');
      setRawDebug(null);
      setUrlPhase('error');
    }
  }, [url]);

  const goToEditor = useCallback(() => {
    if (!payload) return;
    const sid = registerImportSession(payload);
    // URL-import: use the same clean preview, but allow saving from there.
    router.push({ pathname: '/recipe/preview', params: { importSid: sid, mode: 'single' } });
  }, [payload, router]);

  const goToEditorFromPayload = useCallback(
    (p: RecipeSavePayload) => {
      const sid = registerImportSession(p);
      router.push({ pathname: '/recipe/preview', params: { importSid: sid } });
    },
    [router]
  );

  const pickPhotoAndImport = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Foto op web',
        'Importeren via foto werkt het beste op iOS of Android. Op web kun je een URL plakken.'
      );
      return;
    }

    const okKey = await hasActiveAiKey();
    if (!okKey) {
      setPhotoError('Geen API-sleutel ingesteld. Voeg die toe bij Instellingen.');
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhotoError('Toegang tot je fotobibliotheek is nodig om een screenshot te kiezen.');
      return;
    }

    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.65,
      base64: true,
    });

    if (pick.canceled || !pick.assets?.[0]) {
      return;
    }

    const asset = pick.assets[0];

    setPhotoError(null);
    setPhotoBusy(true);
    setPhotoRows([]);

    try {
      const { base64, mediaType } = await downscaleForVision(asset);
      const discovered = await discoverRecipesFromPhoto(base64, mediaType);
      if (!discovered.ok) {
        setPhotoError(discovered.message);
        return;
      }

      const withUrls = await resolveRecipeUrlsForPhotoImport(discovered.recepten);

      const rows: PhotoImportRow[] = withUrls.map((r) => ({
        titel: r.titel,
        url: r.url,
        toelichting: r.toelichting,
        status: r.url ? 'pending' : 'error',
        message: r.url
          ? undefined
          : 'Geen recept-URL gevonden (ook niet via zoeken). Voeg de link handmatig toe via de URL-tab of kies een scherpere foto.',
      }));

      setPhotoRows(rows);

      // Fetch+extract can be slow; run a small pool in parallel to speed up,
      // while keeping rate limits manageable.
      const cfgConcurrency = await getImportExtractConcurrency();
      const indices = rows.map((_, i) => i).filter((i) => !!rows[i]?.url);
      let cursor = 0;
      const concurrency = Math.max(1, Math.min(cfgConcurrency, 10));
      const worker = async () => {
        while (cursor < indices.length) {
          const i = indices[cursor]!;
          cursor++;
          const row = rows[i];
          if (!row?.url) continue;

          setPhotoRows((prev) =>
            prev.map((p, j) => (j === i ? { ...p, status: 'loading' as const } : p))
          );

          const result = await fetchAndExtractOneRecipe(row.url);

          setPhotoRows((prev) =>
            prev.map((p, j) =>
              j === i
                ? result.ok && result.payload
                  ? { ...p, status: 'ok' as const, payload: result.payload }
                  : {
                      ...p,
                      status: 'error' as const,
                      message: result.ok ? 'Importeren mislukt.' : result.message,
                    }
                : p
            )
          );
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, indices.length) }, () => worker()));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Er ging iets mis.');
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  const saveAllOk = useCallback(async () => {
    const okPayloads = photoRows.filter((r) => r.status === 'ok' && r.payload).map((r) => r.payload!);
    if (okPayloads.length === 0) {
      Alert.alert('Niets om op te slaan', 'Er zijn nog geen gelukte imports.');
      return;
    }

    Alert.alert(
      'Recepten opslaan',
      `${okPayloads.length} recept${okPayloads.length === 1 ? '' : 'en'} in je kookboek zetten?`,
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Opslaan',
          onPress: () => {
            void (async () => {
              try {
                let n = 0;
                for (const p of okPayloads) {
                  await createRecipe(p);
                  n++;
                }
                setPhotoRows([]);
                Alert.alert('Klaar', `${n} recept${n === 1 ? '' : 'en'} opgeslagen.`);
                router.replace('/');
              } catch (e) {
                Alert.alert('Fout', e instanceof Error ? e.message : 'Opslaan mislukt.');
              }
            })();
          },
        },
      ]
    );
  }, [photoRows, router]);

  const ingCount =
    payload?.ingredientGroups.reduce((n, g) => n + g.ingredients.length, 0) ?? 0;
  const stepCount =
    payload?.stepSections.reduce((n, s) => n + s.steps.length, 0) ?? 0;

  const okPhotoCount = photoRows.filter((r) => r.status === 'ok').length;

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="always"
    >
      <Text style={styles.lead}>
        Importeer een recept via een link of zoekterm op de URL-tab, of upload een screenshot. Bij foto’s leest
        de assistent de afbeelding; zichtbare links helpen het meest. Ontbreken er links of gebruik je een zoekterm, dan
        volgt web search op titel/zoekterm (met het gekozen model in Instellingen). In Instellingen kun je web search ook al bij de eerste resolve
        aanzetten. Daarna worden de pagina’s opgehaald.
      </Text>

      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tabChip, tab === 'url' && chipOnStyle]}
          onPress={() => setTab('url')}
        >
          <Text style={[styles.tabChipText, tab === 'url' && chipTextOnStyle]}>URL</Text>
        </Pressable>
        <Pressable
          style={[styles.tabChip, tab === 'foto' && chipOnStyle]}
          onPress={() => setTab('foto')}
        >
          <Text style={[styles.tabChipText, tab === 'foto' && chipTextOnStyle]}>Foto</Text>
        </Pressable>
      </View>

      {tab === 'url' ? (
        <>
          <Text style={styles.label}>URL of zoekterm</Text>
          <Text style={styles.hintBlock}>
            Plak een receptlink (https://… of www.…), of typ een zoekterm — dan zoekt de assistent op het web naar een
            passende receptpagina (zelfde stappen als bij foto-import, inclusief web search).
          </Text>
          <TextInput
            style={styles.input}
            placeholder="https://… of bijv. pasta rode pesto ah"
            placeholderTextColor="#999"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={true}
            keyboardType="default"
          />

          <Pressable
            style={[
              styles.primaryBtn,
              { backgroundColor: theme.accent },
              urlPhase === 'loading' && styles.btnDisabled,
            ]}
            onPress={() => void runExtractUrl()}
            disabled={urlPhase === 'loading'}
          >
            {urlPhase === 'loading' ? (
              <View style={styles.row}>
                <ActivityIndicator color="#fff" />
                <Text style={[styles.primaryBtnText, { marginLeft: 10 }]}>Bezig…</Text>
              </View>
            ) : (
              <Text style={styles.primaryBtnText}>Zoek of haal op en importeer</Text>
            )}
          </Pressable>

          {urlPhase === 'preview' && payload ? (
            <View style={styles.card}>
              <Text style={styles.previewTitle}>Voorbeeld</Text>
              <Text style={styles.previewHead}>{payload.title}</Text>
              {payload.description ? (
                <Text style={styles.previewDesc} numberOfLines={4}>
                  {payload.description}
                </Text>
              ) : null}
              <Text style={styles.previewMeta}>
                {ingCount} ingrediënt(en) · {stepCount} stap(pen)
                {payload.baseServings ? ` · ${payload.baseServings} porties` : ''}
              </Text>
              {payload.tagNames.length > 0 ? (
                <Text style={styles.tags}>Tags: {payload.tagNames.join(', ')}</Text>
              ) : null}
              <Pressable
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: theme.accentSoft, borderColor: theme.accent },
                ]}
                onPress={goToEditor}
              >
                <Text style={[styles.secondaryBtnText, { color: theme.accentSoftText }]}>Controleren</Text>
              </Pressable>
              <Pressable
                style={styles.ghostBtn}
                onPress={() => {
                  setUrlPhase('idle');
                  setPayload(null);
                  setUrlMessage(null);
                  setRawDebug(null);
                }}
              >
                <Text style={styles.ghostBtnText}>Opnieuw</Text>
              </Pressable>
            </View>
          ) : null}

          {urlPhase === 'error' && urlMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Mislukt</Text>
              <Text style={styles.errorBody}>{urlMessage}</Text>
              {url.trim() ? (
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    { marginTop: 12, backgroundColor: theme.accentSoft, borderColor: theme.accent },
                  ]}
                  onPress={() =>
                    goToEditorFromPayload(
                      buildManualFallbackImportPayload(
                        'Nieuw recept',
                        lastUrlImportFetchRef.current ??
                          (url.trim().toLowerCase().startsWith('http') ? url.trim() : ''),
                        urlMessage
                      )
                    )
                  }
                >
                  <Text style={[styles.secondaryBtnText, { color: theme.accentSoftText }]}>
                    Handmatig invullen in formulier
                  </Text>
                </Pressable>
              ) : null}
              {rawDebug ? (
                <>
                  <Text style={styles.rawLabel}>Ruwe AI-output (afgekapt)</Text>
                  <Text selectable style={styles.raw}>
                    {rawDebug}
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.label}>Screenshot of foto</Text>
          <Text style={styles.hintBlock}>
            Kies een afbeelding met één of meerdere recepten. Zichtbare URL’s in de screenshot (adresbalk of link)
            geven het beste resultaat. Als de receptpagina een eigen foto heeft, wordt die als omslag gebruikt.
          </Text>

          <View style={styles.switchRow}>
            <View style={styles.switchTextCol}>
              <Text style={styles.switchLabel}>AH/Allerhande site-zoekfunctie gebruiken</Text>
              <Text style={styles.hintBlock}>
                Als je screenshot geen URL’s bevat, probeert de app eerst via ah.nl recepten-zoeken een match te vinden
                op basis van titel. Dit voorkomt dure AI web_search calls.
              </Text>
            </View>
            <Switch
              value={photoAhSearch && Platform.OS !== 'web'}
              onValueChange={(v) => {
                if (Platform.OS !== 'web') onTogglePhotoAhSearch(v);
              }}
              disabled={Platform.OS === 'web'}
              trackColor={{ false: '#ddd', true: theme.accentBorderMuted }}
              thumbColor={photoAhSearch && Platform.OS !== 'web' ? theme.accent : '#f4f3f4'}
            />
          </View>

          <Pressable
            style={[styles.primaryBtn, { backgroundColor: theme.accent }, photoBusy && styles.btnDisabled]}
            onPress={() => void pickPhotoAndImport()}
            disabled={photoBusy}
          >
            {photoBusy ? (
              <View style={styles.row}>
                <ActivityIndicator color="#fff" />
                <Text style={[styles.primaryBtnText, { marginLeft: 10 }]}>Bezig…</Text>
              </View>
            ) : (
              <Text style={styles.primaryBtnText}>Kies foto uit galerij</Text>
            )}
          </Pressable>

          {photoError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Mislukt</Text>
              <Text style={styles.errorBody}>{photoError}</Text>
            </View>
          ) : null}

          {photoRows.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.previewTitle}>Resultaat</Text>
              {photoRows.map((row, idx) => (
                <View key={`${row.titel}-${idx}`} style={styles.photoRow}>
                  <Text style={styles.photoRowTitle} numberOfLines={2}>
                    {row.titel}
                  </Text>
                  {row.url ? (
                    <Text style={styles.photoRowUrl} numberOfLines={1} selectable>
                      {row.url}
                    </Text>
                  ) : null}
                  <Text style={styles.photoRowStatus}>
                    {row.status === 'pending' && 'Wacht…'}
                    {row.status === 'loading' && 'Pagina ophalen…'}
                    {row.status === 'ok' && 'Gelukt'}
                    {row.status === 'error' && (row.message ?? 'Mislukt')}
                  </Text>
                  {row.status === 'ok' && row.payload ? (
                    <Pressable
                      style={styles.smallLinkBtn}
                      onPress={() => goToEditorFromPayload(row.payload!)}
                    >
                      <Text style={styles.smallLinkBtnText}>Controleren</Text>
                    </Pressable>
                  ) : null}
                  {row.status === 'error' && row.url ? (
                    <Pressable
                      style={styles.smallLinkBtn}
                      onPress={() => {
                        const u = row.url;
                        if (!u) return;
                        goToEditorFromPayload(
                          buildManualFallbackImportPayload(row.titel, u, row.message)
                        );
                      }}
                    >
                      <Text style={styles.smallLinkBtnText}>Handmatig invullen in formulier</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {okPhotoCount > 0 ? (
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    { backgroundColor: theme.accentSoft, borderColor: theme.accent },
                  ]}
                  onPress={() => void saveAllOk()}
                >
                  <Text style={[styles.secondaryBtnText, { color: theme.accentSoftText }]}>
                    Alles opslaan ({okPhotoCount} recept{okPhotoCount === 1 ? '' : 'en'})
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                style={styles.ghostBtn}
                onPress={() => {
                  setPhotoRows([]);
                  setPhotoError(null);
                }}
              >
                <Text style={styles.ghostBtnText}>Wissen</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}

      <Pressable onPress={() => router.push('/settings')} style={styles.linkWrap}>
        <Text style={styles.link}>API-sleutel & model → Instellingen</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 16 },
  tabRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  tabChip: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
  },
  tabChipText: { fontSize: 15, fontWeight: '600', color: '#444' },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6 },
  hintBlock: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  switchTextCol: { flex: 1, minWidth: 0 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e2ddd5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    marginBottom: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  linkWrap: { marginTop: 20, marginBottom: 8 },
  link: { fontSize: 15, color: '#2a6cb6', fontWeight: '600' },
  card: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
  },
  previewTitle: { fontSize: 12, fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: 8 },
  previewHead: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  previewDesc: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 8 },
  previewMeta: { fontSize: 14, color: '#666', marginBottom: 8 },
  tags: { fontSize: 13, color: '#555', marginBottom: 14 },
  secondaryBtn: {
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
  },
  secondaryBtnText: { fontWeight: '700', fontSize: 16 },
  ghostBtn: { paddingVertical: 8, alignItems: 'center' },
  ghostBtnText: { color: '#2a6cb6', fontSize: 15, fontWeight: '600' },
  photoRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    marginBottom: 4,
  },
  photoRowTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  photoRowUrl: { fontSize: 12, color: '#2a6cb6', marginTop: 4 },
  photoRowStatus: { fontSize: 13, color: '#666', marginTop: 6 },
  smallLinkBtn: { alignSelf: 'flex-start', marginTop: 8 },
  smallLinkBtnText: { color: '#2a6cb6', fontWeight: '600', fontSize: 14 },
  errorBox: {
    marginTop: 20,
    padding: 14,
    backgroundColor: '#fdeaea',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f0c4c4',
  },
  errorTitle: { fontWeight: '700', color: '#9a3d3d', marginBottom: 6 },
  errorBody: { fontSize: 14, color: '#5c2a2a', lineHeight: 21 },
  rawLabel: { marginTop: 12, fontSize: 12, fontWeight: '600', color: '#666' },
  raw: {
    marginTop: 6,
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    color: '#333',
    lineHeight: 16,
  },
});

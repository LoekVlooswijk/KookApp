import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
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
import { useI18n } from '../../components/I18nContext';
import { useAnimatedValue } from '../../components/useAnimatedValue';
import RecipeWebViewLoader from '../../components/RecipeWebViewLoader';
import type { AiImageMediaType } from '../../lib/aiClient';
import { hasActiveAiKey } from '../../lib/aiClient';
import {
  getImportAhSiteSearchEnabled,
  setImportAhSiteSearchEnabled,
} from '../../lib/aiAhSearchPrefs';
import { getImportExtractConcurrency } from '../../lib/aiImportConcurrencyPrefs';
import { registerImportSession } from '../../lib/importDraft';
import { checkHasInternet } from '../../lib/internetCheck';
import {
  buildManualFallbackImportPayload,
  discoverRecipesFromPhoto,
  fetchAndExtractOneRecipe,
  resolveRecipeUrlFromSearchQuery,
  resolveRecipeUrlsForPhotoImport,
  type PhotoImportRow,
} from '../../lib/recipeImportFromPhoto';
import type { RecipePhotoInput } from '../../lib/recipeImportFromRecipePhotos';
import { extractRecipeFromRecipePhotos } from '../../lib/recipeImportFromRecipePhotos';
import { createRecipe } from '../../lib/recipesRepo';
import type { TranslationKey } from '../../lib/i18n';
import type { RecipeSavePayload } from '../../lib/types';

type UrlPhase = 'idle' | 'loading' | 'preview' | 'error';

/** Directe link (http(s) of www…) vs. vrije zoekterm voor web search + import. */
function classifyUrlImportInput(
  raw: string
): { kind: 'direct'; url: string } | { kind: 'search'; query: string } {
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

async function downscaleForVision(
  asset: ImagePicker.ImagePickerAsset,
  t: (key: TranslationKey) => string
): Promise<{
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
    throw new Error(t('recipes.import.imageReadFailed'));
  }
  return { base64: b64, mediaType: mimeToAiMediaType(asset.mimeType) };
}

export default function ImportRecipeScreen() {
  const theme = useAppTheme();
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ saved?: string | string[] }>();
  const [tab, setTab] = useState<'url' | 'foto' | 'receptfotos'>('url');

  const chipOnStyle = useMemo(
    () => ({ backgroundColor: theme.accentSoft, borderColor: theme.accent }),
    [theme.accentSoft, theme.accent]
  );
  const chipTextOnStyle = useMemo(() => ({ color: theme.accentSoftText }), [theme.accentSoftText]);

  const [url, setUrl] = useState('');
  const [urlPhase, setUrlPhase] = useState<UrlPhase>('idle');
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  const [rawDebug, setRawDebug] = useState<string | null>(null);
  const [urlImportHtmlTruncated, setUrlImportHtmlTruncated] = useState(false);
  const [payload, setPayload] = useState<RecipeSavePayload | null>(null);

  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoRows, setPhotoRows] = useState<PhotoImportRow[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoAhSearch, setPhotoAhSearch] = useState(true);

  type LocalRecipePhoto = { uri: string; base64: string; mediaType: AiImageMediaType };
  const [recipePhoto1, setRecipePhoto1] = useState<LocalRecipePhoto | null>(null);
  const [recipePhoto2, setRecipePhoto2] = useState<LocalRecipePhoto | null>(null);
  const [recipeExtraPhotos, setRecipeExtraPhotos] = useState<LocalRecipePhoto[]>([]);
  const [recipeHint, setRecipeHint] = useState('');

  type RecipePhotoJobStatus = 'queued' | 'ocr' | 'extract' | 'ready' | 'error' | 'saved';
  type RecipePhotoJob = {
    id: string;
    createdAt: number;
    hintText: string;
    photos: RecipePhotoInput[];
    status: RecipePhotoJobStatus;
    statusText?: string;
    payload?: RecipeSavePayload;
    message?: string;
    rawDebug?: string;
  };
  const [recipeJobs, setRecipeJobs] = useState<RecipePhotoJob[]>([]);
  const recipeJobRunningRef = useRef(0);
  const recipeJobConcurrency = 2;

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

  const onTogglePhotoAhSearch = useCallback(
    (v: boolean) => {
      void (async () => {
        try {
          await setImportAhSiteSearchEnabled(v);
          setPhotoAhSearch(v);
        } catch (e) {
          Alert.alert(
            t('recipes.common.error'),
            e instanceof Error ? e.message : t('recipes.common.saveFailed')
          );
        }
      })();
    },
    [t]
  );

  usePreventRemove(importBusy, () => {
    Alert.alert(t('recipes.import.wait.title'), t('recipes.import.wait.body'));
  });

  const recipeJobsRunning =
    !importBusy &&
    tab === 'receptfotos' &&
    recipeJobs.some((j) => j.status === 'ocr' || j.status === 'extract');
  usePreventRemove(recipeJobsRunning, ({ repeat }) => {
    Alert.alert(t('recipes.import.stopImport.title'), t('recipes.import.stopImport.body'), [
      { text: t('recipes.import.stopImport.stay'), style: 'cancel' },
      {
        text: t('recipes.import.stopImport.closeAnyway'),
        style: 'destructive',
        onPress: () => repeat(),
      },
    ]);
  });

  const runExtractUrl = useCallback(async () => {
    const okKey = await hasActiveAiKey();
    if (!okKey) {
      setUrlMessage(t('recipes.import.noApiKey'));
      setUrlPhase('error');
      setRawDebug(null);
      return;
    }

    const u = url.trim();
    if (!u) {
      setUrlMessage(t('recipes.import.urlRequired'));
      setUrlPhase('error');
      setRawDebug(null);
      return;
    }

    setUrlPhase('loading');
    setUrlMessage(null);
    setRawDebug(null);
    setUrlImportHtmlTruncated(false);
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
          setUrlMessage(t('recipes.import.noUrlFound'));
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
        setUrlImportHtmlTruncated(false);
        setUrlPhase('error');
        return;
      }
      setPayload(result.payload);
      setUrlImportHtmlTruncated(result.sourceHtmlTruncated ?? false);
      setUrlPhase('preview');
    } catch (e) {
      setUrlMessage(e instanceof Error ? e.message : t('recipes.import.somethingWrong'));
      setRawDebug(null);
      setUrlPhase('error');
    }
  }, [url, t]);

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

  async function downscaleForVisionWithUri(asset: ImagePicker.ImagePickerAsset): Promise<{
    base64: string;
    mediaType: AiImageMediaType;
    uri: string;
  }> {
    if (asset.uri) {
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1100 } }],
          { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        if (manipulated.base64) {
          return { base64: manipulated.base64, mediaType: 'image/jpeg', uri: manipulated.uri };
        }
      } catch {
        // Fall back to picker base64.
      }
    }
    const b64 = asset.base64;
    if (!b64) {
      throw new Error(t('recipes.import.imageReadFailed'));
    }
    return { base64: b64, mediaType: mimeToAiMediaType(asset.mimeType), uri: asset.uri };
  }

  const clearRecipePhotoDraft = useCallback(() => {
    setRecipePhoto1(null);
    setRecipePhoto2(null);
    setRecipeExtraPhotos([]);
    setRecipeHint('');
  }, []);

  const [pickDialogOpen, setPickDialogOpen] = useState(false);
  const [pickDialogTitle, setPickDialogTitle] = useState('');
  const pickDialogOnPickRef = useRef<((source: 'camera' | 'library') => void) | null>(null);
  const pickDialogAnim = useAnimatedValue(0);

  const closePickDialog = useCallback(() => {
    setPickDialogOpen(false);
  }, []);

  const openPickDialog = useCallback(
    (title: string, onPick: (source: 'camera' | 'library') => void) => {
      pickDialogOnPickRef.current = onPick;
      setPickDialogTitle(title);
      setPickDialogOpen(true);
    },
    []
  );

  const confirmPickDialog = useCallback(
    (source: 'camera' | 'library') => {
      const cb = pickDialogOnPickRef.current;
      closePickDialog();
      if (cb) cb(source);
    },
    [closePickDialog]
  );

  useEffect(() => {
    if (pickDialogOpen) {
      Animated.spring(pickDialogAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
        mass: 0.9,
      }).start();
    } else {
      Animated.timing(pickDialogAnim, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
    }
  }, [pickDialogAnim, pickDialogOpen]);

  const pickOneRecipePhoto = useCallback(
    async (source: 'camera' | 'library') => {
      if (Platform.OS === 'web') {
        throw new Error(t('recipes.import.recipePhotosPlatform'));
      }

      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) throw new Error(t('recipes.import.cameraPermission'));
        const res = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.9,
          base64: true,
          allowsEditing: true,
        });
        if (res.canceled || !res.assets?.[0]) return null;
        return res.assets[0];
      }

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error(t('recipes.import.photoLibraryPermission'));
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        base64: true,
        allowsEditing: true,
      });
      if (res.canceled || !res.assets?.[0]) return null;
      return res.assets[0];
    },
    [t]
  );

  const ensureAiKeyOrAlert = useCallback(async (): Promise<boolean> => {
    const okKey = await hasActiveAiKey();
    if (!okKey) {
      Alert.alert(t('recipes.import.aiNotConfigured'), t('recipes.import.noApiKey'));
      return false;
    }
    return true;
  }, [t]);

  const ensureOnlineOrAlert = useCallback(async (): Promise<boolean> => {
    const online = await checkHasInternet();
    if (!online) {
      Alert.alert(t('recipes.import.offline.title'), t('recipes.import.offline.body'));
      return false;
    }
    return true;
  }, [t]);

  const setSlotPhoto = useCallback(
    async (slot: 1 | 2, source: 'camera' | 'library') => {
      const ok = await ensureAiKeyOrAlert();
      if (!ok) return;
      try {
        const asset = await pickOneRecipePhoto(source);
        if (!asset) return;
        const scaled = await downscaleForVisionWithUri(asset);
        const photo: LocalRecipePhoto = {
          uri: scaled.uri,
          base64: scaled.base64,
          mediaType: scaled.mediaType,
        };
        if (slot === 1) setRecipePhoto1(photo);
        else setRecipePhoto2(photo);
      } catch (e) {
        Alert.alert(
          t('recipes.common.error'),
          e instanceof Error ? e.message : t('recipes.import.addPhotoFailed')
        );
      }
    },
    [ensureAiKeyOrAlert, pickOneRecipePhoto, t]
  );

  const addExtraRecipePhoto = useCallback(
    async (source: 'camera' | 'library') => {
      const ok = await ensureAiKeyOrAlert();
      if (!ok) return;
      try {
        const asset = await pickOneRecipePhoto(source);
        if (!asset) return;
        const scaled = await downscaleForVisionWithUri(asset);
        const photo: LocalRecipePhoto = {
          uri: scaled.uri,
          base64: scaled.base64,
          mediaType: scaled.mediaType,
        };
        setRecipeExtraPhotos((prev) => [...prev, photo]);
      } catch (e) {
        Alert.alert(
          t('recipes.common.error'),
          e instanceof Error ? e.message : t('recipes.import.addPhotoFailed')
        );
      }
    },
    [ensureAiKeyOrAlert, pickOneRecipePhoto, t]
  );

  const enqueueRecipePhotoJob = useCallback(async () => {
    const okKey = await ensureAiKeyOrAlert();
    if (!okKey) return;
    const okOnline = await ensureOnlineOrAlert();
    if (!okOnline) return;

    const photos: RecipePhotoInput[] = [];
    if (recipePhoto1)
      photos.push({ base64: recipePhoto1.base64, mediaType: recipePhoto1.mediaType });
    if (recipePhoto2)
      photos.push({ base64: recipePhoto2.base64, mediaType: recipePhoto2.mediaType });
    for (const p of recipeExtraPhotos) photos.push({ base64: p.base64, mediaType: p.mediaType });

    if (photos.length === 0) {
      Alert.alert(t('recipes.import.noPhotos.title'), t('recipes.import.noPhotos.body'));
      return;
    }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const hintText = recipeHint.trim();
    setRecipeJobs((prev) => [
      {
        id,
        createdAt: Date.now(),
        hintText,
        photos,
        status: 'queued',
        statusText: t('recipes.import.job.queued'),
      },
      ...prev,
    ]);
    clearRecipePhotoDraft();
  }, [
    clearRecipePhotoDraft,
    ensureAiKeyOrAlert,
    ensureOnlineOrAlert,
    recipeExtraPhotos,
    recipeHint,
    recipePhoto1,
    recipePhoto2,
    t,
  ]);

  const runRecipePhotoJob = useCallback(
    async (job: RecipePhotoJob) => {
      recipeJobRunningRef.current += 1;
      try {
        const online = await checkHasInternet();
        if (!online) {
          setRecipeJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    status: 'error',
                    statusText: t('recipes.import.offline.title'),
                    message: t('recipes.import.offline.body'),
                  }
                : j
            )
          );
          return;
        }
        setRecipeJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: 'ocr', statusText: t('recipes.import.job.readingText') }
              : j
          )
        );
        const res = await extractRecipeFromRecipePhotos({
          photos: job.photos,
          hintText: job.hintText,
          onProgress: (p) => {
            if (p.phase === 'ocr') {
              setRecipeJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? {
                        ...j,
                        status: 'ocr',
                        statusText: t('recipes.import.job.readingTextProgress', {
                          current: p.photoIndex + 1,
                          total: p.totalPhotos,
                        }),
                      }
                    : j
                )
              );
            } else {
              setRecipeJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? { ...j, status: 'extract', statusText: t('recipes.import.job.building') }
                    : j
                )
              );
            }
          },
        });
        if (!res.ok) {
          setRecipeJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    status: 'error',
                    statusText: t('recipes.import.failed'),
                    message: res.message,
                    rawDebug: res.rawModelText,
                  }
                : j
            )
          );
          return;
        }
        setRecipeJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: 'ready',
                  statusText: t('recipes.common.done'),
                  payload: res.payload,
                  message: undefined,
                  rawDebug: undefined,
                }
              : j
          )
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : t('recipes.import.job.analysisFailed');
        setRecipeJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: 'error',
                  statusText: t('recipes.import.failed'),
                  message: msg,
                }
              : j
          )
        );
      } finally {
        recipeJobRunningRef.current = Math.max(0, recipeJobRunningRef.current - 1);
        setRecipeJobs((prev) => prev.map((j) => j));
      }
    },
    [t]
  );

  useEffect(() => {
    if (recipeJobRunningRef.current >= recipeJobConcurrency) return;
    const next = recipeJobs.find((j) => j.status === 'queued');
    if (!next) return;
    void runRecipePhotoJob(next);
  }, [recipeJobs, runRecipePhotoJob]);

  const previewRecipeJob = useCallback(
    (p: RecipeSavePayload) => {
      const sid = registerImportSession(p);
      router.push({ pathname: '/recipe/preview', params: { importSid: sid } });
    },
    [router]
  );

  const saveRecipeJob = useCallback(
    async (jobId: string) => {
      const job = recipeJobs.find((j) => j.id === jobId);
      if (!job?.payload) return;
      try {
        await createRecipe(job.payload);
        setRecipeJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? { ...j, status: 'saved', statusText: t('recipes.import.job.saved') }
              : j
          )
        );
      } catch (e) {
        Alert.alert(
          t('recipes.common.error'),
          e instanceof Error ? e.message : t('recipes.common.saveFailed')
        );
      }
    },
    [recipeJobs, t]
  );

  const saveAllReadyRecipeJobs = useCallback(async () => {
    const ids = recipeJobs.filter((j) => j.status === 'ready' && j.payload).map((j) => j.id);
    if (ids.length === 0) {
      Alert.alert(
        t('recipes.import.nothingToSaveTitle'),
        t('recipes.import.nothingToSaveNoAnalyses')
      );
      return;
    }
    Alert.alert(
      t('recipes.import.saveAll.title'),
      ids.length === 1
        ? t('recipes.import.saveAll.confirmSingle', { count: ids.length })
        : t('recipes.import.saveAll.confirmPlural', { count: ids.length }),
      [
        { text: t('recipes.common.cancel'), style: 'cancel' },
        {
          text: t('recipes.common.save'),
          onPress: () => {
            void (async () => {
              try {
                for (const id of ids) {
                  await saveRecipeJob(id);
                }
              } catch (e) {
                Alert.alert(
                  t('recipes.common.error'),
                  e instanceof Error ? e.message : t('recipes.common.saveFailed')
                );
              }
            })();
          },
        },
      ]
    );
  }, [recipeJobs, saveRecipeJob, t]);

  const pickPhotoAndImport = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert(t('recipes.import.photoOnWeb.title'), t('recipes.import.photoOnWeb.body'));
      return;
    }

    const okKey = await hasActiveAiKey();
    if (!okKey) {
      setPhotoError(t('recipes.import.noApiKey'));
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhotoError(t('recipes.import.screenshotLibraryPermission'));
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
      const { base64, mediaType } = await downscaleForVision(asset, t);
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
        message: r.url ? undefined : t('recipes.import.noRecipeUrl'),
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
                      message: result.ok ? t('recipes.import.importFailed') : result.message,
                    }
                : p
            )
          );
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, indices.length) }, () => worker())
      );
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : t('recipes.import.somethingWrong'));
    } finally {
      setPhotoBusy(false);
    }
  }, [t]);

  const saveAllOk = useCallback(async () => {
    const okPayloads = photoRows
      .filter((r) => r.status === 'ok' && r.payload)
      .map((r) => r.payload!);
    if (okPayloads.length === 0) {
      Alert.alert(
        t('recipes.import.nothingToSaveTitle'),
        t('recipes.import.nothingToSaveNoImports')
      );
      return;
    }

    Alert.alert(
      t('recipes.import.saveRecipes.title'),
      okPayloads.length === 1
        ? t('recipes.import.saveRecipes.confirmSingle', { count: okPayloads.length })
        : t('recipes.import.saveRecipes.confirmPlural', { count: okPayloads.length }),
      [
        { text: t('recipes.common.cancel'), style: 'cancel' },
        {
          text: t('recipes.common.save'),
          onPress: () => {
            void (async () => {
              try {
                let n = 0;
                for (const p of okPayloads) {
                  await createRecipe(p);
                  n++;
                }
                setPhotoRows([]);
                Alert.alert(
                  t('recipes.common.done'),
                  n === 1
                    ? t('recipes.import.saveRecipes.doneSingle', { count: n })
                    : t('recipes.import.saveRecipes.donePlural', { count: n })
                );
                router.replace('/(tabs)/recipes');
              } catch (e) {
                Alert.alert(
                  t('recipes.common.error'),
                  e instanceof Error ? e.message : t('recipes.common.saveFailed')
                );
              }
            })();
          },
        },
      ]
    );
  }, [photoRows, router, t]);

  const ingCount = payload?.ingredientGroups.reduce((n, g) => n + g.ingredients.length, 0) ?? 0;
  const stepCount = payload?.stepSections.reduce((n, s) => n + s.steps.length, 0) ?? 0;

  const okPhotoCount = photoRows.filter((r) => r.status === 'ok').length;

  return (
    <>
      <Modal
        visible={pickDialogOpen}
        transparent
        animationType="none"
        onRequestClose={closePickDialog}
      >
        <View style={styles.pickModalRoot}>
          <Pressable style={styles.pickBackdrop} onPress={closePickDialog} />
          <Animated.View
            style={[
              styles.pickSheet,
              {
                borderColor: theme.accentBorderMuted,
                transform: [
                  {
                    translateY: pickDialogAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [28, 0],
                    }),
                  },
                  {
                    scale: pickDialogAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.98, 1],
                    }),
                  },
                ],
                opacity: pickDialogAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1],
                }),
              },
            ]}
          >
            <Text style={styles.pickTitle}>{pickDialogTitle || t('recipes.import.addPhoto')}</Text>
            <Text style={styles.pickSubtitle}>{t('recipes.import.pickDialog.subtitle')}</Text>

            <Pressable
              style={[
                styles.pickAction,
                { backgroundColor: theme.accentSoft, borderColor: theme.accentBorderMuted },
              ]}
              onPress={() => confirmPickDialog('camera')}
            >
              <Text style={[styles.pickActionText, { color: theme.accentSoftText }]}>
                {t('recipes.import.pickDialog.takePhoto')}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.pickAction,
                { backgroundColor: '#fff', borderColor: theme.accentBorderMuted },
              ]}
              onPress={() => confirmPickDialog('library')}
            >
              <Text style={[styles.pickActionText, { color: '#1a1a1a' }]}>
                {t('recipes.import.pickDialog.fromLibrary')}
              </Text>
            </Pressable>

            <Pressable style={styles.pickCancelBtn} onPress={closePickDialog}>
              <Text style={[styles.pickCancelText, { color: theme.accent }]}>
                {t('recipes.common.cancel')}
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      <RecipeWebViewLoader />
      <ScrollView
        style={[styles.scroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="always"
      >
        <Text style={styles.lead}>{t('recipes.import.lead')}</Text>

        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabChip, tab === 'url' && chipOnStyle]}
            onPress={() => setTab('url')}
          >
            <Text style={[styles.tabChipText, tab === 'url' && chipTextOnStyle]}>
              {t('recipes.import.tab.url')}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabChip, tab === 'foto' && chipOnStyle]}
            onPress={() => setTab('foto')}
          >
            <Text style={[styles.tabChipText, tab === 'foto' && chipTextOnStyle]}>
              {t('recipes.import.tab.photo')}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabChip, tab === 'receptfotos' && chipOnStyle]}
            onPress={() => setTab('receptfotos')}
          >
            <Text style={[styles.tabChipText, tab === 'receptfotos' && chipTextOnStyle]}>
              {t('recipes.import.tab.recipePhotos')}
            </Text>
          </Pressable>
        </View>

        {tab === 'url' ? (
          <>
            <Text style={styles.label}>{t('recipes.import.url.label')}</Text>
            <Text style={styles.hintBlock}>{t('recipes.import.url.hint')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('recipes.import.url.placeholder')}
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
                  <Text style={[styles.primaryBtnText, { marginLeft: 10 }]}>
                    {t('recipes.import.busy')}
                  </Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>{t('recipes.import.url.action')}</Text>
              )}
            </Pressable>

            {urlPhase === 'preview' && payload ? (
              <View style={styles.card}>
                <Text style={styles.previewTitle}>{t('recipes.import.preview.title')}</Text>
                <Text style={styles.previewHead}>{payload.title}</Text>
                {payload.description ? (
                  <Text style={styles.previewDesc} numberOfLines={4}>
                    {payload.description}
                  </Text>
                ) : null}
                <Text style={styles.previewMeta}>
                  {t('recipes.import.preview.meta', { ingredients: ingCount, steps: stepCount })}
                  {payload.baseServings
                    ? ` · ${t('recipes.import.preview.portions', { count: payload.baseServings })}`
                    : ''}
                </Text>
                {urlImportHtmlTruncated ? (
                  <Text style={styles.hintBlock}>{t('recipes.import.preview.truncatedHint')}</Text>
                ) : null}
                {payload.tagNames.length > 0 ? (
                  <Text style={styles.tags}>
                    {t('recipes.import.preview.tags', { tags: payload.tagNames.join(', ') })}
                  </Text>
                ) : null}
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    { backgroundColor: theme.accentSoft, borderColor: theme.accent },
                  ]}
                  onPress={goToEditor}
                >
                  <Text style={[styles.secondaryBtnText, { color: theme.accentSoftText }]}>
                    {t('recipes.import.check')}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.ghostBtn}
                  onPress={() => {
                    setUrlPhase('idle');
                    setPayload(null);
                    setUrlMessage(null);
                    setRawDebug(null);
                    setUrlImportHtmlTruncated(false);
                  }}
                >
                  <Text style={styles.ghostBtnText}>{t('recipes.import.retry')}</Text>
                </Pressable>
              </View>
            ) : null}

            {urlPhase === 'error' && urlMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>{t('recipes.import.failed')}</Text>
                <Text style={styles.errorBody}>{urlMessage}</Text>
                {url.trim() ? (
                  <Pressable
                    style={[
                      styles.secondaryBtn,
                      {
                        marginTop: 12,
                        backgroundColor: theme.accentSoft,
                        borderColor: theme.accent,
                      },
                    ]}
                    onPress={() =>
                      goToEditorFromPayload(
                        buildManualFallbackImportPayload(
                          t('recipes.import.manualFallbackTitle'),
                          lastUrlImportFetchRef.current ??
                            (url.trim().toLowerCase().startsWith('http') ? url.trim() : ''),
                          urlMessage
                        )
                      )
                    }
                  >
                    <Text style={[styles.secondaryBtnText, { color: theme.accentSoftText }]}>
                      {t('recipes.import.fillManually')}
                    </Text>
                  </Pressable>
                ) : null}
                {__DEV__ && rawDebug ? (
                  <>
                    <Text style={styles.rawLabel}>{t('recipes.import.rawOutputLabel')}</Text>
                    <Text selectable style={styles.raw}>
                      {rawDebug}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </>
        ) : tab === 'foto' ? (
          <>
            <Text style={styles.label}>{t('recipes.import.photo.label')}</Text>
            <Text style={styles.hintBlock}>{t('recipes.import.photo.hint')}</Text>

            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={styles.switchLabel}>{t('recipes.import.photo.ahSearchLabel')}</Text>
                <Text style={styles.hintBlock}>{t('recipes.import.photo.ahSearchHint')}</Text>
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
              style={[
                styles.primaryBtn,
                { backgroundColor: theme.accent },
                photoBusy && styles.btnDisabled,
              ]}
              onPress={() => void pickPhotoAndImport()}
              disabled={photoBusy}
            >
              {photoBusy ? (
                <View style={styles.row}>
                  <ActivityIndicator color="#fff" />
                  <Text style={[styles.primaryBtnText, { marginLeft: 10 }]}>
                    {t('recipes.import.busy')}
                  </Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>{t('recipes.import.photo.pickAction')}</Text>
              )}
            </Pressable>

            {photoError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>{t('recipes.import.failed')}</Text>
                <Text style={styles.errorBody}>{photoError}</Text>
              </View>
            ) : null}

            {photoRows.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.previewTitle}>{t('recipes.import.photo.results')}</Text>
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
                      {row.status === 'pending' && t('recipes.import.job.queued')}
                      {row.status === 'loading' && t('recipes.import.photo.fetchingPage')}
                      {row.status === 'ok' && t('recipes.import.photo.success')}
                      {row.status === 'error' && (row.message ?? t('recipes.import.failed'))}
                    </Text>
                    {row.status === 'ok' && row.payload ? (
                      <Pressable
                        style={styles.smallLinkBtn}
                        onPress={() => goToEditorFromPayload(row.payload!)}
                      >
                        <Text style={styles.smallLinkBtnText}>{t('recipes.import.check')}</Text>
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
                        <Text style={styles.smallLinkBtnText}>
                          {t('recipes.import.fillManually')}
                        </Text>
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
                      {okPhotoCount === 1
                        ? t('recipes.import.saveAllBtnSingle', { count: okPhotoCount })
                        : t('recipes.import.saveAllBtnPlural', { count: okPhotoCount })}
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
                  <Text style={styles.ghostBtnText}>{t('recipes.import.clear')}</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.label}>{t('recipes.import.recipePhotos.label')}</Text>
            <Text style={styles.hintBlock}>{t('recipes.import.recipePhotos.hint')}</Text>

            <View style={styles.photoSlotsRow}>
              <Pressable
                style={styles.photoSlot}
                onPress={() =>
                  openPickDialog(
                    t('recipes.import.slot.photo1'),
                    (src) => void setSlotPhoto(1, src)
                  )
                }
              >
                {recipePhoto1 ? (
                  <Image source={{ uri: recipePhoto1.uri }} style={styles.photoSlotImg} />
                ) : (
                  <Text style={styles.photoSlotText}>{t('recipes.import.slot.photo1')}</Text>
                )}
              </Pressable>
              <Pressable
                style={styles.photoSlot}
                onPress={() =>
                  openPickDialog(
                    t('recipes.import.slot.photo2'),
                    (src) => void setSlotPhoto(2, src)
                  )
                }
              >
                {recipePhoto2 ? (
                  <Image source={{ uri: recipePhoto2.uri }} style={styles.photoSlotImg} />
                ) : (
                  <Text style={styles.photoSlotText}>{t('recipes.import.slot.photo2')}</Text>
                )}
              </Pressable>
              <Pressable
                style={[
                  styles.addPhotoBtn,
                  { backgroundColor: theme.accentSoft, borderColor: theme.accent },
                ]}
                onPress={() =>
                  openPickDialog(
                    t('recipes.import.addPhoto'),
                    (src) => void addExtraRecipePhoto(src)
                  )
                }
              >
                <Text style={[styles.addPhotoBtnText, { color: theme.accentSoftText }]}>
                  {t('recipes.import.addPhoto')}
                </Text>
              </Pressable>
            </View>

            {recipePhoto1 || recipePhoto2 || recipeExtraPhotos.length > 0 ? (
              <View style={styles.extraStrip}>
                {recipePhoto1 ? (
                  <View style={styles.thumbWrap}>
                    <Pressable
                      onPress={() =>
                        openPickDialog(
                          t('recipes.import.editPhoto1'),
                          (src) => void setSlotPhoto(1, src)
                        )
                      }
                      style={styles.thumbPress}
                    >
                      <Image source={{ uri: recipePhoto1.uri }} style={styles.thumb} />
                    </Pressable>
                    <Pressable style={styles.thumbRemove} onPress={() => setRecipePhoto1(null)}>
                      <Text style={styles.thumbRemoveText}>×</Text>
                    </Pressable>
                  </View>
                ) : null}
                {recipePhoto2 ? (
                  <View style={styles.thumbWrap}>
                    <Pressable
                      onPress={() =>
                        openPickDialog(
                          t('recipes.import.editPhoto2'),
                          (src) => void setSlotPhoto(2, src)
                        )
                      }
                      style={styles.thumbPress}
                    >
                      <Image source={{ uri: recipePhoto2.uri }} style={styles.thumb} />
                    </Pressable>
                    <Pressable style={styles.thumbRemove} onPress={() => setRecipePhoto2(null)}>
                      <Text style={styles.thumbRemoveText}>×</Text>
                    </Pressable>
                  </View>
                ) : null}
                {recipeExtraPhotos.map((p, idx) => (
                  <View key={`${p.uri}-${idx}`} style={styles.thumbWrap}>
                    <Image source={{ uri: p.uri }} style={styles.thumb} />
                    <Pressable
                      style={styles.thumbRemove}
                      onPress={() =>
                        setRecipeExtraPhotos((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <Text style={styles.thumbRemoveText}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.label}>{t('recipes.import.recipePhotos.hintLabel')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('recipes.import.recipePhotos.hintPlaceholder')}
              placeholderTextColor="#999"
              value={recipeHint}
              onChangeText={setRecipeHint}
            />

            <Pressable
              style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
              onPress={() => void enqueueRecipePhotoJob()}
            >
              <Text style={styles.primaryBtnText}>{t('recipes.import.recipePhotos.analyze')}</Text>
            </Pressable>

            {recipeJobs.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.previewTitle}>{t('recipes.import.queue')}</Text>

                {recipeJobs.map((j) => (
                  <View key={j.id} style={styles.jobRow}>
                    <Text style={styles.photoRowTitle} numberOfLines={2}>
                      {j.payload?.title?.trim()
                        ? j.payload.title
                        : t('recipes.import.tab.recipePhotos')}
                    </Text>
                    <Text style={styles.photoRowStatus}>
                      {j.status === 'queued' && (j.statusText ?? t('recipes.import.job.queued'))}
                      {j.status === 'ocr' && (j.statusText ?? t('recipes.import.job.readingText'))}
                      {j.status === 'extract' && (j.statusText ?? t('recipes.import.job.building'))}
                      {j.status === 'ready' && t('recipes.common.done')}
                      {j.status === 'saved' && t('recipes.import.job.saved')}
                      {j.status === 'error' && (j.message ?? t('recipes.import.failed'))}
                    </Text>

                    {j.status === 'error' ? (
                      <View style={styles.jobBtnRow}>
                        <Pressable
                          style={styles.smallLinkBtn}
                          onPress={() => {
                            setRecipeJobs((prev) =>
                              prev.map((x) =>
                                x.id === j.id
                                  ? {
                                      ...x,
                                      status: 'queued',
                                      statusText: t('recipes.import.job.queued'),
                                      message: undefined,
                                    }
                                  : x
                              )
                            );
                          }}
                        >
                          <Text style={styles.smallLinkBtnText}>{t('recipes.import.retry')}</Text>
                        </Pressable>
                        {__DEV__ && j.rawDebug ? (
                          <Pressable
                            style={styles.smallLinkBtn}
                            onPress={() => Alert.alert(t('recipes.import.debug'), j.rawDebug ?? '')}
                          >
                            <Text style={styles.smallLinkBtnText}>{t('recipes.import.debug')}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}

                    {j.status === 'ready' && j.payload ? (
                      <View style={styles.jobBtnRow}>
                        <Pressable
                          style={styles.smallLinkBtn}
                          onPress={() => previewRecipeJob(j.payload!)}
                        >
                          <Text style={styles.smallLinkBtnText}>
                            {t('recipes.import.previewBtn')}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.smallLinkBtn}
                          onPress={() => void saveRecipeJob(j.id)}
                        >
                          <Text style={styles.smallLinkBtnText}>{t('recipes.common.save')}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))}

                {recipeJobs.some((j) => j.status === 'ready' && j.payload) ? (
                  <Pressable
                    style={[
                      styles.secondaryBtn,
                      { backgroundColor: theme.accentSoft, borderColor: theme.accent },
                    ]}
                    onPress={() => void saveAllReadyRecipeJobs()}
                  >
                    <Text style={[styles.secondaryBtnText, { color: theme.accentSoftText }]}>
                      {t('recipes.import.saveAll.title')}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={styles.ghostBtn}
                  onPress={() => {
                    setRecipeJobs([]);
                    clearRecipePhotoDraft();
                  }}
                >
                  <Text style={styles.ghostBtnText}>{t('recipes.import.clear')}</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        )}

        <Pressable onPress={() => router.push('/settings')} style={styles.linkWrap}>
          <Text style={styles.link}>{t('recipes.import.settingsLink')}</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  lead: { fontSize: 14, color: '#555', lineHeight: 21, marginBottom: 16 },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
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
  previewTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
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
  photoSlotsRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch', marginBottom: 12 },
  photoSlot: {
    flex: 1,
    minWidth: 0,
    height: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2ddd5',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoSlotText: { fontSize: 14, fontWeight: '700', color: '#666' },
  photoSlotImg: { width: '100%', height: '100%' },
  addPhotoBtn: {
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoBtnText: { fontSize: 14, fontWeight: '800' },
  extraStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  thumbWrap: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden' },
  thumbPress: { width: '100%', height: '100%' },
  thumb: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontWeight: '900', fontSize: 14, lineHeight: 18 },
  jobRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    marginBottom: 4,
  },
  jobBtnRow: { marginTop: 8, flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
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
  pickModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  pickBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pickSheet: {
    padding: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
  },
  pickTitle: { fontSize: 16, fontWeight: '800', color: '#1a1a1a' },
  pickSubtitle: { fontSize: 13, color: '#666', marginTop: 6, marginBottom: 14, lineHeight: 18 },
  pickAction: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  pickActionText: { fontSize: 16, fontWeight: '800' },
  pickCancelBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 2,
  },
  pickCancelText: { fontSize: 15, fontWeight: '700' },
});

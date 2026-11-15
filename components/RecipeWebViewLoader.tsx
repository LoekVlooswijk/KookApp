import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { useI18n } from './I18nContext';
import {
  buildRecipeHtmlFromWebViewData,
  isBlockedPageData,
  registerWebViewWorker,
  reportWebViewWorkerIdle,
  type WebViewJob,
  type WebViewPageData,
} from '../lib/recipePageWebViewBridge';

const PAGE_LOAD_TIMEOUT_MS = 30_000;

/**
 * Verborgen laadwerker: laadt één receptpagina per keer in een echte WebView
 * (echte browser-engine → Akamai/Cloudflare-JS-checks worden doorstaan), leest
 * daarna JSON-LD + zichtbare tekst uit en geeft die terug aan de bridge.
 * Er is geen ref nodig: het uitleesscript reist mee via `injectedJavaScript`,
 * dat de WebView na het laden van de pagina uitvoert.
 */
function HiddenPageWorker() {
  const { t } = useI18n();
  const jobRef = useRef<WebViewJob | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  // Start op een leeg document; elke klus laadt daarna een echte URL en returns
  // naar about:blank, zodat een volgende klus altijd een nieuwe load triggert.
  const [source, setSource] = useState<{ uri: string }>({ uri: 'about:blank' });

  const onJobRef = useRef<(job: WebViewJob) => void>(() => {});

  const finishJob = useCallback(
    (outcome: { ok: true; html: string } | { ok: false; message: string }) => {
      const job = jobRef.current;
      if (!job) return;
      jobRef.current = null;
      setJobId(null);
      setSource({ uri: 'about:blank' });
      if (timeoutRef.current != null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (outcome.ok) job.resolve(outcome.html);
      else job.reject(new Error(outcome.message));
      // Meld deze worker weer beschikbaar; bridge verstuurt de volgende klus.
      reportWebViewWorkerIdle(onJobRef.current);
    },
    []
  );

  const onJob = useCallback(
    (job: WebViewJob) => {
      if (jobRef.current) return;
      jobRef.current = job;
      setJobId(job.id);
      setSource({ uri: job.url });
      timeoutRef.current = setTimeout(() => {
        finishJob({
          ok: false,
          message: t('recipes.webview.loadTimeout'),
        });
      }, PAGE_LOAD_TIMEOUT_MS);
    },
    [finishJob, t]
  );

  useEffect(() => {
    onJobRef.current = onJob;
  }, [onJob]);

  useEffect(() => {
    const unregister = registerWebViewWorker(onJob);
    return () => {
      unregister();
      if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
    };
  }, [onJob]);

  const onError = useCallback(() => {
    if (!jobRef.current) return;
    finishJob({
      ok: false,
      message: t('recipes.webview.loadFailed'),
    });
  }, [finishJob, t]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const job = jobRef.current;
      if (!job) return;
      let payload: {
        kind?: string;
        jobId?: number;
        message?: string;
        title?: string;
        metaDescription?: string;
        jsonLd?: unknown;
        visibleText?: string;
      };
      try {
        payload = JSON.parse(event.nativeEvent.data);
      } catch {
        // Ongeldig bericht negeren; de timeout vangt het af als er niets komt.
        return;
      }
      if (payload.jobId !== job.id) return;

      if (payload.kind === 'recipe-webview-error') {
        finishJob({
          ok: false,
          message: t('recipes.webview.extractFailed', {
            message: payload.message ?? t('recipes.webview.unknownError'),
          }),
        });
        return;
      }
      if (payload.kind !== 'recipe-webview-page') return;

      const jsonLd = Array.isArray(payload.jsonLd)
        ? payload.jsonLd
            .filter((c): c is string => typeof c === 'string')
            .map((c) => c.trim())
            .filter(Boolean)
        : [];
      const data: WebViewPageData = {
        title: payload.title ?? '',
        metaDescription: payload.metaDescription ?? '',
        jsonLd,
        visibleText: payload.visibleText ?? '',
      };

      if (isBlockedPageData(data)) {
        finishJob({
          ok: false,
          message: t('recipes.webview.blocked'),
        });
        return;
      }
      if (data.jsonLd.length === 0 && data.visibleText.trim().length < 400) {
        finishJob({
          ok: false,
          message: t('recipes.webview.noContent'),
        });
        return;
      }

      finishJob({ ok: true, html: buildRecipeHtmlFromWebViewData(data) });
    },
    [finishJob, t]
  );

  // Tussen klussen door (about:blank) geen externe navigaties toestaan.
  const onShouldStartLoadWithRequest = useCallback((req: WebViewNavigation) => {
    if (!jobRef.current) return req.url === 'about:blank';
    return true;
  }, []);

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        // Normale viewport-maat: bot-bescherming (Akamai) detecteert een
        // 1x1-webview aan window.innerWidth/innerHeight en blokkeert de pagina.
        width: 390,
        height: 844,
        opacity: 0,
        overflow: 'hidden',
      }}
    >
      <WebView
        source={source}
        style={{ flex: 1 }}
        injectedJavaScript={jobId != null ? buildExtractScript(jobId) : undefined}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        mediaPlaybackRequiresUserAction={false}
        onError={onError}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      />
    </View>
  );
}

/**
 * Injectiescript dat na het laden van de pagina de JSON-LD-blokken en zichtbare
 * tekst terugpost naar de app. Pollert kort: bot-bescherming (Akamai) lost een
 * challenge-pagina vaak pas na enkele seconden op; bij een herladen start dit
 * script vanzelf opnieuw in het nieuwe document.
 */
function buildExtractScript(jobId: number): string {
  return `(function(){
  function read(){
    var jsonLd = [];
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length && jsonLd.length < 6; i++) {
      var t = (scripts[i] ? scripts[i].textContent : '') || '';
      t = t.trim();
      if (t.length > 0) jsonLd.push(t.slice(0, 60000));
    }
    var title = document.title || '';
    var desc = '';
    var md = document.querySelector('meta[name="description"], meta[property="og:description"]');
    if (md) desc = md.getAttribute('content') || '';
    var root = document.querySelector('main') || document.querySelector('article') || document.body;
    var visible = root ? (root.innerText || '') : '';
    visible = visible.replace(/\\s+/g, ' ').trim().slice(0, 24000);
    return { title: title, metaDescription: desc, jsonLd: jsonLd, visibleText: visible };
  }
  var attempts = 0;
  var maxAttempts = 8; // 8 x 1500ms = 12s, ruim binnen de load-timeout van 30s
  var timer = setInterval(function(){
    attempts++;
    var d;
    try {
      d = read();
    } catch (e) {
      if (attempts >= maxAttempts) {
        clearInterval(timer);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          kind: 'recipe-webview-error',
          jobId: ${JSON.stringify(jobId)},
          message: String((e && e.message) ? e.message : e)
        }));
      }
      return;
    }
    var good = d.jsonLd.length > 0 || d.visibleText.length >= 400;
    // Duidelijke blockpagina (Access Denied) direct melden; een Akamai-challenge
    // die zichzelf oplost herlaadt de pagina en start dit script opnieuw.
    var blocked = /access denied|toegang geweigerd/i.test(d.title);
    if (blocked || good || attempts >= maxAttempts) {
      clearInterval(timer);
      window.ReactNativeWebView.postMessage(JSON.stringify({
        kind: 'recipe-webview-page',
        jobId: ${JSON.stringify(jobId)},
        title: d.title,
        metaDescription: d.metaDescription,
        jsonLd: d.jsonLd,
        visibleText: d.visibleText
      }));
    }
  }, 1500);
})();true;`;
}

/**
 * Mount 2 verborgen WebView-werkers voor het laden van receptpagina's (queue in
 * recipePageWebViewBridge). Alleen op iOS/Android; op web rendert dit component
 * niets en blijft de fetch-fallback in gebruik.
 */
export default function RecipeWebViewLoader() {
  if (Platform.OS === 'web') return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 390,
        height: 844,
        opacity: 0,
        overflow: 'hidden',
      }}
    >
      <HiddenPageWorker key="webview-worker-1" />
      <HiddenPageWorker key="webview-worker-2" />
    </View>
  );
}

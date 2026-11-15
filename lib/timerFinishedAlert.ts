import type { AudioPlayer } from 'expo-audio';
import { Alert, Vibration } from 'react-native';

import { translate } from './i18n';
import { getLanguageId } from './languagePrefs';

type ExpoAudio = typeof import('expo-audio');

let alarmPlayer: AudioPlayer | null = null;
let audioModeConfigured = false;

async function loadExpoAudio(): Promise<ExpoAudio | null> {
  try {
    return await import('expo-audio');
  } catch {
    return null;
  }
}

async function ensureAudioMode(audio: ExpoAudio): Promise<void> {
  if (audioModeConfigured) return;
  await audio.setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: false,
    allowsRecording: false,
    shouldRouteThroughEarpiece: false,
  });
  audioModeConfigured = true;
}

function vibrateFallback(): void {
  try {
    Vibration.vibrate([0, 400, 200, 400, 200, 400]);
  } catch {
    // ignore
  }
}

async function stopAlarmSound(): Promise<void> {
  try {
    if (!alarmPlayer) return;
    alarmPlayer.pause();
    await alarmPlayer.seekTo(0);
  } catch {
    // ignore
  }
}

async function startAlarmSoundLoop(): Promise<void> {
  const audio = await loadExpoAudio();
  if (!audio) {
    vibrateFallback();
    return;
  }

  await ensureAudioMode(audio);

  if (!alarmPlayer) {
    alarmPlayer = audio.createAudioPlayer(require('../assets/sounds/timer-alarm.mp3'));
    alarmPlayer.loop = true;
    alarmPlayer.volume = 1;
  }

  await alarmPlayer.seekTo(0);
  alarmPlayer.play();
}

/**
 * Stops looping timer alarm if it is playing (e.g. screen unmount).
 */
export async function stopTimerAlarmSoundIfPlaying(): Promise<void> {
  await stopAlarmSound();
}

/**
 * Plays a looping alarm, shows the timer alert, and stops the alarm when the user dismisses it.
 * Alert-teksten volgen de gekozen app-taal (`pref_language`).
 */
export function showTimerFinishedAlert(finishedCount: number): void {
  void (async () => {
    const lang = await getLanguageId()
      .catch(() => null)
      .then((id) => id ?? 'nl');
    const message = translate(
      lang,
      finishedCount > 1 ? 'common.timer.finishedMany' : 'common.timer.finishedOne'
    );

    try {
      await startAlarmSoundLoop();
    } catch {
      vibrateFallback();
    }

    const onClose = () => {
      void stopAlarmSound();
    };

    Alert.alert(
      translate(lang, 'common.timer.title'),
      message,
      [{ text: translate(lang, 'common.timer.ok'), onPress: onClose }],
      {
        cancelable: true,
        onDismiss: onClose,
      }
    );
  })();
}

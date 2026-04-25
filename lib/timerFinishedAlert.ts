import type { AudioPlayer } from 'expo-audio';
import { Alert, Vibration } from 'react-native';

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
 */
export function showTimerFinishedAlert(finishedCount: number): void {
  const message =
    finishedCount > 1 ? 'Meerdere timers zijn afgerond.' : 'Timer is afgerond.';

  void (async () => {
    try {
      await startAlarmSoundLoop();
    } catch {
      vibrateFallback();
    }

    const onClose = () => {
      void stopAlarmSound();
    };

    Alert.alert('Timer', message, [{ text: 'OK', onPress: onClose }], {
      cancelable: true,
      onDismiss: onClose,
    });
  })();
}


// src/userplugins/rawMic/index.ts
// Vencord user plugin: force raw mic (disable AEC/NS/AGC) and notify on VC join

import definePlugin from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

let __origGUM: typeof navigator.mediaDevices.getUserMedia | undefined;
let __origApply: typeof MediaStreamTrack.prototype.applyConstraints | undefined;
let __toastOnce = false;

function patch() {
  // EXACT applyConstraints wrapper
  const origApply = MediaStreamTrack.prototype.applyConstraints;
  if (!__origApply) __origApply = origApply;
  MediaStreamTrack.prototype.applyConstraints = function (constraints: any = {}) {
    if (this.kind === "audio" && constraints) {
      const forced = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false,
        suppressLocalAudioPlayback: false
      };
      const merged = { ...constraints, ...forced };
      return origApply.call(this, merged);
    }
    return origApply.call(this, constraints);
  };
  console.log("Wrapped MediaStreamTrack.applyConstraints for audio");

  // EXACT getUserMedia wrapper
  const md = navigator.mediaDevices as any;
  if (!md || !md.getUserMedia) {
    console.warn("No getUserMedia available");
    return;
  }

  if (!__origGUM) __origGUM = md.getUserMedia.bind(md);

  md.getUserMedia = async (constraints: any = { audio: true }) => {
    if (constraints && constraints.audio) {
      const audio = constraints.audio === true ? {} : { ...constraints.audio };
      Object.assign(audio, {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false,
        suppressLocalAudioPlayback: false,
        // Legacy Chromium flags some builds still read
        googEchoCancellation: false,
        googNoiseSuppression: false,
        googAutoGainControl: false
      });
      constraints = { ...constraints, audio };
    }

    const stream = await (__origGUM as any)(constraints);

    // Apply per-track too
    for (const track of stream.getAudioTracks()) {
      try {
        await track.applyConstraints({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          voiceIsolation: false,
          suppressLocalAudioPlayback: false
        });
      } catch (_) {}
      try {
        console.log("Audio track settings:", track.getSettings());
      } catch (_) {}
    }

    // Notify once per short window when capture starts (join VC)
    if (!__toastOnce) {
      try { showToast("Raw mic patch applied (AEC/NS/AGC off)", Toasts.Type.SUCCESS); } catch (_) {}
      __toastOnce = true;
      setTimeout(() => { __toastOnce = false; }, 15000);
    }

    return stream;
  };

  console.log("Patched getUserMedia: echoCancellation/noiseSuppression/autoGainControl/voiceIsolation disabled");
}

function unpatch() {
  if (__origGUM && navigator.mediaDevices?.getUserMedia) {
    (navigator.mediaDevices as any).getUserMedia = __origGUM;
    __origGUM = undefined;
  }
  if (__origApply) {
    MediaStreamTrack.prototype.applyConstraints = __origApply;
    __origApply = undefined;
  }
}

export default definePlugin({
  name: "RawMic",
  description: "Force raw WebRTC mic (disable echoCancellation/noiseSuppression/autoGainControl) and toast on VC join.",
  authors: [{ name: "Vermin", id: 1287307742805229608 }],
  start() { patch(); },
  stop() { unpatch(); }
});

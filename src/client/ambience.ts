/** Zachte tent-sfeer: zeil, koffiemachine, verre crew. Geen muziek. Mute is default. */

type Layer = { stop: () => void };

function noiseBuffer(ctx: AudioContext, seconds = 2) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function connectNoise(
  ctx: AudioContext,
  dest: AudioNode,
  opts: { freq: number; q: number; gain: number; type?: BiquadFilterType }
) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 3);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type || "bandpass";
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q;
  const gain = ctx.createGain();
  gain.gain.value = opts.gain;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start();
  return { src, gain, filter };
}

export function createAmbience() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let layers: Layer[] = [];
  let timers: number[] = [];
  let muted = true;

  function ensure() {
    if (ctx) return ctx;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  }

  function burst(kind: "coffee" | "crew") {
    if (!ctx || !master || muted) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 1.2);
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    if (kind === "coffee") {
      filter.type = "highpass";
      filter.frequency.value = 1800;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    } else {
      filter.type = "bandpass";
      filter.frequency.value = 420;
      filter.Q.value = 0.9;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.02, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
    }
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(now);
    src.stop(now + 2.6);
  }

  function startLayers() {
    if (!ctx || !master) return;
    stopLayers();
    const canvas = connectNoise(ctx, master, { freq: 240, q: 0.55, gain: 0.028, type: "bandpass" });
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain);
    lfoGain.connect(canvas.gain.gain);
    lfo.start();
    const far = connectNoise(ctx, master, { freq: 90, q: 0.4, gain: 0.012, type: "lowpass" });
    layers = [
      {
        stop: () => {
          canvas.src.stop();
          lfo.stop();
          far.src.stop();
        },
      },
    ];
    const coffeeTick = () => {
      burst("coffee");
      timers.push(window.setTimeout(coffeeTick, 9000 + Math.random() * 14000));
    };
    const crewTick = () => {
      burst("crew");
      timers.push(window.setTimeout(crewTick, 16000 + Math.random() * 24000));
    };
    timers.push(window.setTimeout(coffeeTick, 4000));
    timers.push(window.setTimeout(crewTick, 8000));
  }

  function stopLayers() {
    for (const t of timers) window.clearTimeout(t);
    timers = [];
    for (const layer of layers) layer.stop();
    layers = [];
  }

  async function setMuted(next: boolean) {
    muted = next;
    const audio = ensure();
    if (muted) {
      master!.gain.setTargetAtTime(0, audio.currentTime, 0.08);
      stopLayers();
      if (audio.state === "running") await audio.suspend();
      return;
    }
    if (audio.state === "suspended") await audio.resume();
    startLayers();
    master!.gain.setTargetAtTime(0.55, audio.currentTime, 0.2);
  }

  return {
    get muted() {
      return muted;
    },
    toggle() {
      return setMuted(!muted);
    },
    setMuted,
  };
}

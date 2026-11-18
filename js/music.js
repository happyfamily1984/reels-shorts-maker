// 내장 음악 — 음원 파일 없이 Web Audio 신시사이저로 그 자리에서 만들어 낸다.
// 앱이 직접 생성하는 음악이라 용량이 0이고 저작권 문제가 없다.
const SR = 48000;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const CH = { M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 7: [0, 4, 7, 10] };

// prog: 한 마디에 코드 하나 [근음(MIDI), 코드 종류]
export const TRACKS = {
  pop: { name: '밝은 팝', bpm: 112, prog: [[60, 'M'], [67, 'M'], [69, 'm'], [65, 'M']], kick: [0, 1, 2, 3], clap: [1, 3], hat: 2, pad: 'sawtooth', arp: 2, arpWave: 'triangle', bass: 'root', cutoff: 9000 },
  lofi: { name: '로파이', bpm: 78, prog: [[62, 'm7'], [67, '7'], [60, 'M7'], [69, 'm7']], kick: [0, 2.5], clap: [1, 3], hat: 2, pad: 'triangle', arp: 0, keys: true, bass: 'long', cutoff: 2600, swing: 0.14 },
  beat: { name: '신나는 비트', bpm: 128, prog: [[57, 'm'], [65, 'M'], [60, 'M'], [67, 'M']], kick: [0, 1, 2, 3], clap: [1, 3], hat: 4, pad: 'square', arp: 4, arpWave: 'square', bass: 'off', cutoff: 10000 },
  calm: { name: '잔잔한', bpm: 70, prog: [[60, 'M'], [69, 'm'], [65, 'M'], [67, 'M']], kick: [], clap: [], hat: 0, pad: 'sine', arp: 2, arpWave: 'sine', bass: 'long', cutoff: 5000 },
  tense: { name: '긴장감', bpm: 100, prog: [[57, 'm'], [57, 'm'], [65, 'M'], [64, 'M']], kick: [0, 2], clap: [], hat: 4, pad: 'sawtooth', arp: 0, bass: 'pulse', cutoff: 1800 },
};

let cache = null; // 마지막으로 만든 곡 하나만 기억
export async function renderTrack(id, dur) {
  const key = `${id}:${Math.ceil(dur)}`;
  if (cache && cache.key === key) return cache.buf;
  const T = TRACKS[id], ctx = new OfflineAudioContext(2, Math.ceil((dur + 0.5) * SR), SR);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = T.cutoff;
  const comp = ctx.createDynamicsCompressor(), out = ctx.createGain(); out.gain.value = 0.7;
  lp.connect(comp).connect(out).connect(ctx.destination);
  const noise = ctx.createBuffer(1, SR * 0.3, SR);
  { const d = noise.getChannelData(0); let x = 12345; for (let i = 0; i < d.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = x / 0x3fffffff - 1; } }

  const env = (t, len, vol, a = 0.01) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + Math.max(a, len * 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    return g;
  };
  const tone = (type, freq, t, len, vol, a) => {
    if (t >= dur) return;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    o.connect(env(t, len, vol, a)).connect(lp); o.start(t); o.stop(t + len + 0.05);
  };
  const kick = (t) => {
    if (t >= dur) return;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(comp); o.start(t); o.stop(t + 0.32);
  };
  const hit = (t, type, freq, vol, len) => { // 박수·하이햇: 걸러낸 잡음
    if (t >= dur) return;
    const n = ctx.createBufferSource(); n.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(f).connect(g).connect(comp); n.start(t); n.stop(t + len + 0.02);
  };

  const beat = 60 / T.bpm, bar = beat * 4;
  for (let b = 0; b * bar < dur; b++) {
    const [root, kind] = T.prog[b % T.prog.length], tones = CH[kind], t0 = b * bar;
    const padVol = T.pad === 'sine' || T.pad === 'triangle' ? 0.07 : 0.03;
    for (const n of tones) tone(T.pad, mtof(root + n), t0, bar * 0.99, padVol, 0.12);
    if (T.keys) for (const at of [0, 2.5]) for (const n of tones) tone('sine', mtof(root + 12 + n), t0 + at * beat, beat * 1.4, 0.06);
    if (T.bass === 'root') for (const at of [0, 2]) tone('triangle', mtof(root - 24), t0 + at * beat, beat * 1.6, 0.3);
    else if (T.bass === 'off') for (let i = 0; i < 4; i++) tone('triangle', mtof(root - 24), t0 + (i + 0.5) * beat, beat * 0.42, 0.34);
    else if (T.bass === 'pulse') for (let i = 0; i < 8; i++) tone('sawtooth', mtof(root - 24), t0 + i * beat / 2, beat * 0.4, 0.2);
    else tone('sine', mtof(root - 12), t0, bar * 0.95, 0.24, 0.03);
    if (T.arp) {
      const seq = [...tones, tones[0] + 12, ...tones.slice(1).reverse()], step = beat / T.arp;
      for (let i = 0; i < 4 * T.arp; i++) tone(T.arpWave, mtof(root + 12 + seq[i % seq.length]), t0 + i * step, step * 0.9, T.arpWave === 'square' ? 0.03 : 0.08);
    }
    for (const at of T.kick) kick(t0 + at * beat);
    for (const at of T.clap) hit(t0 + at * beat, 'bandpass', 1800, 0.3, 0.16);
    if (T.hat) {
      const step = beat / T.hat;
      for (let i = 0; i < 4 * T.hat; i++) hit(t0 + i * step + (i % 2 ? (T.swing || 0) * step : 0), 'highpass', 7000, i % T.hat ? 0.05 : 0.09, 0.04);
    }
  }
  const buf = await ctx.startRendering();
  cache = { key, buf };
  return buf;
}

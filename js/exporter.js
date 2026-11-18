// 내보내기 — 휴대폰 안에서 직접 영상을 인코딩한다 (서버·PC 불필요).
// 1순위: WebCodecs + MP4 먹서 (프레임 단위, 실시간보다 빠르고 정확)
// 2순위: MediaRecorder 실시간 녹화 (구형 브라우저용)
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';
import { drawFrame, seekVideos, syncVideos, totalDuration } from './render.js';

const SR = 48000;

async function pickVideo(w, h, fps, bitrate) {
  if (!('VideoEncoder' in window)) return null;
  const cands = [['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.42e028'], ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08']];
  for (const [mux, codec] of cands) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps };
    if (mux === 'avc') cfg.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { mux, cfg }; } catch {}
  }
  return null;
}
async function pickAudio() {
  if (!('AudioEncoder' in window)) return null;
  for (const [mux, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: SR, numberOfChannels: 2, bitrate: 128000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { mux, cfg }; } catch {}
  }
  return null;
}

async function viaWebCodecs({ p, assets, audioBuf, w, h, fps, bitrate, onProgress, signal }) {
  const vc = await pickVideo(w, h, fps, bitrate);
  if (!vc) throw new Error('no-webcodecs');
  const ac = audioBuf ? await pickAudio() : null;
  if (audioBuf && !ac) throw new Error('no-audio-encoder');
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: vc.mux, width: w, height: h, frameRate: fps },
    audio: ac ? { codec: ac.mux, numberOfChannels: 2, sampleRate: SR } : undefined,
  });
  let err = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { err = e; } });
  venc.configure(vc.cfg);

  const total = totalDuration(p), frames = Math.max(1, Math.round(total * fps));
  for (let i = 0; i < frames; i++) {
    if (signal.aborted) { venc.close(); throw new DOMException('취소됨', 'AbortError'); }
    if (err) throw err;
    const t = i / fps;
    await seekVideos(p, t, assets);
    drawFrame(ctx, p, t, assets);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
    if (i % 5 === 0) { onProgress(i / frames * 0.92); await new Promise((r) => setTimeout(r)); }
  }
  await venc.flush(); venc.close();
  if (err) throw err;

  if (ac) {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { err = e; } });
    aenc.configure(ac.cfg);
    const n = audioBuf.length, ch0 = audioBuf.getChannelData(0), ch1 = audioBuf.getChannelData(audioBuf.numberOfChannels > 1 ? 1 : 0);
    const step = SR;
    for (let off = 0; off < n; off += step) {
      const len = Math.min(step, n - off);
      const data = new Float32Array(len * 2);
      data.set(ch0.subarray(off, off + len), 0); data.set(ch1.subarray(off, off + len), len);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round(off / SR * 1e6), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
    if (err) throw err;
  }
  muxer.finalize();
  onProgress(1);
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', method: '고속 인코딩(WebCodecs)' };
}

async function viaRecorder({ p, assets, audioBuf, w, h, fps, bitrate, onProgress, signal }) {
  const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('이 브라우저는 영상 내보내기를 지원하지 않습니다. 최신 Chrome을 사용해 주세요.');
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  drawFrame(ctx, p, 0, assets);
  const stream = canvas.captureStream(fps);
  let actx, src;
  if (audioBuf) {
    actx = new AudioContext(); await actx.resume();
    const dest = actx.createMediaStreamDestination();
    src = actx.createBufferSource(); src.buffer = audioBuf; src.connect(dest);
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => { rec.onstop = r; });
  const total = totalDuration(p);
  rec.start(500); src && src.start();
  const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= total || signal.aborted) return res();
      syncVideos(p, t, assets, true);
      drawFrame(ctx, p, t, assets);
      onProgress(t / total);
      requestAnimationFrame(tick);
    };
    tick();
  });
  syncVideos(p, 0, assets, false);
  rec.stop(); await stopped;
  stream.getTracks().forEach((t) => t.stop());
  actx && actx.close();
  if (signal.aborted) throw new DOMException('취소됨', 'AbortError');
  onProgress(1);
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(parts, { type: mime.split(';')[0] }), ext, method: '실시간 녹화(MediaRecorder)' };
}

export async function exportVideo(opts) {
  try {
    return await viaWebCodecs(opts);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    console.warn('WebCodecs 내보내기 실패, 실시간 녹화로 전환:', e);
    opts.onProgress(0);
    return viaRecorder(opts);
  }
}

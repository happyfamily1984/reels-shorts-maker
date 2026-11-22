// 렌더 엔진 — 프로젝트와 시각 t(초)를 받아 캔버스에 한 프레임을 그린다.
// 미리보기와 내보내기가 같은 함수를 쓰므로 보이는 그대로 영상이 된다.
import { poseAt } from './talk.js';
import { TRACKS, renderTrack } from './music.js';

export const W = 1080, H = 1920;
export const TD = 0.45; // 전환 길이(초)
export const BGS = [
  ['#ff5f6d', '#ffc371'], ['#1e3c72', '#2a5298'], ['#0f0c29', '#302b63'], ['#11998e', '#38ef7d'],
  ['#fc466b', '#3f5efb'], ['#232526', '#414345'], ['#f7971e', '#ffd200'], ['#000000', '#000000'],
];
export const FONTS = { gothic: 'system-ui, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif', serif: '"Noto Serif KR", "AppleMyungjo", serif' };

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const back = (x) => { x = clamp(x); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

export const totalDuration = (p) => p.scenes.reduce((a, s) => a + s.duration, 0);
export function sceneStart(p, i) { let t = 0; for (let k = 0; k < i; k++) t += p.scenes[k].duration; return t; }
export function sceneAt(p, t) {
  let acc = 0;
  for (let i = 0; i < p.scenes.length; i++) {
    const d = p.scenes[i].duration;
    if (t < acc + d || i === p.scenes.length - 1) return { i, local: clamp(t - acc, 0, d) };
    acc += d;
  }
  return { i: 0, local: 0 };
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const tryLine = line ? line + ' ' + word : word;
      if (ctx.measureText(tryLine).width <= maxW) { line = tryLine; continue; }
      if (line) out.push(line);
      line = '';
      for (const ch of word) { // 한 단어가 너무 길면 글자 단위로 끊는다
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

function drawMedia(ctx, s, a, prog) {
  const src = a.src, sw = a.w, sh = a.h;
  if (!sw || !sh) return false;
  let z = 1, ox = 0;
  if (s.motion === 'zoomIn') z = 1 + 0.15 * prog;
  else if (s.motion === 'zoomOut') z = 1.15 - 0.15 * prog;
  else if (s.motion === 'panL') { z = 1.15; ox = (0.5 - prog) * 0.14 * W; }
  else if (s.motion === 'panR') { z = 1.15; ox = (prog - 0.5) * 0.14 * W; }
  const cover = Math.max(W / sw, H / sh);
  if (s.fit === 'contain') {
    // 흐린 배경 위에 원본 비율 그대로 얹는다
    ctx.save(); ctx.filter = 'blur(40px) brightness(0.6)';
    const bw = sw * cover * 1.1, bh = sh * cover * 1.1;
    ctx.drawImage(src, (W - bw) / 2, (H - bh) / 2, bw, bh); ctx.restore();
    const c = Math.min(W / sw, H / sh) * (0.94 + 0.06 * (z - 1) / 0.15);
    ctx.drawImage(src, (W - sw * c) / 2, (H - sh * c) / 2, sw * c, sh * c);
  } else {
    const dw = sw * cover * z, dh = sh * cover * z;
    ctx.drawImage(src, (W - dw) / 2 + ox, (H - dh) / 2, dw, dh);
  }
  return true;
}

// 대사 자막: 내레이션(대본 문장 전체)을 화면 아래에 반투명 띠와 함께 작게 띄운다.
// 그린 영역의 맨 위 y를 돌려줘서, 아래쪽 큰 자막이 그 위로 비켜 가게 한다.
export const subOn = (p, s) => p.subtitle !== false && !!(s.narration || '').trim() && s.narration.trim() !== (s.text || '').trim();
// 자막 위치 (스타일에서 조절): 위 자막의 윗선, 아래 대사 자막의 아랫선 — 화면 높이 대비 비율
export const CAP_Y = 0.177, SUB_Y = 0.88;
const capTop = (p) => (p.style.capY ?? CAP_Y) * H;
const subBottom = (p) => (p.style.subY ?? SUB_Y) * H;
function drawSub(ctx, p, s, local) {
  if (!subOn(p, s)) return H;
  const size = p.style.subSize || 54, lh = size * 1.4;
  ctx.save();
  ctx.font = `700 ${size}px ${FONTS[p.style.font] || FONTS.gothic}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrap(ctx, s.narration.trim(), W - 160).slice(0, 4);
  const bottom = subBottom(p), top = bottom - lines.length * lh;
  ctx.globalAlpha *= ease(clamp(local / 0.3));
  lines.forEach((line, i) => {
    const y = top + lh * (i + 0.5), w = ctx.measureText(line).width + size * 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, y - lh / 2 + 2, w, lh - 4, 14); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(line, W / 2, y);
  });
  ctx.restore();
  return top;
}

function drawText(ctx, p, s, local, subTop = H, lower = 0) {
  if (!s.text) return;
  const st = p.style, size = st.size;
  ctx.font = `900 ${size}px ${FONTS[st.font] || FONTS.gothic}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrap(ctx, s.text, W - 180);
  const lh = size * 1.32, bh = lines.length * lh;
  const cy = s.textPos === 'top' ? Math.max(capTop(p), lower) + bh / 2 : s.textPos === 'center' ? H / 2 : Math.min(H - 440, subTop - 50) - bh / 2;
  const ap = local / 0.5;
  let alpha = 1, scale = 1, ty = 0, chars = Infinity;
  if (s.textAnim === 'fade') alpha = ease(ap);
  else if (s.textAnim === 'pop') { alpha = clamp(ap * 2); scale = 0.6 + 0.4 * back(ap); }
  else if (s.textAnim === 'slide') { alpha = ease(ap); ty = (1 - ease(ap)) * 90; }
  else if (s.textAnim === 'type') {
    const n = lines.join('').length;
    chars = Math.floor(n * clamp(local / Math.min(s.duration * 0.6, n * 0.07 + 0.2)));
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(W / 2, cy + ty); ctx.scale(scale, scale);
  lines.forEach((full, i) => {
    const line = chars === Infinity ? full : full.slice(0, Math.max(0, chars));
    if (chars !== Infinity) chars -= full.length;
    if (!line) return;
    const y = (i - (lines.length - 1) / 2) * lh;
    if (st.caption === 'box' || st.caption === 'highlight') {
      const w = ctx.measureText(line).width + size * 0.7;
      ctx.fillStyle = st.caption === 'box' ? 'rgba(0,0,0,0.72)' : st.color;
      ctx.beginPath(); ctx.roundRect(-w / 2, y - lh / 2 + 3, w, lh - 6, size * 0.22); ctx.fill();
    } else if (st.caption === 'outline') {
      ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.2; ctx.strokeStyle = '#000';
      ctx.strokeText(line, 0, y);
    } else if (st.caption === 'neon') {
      ctx.shadowColor = st.color; ctx.shadowBlur = size * 0.5;
      ctx.fillStyle = st.color; ctx.fillText(line, 0, y); ctx.fillText(line, 0, y);
    } else { // shadow
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetY = size * 0.06;
    }
    ctx.fillStyle = st.caption === 'neon' ? '#fff' : st.caption === 'highlight' ? '#111' : st.color;
    ctx.fillText(line, 0, y);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  });
  ctx.restore();
}

export function drawScene(ctx, p, s, local, assets, withText = true) {
  const prog = clamp(local / s.duration);
  const a = s.mediaId && assets.get(s.mediaId);
  let ok = false;
  const tks = talkerFor(assets, s);
  if (s.talk && tks && tks.t !== undefined) { drawTalkScene(ctx, tks.tk, prog); ok = true; }
  else if (a) { try { ok = drawMedia(ctx, s, a, prog); } catch { ok = false; } }
  if (!ok) {
    const c = BGS[s.bg % BGS.length];
    const g = ctx.createLinearGradient(0, 0, W * (0.3 + 0.4 * prog), H);
    g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (withText) drawTexts(ctx, p, s, local);
}
// lower: 위쪽 구석의 캐릭터 창과 겹치지 않게 위 자막을 내리는 양
function drawTexts(ctx, p, s, local, lower = 0) {
  const top = drawSub(ctx, p, s, local);
  drawText(ctx, p, s, local, top, lower);
}

/* ───────── 캐릭터 진행자 ─────────
   저장된 캐릭터 그림을 화면 위쪽 구석의 작은 동그란 창에 넣는다 (전신 그림이든 얼굴 사진이든 위쪽 정사각형 = 얼굴 쪽을 쓴다).
   AI 음성의 크기에 맞춰 창이 살짝 커지고 테두리가 빛나 말하는 것처럼 보인다.
   talk: 1/30초마다의 음성 크기(0~1) — 믹싱할 때 assets.talk 에 만들어 둔다. */
export const presenterOn = (p, assets) => !!(p.char && p.char.show && p.char.imageId && (assets.talker || assets.get(p.char.imageId)));
// 말하는 사진(assets.talker): 이 시각의 표정으로 한 번만 그려 두고 구석 창·말하는 장면이 같이 쓴다
const ampAt = (assets, t) => { const a = assets.talk, k = Math.floor(t * 30); return a && k < a.length ? a[k] : 0; };
// 장면의 자세(s.pose) 사진이 있으면 그것으로, 없으면 대표 사진으로
function talkerFor(assets, s) { return (s && s.pose && assets.poses && assets.poses[s.pose]) || assets.talker; }
function talkFrame(assets, t, s) {
  const tk = talkerFor(assets, s); if (!tk) return null;
  if (tk.t !== t) { tk.t = t; tk.tk.render(poseAt(t, ampAt(assets, t))); }
  return tk.tk;
}
// 장면 전체를 캐릭터가 말하는 화면으로: 얼굴이 화면 위쪽 2/5쯤 오게 확대해 채운다
function drawTalkScene(ctx, tk, prog) {
  const f = tk.face, z = 1 + 0.06 * prog;
  const k = Math.max(W / tk.width, H / tk.height, (H * 0.3) / f.h) * z;
  let x = W / 2 - f.x * k, y = H * 0.4 - f.y * k;
  x = Math.min(0, Math.max(W - tk.width * k, x)); y = Math.min(0, Math.max(H - tk.height * k, y));
  ctx.fillStyle = '#20202c'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(tk.canvas, x, y, tk.width * k, tk.height * k);
}
// 캐릭터 창 위치: tl·tc·tr / ml·mr / bl·bc·br (위·가운데·아래 × 왼쪽·가운데·오른쪽)
export const charPos = (c) => c.pos || (c.side === 'right' ? 'tr' : 'tl');
export const presenterSize = (c) => 230 * (c.scale || 1);
export function presenterXY(p) {
  const c = p.char, pos = charPos(c), d = presenterSize(c);
  const x = pos[1] === 'l' ? 44 + d / 2 : pos[1] === 'r' ? W - 44 - d / 2 : W / 2;
  const y = pos[0] === 't' ? 120 + d / 2 : pos[0] === 'm' ? H * 0.46 : subBottom(p) - 220 - d / 2;
  return { x, y, d };
}
export function drawPresenter(ctx, p, t, assets) {
  const c = p.char;
  if (!presenterOn(p, assets)) return;
  const tk = talkFrame(assets, t, p.scenes.length ? p.scenes[sceneAt(p, t).i] : null), a = tk ? null : assets.get(c.imageId);
  const amp = ampAt(assets, t);
  const d = 230 * (c.scale || 1), r = d / 2 * back(clamp(t / 0.5)) * (1 + amp * 0.05);
  const { x: cx, y: cy0 } = presenterXY(p), cy = cy0 - amp * 6 * Math.abs(Math.sin(t * 9));
  if (r <= 1) return;
  // 말하는 사진이면 얼굴을 가운데로, 아니면 그림 위쪽 정사각형
  let sx, sy, side;
  if (tk) { const f = tk.face; side = Math.min(tk.width, tk.height, f.h * 1.7); sx = Math.max(0, Math.min(tk.width - side, f.x - side / 2)); sy = Math.max(0, Math.min(tk.height - side, f.y - side * 0.48)); }
  else { side = Math.min(a.w, a.h); sx = (a.w - side) / 2; sy = 0; }
  ctx.save();
  ctx.shadowColor = `rgba(255,255,255,${0.25 + amp * 0.6})`; ctx.shadowBlur = 18 + amp * 40;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r + 7, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r); g.addColorStop(0, '#dfe7f5'); g.addColorStop(1, '#aebbd6');
  ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.drawImage(tk ? tk.canvas : a.src, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

export function drawFrame(ctx, p, t, assets) {
  ctx.setTransform(ctx.canvas.width / W, 0, 0, ctx.canvas.height / H, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (!p.scenes.length) return;
  const { i, local } = sceneAt(p, t);
  const s = p.scenes[i], tr = s.transition || p.transition;
  talkFrame(assets, t, s);
  if (i > 0 && local < TD) talkFrame(assets, t, p.scenes[i - 1]); // 전환 중에는 앞 장면 자세도
  const ch = presenterOn(p, assets) && !s.talk; // 장면마다 따로 고른 전환이 있으면 그것을 쓴다
  if (i > 0 && tr !== 'none' && local < TD) {
    const q = ease(local / TD), prev = p.scenes[i - 1];
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (tr === 'slide') {
      ctx.save(); ctx.translate(-q * W, 0); drawScene(ctx, p, prev, prev.duration, assets, !ch); ctx.restore();
      ctx.save(); ctx.translate((1 - q) * W, 0); drawScene(ctx, p, s, local, assets, !ch); ctx.restore();
    } else {
      drawScene(ctx, p, prev, prev.duration, assets, !ch);
      ctx.save(); ctx.globalAlpha = q;
      if (tr === 'zoom') { const k = 1.3 - 0.3 * q; ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2); }
      drawScene(ctx, p, s, local, assets, !ch); ctx.restore();
    }
    ctx.restore();
  } else drawScene(ctx, p, s, local, assets, !ch);
  // 캐릭터가 있으면 장면 그림 위·자막 아래에 그린다 (자막이 가려지지 않게)
  // 캐릭터 창이 위쪽에 있으면 위 자막을 그 아래로 내린다
  if (ch) { drawPresenter(ctx, p, t, assets); drawTexts(ctx, p, s, local, charPos(p.char)[0] === 't' ? 140 + presenterSize(p.char) : 0); }
}

// 장면 안의 시각 → 원본 영상의 시각 (잘라낸 시작 지점 반영, 영상이 장면보다 짧으면 마지막 화면에서 멈춤)
const clipTime = (s, local, v) => Math.min((s.trimStart || 0) + local, Math.max(0, (v.duration || 1) - 0.05));

// 영상 클립을 현재 시각에 맞춘다 (미리보기·실시간 녹화용)
export function syncVideos(p, t, assets, playing) {
  const { i, local } = p.scenes.length ? sceneAt(p, t) : { i: -1, local: 0 };
  const active = i >= 0 && p.scenes[i].mediaId;
  for (const [id, a] of assets) {
    if (a.kind !== 'video') continue;
    const v = a.src;
    if (id !== active) { if (!v.paused) v.pause(); continue; }
    const target = clipTime(p.scenes[i], local, v);
    if (playing) {
      if (Math.abs(v.currentTime - target) > 0.4) v.currentTime = target;
      if (v.paused) v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
    }
  }
}

// 프레임 단위 내보내기용: 정확한 위치로 탐색이 끝날 때까지 기다린다
export async function seekVideos(p, t, assets) {
  if (!p.scenes.length) return;
  const { i, local } = sceneAt(p, t);
  const a = assets.get(p.scenes[i].mediaId);
  if (!a || a.kind !== 'video') return;
  const v = a.src, target = clipTime(p.scenes[i], local, v);
  if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return;
  await new Promise((res) => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 1500);
    v.addEventListener('seeked', done);
    v.currentTime = target;
  });
}

// 배경음악 + 내레이션 + 클립 소리를 하나의 오디오 버퍼로 섞는다
const DECODED = new Map();
export async function talkEnvelope(p, getBlob) {
  const total = totalDuration(p), n = Math.ceil(total * 30) + 1, env = new Float32Array(n);
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const decode = async (id) => {
    if (DECODED.has(id)) return DECODED.get(id);
    try { const b = await getBlob(id); const buf = b ? await ctx.decodeAudioData(await b.arrayBuffer()) : null; if (buf && buf.duration < 180) DECODED.set(id, buf); return buf; } catch { return null; }
  };
  const addBuf = (buf, at) => {
    const d = buf.getChannelData(0), sr = buf.sampleRate, step = sr / 30;
    for (let f = 0; f * step < d.length; f++) {
      let sum = 0; const s0 = Math.floor(f * step), s1 = Math.min(d.length, Math.floor((f + 1) * step));
      for (let i = s0; i < s1; i += 4) sum += d[i] * d[i];
      const k = Math.floor(at * 30) + f; if (k < n) env[k] = Math.max(env[k], Math.sqrt(sum / Math.max(1, (s1 - s0) / 4)));
    }
  };
  let any = false, t = 0;
  if (p.audio.narrationId) { const b = await decode(p.audio.narrationId); if (b) { addBuf(b, 0); any = true; } }
  for (const s of p.scenes) { if (s.ttsId) { const b = await decode(s.ttsId); if (b) { addBuf(b, t); any = true; } } t += s.duration; }
  if (!any) return null;
  const sorted = [...env].filter((v) => v > 0.005).sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * 0.9)] || 1;
  let prev = 0;
  for (let k = 0; k < n; k++) { const v = Math.min(1, env[k] / ref); prev = v > prev ? v : prev * 0.8 + v * 0.2; env[k] = v < 0.08 ? prev * 0.6 : prev; }
  return env;
}
export async function mixAudio(p, getBlob) {
  const total = totalDuration(p), sr = 48000;
  if (total <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  // 한 번 풀어 둔 소리는 다시 풀지 않는다 (미디어 id는 바뀌지 않으므로 안전). 긴 소리는 메모리 때문에 담아 두지 않는다.
  const decode = async (id) => {
    if (DECODED.has(id)) return DECODED.get(id);
    try {
      const b = await getBlob(id); const buf = b ? await ctx.decodeAudioData(await b.arrayBuffer()) : null;
      if (buf && buf.duration < 180) { DECODED.set(id, buf); if (DECODED.size > 60) DECODED.delete(DECODED.keys().next().value); }
      return buf;
    } catch { return null; }
  };
  let any = false;
  const add = (buf, vol, when, dur, loop, offset = 0) => {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.loop = !!loop; g.gain.value = vol;
    if (loop) { g.gain.setValueAtTime(vol, Math.max(0, total - 1.2)); g.gain.linearRampToValueAtTime(0, total); }
    src.connect(g).connect(ctx.destination);
    if (dur) src.start(when, Math.min(offset, Math.max(0, buf.duration - 0.05)), dur); else src.start(when);
    any = true;
  };
  const a = p.audio;
  if (a.musicId) { const b = await decode(a.musicId); if (b) add(b, a.musicVol, 0, 0, true); }
  else if (TRACKS[a.musicPreset]) add(await renderTrack(a.musicPreset, total), a.musicVol, 0, 0, true);
  if (a.narrationId) { const b = await decode(a.narrationId); if (b) add(b, a.narrationVol, 0); }
  let t = 0;
  const cache = new Map();
  for (const s of p.scenes) {
    if (s.ttsId) { const b = await decode(s.ttsId); if (b) add(b, 1, t); }
    if (s.mediaKind === 'video' && s.clipAudio) {
      if (!cache.has(s.mediaId)) cache.set(s.mediaId, await decode(s.mediaId));
      const b = cache.get(s.mediaId);
      if (b) add(b, 1, t, s.duration, false, s.trimStart || 0);
    }
    t += s.duration;
  }
  return any ? ctx.startRendering() : null;
}

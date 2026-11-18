// 렌더 엔진 — 프로젝트와 시각 t(초)를 받아 캔버스에 한 프레임을 그린다.
// 미리보기와 내보내기가 같은 함수를 쓰므로 보이는 그대로 영상이 된다.
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

function drawText(ctx, p, s, local) {
  if (!s.text) return;
  const st = p.style, size = st.size;
  ctx.font = `900 ${size}px ${FONTS[st.font] || FONTS.gothic}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrap(ctx, s.text, W - 180);
  const lh = size * 1.32, bh = lines.length * lh;
  const cy = s.textPos === 'top' ? 340 + bh / 2 : s.textPos === 'center' ? H / 2 : H - 440 - bh / 2;
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
    if (st.caption === 'box') {
      const w = ctx.measureText(line).width + size * 0.7;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
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
    ctx.fillStyle = st.caption === 'neon' ? '#fff' : st.color;
    ctx.fillText(line, 0, y);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  });
  ctx.restore();
}

export function drawScene(ctx, p, s, local, assets) {
  const prog = clamp(local / s.duration);
  const a = s.mediaId && assets.get(s.mediaId);
  let ok = false;
  if (a) { try { ok = drawMedia(ctx, s, a, prog); } catch { ok = false; } }
  if (!ok) {
    const c = BGS[s.bg % BGS.length];
    const g = ctx.createLinearGradient(0, 0, W * (0.3 + 0.4 * prog), H);
    g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  drawText(ctx, p, s, local);
}

export function drawFrame(ctx, p, t, assets) {
  ctx.setTransform(ctx.canvas.width / W, 0, 0, ctx.canvas.height / H, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (!p.scenes.length) return;
  const { i, local } = sceneAt(p, t);
  const s = p.scenes[i], tr = p.transition;
  if (i > 0 && tr !== 'none' && local < TD) {
    const q = ease(local / TD), prev = p.scenes[i - 1];
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (tr === 'slide') {
      ctx.save(); ctx.translate(-q * W, 0); drawScene(ctx, p, prev, prev.duration, assets); ctx.restore();
      ctx.save(); ctx.translate((1 - q) * W, 0); drawScene(ctx, p, s, local, assets); ctx.restore();
    } else {
      drawScene(ctx, p, prev, prev.duration, assets);
      ctx.save(); ctx.globalAlpha = q;
      if (tr === 'zoom') { const k = 1.3 - 0.3 * q; ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2); }
      drawScene(ctx, p, s, local, assets); ctx.restore();
    }
    ctx.restore();
  } else drawScene(ctx, p, s, local, assets);
}

// 영상 클립을 현재 시각에 맞춘다 (미리보기·실시간 녹화용)
export function syncVideos(p, t, assets, playing) {
  const { i, local } = p.scenes.length ? sceneAt(p, t) : { i: -1, local: 0 };
  const active = i >= 0 && p.scenes[i].mediaId;
  for (const [id, a] of assets) {
    if (a.kind !== 'video') continue;
    const v = a.src;
    if (id !== active) { if (!v.paused) v.pause(); continue; }
    const target = local % (v.duration || 1);
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
  const v = a.src, target = local % (v.duration || 1);
  if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return;
  await new Promise((res) => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 1500);
    v.addEventListener('seeked', done);
    v.currentTime = target;
  });
}

// 배경음악 + 내레이션 + 클립 소리를 하나의 오디오 버퍼로 섞는다
export async function mixAudio(p, getBlob) {
  const total = totalDuration(p), sr = 48000;
  if (total <= 0) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const decode = async (id) => {
    try { const b = await getBlob(id); return b ? await ctx.decodeAudioData(await b.arrayBuffer()) : null; } catch { return null; }
  };
  let any = false;
  const add = (buf, vol, when, dur, loop) => {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.loop = !!loop; g.gain.value = vol;
    if (loop) { g.gain.setValueAtTime(vol, Math.max(0, total - 1.2)); g.gain.linearRampToValueAtTime(0, total); }
    src.connect(g).connect(ctx.destination);
    if (dur) src.start(when, 0, dur); else src.start(when);
    any = true;
  };
  const a = p.audio;
  if (a.musicId) { const b = await decode(a.musicId); if (b) add(b, a.musicVol, 0, 0, true); }
  if (a.narrationId) { const b = await decode(a.narrationId); if (b) add(b, a.narrationVol, 0); }
  let t = 0;
  const cache = new Map();
  for (const s of p.scenes) {
    if (s.mediaKind === 'video' && s.clipAudio) {
      if (!cache.has(s.mediaId)) cache.set(s.mediaId, await decode(s.mediaId));
      const b = cache.get(s.mediaId);
      if (b) add(b, 1, t, s.duration);
    }
    t += s.duration;
  }
  return any ? ctx.startRendering() : null;
}

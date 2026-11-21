import * as db from './db.js';
import { W, H, BGS, drawFrame, drawScene, syncVideos, mixAudio, totalDuration, sceneStart, sceneAt } from './render.js';
import { exportVideo } from './exporter.js';
import { TRACKS } from './music.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app'), layers = $('#layers');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let toastTo;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTo); toastTo = setTimeout(() => el.classList.remove('on'), 2400); }

/* ───────── 뒤로가기 ─────────
   뒤로가기 = 직전 행동(열린 창) 취소 → 이전 화면 → 홈에서는 종료 확인 */
const backStack = [];
let exiting = false;
history.replaceState({ base: 1 }, '');
history.pushState({ guard: 1 }, '');
addEventListener('popstate', () => {
  if (exiting) { history.back(); return; }
  history.pushState({ guard: 1 }, '');
  goBack();
});
// 안드로이드 앱(APK) 안에서 실행 중이면 기기 기능은 네이티브 쪽에 맡긴다
const NATIVE = window.Android || null;
window.__back = () => goBack(); // 기기 뒤로가기 버튼 → 네이티브가 호출
async function nativeFile(blob, name, action) {
  const u8 = new Uint8Array(await blob.arrayBuffer()), STEP = 3 * 256 * 1024;
  NATIVE.fileBegin(name, blob.type || 'video/mp4');
  for (let o = 0; o < u8.length; o += STEP) {
    let bin = ''; const part = u8.subarray(o, o + STEP);
    for (let i = 0; i < part.length; i += 32768) bin += String.fromCharCode.apply(null, part.subarray(i, i + 32768));
    NATIVE.fileChunk(btoa(bin));
  }
  return NATIVE.fileEnd(action); // 'save' | 'share' → 결과 메시지
}
function goBack() { const fn = backStack.pop(); if (fn) fn(); else askExit(); }
async function askExit() {
  if (!(await confirmDlg('앱을 종료하겠습니까?'))) return;
  if (NATIVE) return NATIVE.exit();
  exiting = true;
  history.back();
  try { window.close(); } catch {}
  setTimeout(() => {
    layers.innerHTML = '';
    app.innerHTML = '<div class="empty" style="margin-top:40vh">앱이 종료되었습니다.<br><br><button id="re">다시 열기</button></div>';
    $('#re').onclick = () => location.reload();
  }, 500);
}

/* ───────── 시트·대화상자 ───────── */
function openLayer(inner, cls = '') {
  const el = document.createElement('div');
  el.className = 'backdrop ' + cls; el.innerHTML = inner; layers.append(el);
  const L = { el, onClose: null };
  const entry = () => { el.remove(); L.onClose && L.onClose(); };
  backStack.push(entry);
  L.close = () => { const i = backStack.indexOf(entry); if (i >= 0) { backStack.splice(i, 1); entry(); } };
  el.addEventListener('click', (e) => { if (e.target === el) L.close(); });
  return L;
}
const sheet = (title, body) => openLayer(`<div class="sheet"><h3><span>${title}</span><button class="ghost" data-x>✕</button></h3>${body}</div>`);
function wire(L, acts) {
  L.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return L.close();
    const b = e.target.closest('[data-act]');
    if (b && acts[b.dataset.act]) acts[b.dataset.act](b);
  });
}
function confirmDlg(msg, yes = '예', no = '아니오') {
  return new Promise((res) => {
    const L = openLayer(`<div class="dialog"><div>${esc(msg)}</div><div class="row"><button data-n>${no}</button><button class="pri" data-y>${yes}</button></div></div>`, 'center');
    let ans = false;
    L.onClose = () => res(ans);
    $('[data-y]', L.el).onclick = () => { ans = true; L.close(); };
    $('[data-n]', L.el).onclick = () => L.close();
  });
}
function chips(key, opts, val) {
  return `<div class="chips" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function swatches(key, colors, val) {
  return `<div class="chips" data-key="${key}">${colors.map((c, i) => `<button class="sw ${String(c.v) === String(val) ? 'on' : ''}" data-v="${c.v}" style="background:${c.css}"></button>`).join('')}</div>`;
}
function bindChips(root, fn) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.chips[data-key] button'); if (!b) return;
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    fn(b.parentElement.dataset.key, b.dataset.v);
  });
}
function pickFiles(accept, multiple) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = !!multiple;
    i.onchange = () => res([...i.files]); i.click();
  });
}

/* ───────── 데이터 ───────── */
const MOTIONS = ['zoomIn', 'panL', 'zoomOut', 'panR'];
const newProject = (name) => ({
  id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), scenes: [], media: [], transition: 'fade',
  style: { caption: 'outline', color: '#ffffff', size: 84, font: 'gothic' },
  audio: { musicId: null, musicName: '', musicVol: 0.5, narrationId: null, narrationVol: 1 },
});
const newScene = (o) => ({ id: uid(), text: '', narration: '', duration: 3, mediaId: null, mediaKind: null, bg: 0, motion: 'zoomIn', textPos: 'bottom', textAnim: 'pop', fit: 'cover', clipAudio: true, ...o });
const autoDur = (t) => Math.min(8, Math.max(2, Math.round((1 + t.length / 6) * 2) / 2));
function splitScript(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    if (line.length <= 40) { out.push(line); continue; }
    let buf = '';
    for (const s of line.match(/[^.!?…]+[.!?…]*\s*/g) || [line]) {
      if ((buf + s).length > 40 && buf) { out.push(buf.trim()); buf = s; } else buf += s;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}
async function storeMedia(p, blob, kind, name) {
  const id = uid(); await db.put('media', { id, blob, kind, name }); p.media.push(id); return id;
}
async function importFile(p, file) {
  if (file.type.startsWith('video/')) return { id: await storeMedia(p, file, 'video', file.name), kind: 'video' };
  // 큰 사진은 메모리 절약을 위해 긴 변 2160px로 줄여 저장
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2160 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return { id: await storeMedia(p, blob, 'image', file.name), kind: 'image' };
}
async function loadAsset(id) {
  const rec = await db.get('media', id); if (!rec) return null;
  if (rec.kind === 'image') { const b = await createImageBitmap(rec.blob); return { kind: 'image', src: b, w: b.width, h: b.height }; }
  if (rec.kind === 'video') {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(rec.blob);
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('영상을 열 수 없습니다')); setTimeout(res, 5000); });
    return { kind: 'video', src: v, get w() { return v.videoWidth; }, get h() { return v.videoHeight; }, dur: v.duration || 5 };
  }
  return null;
}
function thumb(cv, p, s, assets) {
  const c = cv.getContext('2d');
  c.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  drawScene(c, p, s, s.duration, assets);
}

/* ───────── 홈 ───────── */
const ICON = {
  gear: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.300 7.300 0 0 0-1.700-1l-.4-2.500a.5.5 0 0 0-.5-.4h-3.800a.5.5 0 0 0-.5.4l-.4 2.500a7.300 7.300 0 0 0-1.700 1l-2.400-1a.5.5 0 0 0-.6.2L2.700 8.800a.5.5 0 0 0 .1.6l2 1.600a7.600 7.600 0 0 0 0 2l-2 1.600a.5.5 0 0 0-.1.6l1.900 3.300c.1.200.400.300.600.200l2.400-1c.500.400 1.100.700 1.700 1l.4 2.500c0 .200.200.400.500.400h3.800c.200 0 .500-.200.500-.400l.4-2.500c.600-.300 1.200-.600 1.700-1l2.400 1c.200.100.500 0 .600-.200l1.900-3.300a.5.5 0 0 0-.1-.6l-2-1.600ZM12 15.500a3.500 3.500 0 1 1 0-7 3.500 3.500 0 0 1 0 7Z"/></svg>',
  shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M12 2 4 5v6c0 5 3.400 9.700 8 11 4.600-1.300 8-6 8-11V5l-8-3Zm-1.200 14.200-3.500-3.500 1.400-1.400 2.100 2.100 4.500-4.500 1.400 1.400-5.900 5.900Z"/></svg>',
  chev: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
};
async function showHome() {
  const ps = (await db.all('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
  app.innerHTML = `<header class="home"><img class="logo" src="icons/icon-192.png" alt=""><h1>릴스·쇼츠 메이커</h1><button class="iconbtn" id="set" aria-label="설정">${ICON.gear}</button></header>
  <div class="home-body">
    <div class="hero"><img class="art" src="icons/art.webp" alt=""><div class="txt">
      <div class="l1">휴대폰만으로</div><div class="l2"><span class="c1">세로</span> <span class="c2">영상</span> 완성</div>
      <p>대본이나 사진·영상을 넣으면 자막·전환·음악이 들어간 9:16 영상으로 만들어 드려요.</p>
      <div class="badge">${ICON.shield}모든 작업은 이 기기 안에서 처리</div>
    </div></div>
    ${ps.length ? `<div class="sec">내 영상 ${ps.length}개</div>` + ps.map((p) => `<div class="proj" data-id="${p.id}"><canvas width="108" height="192"></canvas><div class="info"><b>${esc(p.name)}</b><span class="mut">장면 ${p.scenes.length}개 · ${fmt(totalDuration(p))} · ${new Date(p.updatedAt).toLocaleDateString('ko-KR')}</span></div><button class="ghost" data-menu>⋯</button></div>`).join('') : '<div class="empty"><div class="pod"><img src="icons/art.webp" alt=""></div><b>아직 만든 영상이 없어요.</b><span>아래 버튼으로 시작해 보세요.</span></div>'}
  </div>
  <button class="pri fab" id="new">＋ 새 영상 만들기</button>`;
  $('#new').onclick = newSheet;
  $('#set').onclick = () => settingsSheet();
  for (const el of app.querySelectorAll('.proj')) {
    const p = ps.find((x) => x.id === el.dataset.id);
    el.onclick = (e) => (e.target.closest('[data-menu]') ? projMenu(p) : openEditor(p.id));
    const s = p.scenes[0];
    if (s) {
      const assets = new Map();
      const draw = () => thumb($('canvas', el), p, s, assets);
      draw();
      if (s.mediaKind === 'image') loadAsset(s.mediaId).then((a) => { if (a) { assets.set(s.mediaId, a); draw(); } }).catch(() => {});
    }
  }
}
function projMenu(p) {
  const L = sheet(esc(p.name), `<button class="big" data-act="ren">✏️ 이름 바꾸기</button><button class="big danger" data-act="del">🗑 삭제</button>`);
  wire(L, {
    ren: () => { L.close(); renameSheet(p, showHome); },
    del: async () => {
      L.close();
      if (!(await confirmDlg(`"${p.name}"을(를) 삭제할까요?`, '삭제', '취소'))) return;
      for (const id of p.media) await db.del('media', id);
      await db.del('projects', p.id); showHome();
    },
  });
}
function renameSheet(p, done) {
  const L = sheet('이름 바꾸기', `<input type="text" id="nm" value="${esc(p.name)}" maxlength="40"><div class="row" style="margin-top:12px"><button class="pri" data-act="ok">저장</button></div>`);
  wire(L, { ok: async () => { p.name = $('#nm', L.el).value.trim() || p.name; p.updatedAt = Date.now(); await db.put('projects', p); L.close(); done(); } });
}
function newSheet() {
  const L = sheet('새 영상 만들기', `
    ${[['ai', 't1', '🤖', 'AI로 만들기', '주제만 적으면 AI가 대본·자막·해시태그까지 작성'],
      ['script', 't2', '📝', '대본으로 만들기', '글을 붙여넣으면 문장마다 장면과 자막을 자동 생성'],
      ['media', 't3', '🖼️', '사진·영상으로 만들기', '갤러리에서 여러 개를 고르면 순서대로 이어 붙임'],
      ['blank', 't4', '＋', '빈 프로젝트', '처음부터 직접 구성']]
    .map(([act, t, e, title, sub]) => `<button class="opt" data-act="${act}"><i class="tile ${t}">${e}</i><span><b>${title}</b><small>${sub}</small></span>${ICON.chev}</button>`).join('')}`);
  const create = async (p) => { await db.put('projects', p); openEditor(p.id); };
  wire(L, {
    ai: () => { L.close(); aiSheet(create); },
    blank: () => { L.close(); create(newProject('새 영상')); },
    media: async () => {
      const files = await pickFiles('image/*,video/*', true); L.close();
      if (!files.length) return;
      const p = newProject('새 영상'); toast('미디어를 불러오는 중…');
      await addMediaScenes(p, files, null); create(p);
    },
    script: () => {
      L.close();
      const S = sheet('대본 입력', `<textarea id="sc" rows="9" placeholder="예)\n요즘 뜨는 제주 맛집 3곳!\n첫 번째, 해녀가 직접 잡은 해산물\n두 번째, 줄 서서 먹는 고기국수\n저장해 두고 꼭 가보세요"></textarea><div class="mut" style="margin-top:6px">줄바꿈·문장 단위로 장면이 나뉘고 길이는 글자 수에 맞춰 자동 설정됩니다.</div><div class="row" style="margin-top:12px"><button class="pri" data-act="ok">영상 만들기</button></div>`);
      wire(S, {
        ok: () => {
          const lines = splitScript($('#sc', S.el).value);
          if (!lines.length) return toast('대본을 입력해 주세요');
          const p = newProject(lines[0].slice(0, 20));
          p.scenes = lines.map((t, i) => newScene({ text: t, duration: autoDur(t), bg: i % (BGS.length - 1), motion: MOTIONS[i % 4] }));
          S.close(); create(p);
        },
      });
    },
  });
}
/* ───────── 설정(API 키)·AI 대본 ───────── */
const getKey = () => { try { return localStorage.getItem('key.gemini') || ''; } catch { return ''; } };
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];
const geminiModel = () => { try { const m = localStorage.getItem('model.gemini'); return GEMINI_MODELS.includes(m) ? m : GEMINI_MODELS[0]; } catch { return GEMINI_MODELS[0]; } };
function settingsSheet(done) {
  const L = sheet('설정', `
    <label>Gemini API 키 — AI 대본·AI 음성용 (무료) · 여러 개면 한 줄에 하나씩</label><textarea id="k1" class="secret" rows="4" placeholder="AIza...&#10;AIza..." autocomplete="off" autocapitalize="off" spellcheck="false">${esc(getKey().split(/[\s,]+/).filter(Boolean).join('\n'))}</textarea>
    <div class="mut" style="margin-top:6px">Google AI Studio(aistudio.google.com)에 구글 계정으로 로그인 → "Get API key" → 키를 만들어 붙여넣어 주세요. 무료 등급은 하루·분당 사용 횟수에 제한이 있습니다.</div>
    <div class="mut" style="margin-top:6px">키를 여러 개 넣으면 한 키가 한도에 걸리거나 잘못됐을 때 자동으로 다음 키를 씁니다. 한도는 키가 아니라 Google 프로젝트 단위라서, 서로 다른 프로젝트(또는 계정)에서 만든 키여야 효과가 있습니다.</div>
    <label>대본 작성 모델 — 고른 모델이 한도에 걸리면 나머지를 자동으로 차례로 씁니다</label>${chips('model', GEMINI_MODELS.map((m) => [m, m.replace('gemini-', '')]), geminiModel())}
    <div class="mut" style="margin-top:10px">🔒 키는 이 기기에만 저장되고, Google로만 직접 전송됩니다. 공용 기기에서는 입력하지 마세요.</div>
    <div class="row" style="margin-top:12px"><button class="pri" data-act="ok">저장</button></div>`);
  let model = geminiModel();
  bindChips(L.el, (k, v) => { model = v; });
  wire(L, {
    ok: () => {
      try { localStorage.setItem('model.gemini', model); } catch {}
      const v = $('#k1', L.el).value.split(/[\s,]+/).filter(Boolean).join('\n');
      try { v ? localStorage.setItem('key.gemini', v) : localStorage.removeItem('key.gemini'); } catch {}
      L.close(); toast(v ? `키 ${v.split('\n').length}개를 저장했어요` : '키를 지웠어요'); done && done();
    },
  });
}
function aiSheet(create) {
  if (!getKey()) { toast('먼저 Gemini API 키를 입력해 주세요'); return settingsSheet(() => aiSheet(create)); }
  let tone = '정보 전달', seconds = 30, busy = false;
  const L = sheet('🤖 AI로 만들기', `
    <label>어떤 영상을 만들까요?</label><textarea id="tp" rows="3" placeholder="예) 자취생을 위한 5분 계란 요리 3가지"></textarea>
    <label>분위기</label>${chips('tone', [['정보 전달', '정보'], ['유머러스', '유머'], ['감성적', '감성'], ['제품·가게 홍보', '홍보'], ['동기부여', '동기부여']], tone)}
    <label>길이</label>${chips('seconds', [[15, '15초'], [30, '30초'], [45, '45초'], [60, '60초']], seconds)}
    <div class="row" style="margin-top:14px"><button class="pri" data-act="ok">대본 만들기</button></div>`);
  bindChips(L.el, (k, v) => { if (k === 'tone') tone = v; else seconds = +v; });
  wire(L, {
    ok: async (btn) => {
      const topic = $('#tp', L.el).value.trim();
      if (!topic) return toast('주제를 입력해 주세요');
      if (busy) return; busy = true; btn.textContent = 'AI가 대본을 쓰는 중…';
      try {
        const { generateScript } = await import('./ai.js');
        const out = await generateScript({ topic, tone, seconds });
        if (!L.el.isConnected) return;
        const p = newProject((out.title || topic).slice(0, 30));
        p.post = { description: out.description || '', hashtags: out.hashtags || [] };
        p.look = out.look || ''; p.tone = tone;
        p.scenes = out.scenes.map((sc, i) => newScene({
          text: sc.caption, narration: sc.narration || '', imgPrompt: sc.image || '',
          stickers: sc.emoji ? [{ id: uid(), e: sc.emoji, x: 0.5, y: 0.3, size: 280, anim: 'bounce' }] : [],
          duration: autoDur(sc.narration || sc.caption), bg: i % (BGS.length - 1), motion: MOTIONS[i % 4],
        }));
        L.close(); create(p);
      } catch (e) { console.warn(e); toast(e.message || 'AI 요청에 실패했어요'); busy = false; btn.textContent = '대본 만들기'; }
    },
  });
}
async function addMediaScenes(p, files, assets) {
  for (const f of files) {
    try {
      const m = await importFile(p, f);
      const a = await loadAsset(m.id);
      if (assets) assets.set(m.id, a);
      const n = p.scenes.length;
      p.scenes.push(m.kind === 'video'
        ? newScene({ mediaId: m.id, mediaKind: 'video', motion: 'none', duration: Math.max(1, Math.min(15, Math.round(a.dur * 2) / 2)) })
        : newScene({ mediaId: m.id, mediaKind: 'image', motion: MOTIONS[n % 4] }));
    } catch (e) { console.warn(e); toast(`불러오지 못함: ${f.name}`); }
  }
}

/* ───────── 편집기 ───────── */
let cur = null;
async function openEditor(id) {
  const p = await db.get('projects', id); if (!p) return showHome();
  const E = cur = { p, assets: new Map(), t: 0, playing: false, sel: 0, mix: null, mixDirty: true, actx: null, node: null, t0: 0, busy: false };
  app.innerHTML = `<header><button class="ghost" id="back">←</button><h1 id="pname"></h1><button class="pri" id="export">내보내기</button></header>
  <div class="stage"><canvas id="cv" width="540" height="960"></canvas></div>
  <div class="transport"><button id="play">▶</button><input type="range" id="seek" min="0" max="1000" value="0"><span class="mut" id="time"></span></div>
  <div class="strip" id="strip"></div>
  <div class="tools">
    <button data-tool="scene"><i>🎞</i>장면 편집</button><button data-tool="script"><i>📝</i>대본</button>
    <button data-tool="image"><i>🖼</i>이미지</button><button data-tool="style"><i>🎨</i>스타일</button><button data-tool="audio"><i>🎵</i>오디오</button>
  </div>`;
  $('#pname').textContent = p.name;
  backStack.push(closeEditor);
  $('#back').onclick = goBack;
  $('#pname').onclick = () => renameSheet(p, () => { $('#pname').textContent = p.name; });
  $('#export').onclick = exportSheet;
  $('#play').onclick = () => (E.playing ? pause() : play());
  // 미리보기: 탭 = 재생/정지, 스티커를 끌면 이동, 스티커를 탭하면 편집
  const cv = $('#cv'); let drag = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  cv.onpointerdown = (e) => {
    const q = pos(e), s = p.scenes.length && p.scenes[sceneAt(p, E.t).i];
    const k = !E.playing && s && [...(s.stickers || [])].reverse().find((k) => Math.hypot((q.x - k.x) * W, (q.y - k.y) * H) < k.size * 0.6);
    drag = { k, s, q, moved: false };
    if (k) cv.setPointerCapture(e.pointerId);
  };
  cv.onpointermove = (e) => {
    if (!drag || !drag.k) return;
    const q = pos(e);
    if (!drag.moved && Math.hypot(q.x - drag.q.x, q.y - drag.q.y) < 0.015) return;
    drag.moved = true;
    drag.k.x = Math.min(0.95, Math.max(0.05, q.x)); drag.k.y = Math.min(0.95, Math.max(0.05, q.y));
  };
  cv.onpointerup = cv.onpointercancel = () => {
    const d = drag; drag = null; if (!d) return;
    if (!d.k) return E.playing ? pause() : play();
    if (d.moved) changed(); else stickerEdit(d.s, d.k);
  };
  $('#seek').oninput = (e) => { pause(); E.t = e.target.value / 1000 * totalDuration(p); E.sel = sceneAt(p, E.t).i; markSel(); };
  app.querySelector('.tools').onclick = (e) => {
    const b = e.target.closest('[data-tool]'); if (!b) return;
    ({ scene: sceneSheet, script: scriptSheet, image: imageSheet, style: styleSheet, audio: audioSheet })[b.dataset.tool]();
  };
  $('#strip').onclick = (e) => {
    const b = e.target.closest('.sc'); if (!b) return;
    if (b.dataset.add !== undefined) return addSheet();
    const i = +b.dataset.i;
    if (i === E.sel && !E.playing) return sceneSheet();
    pause(); E.sel = i; E.t = sceneStart(p, i) + Math.min(0.8, p.scenes[i].duration * 0.5); markSel();
  };
  const ids = new Set(p.scenes.map((s) => s.mediaId).filter(Boolean));
  await Promise.all([...ids].map(async (mid) => { try { const a = await loadAsset(mid); if (a) E.assets.set(mid, a); } catch (e) { console.warn(e); } }));
  if (cur !== E) return;
  if (p.scenes.length) E.t = Math.min(0.8, p.scenes[0].duration * 0.5); // 첫 자막이 보이는 지점에서 시작
  renderStrip();
  const ctx = $('#cv').getContext('2d');
  const loop = () => {
    if (cur !== E) return;
    requestAnimationFrame(loop);
    if (E.busy) return;
    const total = totalDuration(p);
    if (E.playing) {
      E.t = (performance.now() - E.t0) / 1000;
      if (E.t >= total) { E.t = total; pause(); E.onEnd && E.onEnd(); }
      const i = sceneAt(p, E.t).i; if (i !== E.sel) { E.sel = i; markSel(true); }
    }
    syncVideos(p, E.t, E.assets, E.playing);
    drawFrame(ctx, p, Math.min(E.t, Math.max(0, total - 0.001)), E.assets);
    if (!p.scenes.length) {
      ctx.fillStyle = '#888'; ctx.font = '48px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('아래 ＋ 를 눌러 장면을 추가하세요', W / 2, H / 2);
    }
    $('#time').textContent = `${fmt(E.t)} / ${fmt(total)}`;
    if (E.playing) $('#seek').value = total ? E.t / total * 1000 : 0;
  };
  loop();
}
function closeEditor() {
  const E = cur; if (!E) return;
  pause(); cur = null;
  for (const a of E.assets.values()) { if (a.kind === 'video') { a.src.pause(); URL.revokeObjectURL(a.src.src); } else a.src.close && a.src.close(); }
  E.actx && E.actx.close();
  clearTimeout(saveTo); db.put('projects', E.p).then(showHome);
}
let saveTo;
function changed({ audio = false, strip = true } = {}) {
  const E = cur; if (!E) return;
  E.p.updatedAt = Date.now();
  if (audio) E.mixDirty = true;
  E.sel = Math.max(0, Math.min(E.sel, E.p.scenes.length - 1));
  E.t = Math.min(E.t, totalDuration(E.p));
  if (strip) renderStrip();
  clearTimeout(saveTo); saveTo = setTimeout(() => db.put('projects', E.p), 400);
}
function renderStrip() {
  const E = cur, p = E.p, el = $('#strip');
  el.innerHTML = p.scenes.map((s, i) => `<button class="sc ${i === E.sel ? 'sel' : ''}" data-i="${i}"><canvas width="108" height="192"></canvas><span>${s.duration}s</span></button>`).join('') + '<button class="sc add" data-add>＋</button>';
  el.querySelectorAll('.sc[data-i]').forEach((b) => thumb($('canvas', b), p, p.scenes[+b.dataset.i], E.assets));
}
function markSel(scroll) {
  document.querySelectorAll('#strip .sc[data-i]').forEach((b) => {
    const on = +b.dataset.i === cur.sel; b.classList.toggle('sel', on);
    if (on && scroll) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  });
  const total = totalDuration(cur.p); $('#seek').value = total ? cur.t / total * 1000 : 0;
}
async function getMix() {
  const E = cur;
  if (E.mixDirty) { E.mix = await mixAudio(E.p, async (id) => (await db.get('media', id))?.blob); E.mixDirty = false; }
  return E.mix;
}
async function play(silent) {
  const E = cur; if (!E || E.playing || !E.p.scenes.length) return;
  if (E.t >= totalDuration(E.p) - 0.05) E.t = 0;
  if (!silent) {
    E.actx = E.actx || new AudioContext(); E.actx.resume();
    const mix = await getMix();
    if (cur !== E) return;
    if (mix) { E.node = E.actx.createBufferSource(); E.node.buffer = mix; E.node.connect(E.actx.destination); E.node.start(0, E.t); }
  }
  E.t0 = performance.now() - E.t * 1000; E.playing = true; $('#play').textContent = '⏸';
}
function pause() {
  const E = cur; if (!E) return;
  E.playing = false;
  if (E.node) { try { E.node.stop(); } catch {} E.node = null; }
  const b = $('#play'); if (b) b.textContent = '▶';
}

/* ───────── 장면 추가·편집 ───────── */
function addSheet() {
  const E = cur, p = E.p;
  const L = sheet('장면 추가', `<button class="big" data-act="media"><b>🖼 사진·영상 추가</b><span class="mut">여러 개 선택 가능</span></button><button class="big" data-act="text"><b>🔤 글자 장면 추가</b><span class="mut">배경색 위에 자막만 있는 장면</span></button>`);
  wire(L, {
    media: async () => {
      const files = await pickFiles('image/*,video/*', true); L.close();
      if (!files.length) return; toast('미디어를 불러오는 중…');
      await addMediaScenes(p, files, E.assets);
      E.sel = p.scenes.length - 1; E.t = sceneStart(p, E.sel); changed({ audio: true });
    },
    text: () => {
      L.close(); p.scenes.push(newScene({ text: '여기에 자막 입력', bg: p.scenes.length % (BGS.length - 1) }));
      E.sel = p.scenes.length - 1; E.t = sceneStart(p, E.sel) + 0.8; changed(); sceneSheet();
    },
  });
}
function sceneSheet() {
  const E = cur, p = E.p, s = p.scenes[E.sel];
  if (!s) return addSheet();
  pause();
  const vdur = s.mediaKind === 'video' ? (E.assets.get(s.mediaId)?.dur || 0) : 0;
  const L = sheet(`장면 ${E.sel + 1} 편집`, `
    <label>자막</label><textarea id="tx" rows="2" placeholder="자막을 입력하세요">${esc(s.text)}</textarea>
    <label>읽을 문장 (AI 음성용 · 비우면 자막을 읽음)</label><input type="text" id="nr" value="${esc(s.narration || '')}" placeholder="자막과 다르게 읽고 싶을 때만 입력">
    <label>길이 <b id="dv">${s.duration}</b>초</label><input type="range" id="du" min="1" max="20" step="0.5" value="${s.duration}">
    <label>자막 위치</label>${chips('textPos', [['top', '위'], ['center', '가운데'], ['bottom', '아래']], s.textPos)}
    <label>자막 효과</label>${chips('textAnim', [['pop', '팝'], ['fade', '페이드'], ['slide', '슬라이드'], ['type', '타자기'], ['none', '없음']], s.textAnim)}
    ${E.sel > 0 ? `<label>이 장면으로 넘어올 때</label>${chips('transition', [['', '기본'], ['fade', '페이드'], ['slide', '슬라이드'], ['zoom', '줌'], ['none', '없음']], s.transition || '')}` : ''}
    <label>화면 움직임</label>${chips('motion', [['zoomIn', '줌 인'], ['zoomOut', '줌 아웃'], ['panL', '← 이동'], ['panR', '이동 →'], ['none', '고정']], s.motion)}
    ${s.mediaId ? `<label>화면 맞춤</label>${chips('fit', [['cover', '꽉 채우기'], ['contain', '전체 보기(흐린 배경)']], s.fit)}` : `<label>배경색</label>${swatches('bg', BGS.map((c, i) => ({ v: i, css: `linear-gradient(135deg,${c[0]},${c[1]})` })), s.bg)}`}
    ${s.mediaKind === 'video' ? `<label>✂ 영상 시작 지점 <b id="tv">${(s.trimStart || 0).toFixed(1)}</b>초 (원본 ${vdur.toFixed(1)}초)</label><input type="range" id="tr" min="0" max="${Math.max(0, vdur - 0.5).toFixed(1)}" step="0.1" value="${s.trimStart || 0}">` : ''}
    ${s.mediaKind === 'video' ? `<label>영상 원본 소리</label>${chips('clipAudio', [['1', '켜기'], ['0', '끄기']], s.clipAudio ? '1' : '0')}` : ''}
    <label>스티커 (미리보기에서 끌어서 옮기고, 눌러서 수정)</label><div class="chips">${(s.stickers || []).map((k) => `<button data-act="stk" data-id="${k.id}">${k.e}</button>`).join('')}<button data-act="addStk">＋ 추가</button></div>
    <label>미디어</label><div class="row"><button data-act="media">${s.mediaId ? '교체' : '사진·영상 넣기'}</button>${s.mediaId ? '<button data-act="rm">제거</button>' : ''}<button data-act="prompt">📋 이미지 프롬프트</button></div>
    <label>장면</label><div class="row"><button data-act="left">◀ 앞으로</button><button data-act="right">뒤로 ▶</button><button data-act="split">나누기</button><button data-act="dup">복제</button><button class="danger" data-act="del">삭제</button></div>`);
  $('#tx', L.el).oninput = (e) => { s.text = e.target.value; if (!s.narration) dropTts(s); changed(); };
  $('#nr', L.el).oninput = (e) => { s.narration = e.target.value; dropTts(s); changed({ strip: false }); };
  $('#du', L.el).oninput = (e) => { s.duration = +e.target.value; $('#dv', L.el).textContent = s.duration; changed({ audio: true }); };
  const tr = $('#tr', L.el);
  if (tr) tr.oninput = () => {
    s.trimStart = +tr.value; $('#tv', L.el).textContent = s.trimStart.toFixed(1);
    // 남은 원본보다 장면이 길면 장면 길이를 줄인다
    const room = Math.max(0.5, Math.floor((vdur - s.trimStart) * 2) / 2);
    if (s.duration > room) { s.duration = room; $('#du', L.el).value = room; $('#dv', L.el).textContent = room; }
    E.t = sceneStart(p, E.sel); changed({ audio: true });
  };
  bindChips(L.el, (k, v) => {
    if (k === 'bg') s.bg = +v; else if (k === 'clipAudio') s.clipAudio = v === '1'; else s[k] = v;
    if (k === 'transition') E.t = sceneStart(p, E.sel);
    changed({ audio: k === 'clipAudio' });
    if (k === 'textAnim' || k === 'motion') { E.t = sceneStart(p, E.sel); }
  });
  const move = (d) => {
    const j = E.sel + d; if (j < 0 || j >= p.scenes.length) return;
    [p.scenes[E.sel], p.scenes[j]] = [p.scenes[j], p.scenes[E.sel]]; E.sel = j; E.t = sceneStart(p, j) + 0.8;
    changed({ audio: true }); $('h3 span', L.el).textContent = `장면 ${j + 1} 편집`;
  };
  wire(L, {
    left: () => move(-1), right: () => move(1),
    addStk: () => { L.close(); stickerPicker(s); },
    prompt: () => copyText(buildPrompt(p, E.sel), `장면 ${E.sel + 1} 프롬프트를 복사했어요`),
    stk: (b) => { L.close(); stickerEdit(s, s.stickers.find((k) => k.id === b.dataset.id)); },
    split: () => {
      // 재생 위치에서 장면을 둘로 나눈다 (영상 클립은 뒤쪽 조각이 이어서 재생됨)
      const at = Math.round((E.t - sceneStart(p, E.sel)) * 2) / 2;
      if (at < 0.5 || s.duration - at < 0.5) return toast('나눌 위치로 재생 막대를 옮긴 뒤 눌러 주세요 (앞뒤 0.5초 이상)');
      const rest = { ...s, id: uid(), duration: s.duration - at, ttsId: null };
      if (s.mediaKind === 'video') rest.trimStart = (s.trimStart || 0) + at;
      s.duration = at; p.scenes.splice(E.sel + 1, 0, rest);
      changed({ audio: true }); L.close(); toast('장면을 나눴어요');
    },
    dup: () => { p.scenes.splice(E.sel + 1, 0, { ...s, id: uid() }); E.sel++; changed({ audio: true }); L.close(); toast('장면을 복제했어요'); },
    del: () => { p.scenes.splice(E.sel, 1); changed({ audio: true }); E.t = p.scenes.length ? sceneStart(p, E.sel) : 0; L.close(); },
    rm: () => { s.mediaId = null; s.mediaKind = null; changed({ audio: true }); L.close(); },
    media: async () => {
      const [f] = await pickFiles('image/*,video/*'); if (!f) return;
      try {
        const m = await importFile(p, f); const a = await loadAsset(m.id); E.assets.set(m.id, a);
        s.mediaId = m.id; s.mediaKind = m.kind;
        if (m.kind === 'video') { s.duration = Math.max(1, Math.min(15, Math.round(a.dur * 2) / 2)); s.motion = 'none'; }
        changed({ audio: true }); L.close(); maybeAutoFx();
      } catch { toast('파일을 불러오지 못했어요'); }
    },
  });
}
const EMOJIS = '🔥 ✨ ❤️ 😍 😂 🤣 😱 🤔 👍 👏 🙌 💯 ⭐ 🎉 💡 📌 ✅ ❌ ⚠️ 👉 👇 👆 💰 🛒 🎁 🍽️ ☕ 🍰 ✈️ 🏠 🐶 🐱 💪 🏃 🎵 📷 💬 ❓ ❗ 🆕 🔔 🌸 🌈 ☀️ 🌙 💤 😎 🥳 😭 🙏'.split(' ');
function stickerPicker(s) {
  const L = sheet('스티커 고르기', `<div class="chips emo">${EMOJIS.map((e) => `<button data-act="pick" data-e="${e}">${e}</button>`).join('')}</div>`);
  wire(L, {
    pick: (b) => {
      (s.stickers = s.stickers || []).push({ id: uid(), e: b.dataset.e, x: 0.5, y: 0.32, size: 240, anim: 'bounce' });
      changed(); L.close(); toast('미리보기에서 스티커를 끌어 옮길 수 있어요');
    },
  });
}
function stickerEdit(s, k) {
  if (!k) return;
  const L = sheet(`스티커 ${k.e}`, `
    <label>크기</label><input type="range" id="ss" min="100" max="600" step="10" value="${k.size}">
    <label>움직임</label>${chips('anim', [['bounce', '통통'], ['pulse', '두근'], ['wiggle', '흔들'], ['spin', '회전'], ['none', '고정']], k.anim)}
    <div class="row" style="margin-top:14px"><button class="danger" data-act="del">스티커 삭제</button></div>`);
  $('#ss', L.el).oninput = (e) => { k.size = +e.target.value; changed(); };
  bindChips(L.el, (key, v) => { k.anim = v; changed(); });
  wire(L, { del: () => { s.stickers = s.stickers.filter((x) => x !== k); changed(); L.close(); } });
}
/* ───────── 장면별 이미지 (외부 AI로 그려서 넣기) ───────── */
// 복사: 앱(APK)에서는 네이티브 클립보드, 브라우저에서는 Clipboard API → 안 되면 옛 방식
async function copyText(text, msg = '복사했어요') {
  let ok = false;
  if (NATIVE && NATIVE.copy) { try { ok = NATIVE.copy(text); } catch {} }
  if (!ok) { try { await navigator.clipboard.writeText(text); ok = true; } catch {} }
  if (!ok) {
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t); t.select();
    try { ok = document.execCommand('copy'); } catch {}
    t.remove();
  }
  toast(ok ? msg : '복사하지 못했어요. 글을 길게 눌러 직접 복사해 주세요');
}
// ChatGPT 등에 그대로 붙여넣을 주문서. 장면 설명이 없으면 자막으로 대신 설명한다.
function buildPrompt(p, i) {
  const s = p.scenes[i];
  const what = (s.imgPrompt || '').trim() || `"${(s.narration || s.text || '').trim()}" 라는 내용을 한눈에 보여 주는 장면.`;
  return `세로형 숏폼 영상(인스타 릴스·유튜브 쇼츠)의 ${i + 1}번째 장면에 쓸 이미지를 1장 만들어 주세요.

[그림 내용]
${what}

[조건]
- 비율: 세로 9:16 (1080×1920)
- 화풍: ${(p.look || '').trim() || '선명하고 밝은 실사 사진 느낌'}
- 이미지 안에 글자·자막·로고·워터마크는 넣지 마세요.
- 화면 아래쪽 1/3에는 자막이 올라가니 주요 피사체는 가운데~위쪽에 두세요.`;
}
function buildAllPrompts(p) {
  return `세로형 숏폼 영상에 쓸 장면 이미지 ${p.scenes.length}장을 순서대로 1장씩 만들어 주세요. 모든 장면은 같은 화풍으로 통일하고, 같은 인물·물건은 같은 생김새를 유지해 주세요.

[공통 조건]
- 비율: 세로 9:16 (1080×1920)
- 화풍: ${(p.look || '').trim() || '선명하고 밝은 실사 사진 느낌'}
- 이미지 안에 글자·자막·로고·워터마크는 넣지 마세요.
- 화면 아래쪽 1/3에는 자막이 올라가니 주요 피사체는 가운데~위쪽에 두세요.

${p.scenes.map((s, i) => `[장면 ${i + 1}] ${(s.imgPrompt || '').trim() || `"${(s.narration || s.text || '').trim()}" 라는 내용을 한눈에 보여 주는 장면.`}`).join('\n')}`;
}
function imageSheet() {
  const E = cur, p = E.p;
  if (!p.scenes.length) return toast('먼저 장면을 추가해 주세요');
  pause();
  const done = p.scenes.filter((s) => s.mediaId).length, noIdea = p.scenes.some((s) => !(s.imgPrompt || '').trim());
  const L = sheet('🖼 장면별 이미지', `
    <div class="mut">① 📋 복사 → ② ChatGPT 등 이미지 AI에 붙여넣기 → ③ 만든 그림을 저장 → ④ 🖼 넣기. 모든 장면에 이미지가 들어가면 장면별 효과가 자동으로 적용돼요.</div>
    <label>공통 화풍 (모든 장면에 적용)</label><input type="text" id="lk" value="${esc(p.look || '')}" placeholder="예) 따뜻한 자연광의 실사 사진">
    <div class="row" style="margin-top:10px"><button data-act="ai">🤖 ${noIdea ? 'AI 장면 설명' : '설명 다시 쓰기'}</button><button data-act="all">📋 전체 복사</button></div>
    <div class="row" style="margin-top:8px"><button data-act="bulk">🖼 한꺼번에 넣기</button><button data-act="fx">✨ 효과 추천</button></div>
    <div class="sec" style="margin-top:14px">이미지 ${done} / ${p.scenes.length}장</div>
    ${p.scenes.map((s, i) => `<div class="imgc" data-i="${i}"><canvas width="90" height="160"></canvas><div class="b">
      <b>장면 ${i + 1}</b><span class="mut">${esc(s.text || '(자막 없음)')}</span>
      <textarea rows="3" data-p="${i}" placeholder="그림 설명 (비우면 자막으로 설명해요)">${esc(s.imgPrompt || '')}</textarea>
      <div class="row"><button data-act="copy" data-i="${i}">📋 복사</button><button class="${s.mediaId ? '' : 'pri'}" data-act="put" data-i="${i}">🖼 ${s.mediaId ? '교체' : '넣기'}</button></div>
    </div></div>`).join('')}`);
  L.el.querySelectorAll('.imgc canvas').forEach((c) => thumb(c, p, p.scenes[+c.closest('.imgc').dataset.i], E.assets));
  $('#lk', L.el).oninput = (e) => { p.look = e.target.value; changed({ strip: false }); };
  L.el.querySelectorAll('textarea[data-p]').forEach((t) => { t.oninput = () => { p.scenes[+t.dataset.p].imgPrompt = t.value; changed({ strip: false }); }; });
  const reopen = () => { L.close(); imageSheet(); };
  let busy = false;
  wire(L, {
    copy: (b) => copyText(buildPrompt(p, +b.dataset.i), `장면 ${+b.dataset.i + 1} 프롬프트를 복사했어요`),
    all: () => copyText(buildAllPrompts(p), `${p.scenes.length}개 장면 프롬프트를 한꺼번에 복사했어요`),
    put: async (b) => {
      const i = +b.dataset.i, [f] = await pickFiles('image/*,video/*'); if (!f) return;
      if (await putMedia(p.scenes[i], f)) { reopen(); maybeAutoFx(); }
    },
    bulk: async () => {
      const files = await pickFiles('image/*,video/*', true); if (!files.length) return;
      // 이미지 AI에서 받은 순서(= 장면 순서)대로 넣도록 저장된 시각 순으로 정렬해, 이미지가 없는 장면부터 채운다
      files.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }));
      let empty = p.scenes.filter((s) => !s.mediaId);
      if (!empty.length) empty = p.scenes.slice(); // 다 차 있으면 처음부터 교체
      toast('이미지를 넣는 중…');
      let n = 0;
      for (let k = 0; k < files.length && k < empty.length; k++) if (await putMedia(empty[k], files[k])) n++;
      reopen();
      toast(files.length > empty.length ? `${n}장을 넣었어요 (남는 ${files.length - empty.length}장은 뺐어요)` : `${n}장을 넣었어요`);
      setTimeout(maybeAutoFx, 600);
    },
    fx: async () => { await autoFx(p, E.assets); changed({ audio: true }); E.t = 0; reopen(); toast('✨ 장면별 효과를 추천해 적용했어요'); },
    ai: async (b) => {
      if (busy) return;
      if (!getKey()) { toast('먼저 Gemini API 키를 입력해 주세요'); return settingsSheet(); }
      busy = true; b.textContent = '작성 중…';
      try {
        const { generateImageIdeas } = await import('./ai.js');
        const out = await generateImageIdeas({ title: p.name, scenes: p.scenes });
        p.scenes.forEach((s, i) => { if (out.images[i]) s.imgPrompt = out.images[i]; });
        if (out.look) p.look = out.look;
        changed({ strip: false });
        if (L.el.isConnected) reopen();
        toast('장면 설명을 만들었어요');
      } catch (e) { console.warn(e); toast(e.message || 'AI 요청에 실패했어요'); busy = false; b.textContent = '🤖 AI 장면 설명'; }
    },
  });
}
// 장면 하나에 파일을 넣는다 (사진은 움직임 유지, 영상은 길이를 영상에 맞춤)
async function putMedia(s, f) {
  const E = cur, p = E.p;
  try {
    const m = await importFile(p, f); const a = await loadAsset(m.id); E.assets.set(m.id, a);
    s.mediaId = m.id; s.mediaKind = m.kind;
    if (m.kind === 'video') { s.duration = Math.max(1, Math.min(15, Math.round(a.dur * 2) / 2)); s.motion = 'none'; }
    else if (s.motion === 'none') s.motion = 'zoomIn';
    changed({ audio: true });
    return true;
  } catch (e) { console.warn(e); toast(`불러오지 못함: ${f.name}`); return false; }
}

/* ───────── 장면별 효과 자동 추천 ─────────
   모든 장면에 이미지가 처음 다 들어갔을 때 한 번 자동 적용한다 (이후에는 ✨ 버튼으로 다시 적용).
   그림의 밝기·가로세로 모양, 장면 위치(첫 장면 훅·마지막 행동 유도), 자막 내용, 영상 분위기를 보고 고른다. */
function maybeAutoFx() {
  const E = cur; if (!E) return;
  const p = E.p;
  if (p.autoFxDone || !p.scenes.length || p.scenes.some((s) => !s.mediaId)) return;
  autoFx(p, E.assets).then(() => {
    p.autoFxDone = true; changed({ audio: true }); E.t = 0;
    toast('✨ 모든 장면에 이미지가 들어가서 장면별 효과를 자동으로 적용했어요');
  });
}
function lookOf(a) {
  // 작게 줄여 평균 밝기(0~1)와 채도를 잰다
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(a.src, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data; let L = 0, S = 0;
    for (let k = 0; k < d.length; k += 4) {
      const mx = Math.max(d[k], d[k + 1], d[k + 2]), mn = Math.min(d[k], d[k + 1], d[k + 2]);
      L += (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) / 255; S += mx ? (mx - mn) / mx : 0;
    }
    return { lum: L / 256, sat: S / 256, wide: a.w / a.h > 0.75 };
  } catch { return { lum: 0.5, sat: 0.5, wide: false }; }
}
async function autoFx(p, assets) {
  const n = p.scenes.length, calm = /감성/.test(p.tone || '') || /감성|잔잔|따뜻|파스텔|빈티지|필름/.test(p.look || '');
  const fun = /유머/.test(p.tone || '');
  const info = p.scenes.map((s) => { const a = assets.get(s.mediaId); return a && a.kind === 'image' ? lookOf(a) : null; });
  let pan = 0;
  p.scenes.forEach((s, i) => {
    const t = (s.text || '') + ' ' + (s.narration || ''), last = i === n - 1, first = i === 0;
    const loud = /[!?！？]|충격|대박|꿀팁|비밀|진짜|절대|놓치|반전/.test(t);
    const im = info[i], prev = info[i - 1];
    // 화면 움직임: 영상은 그대로, 가로로 넓은 그림은 좌우 이동, 세로 그림은 줌 (첫 장면 줌 인, 마지막 줌 아웃)
    if (s.mediaKind === 'image') {
      if (first) s.motion = 'zoomIn';
      else if (last) s.motion = 'zoomOut';
      else if (im && im.wide) s.motion = pan++ % 2 ? 'panR' : 'panL';
      else s.motion = loud ? 'zoomIn' : (i % 2 ? 'zoomOut' : 'zoomIn');
    }
    // 장면 전환: 감성은 페이드, 밝기 차이가 크면 페이드로 부드럽게, 강조 장면은 줌, 나머지는 슬라이드·페이드 교대
    if (!first) {
      const jump = im && prev ? Math.abs(im.lum - prev.lum) > 0.28 : false;
      s.transition = last ? 'fade'
        : calm || jump ? 'fade'
        : loud || i === 1 ? 'zoom'
        : i % 2 ? 'slide' : 'fade';
    } else s.transition = '';
    // 자막 효과: 훅·강조는 팝, 감성·어두운 그림은 페이드, 긴 문장은 타자기, 나머지는 슬라이드
    const len = (s.text || '').replace(/\s/g, '').length;
    s.textAnim = first || loud || fun ? 'pop'
      : calm || (im && im.lum < 0.3) ? 'fade'
      : len >= 14 && s.duration >= 3 ? 'type'
      : last ? 'pop' : 'slide';
  });
  p.transition = calm ? 'fade' : p.transition;
}

// 자막 템플릿: 스타일·전환·자막 위치·효과를 한 번에 바꾼다
const TEMPLATES = {
  basic: ['기본', { caption: 'outline', color: '#ffffff', size: 84, font: 'gothic' }, 'fade', 'bottom', 'pop'],
  variety: ['예능', { caption: 'outline', color: '#ffe600', size: 104, font: 'gothic' }, 'zoom', 'center', 'pop'],
  mood: ['감성', { caption: 'shadow', color: '#ffffff', size: 68, font: 'serif' }, 'fade', 'center', 'fade'],
  news: ['뉴스', { caption: 'box', color: '#ffffff', size: 72, font: 'gothic' }, 'slide', 'bottom', 'slide'],
  neon: ['네온', { caption: 'neon', color: '#00e5ff', size: 88, font: 'gothic' }, 'zoom', 'center', 'fade'],
  marker: ['형광펜', { caption: 'highlight', color: '#ffe600', size: 80, font: 'gothic' }, 'slide', 'bottom', 'type'],
};
function scriptSheet() {
  const E = cur, p = E.p;
  const L = sheet('대본', `<div class="mut">한 줄이 한 장면의 자막이 됩니다. 장면보다 줄이 많으면 새 장면이 추가돼요.</div>
    <textarea id="sc" rows="10" style="margin-top:8px">${esc(p.scenes.map((s) => s.text.replace(/\n/g, ' ')).join('\n'))}</textarea>
    <label><input type="checkbox" id="ad"> 자막 길이에 맞춰 장면 길이 자동 조절 (영상 클립 제외)</label>
    <div class="row"><button class="pri" data-act="ok">적용</button></div>`);
  wire(L, {
    ok: () => {
      const lines = $('#sc', L.el).value.split('\n').map((x) => x.trim()), auto = $('#ad', L.el).checked;
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      lines.forEach((t, i) => {
        if (!p.scenes[i]) p.scenes.push(newScene({ bg: i % (BGS.length - 1), motion: MOTIONS[i % 4], duration: autoDur(t) }));
        const s = p.scenes[i]; s.text = t;
        if (auto && s.mediaKind !== 'video' && t) s.duration = autoDur(t);
      });
      for (let i = lines.length; i < p.scenes.length; i++) p.scenes[i].text = '';
      changed({ audio: true }); L.close();
    },
  });
}
function styleSheet() {
  const E = cur, p = E.p, st = p.style;
  const colors = ['#ffffff', '#ffe600', '#00e5ff', '#ff5c8a', '#7dff7a', '#ff9d2e'].map((c) => ({ v: c, css: c }));
  const L = sheet('스타일', `
    <label>템플릿 — 누르면 전체 분위기가 한 번에 바뀝니다</label>${chips('tpl', Object.entries(TEMPLATES).map(([k, v]) => [k, v[0]]), '')}
    <label>자막 스타일</label>${chips('caption', [['outline', '테두리'], ['box', '박스'], ['highlight', '형광펜'], ['neon', '네온'], ['shadow', '그림자']], st.caption)}
    <label>자막 색</label>${swatches('color', colors, st.color)}
    <label>글꼴</label>${chips('font', [['gothic', '고딕'], ['serif', '명조']], st.font)}
    <label>글자 크기 <b id="sv">${st.size}</b></label><input type="range" id="sz" min="48" max="140" step="4" value="${st.size}">
    <label>장면 전환</label>${chips('transition', [['fade', '페이드'], ['slide', '슬라이드'], ['zoom', '줌'], ['none', '없음']], p.transition)}
    <label>모든 장면에 일괄 적용 — 자막 위치</label>${chips('all.textPos', [['top', '위'], ['center', '가운데'], ['bottom', '아래']], '')}
    <label>모든 장면에 일괄 적용 — 자막 효과</label>${chips('all.textAnim', [['pop', '팝'], ['fade', '페이드'], ['slide', '슬라이드'], ['type', '타자기'], ['none', '없음']], '')}`);
  wire(L, {});
  $('#sz', L.el).oninput = (e) => { st.size = +e.target.value; $('#sv', L.el).textContent = st.size; changed(); };
  bindChips(L.el, (k, v) => {
    if (k === 'tpl') {
      const [, style, tr, pos, anim] = TEMPLATES[v];
      Object.assign(st, style); p.transition = tr; p.scenes.forEach((x) => { x.transition = ''; });
      p.scenes.forEach((s) => { s.textPos = pos; s.textAnim = anim; });
      changed(); L.close(); styleSheet(); return;
    }
    if (k === 'transition') { p.transition = v; p.scenes.forEach((x) => { x.transition = ''; }); }
    else if (k.startsWith('all.')) p.scenes.forEach((s) => { s[k.slice(4)] = v; });
    else st[k] = v;
    changed();
  });
}
function audioSheet() {
  const E = cur, a = E.p.audio;
  pause();
  const L = sheet('오디오', `
    <label>내장 음악 — 앱이 직접 만드는 음악이라 저작권 걱정이 없어요</label>${chips('preset', [['', '없음'], ...Object.entries(TRACKS).map(([k, v]) => [k, v.name])], a.musicId ? '' : (a.musicPreset || ''))}
    <div class="row" style="margin-top:8px"><button data-act="listen">▶ 처음부터 들어보기</button></div>
    <label>내 음악 파일 ${a.musicId ? `— ${esc(a.musicName)}` : '(없음)'}</label>
    <div class="row"><button data-act="music">🎵 음악 파일 ${a.musicId ? '교체' : '선택'}</button>${a.musicId ? '<button data-act="rmMusic">제거</button>' : ''}</div>
    <label>음악 크기</label><input type="range" id="mv" min="0" max="1" step="0.05" value="${a.musicVol}">
    <label>내레이션 ${a.narrationId ? '(녹음됨)' : '(없음)'}</label>
    <div class="row"><button data-act="rec">🎙 ${a.narrationId ? '다시 녹음' : '녹음하기'}</button>${a.narrationId ? '<button data-act="rmNar">제거</button>' : ''}</div>
    <label>내레이션 크기</label><input type="range" id="nv" min="0" max="1.5" step="0.05" value="${a.narrationVol}">
    <label>AI 음성 ${E.p.scenes.some((s) => s.ttsId) ? `(장면 ${E.p.scenes.filter((s) => s.ttsId).length}개에 적용됨)` : '(없음)'}</label>
    <div class="row"><button data-act="tts">🗣 장면별 AI 음성 만들기</button>${E.p.scenes.some((s) => s.ttsId) ? '<button data-act="rmTts">제거</button>' : ''}</div>
    <div class="mut" style="margin-top:10px">음악은 영상 길이에 맞춰 이어지고 끝에서 자연스럽게 줄어듭니다. 내 음악 파일은 저작권이 허용된 음원만 사용하세요.</div>`);
  $('#mv', L.el).oninput = (e) => { a.musicVol = +e.target.value; changed({ audio: true, strip: false }); };
  $('#nv', L.el).oninput = (e) => { a.narrationVol = +e.target.value; changed({ audio: true, strip: false }); };
  const reopen = () => { L.close(); changed({ audio: true, strip: false }); audioSheet(); };
  bindChips(L.el, (k, v) => { a.musicPreset = v; a.musicId = null; a.musicName = ''; reopen(); });
  wire(L, {
    music: async () => {
      const [f] = await pickFiles('audio/*'); if (!f) return;
      a.musicId = await storeMedia(E.p, f, 'audio', f.name); a.musicName = f.name; a.musicPreset = ''; reopen();
    },
    rmMusic: () => { a.musicId = null; a.musicName = ''; reopen(); },
    rmNar: () => { a.narrationId = null; reopen(); },
    rec: () => { L.close(); recordNarration(); },
    listen: () => { L.close(); E.t = 0; play(); },
    tts: () => { L.close(); ttsSheet(); },
    rmTts: () => { E.p.scenes.forEach((s) => { s.ttsId = null; }); reopen(); },
  });
}
function dropTts(s) { if (s.ttsId) { s.ttsId = null; cur.mixDirty = true; } }
const TTS_STYLES = { slow: '차분하고 천천히 또박또박 말하기', normal: '', fast: '활기차고 조금 빠르게 말하기', hype: '신나고 빠르게, 에너지 넘치게 말하기' };
async function ttsSheet() {
  const E = cur, p = E.p;
  if (!getKey()) { toast('먼저 Gemini API 키를 입력해 주세요'); return settingsSheet(() => cur === E && ttsSheet()); }
  const targets = p.scenes.filter((s) => (s.narration || s.text).trim());
  if (!targets.length) return toast('자막이 있는 장면이 없어요');
  const ai = await import('./ai.js');
  let style = p.audio.ttsStyle || 'normal', busy = false;
  const L = sheet('🗣 AI 음성 만들기', `
    <label>목소리</label><select id="vc">${ai.VOICES.map((v) => `<option ${v === p.audio.ttsVoice ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label>말투</label>${chips('style', [['slow', '차분하게'], ['normal', '보통'], ['fast', '활기차게'], ['hype', '신나게']], style)}
    <label><input type="checkbox" id="fit" checked> 장면 길이를 음성 길이에 맞추기 (영상 클립 제외)</label>
    <div class="mut" id="tst" style="margin:10px 0">자막이 있는 장면 ${targets.length}개의 음성을 만듭니다. 무료 등급은 요청 간격 제한이 있어 장면이 많으면 시간이 걸릴 수 있어요.</div>
    <div class="row"><button class="pri" data-act="go">음성 만들기</button></div>`);
  bindChips(L.el, (k, v) => { style = v; });
  wire(L, {
    go: async (btn) => {
      const voice = $('#vc', L.el).value, fit = $('#fit', L.el).checked;
      if (busy) return; busy = true; btn.disabled = true;
      const dec = new OfflineAudioContext(1, 1, 48000);
      const say = (m) => { if (L.el.isConnected) $('#tst', L.el).textContent = m; };
      try {
        for (let i = 0; i < targets.length; i++) {
          say(`음성 만드는 중… ${i + 1} / ${targets.length}`);
          const s = targets[i];
          const blob = await ai.synth((s.narration || s.text).replace(/\n/g, ' '), voice, TTS_STYLES[style], () => say(`사용 한도에 걸려 20초 기다리는 중… (${i + 1} / ${targets.length})`));
          if (cur !== E || !L.el.isConnected) return;
          const dur = (await dec.decodeAudioData(await blob.arrayBuffer())).duration;
          s.ttsId = await storeMedia(p, blob, 'audio', 'tts');
          if (fit && s.mediaKind !== 'video') s.duration = Math.max(1.5, Math.ceil((dur + 0.4) * 2) / 2);
        }
        p.audio.ttsVoice = voice; p.audio.ttsStyle = style;
        E.t = 0; changed({ audio: true }); L.close(); toast('AI 음성을 넣었어요. ▶ 로 들어보세요');
      } catch (e) { console.warn(e); changed({ audio: true }); busy = false; btn.disabled = false; say(e.message || '음성 합성에 실패했어요'); }
    },
  });
}
async function recordNarration() {
  const E = cur, p = E.p;
  if (!p.scenes.length) return toast('먼저 장면을 추가해 주세요');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('마이크 권한이 필요합니다'); }
  const rec = new MediaRecorder(stream), parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const L = openLayer(`<div class="sheet"><h3><span>🔴 녹음 중 — 화면의 자막을 보며 읽어 주세요</span></h3><div class="row"><button class="pri" data-act="stop">녹음 종료</button></div></div>`, 'clear');
  L.el.style.background = 'transparent';
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    if (cur !== E) return;
    p.audio.narrationId = await storeMedia(p, new Blob(parts, { type: rec.mimeType }), 'audio', 'narration');
    E.t = 0; changed({ audio: true, strip: false }); toast('내레이션을 저장했어요');
  };
  L.onClose = () => { E.onEnd = null; pause(); if (rec.state !== 'inactive') rec.stop(); };
  wire(L, { stop: () => L.close() });
  E.t = 0; E.onEnd = () => L.close();
  rec.start(); play(true);
}

/* ───────── 내보내기 ───────── */
function exportSheet() {
  const E = cur, p = E.p;
  if (!p.scenes.length) return toast('먼저 장면을 추가해 주세요');
  pause();
  let res = 1080, ctl = null, url = null, lock = null;
  const L = sheet('내보내기', `<div id="ex">
    <label>화질</label>${chips('res', [['1080', '1080×1920 (권장)'], ['720', '720×1280 (빠름)']], res)}
    <div class="mut" style="margin:12px 0">길이 ${fmt(totalDuration(p))} · 30fps · 이 기기에서 바로 영상 파일을 만듭니다. 완료될 때까지 화면을 켜 두세요.</div>
    <div class="row"><button class="pri" data-act="go">영상 만들기</button></div></div>`);
  bindChips(L.el, (k, v) => { res = +v; });
  L.onClose = () => { ctl && ctl.abort(); url && URL.revokeObjectURL(url); lock && lock.release().catch(() => {}); E.busy = false; };
  wire(L, {
    go: async () => {
      const box = $('#ex', L.el);
      box.innerHTML = `<div class="bar"><div id="pb"></div></div><div class="mut" id="pt">준비 중…</div><div class="row" style="margin-top:12px"><button data-x>취소</button></div>`;
      ctl = new AbortController(); E.busy = true;
      try { lock = await navigator.wakeLock?.request('screen'); } catch {}
      NATIVE && NATIVE.keepAwake(true);
      try {
        const audioBuf = await getMix();
        const w = res, h = res * 16 / 9;
        const t0 = performance.now();
        const out = await exportVideo({
          p, assets: E.assets, audioBuf, w, h, fps: 30, bitrate: res === 1080 ? 8e6 : 4e6, signal: ctl.signal,
          onProgress: (q) => { const b = $('#pb', L.el); if (b) { b.style.width = `${q * 100}%`; $('#pt', L.el).textContent = `영상 만드는 중… ${Math.round(q * 100)}%`; } },
        });
        const name = `${p.name.replace(/[\\/:*?"<>|]/g, '_')}.${out.ext}`;
        const file = new File([out.blob], name, { type: out.blob.type });
        url = URL.createObjectURL(out.blob);
        const canShare = NATIVE || (navigator.canShare && navigator.canShare({ files: [file] }));
        box.innerHTML = `<div class="result"><video src="${url}" controls playsinline loop></video></div>
          <div class="mut" style="margin:8px 0">✅ 완성 · ${(out.blob.size / 1048576).toFixed(1)}MB · ${out.ext.toUpperCase()} · ${out.method} · ${((performance.now() - t0) / 1000).toFixed(1)}초 소요</div>
          <div class="row">${canShare ? '<button class="pri" data-act="share">📤 인스타·유튜브로 공유</button>' : ''}${NATIVE ? '<button data-act="nsave">💾 갤러리에 저장</button>' : `<a class="dl" href="${url}" download="${esc(name)}" style="text-decoration:none"><button style="width:100%" class="${canShare ? '' : 'pri'}">💾 기기에 저장</button></a>`}</div>
          ${p.post ? `<label>업로드용 설명글</label><textarea id="post" rows="4" readonly>${esc(`${p.post.description}\n\n${p.post.hashtags.join(' ')}`)}</textarea><div class="row" style="margin-top:6px"><button data-act="copy">📋 설명글 복사</button></div>` : ''}
          ${out.ext === 'webm' ? '<div class="mut" style="margin-top:8px">이 브라우저는 MP4 인코딩을 지원하지 않아 WebM으로 저장됩니다. 최신 Chrome에서 MP4로 만들어집니다.</div>' : ''}`;
        const native = (action) => async () => { toast('파일을 준비하는 중…'); try { toast(await nativeFile(out.blob, name, action)); } catch (e) { toast('실패했어요: ' + (e.message || e)); } };
        L.share = NATIVE ? native('share') : () => navigator.share({ files: [file], title: p.name }).catch(() => {});
        L.nsave = native('save');
      } catch (e) {
        if (e.name !== 'AbortError') { console.error(e); box.innerHTML = `<div class="mut">내보내기에 실패했어요: ${esc(e.message || e)}</div>`; }
      } finally {
        E.busy = false; ctl = null; lock && lock.release().catch(() => {}); lock = null;
        NATIVE && NATIVE.keepAwake(false);
      }
    },
    share: () => L.share && L.share(),
    nsave: () => L.nsave && L.nsave(),
    copy: () => copyText($('#post', L.el).value, '설명글을 복사했어요'),
  });
}

/* ───────── 시작 ───────── */
showHome();
if (!NATIVE && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

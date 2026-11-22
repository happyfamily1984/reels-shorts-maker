import * as db from './db.js';
import { W, H, BGS, CAP_Y, SUB_Y, charPos, drawFrame, drawScene, syncVideos, mixAudio, talkEnvelope, totalDuration, sceneStart, sceneAt } from './render.js';
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
// 그림 아래쪽에 자막용으로 비워 둔 단색 띠가 있으면 그 높이를 돌려준다 (가로줄마다 색이 고르고 서로 비슷한 구간)
function bottomBand(bmp) {
  try {
    const w = 48, h = Math.max(8, Math.round(bmp.height / bmp.width * w));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const row = (y) => { let r = 0, gg = 0, bb = 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; r += d[i]; gg += d[i + 1]; bb += d[i + 2]; } return [r / w, gg / w, bb / w]; };
    const flat = (y, m) => { for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; if (Math.abs(d[i] - m[0]) + Math.abs(d[i + 1] - m[1]) + Math.abs(d[i + 2] - m[2]) > 30) return false; } return true; };
    const base = row(h - 2); let y = h - 1;
    while (y > h * 0.4) { const m = row(y); if (!flat(y, m) || Math.abs(m[0] - base[0]) + Math.abs(m[1] - base[1]) + Math.abs(m[2] - base[2]) > 24) break; y--; }
    const band = h - 1 - y;
    return band > h * 0.08 ? Math.floor(band / h * bmp.height) - 2 : 0;
  } catch { return 0; }
}
async function loadAsset(id) {
  const rec = await db.get('media', id); if (!rec) return null;
  if (rec.kind === 'image') {
    let b = await createImageBitmap(rec.blob);
    const cut = bottomBand(b);
    if (cut) { const c2 = await createImageBitmap(b, 0, 0, b.width, b.height - cut); b.close(); b = c2; }
    return { kind: 'image', src: b, w: b.width, h: b.height };
  }
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
    <div id="chars"></div>
    ${ps.length ? `<div class="sec">내 영상 ${ps.length}개</div>` + ps.map((p) => `<div class="proj" data-id="${p.id}"><canvas width="108" height="192"></canvas><div class="info"><b>${esc(p.name)}</b><span class="mut">장면 ${p.scenes.length}개 · ${fmt(totalDuration(p))} · ${new Date(p.updatedAt).toLocaleDateString('ko-KR')}</span></div><button class="ghost" data-menu>⋯</button></div>`).join('') : '<div class="empty"><div class="pod"><img src="icons/art.webp" alt=""></div><b>아직 만든 영상이 없어요.</b><span>아래 버튼으로 시작해 보세요.</span></div>'}
  </div>
  <button class="pri fab" id="new">＋ 새 영상 만들기</button>`;
  $('#new').onclick = newSheet;
  homeChars();
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
async function aiSheet(create, preChar) {
  if (!getKey()) { toast('먼저 Gemini API 키를 입력해 주세요'); return settingsSheet(() => aiSheet(create, preChar)); }
  let tone = '정보 전달', seconds = 30, busy = false;
  const chars = (await db.all('characters')).sort((a, b) => b.updatedAt - a.updatedAt);
  const allProjects = await db.all('projects');
  let charId = preChar ? preChar.id : '';
  const prevOf = (id) => allProjects.filter((p) => p.char && p.char.id === id).sort((a, b) => a.createdAt - b.createdAt);
  const L = sheet('🤖 AI로 만들기', `
    ${chars.length ? `<label>진행 캐릭터</label>${chips('char', [['', '없음'], ...chars.map((c) => [c.id, esc(c.name)])], charId)}
    <label id="srl" style="display:none"><input type="checkbox" id="sr" checked> <span id="srt"></span></label>
    <label id="tkl" style="display:none"><input type="checkbox" id="tk" checked> 첫 장면과 마지막 장면은 캐릭터가 직접 말하기</label>` : ''}
    <label>어떤 영상을 만들까요?</label><textarea id="tp" rows="3" placeholder="예) 자취생을 위한 5분 계란 요리 3가지"></textarea>
    <label>분위기</label>${chips('tone', [['정보 전달', '정보'], ['유머러스', '유머'], ['감성적', '감성'], ['제품·가게 홍보', '홍보'], ['동기부여', '동기부여']], tone)}
    <label>길이</label>${chips('seconds', [[15, '15초'], [30, '30초'], [45, '45초'], [60, '60초']], seconds)}
    <div class="row" style="margin-top:14px"><button class="pri" data-act="ok">대본 만들기</button></div>`);
  const series = () => {
    const box = $('#srl', L.el); if (!box) return;
    const n = charId ? prevOf(charId).length : 0;
    box.style.display = n ? '' : 'none';
    const c = chars.find((x) => x.id === charId); $('#tkl', L.el).style.display = c && c.face ? '' : 'none';
    $('#srt', L.el).textContent = `이 캐릭터의 지난 영상 ${n}개에 이어지는 다음 편으로 만들기`;
  };
  series();
  bindChips(L.el, (k, v) => { if (k === 'tone') tone = v; else if (k === 'char') { charId = v; series(); } else seconds = +v; });
  wire(L, {
    ok: async (btn) => {
      const topic = $('#tp', L.el).value.trim();
      const ch = chars.find((c) => c.id === charId) || null;
      const previous = ch && $('#sr', L.el)?.checked ? prevOf(ch.id).slice(-5).map((p) => `${p.name} — ${p.scenes.map((s) => s.text).filter(Boolean).slice(0, 4).join(' / ')}`) : [];
      if (!topic) return toast('주제를 입력해 주세요');
      if (busy) return; busy = true; btn.textContent = 'AI가 대본을 쓰는 중…';
      try {
        const { generateScript } = await import('./ai.js');
        const out = await generateScript({ topic, tone, seconds, character: ch, previous });
        if (!L.el.isConnected) return;
        const p = newProject((out.title || topic).slice(0, 30));
        p.post = { description: out.description || '', hashtags: out.hashtags || [] };
        p.look = out.look || ''; p.tone = tone;
        if (ch) {
          p.char = charOf(ch); p.audio.ttsVoice = ch.voice;
        }
        p.scenes = out.scenes.map((sc, i) => newScene({
          text: sc.caption, narration: sc.narration || '', imgPrompt: sc.image || '', moveText: sc.motion || '',
          textPos: 'top',
          duration: autoDur(sc.narration || sc.caption), bg: i % (BGS.length - 1), motion: MOTIONS[i % 4],
        }));
        if (ch && ch.face && $('#tk', L.el)?.checked) { p.scenes[0].talk = true; if (p.scenes.length > 2) p.scenes[p.scenes.length - 1].talk = true; }
        if (ch) autoPoses(p);
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
  $('#play').onclick = togglePlay;
  // 예전 프로젝트: 스티커 기능 삭제, 대사(내레이션)가 있으면 대사 자막을 아래에 켜고 큰 자막은 위로 올린다
  let mig = false;
  p.scenes.forEach((s) => { if (s.stickers) { delete s.stickers; mig = true; } });
  if (p.subtitle === undefined) {
    p.subtitle = p.scenes.some((s) => (s.narration || '').trim());
    if (p.subtitle) p.scenes.forEach((s) => { if (s.textPos === 'bottom') s.textPos = 'top'; });
    mig = true;
  }
  if (p.char && !p.char.v2) { p.char.v2 = true; p.char.show = false; mig = true; }
  if (p.char && !p.char.v3) { p.char.v3 = true; p.char.side = 'left'; p.char.scale = 1; mig = true; }
  // 2.1의 높이 슬라이더가 스크롤 중 실수로 움직였을 수 있어 자막 높이를 한 번 기본값으로
  if (!p.style.v4) { p.style.v4 = true; delete p.style.capY; delete p.style.subY; mig = true; }
  if (mig) db.put('projects', p);
  warmMix();
  // 미리보기 탭 = 재생/정지
  $('#cv').onclick = togglePlay;
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
  if (p.char && p.char.imageId) ids.add(p.char.imageId);
  await Promise.all([...ids].map(async (mid) => { try { const a = await loadAsset(mid); if (a) E.assets.set(mid, a); } catch (e) { console.warn(e); } }));
  if (cur !== E) return;
  setupTalker(E);
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
  if (audio) { E.mixDirty = true; warmMix(); }
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
// 소리 합치기(믹싱)는 몇 초 걸릴 수 있다. 한 번에 하나만 돌리고, 결과는 바뀌기 전까지 다시 쓴다.
// 버튼을 여러 번 눌러도 믹싱이 겹치거나 소리가 여러 개 재생되지 않게 한다.
function getMix() {
  const E = cur;
  if (!E.mixDirty) return E.mixP || Promise.resolve(E.mix);
  E.mixDirty = false;
  const gen = E.mixGen = (E.mixGen || 0) + 1; // 믹싱 도중 또 바뀌면 늦게 끝난 옛 결과는 버린다
  const blobOf = async (id) => (await db.get('media', id))?.blob;
  E.mixP = mixAudio(E.p, blobOf)
    .then(async (m) => {
      const env = E.p.char ? await talkEnvelope(E.p, blobOf).catch(() => null) : null;
      if (gen === E.mixGen) { E.mix = m; E.assets.talk = env; }
      return m;
    })
    .catch((e) => { console.warn(e); E.mixDirty = true; return null; })
    .finally(() => { if (gen === E.mixGen) E.mixP = null; });
  return E.mixP;
}
// 편집이 멈추면 미리 믹싱해 둬서, 재생을 누르면 바로 소리가 나게 한다
function warmMix() {
  const E = cur; if (!E) return;
  clearTimeout(E.warmTo);
  E.warmTo = setTimeout(() => { if (cur === E && E.mixDirty && !E.playing) getMix(); }, 1200);
}
function togglePlay() {
  const E = cur; if (!E) return;
  // 소리 준비 중에 누르면 '재생 예약'을 켜고 끈다 → 마지막으로 누른 상태대로 된다
  if (E.loading) { E.cancel = !E.cancel; $('#play').textContent = E.cancel ? '▶' : '⏳'; return; }
  if (E.playing) pause(); else play();
}
async function play(silent) {
  const E = cur; if (!E || E.playing || E.loading || !E.p.scenes.length) return;
  if (E.t >= totalDuration(E.p) - 0.05) E.t = 0;
  stopNode(E);
  if (!silent) {
    E.actx = E.actx || new AudioContext(); E.actx.resume();
    if (E.mixDirty || E.mixP) {
      E.loading = true; $('#play').textContent = '⏳';
      toast('소리를 준비하는 중…');
    }
    const mix = await getMix();
    if (cur !== E) return;
    const cancelled = E.cancel; E.loading = false; E.cancel = false;
    if (cancelled) { $('#play').textContent = '▶'; return; }
    stopNode(E);
    if (mix) { E.node = E.actx.createBufferSource(); E.node.buffer = mix; E.node.connect(E.actx.destination); E.node.start(0, E.t); }
  }
  E.t0 = performance.now() - E.t * 1000; E.playing = true; $('#play').textContent = '⏸';
}
function stopNode(E) { if (E.node) { try { E.node.stop(); } catch {} E.node.disconnect(); E.node = null; } }
function pause() {
  const E = cur; if (!E) return;
  if (E.loading) E.cancel = true; // 준비 중에 다시 누르면 재생 취소
  E.playing = false;
  stopNode(E);
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
    ${E.assets.talker ? `<label>장면 화면</label>${chips('talk', [['0', '🖼 그림·영상'], ['1', `🗣 ${esc(p.char.name)}가 말하기`]], s.talk ? '1' : '0')}` : ''}
    ${p.char && (p.char.poses || []).length ? `<label>${esc(p.char.name)}의 자세</label>${chips('pose', p.char.poses.map((x) => [x.key, poseLabel(x.key)]), s.pose || '')}` : ''}
    <label>큰 자막 (장면 제목)</label><textarea id="tx" rows="2" placeholder="자막을 입력하세요">${esc(s.text)}</textarea>
    <label>대사 (화면 아래 대사 자막 · AI 음성이 읽음 · 비우면 자막을 읽음)</label><textarea id="nr" rows="2" placeholder="대본 문장 전체">${esc(s.narration || '')}</textarea>
    <label>길이 <b id="dv">${s.duration}</b>초</label><input type="range" id="du" min="1" max="20" step="0.5" value="${s.duration}">
    <label>자막 위치</label>${chips('textPos', [['top', '위'], ['center', '가운데'], ['bottom', '아래']], s.textPos)}
    <label>자막 효과</label>${chips('textAnim', [['pop', '팝'], ['fade', '페이드'], ['slide', '슬라이드'], ['type', '타자기'], ['none', '없음']], s.textAnim)}
    ${E.sel > 0 ? `<label>이 장면으로 넘어올 때</label>${chips('transition', [['', '기본'], ['fade', '페이드'], ['slide', '슬라이드'], ['zoom', '줌'], ['none', '없음']], s.transition || '')}` : ''}
    <label>화면 움직임</label>${chips('motion', [['zoomIn', '줌 인'], ['zoomOut', '줌 아웃'], ['panL', '← 이동'], ['panR', '이동 →'], ['none', '고정']], s.motion)}
    ${s.mediaId ? `<label>화면 맞춤</label>${chips('fit', [['cover', '꽉 채우기'], ['contain', '전체 보기(흐린 배경)']], s.fit)}` : `<label>배경색</label>${swatches('bg', BGS.map((c, i) => ({ v: i, css: `linear-gradient(135deg,${c[0]},${c[1]})` })), s.bg)}`}
    ${s.mediaKind === 'video' ? `<label>✂ 영상 시작 지점 <b id="tv">${(s.trimStart || 0).toFixed(1)}</b>초 (원본 ${vdur.toFixed(1)}초)</label><input type="range" id="tr" min="0" max="${Math.max(0, vdur - 0.5).toFixed(1)}" step="0.1" value="${s.trimStart || 0}">` : ''}
    ${s.mediaKind === 'video' ? `<label>영상 원본 소리</label>${chips('clipAudio', [['1', '켜기'], ['0', '끄기']], s.clipAudio ? '1' : '0')}` : ''}
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
    if (k === 'bg') s.bg = +v; else if (k === 'clipAudio' || k === 'talk') s[k] = v === '1'; else s[k] = v;
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
    prompt: () => copyText(buildPrompt(p, E.sel), `장면 ${E.sel + 1} 프롬프트를 복사했어요`),
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
/* ───────── 캐릭터 ─────────
   전신 그림을 저장해 두고 여러 영상에서 진행자로 쓴다. 그림은 ChatGPT·Gemini 등에서 만들어 넣고,
   배경이 단색이면 기기에서 지운다(테두리에서 비슷한 색을 채워 나가며 투명하게). */
async function cutout(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h); bmp.close();
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  let removed = false;
  const transparent = border.filter((i) => d[i * 4 + 3] < 200).length > border.length * 0.5;
  if (!transparent) {
    // 테두리 색의 중앙값을 배경색으로 보고, 테두리 대부분이 그 색이면 배경을 지운다
    const med = (o) => border.map((i) => d[i * 4 + o]).sort((a, b) => a - b)[border.length >> 1];
    const bg = [med(0), med(1), med(2)];
    const dist = (i) => Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]);
    // 사진 스튜디오처럼 은은한 그라데이션 배경도 지우도록: 이웃 픽셀끼리 색이 거의 같으면 계속 배경으로 번져 나간다
    const near = (i, j) => Math.abs(d[i * 4] - d[j * 4]) + Math.abs(d[i * 4 + 1] - d[j * 4 + 1]) + Math.abs(d[i * 4 + 2] - d[j * 4 + 2]);
    if (border.filter((i) => dist(i) < 90).length > border.length * 0.6) {
      const seen = new Uint8Array(w * h), q = [];
      for (const i of border) if (dist(i) < 90) { seen[i] = 1; q.push(i); }
      while (q.length) {
        const i = q.pop(); d[i * 4 + 3] = 0;
        const x = i % w, y = (i / w) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j >= 0 && !seen[j] && near(i, j) < 10 && dist(j) < 200) { seen[j] = 1; q.push(j); }
        }
      }
      // 가장자리를 부드럽게: 지운 곳과 맞닿은 픽셀은 배경색에 가까운 만큼 반투명
      for (let i = 0; i < w * h; i++) {
        if (!d[i * 4 + 3]) continue;
        const x = i % w;
        if ((x > 0 && !d[(i - 1) * 4 + 3]) || (x < w - 1 && !d[(i + 1) * 4 + 3]) || (i >= w && !d[(i - w) * 4 + 3]) || (i < w * (h - 1) && !d[(i + w) * 4 + 3])) {
          d[i * 4 + 3] = Math.min(255, Math.round(255 * Math.min(1, dist(i) / 140)));
        }
      }
      removed = true;
    }
  }
  // 투명한 여백을 잘라 캐릭터에 딱 맞춘다
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  g.putImageData(img, 0, 0);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  const blob = await new Promise((r) => o.toBlob(r, 'image/png'));
  return { blob, removed: removed || transparent };
}
function charPrompt(ch) {
  return `영상에 계속 등장할 진행자 캐릭터의 전신 이미지를 1장 만들어 주세요.

[캐릭터]
- 이름: ${ch.name || '(이름 없음)'}
- 외형: ${(ch.look || '').trim() || '(외형 설명을 적어 주세요)'}

[조건]
- 머리부터 발끝까지 전신이 모두 보이게, 정면을 보고 서 있는 자세 (팔은 몸 옆으로 자연스럽게)
- 배경은 아무것도 없는 단색 흰색 (투명 배경 PNG로 만들 수 있으면 투명으로)
- 바닥·그림자·글자·로고 없이 캐릭터만
- 세로 이미지, 캐릭터가 화면 가운데에 크게`;
}
// 아바타 사진 세트: 같은 인물의 여러 자세. 장면마다 어울리는 자세로 말하게 한다 (주문서 순서 = 넣는 순서)
const POSES = [
  ['hello', '인사', '한 손을 들어 손을 흔들며 밝게 웃는 모습'],
  ['explain', '설명', '한 손을 앞으로 펼쳐 내밀며 차분히 설명하는 모습'],
  ['point', '가리키기', '검지로 화면 옆 위쪽을 가리키며 말하는 모습'],
  ['thumb', '엄지척', '엄지를 들어 올리며 자신감 있게 웃는 모습'],
  ['think', '생각', '한 손을 턱에 대고 궁금한 듯 생각하는 표정'],
  ['wow', '놀람', '눈을 크게 뜨고 두 손을 펼친 놀란 표정'],
  ['smile', '웃음', '두 팔을 자연스럽게 내리고 활짝 웃는 얼굴'],
  ['serious', '진지', '두 손을 가슴 앞에 모으고 진지하게 말하는 표정'],
  ['count', '숫자', '손가락 하나를 세워 보이며 "첫째"를 말하는 모습'],
  ['bye', '감사', '두 손을 모으고 고개를 살짝 숙여 감사 인사하며 미소 짓는 모습'],
];
const poseLabel = (k) => (POSES.find((x) => x[0] === k) || [, k])[1];
function posePrompt(c, withPhoto) {
  return `같은 인물(캐릭터)의 아바타 사진 ${POSES.length}장을 만들어 주세요. 한 장에 모으지 말고 각각 별도의 이미지로 1장씩, 아래 번호 순서대로 총 ${POSES.length}장입니다.

[인물]
${withPhoto ? '- 첨부한 사진 속 인물과 똑같은 얼굴·머리·체형·옷으로 (다른 사람처럼 바뀌지 않게)\n' : ''}- 이름: ${c.name || '(이름 없음)'}
- 외형: ${(c.look || '').trim() || (withPhoto ? '첨부한 사진과 같게' : '(외형 설명을 적어 주세요)')}

[공통 조건 — 영상에서 입·눈을 움직이게 하므로 꼭 지켜 주세요]
- 세로 9:16, 허리 위 상반신이 화면 가운데에
- 얼굴은 카메라 정면을 보고 또렷하게, 손·머리카락·소품이 얼굴(특히 입)을 가리지 않게
- 입은 자연스럽게 다물거나 살짝 웃는 정도로
- ${POSES.length}장 모두 같은 옷·같은 조명·같은 단순한 연회색 배경
- 글자·로고·워터마크 없이

[${POSES.length}장]
${POSES.map(([, label, d], i) => `${i + 1}. ${label}: ${d}`).join('\n')}`;
}
// 입 모양 세트: 같은 사진에서 입(과 눈)만 바꾼 사진들. 넣는 순서 = 아래 순서
const MOUTHS = [['half', '반쯤 열림', "입을 반쯤 벌린 모습 ('어' 발음, 윗니가 살짝 보임)"], ['open', '크게 열림', "입을 크게 벌린 모습 ('아' 발음, 윗니와 혀가 보이고 턱이 살짝 내려감)"], ['round', '오 모양', "입술을 동그랗게 모은 모습 ('오' 발음)"], ['blink', '눈 감음', '입은 첨부 사진 그대로 다물고, 눈만 자연스럽게 감은 모습']];
const mouthPrompt = () => `첨부한 사진을 그대로 바탕으로, 입 모양(마지막 장은 눈)만 다른 사진 ${MOUTHS.length}장을 각각 따로 만들어 주세요. 말하는 영상의 입 움직임에 씁니다.

[꼭 지켜 주세요]
- 얼굴·머리·표정의 나머지·옷·자세·손·배경·조명·구도·인물 크기와 위치를 첨부 사진과 완전히 똑같이 유지 (확대·이동·다시 그리기 금지)
- 바꾸는 곳은 입(과 턱의 자연스러운 움직임)뿐, 마지막 장만 눈
- 이미지 비율과 해상도도 첨부 사진과 같게, 글자·로고 없이

[${MOUTHS.length}장]
${MOUTHS.map(([, l, d], i) => `${i + 1}. ${l}: ${d}`).join('\n')}`;
const charMediaIds = (c) => (c ? [c.imageId, c.photoId, ...Object.values(c.mouths || {}).map((m) => m.id), ...(c.poses || []).flatMap((x) => [x.id, ...Object.values(x.mouths || {}).map((m) => m.id)])].filter(Boolean) : []);
// target: 캐릭터 대표({photoId, face, mouths}) 또는 자세({id, face, mouths}). 저장은 캐릭터 화면의 저장 버튼으로.
function mouthSheet(target, photoId, title, pending, removed, done) {
  target.mouths = target.mouths || {};
  const L = sheet(`👄 입 모양 세트 — ${esc(title)}`, `
    <div class="mut">이 사진을 이미지 AI에 보내 <b>입만 바꾼 사진 ${MOUTHS.length}장</b>을 받으세요 (Gemini·ChatGPT처럼 사진 고치기를 잘하는 AI가 좋아요). 받은 순서대로 넣으면 말할 때 진짜 입 모양으로 바뀌어요.</div>
    <div class="poses" id="ml" style="grid-template-columns:repeat(5,1fr)"></div>
    <div class="row" style="margin-top:10px"><button data-act="send">📤 보내기</button><button data-act="copy">📋 복사</button><button class="pri" data-act="put">🖼 넣기</button></div>`);
  const draw = () => {
    const items = [['base', '바탕', { id: photoId }], ...MOUTHS.map(([k, l]) => [k, l, target.mouths[k]])];
    $('#ml', L.el).innerHTML = items.map(([k, l, m]) => `<div class="pose">${m ? `<img data-id="${m.id}" alt="">` : '<div class="ph0">?</div>'}<span>${l}</span>${m && k !== 'base' ? `<button data-act="rm" data-k="${k}">✕</button>` : ''}</div>`).join('');
    $('#ml', L.el).querySelectorAll('img[data-id]').forEach(async (im) => { im.src = await charImgUrl(im.dataset.id); });
  };
  draw();
  wire(L, {
    send: () => sendWithImage(mouthPrompt(), photoId),
    copy: () => copyText(mouthPrompt(), '입 모양 주문서를 복사했어요'),
    rm: (b) => { const m = target.mouths[b.dataset.k]; delete target.mouths[b.dataset.k]; if (!pending.delete(m.id)) removed.add(m.id); draw(); done(); },
    put: async () => {
      const files = await pickFiles('image/*', true); if (!files.length) return;
      files.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }));
      const empty = MOUTHS.map(([k]) => k).filter((k) => !target.mouths[k]);
      const slots = empty.length >= files.length ? empty : MOUTHS.map(([k]) => k);
      let ok = 0, bad = 0;
      for (let i = 0; i < files.length && i < slots.length; i++) {
        toast(`얼굴을 맞추는 중… ${i + 1} / ${Math.min(files.length, slots.length)}`);
        const blob = await shrinkPhoto(files[i], 1280), face = await faceOfBlob(blob);
        if (!face) { bad++; continue; }
        const id = uid(); await db.put('media', { id, blob, kind: 'image', name: 'mouth.jpg' }); pending.add(id);
        const old = target.mouths[slots[i]]; if (old && !pending.delete(old.id)) removed.add(old.id);
        target.mouths[slots[i]] = { id, face }; ok++;
      }
      draw(); done();
      toast(`${ok}장을 넣었어요${bad ? ` · 얼굴을 찾지 못한 ${bad}장은 뺐어요` : ''}. 캐릭터 화면에서 저장을 눌러 주세요`);
    },
  });
}
// 장면마다 어울리는 자세: 첫 장면 인사, 마지막 감사, 물음 → 생각, 감탄 → 놀람, 나머지는 돌아가며
function autoPoses(p) {
  const ps = p.char && p.char.poses; if (!ps || ps.length < 2) return;
  const has = (k) => ps.some((x) => x.key === k);
  const cycle = ['explain', 'point', 'thumb', 'smile', 'serious', 'count'].filter(has);
  let n = 0;
  p.scenes.forEach((s, i) => {
    const t = `${s.text || ''} ${s.narration || ''}`;
    let k = i === 0 && has('hello') ? 'hello'
      : i === p.scenes.length - 1 && p.scenes.length > 2 && has('bye') ? 'bye'
      : /[?？]|왜|어떻게|뭘까|무엇/.test(t) && has('think') ? 'think'
      : /[!！]|놀라|충격|대박|반전/.test(t) && has('wow') ? 'wow'
      : /첫째|첫 번째|하나|둘째|두 번째|셋째|세 번째|넷째|다섯/.test(t) && has('count') ? 'count'
      : cycle.length ? cycle[n++ % cycle.length] : ps[0].key;
    s.pose = k;
  });
}
const charUrls = new Map(); // 캐릭터 그림 미리보기 주소 (다시 그릴 때 재사용)
async function charImgUrl(imageId) {
  if (!imageId) return '';
  if (!charUrls.has(imageId)) { const r = await db.get('media', imageId); if (!r) return ''; charUrls.set(imageId, URL.createObjectURL(r.blob)); }
  return charUrls.get(imageId);
}
async function homeChars() {
  const cs = (await db.all('characters')).sort((a, b) => b.updatedAt - a.updatedAt);
  const box = $('#chars'); if (!box) return;
  box.innerHTML = `<div class="sec">내 캐릭터 ${cs.length ? cs.length + '명' : ''}</div><div class="chars">${cs.map((c) => `<button class="char" data-id="${c.id}"><div class="ph"><img alt=""></div><b>${esc(c.name || '이름 없음')}</b></button>`).join('')}<button class="char add" data-new><div class="ph">＋</div><b>새 캐릭터</b></button></div>`;
  box.querySelectorAll('.char[data-id]').forEach(async (b) => {
    const c = cs.find((x) => x.id === b.dataset.id); b.onclick = () => charSheet(c);
    const u = await charImgUrl(c.imageId); if (u) $('img', b).src = u; else $('.ph', b).textContent = '🧑';
  });
  $('[data-new]', box).onclick = () => charSheet(null);
}
async function charSheet(orig) {
  const c = orig ? { ...orig } : { id: uid(), name: '', look: '', persona: '', voice: 'Kore', imageId: null, createdAt: Date.now() };
  const { VOICES } = await import('./ai.js');
  const projects = orig ? (await db.all('projects')).filter((p) => p.char && p.char.id === c.id) : [];
  let pendingImage = null, pendingPhoto = null; // 저장 전에 넣은 그림 (저장하지 않고 닫으면 버린다)
  c.poses = (c.poses || []).slice();
  const pendingPoses = new Set(), removedPoses = new Set();
  const L = sheet(orig ? `🧑 ${esc(c.name || '캐릭터')}` : '🧑 새 캐릭터', `
    <div class="charimg"><img id="ci" alt="" style="display:none"><span id="cn" class="mut">아직 전신 그림이 없어요</span></div>
    <label>어떤 캐릭터인가요? (짧게 적고 AI에게 맡기기)</label><input type="text" id="cc" placeholder="예) 공부 습관을 알려 주는 귀여운 새싹 화분">
    <div class="row" style="margin-top:8px"><button data-act="ai">🤖 AI로 캐릭터 설정 만들기</button></div>
    <label>이름</label><input type="text" id="cnm" value="${esc(c.name)}" maxlength="20" placeholder="예) 새싹이">
    <label>외형 (그림 주문에 그대로 들어가요 · 자세할수록 매번 같은 모습)</label><textarea id="clk" rows="4" placeholder="화풍, 몸 형태, 얼굴, 색, 옷·소품">${esc(c.look)}</textarea>
    <label>성격·말투 (대본에 반영)</label><textarea id="cps" rows="2" placeholder="예) 밝고 다정한 존댓말">${esc(c.persona)}</textarea>
    <label>목소리 (AI 음성)</label><select id="cvc">${VOICES.map((v) => `<option ${v === c.voice ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label>전신 그림 — 보내기·복사로 이미지 AI에 주문한 뒤 받은 그림을 넣으세요 (단색 배경은 자동으로 지워요)</label>
    <div class="row"><button data-act="send">📤 보내기</button><button data-act="copy">📋 복사</button><button class="pri" data-act="put">🖼 ${c.imageId ? '교체' : '넣기'}</button></div>
    <label>입 모양 세트 — 말할 때 진짜 입 모양으로 바뀌게 (대표 사진)</label>
    <div class="row"><button data-act="mouth" id="mb">👄 입 모양 세트</button></div>
    <label>아바타 사진 세트 — 다양한 표정·몸짓 ${POSES.length}장 (장면마다 다른 자세로 말해 더 자연스러워요)</label>
    <div class="mut">자세 사진을 누르면 그 자세의 입 모양 세트도 만들 수 있어요. 📤 보내기로 Grok·ChatGPT·Gemini에 ${POSES.length}장을 한 번에 주문하고, 받은 사진들을 🖼 넣기로 한꺼번에 고르세요 (받은 순서대로 1~10번이 돼요). 위 그림이 있으면 그 얼굴로 만들도록 함께 보내요.</div>
    <div class="row" style="margin-top:8px"><button data-act="psend">📤 보내기</button><button data-act="pcopy">📋 복사</button><button class="pri" data-act="pput">🖼 넣기</button></div>
    <div class="poses" id="pl"></div>
    <div class="row" style="margin-top:16px"><button class="pri" data-act="save">저장</button>${orig ? '<button data-act="make">🎬 이 캐릭터로 영상</button>' : ''}</div>
    ${orig ? `<div class="mut" style="margin-top:8px">이 캐릭터로 만든 영상 ${projects.length}개</div><div class="row" style="margin-top:8px"><button class="danger" data-act="del">캐릭터 삭제</button></div>` : ''}`);
  const read = () => { c.name = $('#cnm', L.el).value.trim(); c.look = $('#clk', L.el).value.trim(); c.persona = $('#cps', L.el).value.trim(); c.voice = $('#cvc', L.el).value; };
  const showImg = async (id) => { const u = await charImgUrl(id); if (u) { $('#ci', L.el).src = u; $('#ci', L.el).style.display = ''; $('#cn', L.el).style.display = 'none'; } };
  showImg(c.imageId);
  const drawPoses = () => {
    const box = $('#pl', L.el);
    box.innerHTML = c.poses.map((x, i) => `<div class="pose"><img data-i="${i}" data-act="pmouth" alt=""><span>${i + 1}. ${esc(poseLabel(x.key))}${Object.keys(x.mouths || {}).length ? ' 👄' : ''}</span><button data-act="prm" data-i="${i}">✕</button></div>`).join('') || '<span class="mut">아직 사진 세트가 없어요</span>';
    const mb = $('#mb', L.el); if (mb) mb.textContent = `👄 입 모양 세트 (${Object.keys(c.mouths || {}).length} / ${MOUTHS.length})`;
    box.querySelectorAll('img[data-i]').forEach(async (im) => { im.src = await charImgUrl(c.poses[+im.dataset.i].id); });
  };
  drawPoses();
  L.onClose = () => { if (pendingImage) db.del('media', pendingImage); if (pendingPhoto) db.del('media', pendingPhoto); for (const id of pendingPoses) db.del('media', id); };
  const save = async () => {
    read();
    if (!c.name) { toast('이름을 입력해 주세요'); return false; }
    const old = orig && orig.imageId !== c.imageId ? [orig.imageId, orig.photoId].filter(Boolean) : [];
    old.push(...removedPoses);
    c.updatedAt = Date.now(); await db.put('characters', c); pendingImage = null; pendingPhoto = null; pendingPoses.clear(); removedPoses.clear();
    const used = new Set([...(await db.all('projects')).flatMap((p) => charMediaIds(p.char)), ...charMediaIds(c)]);
    for (const id of old) if (!used.has(id)) db.del('media', id);
    Object.assign(orig || {}, c);
    return true;
  };
  let busy = false;
  wire(L, {
    ai: async (b) => {
      const concept = $('#cc', L.el).value.trim() || $('#cnm', L.el).value.trim();
      if (!concept) return toast('어떤 캐릭터인지 짧게 적어 주세요');
      if (!getKey()) { toast('먼저 Gemini API 키를 입력해 주세요'); return settingsSheet(); }
      if (busy) return; busy = true; b.textContent = 'AI가 캐릭터를 만드는 중…';
      try {
        const { generateCharacter } = await import('./ai.js');
        const out = await generateCharacter(concept);
        if (!L.el.isConnected) return;
        if (out.name) $('#cnm', L.el).value = out.name;
        if (out.look) $('#clk', L.el).value = out.look;
        if (out.persona) $('#cps', L.el).value = out.persona;
        toast('설정을 채웠어요. 이제 📤 보내기로 전신 그림을 주문하세요');
      } catch (e) { toast(e.message || 'AI 요청에 실패했어요'); }
      busy = false; b.textContent = '🤖 AI로 캐릭터 설정 만들기';
    },
    send: () => { read(); sendText(charPrompt(c)); },
    psend: () => { read(); const ref = c.photoId || c.imageId; ref ? sendWithImage(posePrompt(c, true), ref) : sendText(posePrompt(c, false)); },
    pcopy: () => { read(); copyText(posePrompt(c, !!(c.photoId || c.imageId)), `사진 ${POSES.length}장 주문서를 복사했어요`); },
    pput: async () => {
      const files = await pickFiles('image/*', true); if (!files.length) return;
      files.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }));
      let ok = 0, bad = 0;
      for (const f of files) {
        toast(`얼굴을 찾는 중… ${ok + bad + 1} / ${files.length}`);
        try {
          const blob = await shrinkPhoto(f, 1280), face = await faceOfBlob(blob);
          if (!face) { bad++; continue; }
          const id = uid(); await db.put('media', { id, blob, kind: 'image', name: 'pose.jpg' }); pendingPoses.add(id);
          const used = new Set(c.poses.map((x) => x.key));
          const key = (POSES.find(([k], j) => j >= c.poses.length && !used.has(k)) || POSES.find(([k]) => !used.has(k)) || POSES[c.poses.length % POSES.length])[0];
          c.poses.push({ id, face, key }); ok++;
        } catch (e) { console.warn(e); bad++; }
      }
      // 대표 그림이 없으면 첫 사진을 대표로
      if (!c.imageId && c.poses[0]) { const r = await db.get('media', c.poses[0].id); const { blob } = await cutout(new File([r.blob], 'p.jpg', { type: 'image/jpeg' })); const id = uid(); await db.put('media', { id, blob, kind: 'image', name: 'character.png' }); pendingImage = id; c.imageId = id; c.photoId = c.poses[0].id; c.face = c.poses[0].face; showImg(id); }
      drawPoses();
      toast(`${ok}장을 넣었어요${bad ? ` · 얼굴을 찾지 못한 ${bad}장은 뺐어요 (정면 얼굴이 또렷해야 해요)` : ''}. 저장을 눌러 주세요`);
    },
    prm: (b) => {
      const [x] = c.poses.splice(+b.dataset.i, 1);
      for (const id of [x.id, ...Object.values(x.mouths || {}).map((m) => m.id)]) { if (pendingPoses.delete(id)) db.del('media', id); else removedPoses.add(id); }
      drawPoses();
    },
    mouth: () => {
      if (!c.photoId || !c.face) return toast('먼저 위에 얼굴이 보이는 대표 사진을 넣어 주세요');
      mouthSheet(c, c.photoId, '대표 사진', pendingPoses, removedPoses, drawPoses);
    },
    pmouth: (b) => { const x = c.poses[+b.dataset.i]; mouthSheet(x, x.id, `${+b.dataset.i + 1}. ${poseLabel(x.key)}`, pendingPoses, removedPoses, drawPoses); },
    copy: () => { read(); copyText(charPrompt(c), '전신 그림 프롬프트를 복사했어요'); },
    put: async () => {
      const [f] = await pickFiles('image/*'); if (!f) return;
      toast('배경을 지우고 얼굴을 찾는 중…');
      try {
        const { blob, removed } = await cutout(f);
        if (pendingImage) await db.del('media', pendingImage);
        if (pendingPhoto) await db.del('media', pendingPhoto);
        const id = uid(); await db.put('media', { id, blob, kind: 'image', name: 'character.png' });
        pendingImage = id; c.imageId = id; showImg(id);
        // 말하는 사진용: 배경을 지우지 않은 원본(긴 변 1600px)과 얼굴 점
        const photo = await shrinkPhoto(f), pid = uid();
        await db.put('media', { id: pid, blob: photo, kind: 'image', name: 'character-photo.jpg' });
        pendingPhoto = pid; c.photoId = pid;
        c.face = await faceOfBlob(photo);
        toast(`${removed ? '배경을 지웠어요' : '배경이 복잡해 그대로 넣었어요'}${c.face ? ' · 얼굴을 찾아 말하는 캐릭터로 쓸 수 있어요' : ' · 얼굴을 찾지 못해 말하기 기능은 못 써요'}. 저장을 눌러 주세요`);
      } catch (e) { console.warn(e); toast('그림을 불러오지 못했어요'); }
    },
    save: async () => { if (await save()) { L.close(); toast('캐릭터를 저장했어요'); homeChars(); } },
    make: async () => { if (!(await save())) return; L.close(); homeChars(); aiSheet(async (p) => { await db.put('projects', p); openEditor(p.id); }, c); },
    del: async () => {
      if (!(await confirmDlg(`"${c.name}" 캐릭터를 삭제할까요? 이미 만든 영상에는 그대로 남아요.`, '삭제', '취소'))) return;
      await db.del('characters', c.id);
      const used = new Set((await db.all('projects')).flatMap((p) => charMediaIds(p.char)));
      for (const id of charMediaIds(orig)) if (!used.has(id)) db.del('media', id);
      L.close(); homeChars();
    },
  });
}
// 프로젝트에 캐릭터 붙이기 (그림·말투는 복사해 둬서 캐릭터를 지워도 영상은 그대로)
const charOf = (c) => ({ id: c.id, imageId: c.imageId, photoId: c.photoId || null, face: c.face || null, mouths: { ...(c.mouths || {}) }, poses: (c.poses || []).map((x) => ({ ...x, mouths: { ...(x.mouths || {}) } })), name: c.name, look: c.look, persona: c.persona, voice: c.voice, show: !!c.face, side: 'left', scale: 1, v2: true, v3: true });
// 말하는 사진 준비: 사진 줄이기, 얼굴 찾기, 편집기에 말하는 엔진 붙이기
async function shrinkPhoto(file, max = 1600) {
  const bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}
async function faceOfBlob(blob) {
  try { const { findFace } = await import('./talk.js'); const bmp = await createImageBitmap(blob); const pts = await findFace(bmp); bmp.close(); return pts; }
  catch (e) { console.warn('얼굴 찾기 실패', e); return null; }
}
async function buildTalker(blob, face, mouths) {
  const T = await import('./talk.js');
  const base = await createImageBitmap(blob);
  const frames = {};
  for (const [k, m] of Object.entries(mouths || {})) {
    try { const r = await db.get('media', m.id); if (r) frames[k] = { bmp: await createImageBitmap(r.blob), face: m.face }; } catch {}
  }
  return { tk: Object.keys(frames).length ? T.createFrameTalker(base, face, frames) : T.createTalker(base, face), t: undefined };
}
async function setupTalker(E) {
  const c = E.p.char; E.assets.talker = null; E.assets.poses = null;
  if (!c) return;
  // 캐릭터 화면에서 나중에 넣은 자세·입 모양 사진도 이 영상에 반영 (보이기·위치·크기는 영상 설정 유지)
  const fresh = await db.get('characters', c.id);
  if (fresh) {
    const add = !(c.poses || []).length && (fresh.poses || []).length;
    Object.assign(c, { imageId: fresh.imageId || c.imageId, photoId: fresh.photoId || c.photoId, face: fresh.face || c.face, mouths: { ...(fresh.mouths || {}) }, poses: (fresh.poses || []).map((x) => ({ ...x, mouths: { ...(x.mouths || {}) } })) });
    if (add) autoPoses(E.p);
    db.put('projects', E.p);
  }
  const srcId = c.photoId || c.imageId; if (!srcId) return;
  try {
    const rec = await db.get('media', srcId); if (!rec) return;
    if (!c.face && !c.noFace) { // 예전 캐릭터: 처음 열 때 한 번 얼굴을 찾아 둔다
      c.face = await faceOfBlob(rec.blob); if (!c.face) c.noFace = true;
      const ch = await db.get('characters', c.id); if (ch && !ch.face && c.face) { ch.face = c.face; db.put('characters', ch); }
      db.put('projects', E.p);
    }
    if (!c.face || cur !== E) return;
    E.assets.talker = await buildTalker(rec.blob, c.face, c.mouths);
    // 자세 사진들: 장면의 s.pose 로 고른다
    const poses = {};
    for (const x of c.poses || []) {
      try { const r = await db.get('media', x.id); if (!r || cur !== E) continue; poses[x.key] = await buildTalker(r.blob, x.face, x.mouths); } catch (e) { console.warn(e); }
    }
    E.assets.poses = poses;
  } catch (e) { console.warn('말하는 캐릭터를 준비하지 못했어요', e); }
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
// 다른 앱으로 보내기: 클립보드에도 복사해 두고(받는 앱이 글을 못 받아도 붙여넣기 가능) 공유 창을 연다
async function sendText(text) {
  let ok = false;
  if (NATIVE && NATIVE.copy) { try { ok = NATIVE.copy(text); } catch {} }
  if (!ok) { try { await navigator.clipboard.writeText(text); } catch {} }
  if (NATIVE && NATIVE.shareText) { NATIVE.shareText(text); return toast('ChatGPT·Gemini를 고르세요 (내용은 복사도 돼 있어요)'); }
  if (navigator.share) { try { await navigator.share({ text }); } catch {} return; }
  copyText(text, '이 브라우저는 보내기를 지원하지 않아 복사만 했어요');
}
// ChatGPT 등에 그대로 붙여넣을 주문서. 장면 설명이 없으면 자막으로 대신 설명한다.
const sceneWhat = (s) => (s.imgPrompt || '').trim() || `"${(s.narration || s.text || '').trim()}" 라는 내용을 한눈에 보여 주는 장면.`;
const IMG_RULES = (p) => `- 비율: 세로 9:16 (1080×1920). 그림이 화면 전체를 꽉 채우게 (위아래 빈 여백·단색 띠 없이)
- 화풍: ${(p.look || '').trim() || '선명하고 밝은 실사 사진 느낌'}
- 이미지 안에 글자·자막·로고·워터마크는 넣지 마세요.
- 자막은 영상에서 따로 겹쳐 넣으니, 자막용 빈 공간·여백·단색 띠는 만들지 마세요.${charNote(p)}`;
function buildPrompt(p, i) {
  return `세로형 숏폼 영상(인스타 릴스·유튜브 쇼츠)의 ${i + 1}번째 장면에 쓸 이미지를 1장 만들어 주세요.

[그림 내용]
${sceneWhat(p.scenes[i])}

[조건]
${IMG_RULES(p)}`;
}
function charNote(p) {
  const c = p.char; if (!c) return '';
  if (c.show && c.imageId) {
    const where = { tl: '왼쪽 위', tc: '가운데 위', tr: '오른쪽 위', ml: '왼쪽 가운데', mr: '오른쪽 가운데', bl: '왼쪽 아래', bc: '가운데 아래', br: '오른쪽 아래' }[charPos(c)];
    return `\n- 진행 캐릭터는 영상에 따로 합성하니 그림에 넣지 마세요.\n- 화면 ${where} 구석(화면 폭의 약 1/4 크기 동그라미 자리)에는 설명 캐릭터 창이 올라갑니다. 그 자리에는 얼굴·글자·중요한 물건을 두지 말고 하늘·벽·바닥 같은 단순한 배경이 자연스럽게 이어지게 해 주세요 (빈칸·테두리로 만들지 말 것).`;
  }
  return `\n\n[등장 캐릭터] ${c.name}: ${c.look}\n캐릭터는 첨부한 캐릭터 그림과 똑같은 얼굴·머리·옷으로 그려 주세요.`;
}
function buildAllPrompts(p) {
  return `세로형 숏폼 영상에 쓸 장면 이미지 ${p.scenes.length}장을 순서대로 1장씩 만들어 주세요. 모든 장면은 같은 화풍으로 통일하고, 같은 인물·물건은 같은 생김새를 유지해 주세요.

[공통 조건]
${IMG_RULES(p)}

${p.scenes.map((s, i) => `[장면 ${i + 1}] ${sceneWhat(s)}`).join('\n')}`;
}
// 움직이는 영상 주문서: 장면 그림을 첫 화면으로, 인물이 실제로 움직이게 (Gemini·ChatGPT·Kling 등 이미지→영상 AI용)
function buildMotionPrompt(p, i) {
  const s = p.scenes[i], sec = Math.max(4, Math.min(8, Math.round(s.duration)));
  const move = (s.moveText || '').trim() || '인물이 있으면 자연스럽게 숨 쉬고 눈을 깜빡이며, 장면 내용을 설명하듯 손짓하고 표정이 바뀐다. 카메라는 천천히 앞으로 다가간다.';
  const talk = (s.narration || '').trim();
  return `첨부한 이미지를 첫 화면으로 그대로 써서, 세로(9:16) ${sec}초 길이의 움직이는 영상을 만들어 주세요.

[움직임]
${move}${talk ? `\n인물은 시청자를 보며 이렇게 말하는 듯한 입 모양과 몸짓을 해 주세요: "${talk}"` : ''}

[조건]
- 인물의 얼굴·머리·옷과 배경은 첨부한 이미지와 똑같이 유지 (다른 사람으로 바뀌지 않게)
- 움직임은 자연스럽고 부드럽게, 화면이 갑자기 바뀌거나 잘리지 않게
- 글자·자막·로고는 넣지 마세요
- 소리는 없어도 됩니다 (음성은 따로 넣어요)`;
}
// 그림과 주문서를 함께 다른 앱으로 보낸다 (앱: 네이티브 공유 / 브라우저: Web Share) — 주문서는 클립보드에도 복사
async function sendWithImage(text, mediaId) {
  const rec = mediaId && await db.get('media', mediaId);
  if (!rec || rec.kind !== 'image') return sendText(text);
  if (NATIVE && NATIVE.copy) { try { NATIVE.copy(text); } catch {} } else { try { await navigator.clipboard.writeText(text); } catch {} }
  if (NATIVE && NATIVE.shareImage) {
    toast('그림을 준비하는 중…');
    const u8 = new Uint8Array(await rec.blob.arrayBuffer()), STEP = 3 * 256 * 1024;
    NATIVE.fileBegin(`scene_${Date.now()}.jpg`, rec.blob.type || 'image/jpeg');
    for (let o = 0; o < u8.length; o += STEP) {
      let bin = ''; const part = u8.subarray(o, o + STEP);
      for (let i = 0; i < part.length; i += 32768) bin += String.fromCharCode.apply(null, part.subarray(i, i + 32768));
      NATIVE.fileChunk(btoa(bin));
    }
    const r = NATIVE.shareImage(text);
    return toast(r === 'ok' ? 'Gemini·ChatGPT·Kling 등을 고르세요 (주문서는 복사도 돼 있어요)' : r);
  }
  const file = new File([rec.blob], 'scene.jpg', { type: rec.blob.type || 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text }); } catch {} return; }
  copyText(text, '이 브라우저는 그림 보내기를 지원하지 않아 주문서만 복사했어요');
}
const stillOf = (s) => (s.mediaKind === 'image' ? s.mediaId : s.stillId) || null; // 움직이게 만들 원본 그림
function imageSheet() {
  const E = cur, p = E.p;
  if (!p.scenes.length) return toast('먼저 장면을 추가해 주세요');
  pause();
  const done = p.scenes.filter((s) => s.mediaId).length, moving = p.scenes.filter((s) => s.mediaKind === 'video').length;
  const noIdea = p.scenes.some((s) => !(s.imgPrompt || '').trim());
  const L = sheet('🖼 장면별 이미지·모션', `
    <div class="mut"><b>그림</b>: 📤 보내기 → 이미지 AI에서 그림 만들기 → 🖼 넣기<br><b>모션</b>: 그림을 넣은 뒤 🎬 움직이게 → 그림과 주문서가 함께 넘어가요 → Gemini·ChatGPT·Kling 등에서 영상 만들기 → 🎞 영상 넣기</div>
    <label>공통 화풍 (모든 장면에 적용)</label><input type="text" id="lk" value="${esc(p.look || '')}" placeholder="예) 따뜻한 자연광의 실사 사진">
    <div class="row" style="margin-top:10px"><button data-act="ai">🤖 ${noIdea ? 'AI 장면 설명' : '설명 다시 쓰기'}</button><button data-act="all">📋 전체 복사</button><button data-act="allSend">📤 전체 보내기</button></div>
    <div class="row" style="margin-top:8px"><button data-act="bulk">🖼 그림 일괄</button><button data-act="bulkV">🎞 영상 일괄</button><button data-act="fx">✨ 효과 추천</button></div>
    <div class="sec" style="margin-top:14px">그림 ${done} / ${p.scenes.length} · 움직이는 영상 ${moving} / ${p.scenes.length}</div>
    ${p.scenes.map((s, i) => `<div class="imgc" data-i="${i}"><canvas width="90" height="160"></canvas><div class="b">
      <b>장면 ${i + 1}${s.talk ? ' · 🗣 캐릭터가 말하는 장면' : s.mediaKind === 'video' ? ' · 🎞 움직이는 영상' : ''}</b>
      ${E.assets.talker ? `<div class="row"><button class="${s.talk ? 'pri' : ''}" data-act="talk" data-i="${i}">🗣 ${s.talk ? '말하는 장면 끄기' : `${esc(p.char.name)}가 직접 말하는 장면으로`}</button></div>` : ''}<span class="mut">${esc(s.text || '(자막 없음)')}</span>
      <textarea rows="3" data-p="${i}" placeholder="그림 설명 (비우면 자막으로 설명해요)">${esc(s.imgPrompt || '')}</textarea>
      <div class="row"><button data-act="copy" data-i="${i}">📋 복사</button><button data-act="send" data-i="${i}">📤 보내기</button><button class="${s.mediaId ? '' : 'pri'}" data-act="put" data-i="${i}">🖼 ${stillOf(s) ? '교체' : '넣기'}</button></div>
      ${stillOf(s) ? `<textarea rows="2" data-m="${i}" placeholder="움직임 (비우면 자연스러운 몸짓으로)">${esc(s.moveText || '')}</textarea>
      <div class="row"><button data-act="mcopy" data-i="${i}">📋 모션 복사</button><button data-act="msend" data-i="${i}">🎬 움직이게</button><button class="${s.mediaKind === 'video' ? '' : 'pri'}" data-act="vput" data-i="${i}">🎞 ${s.mediaKind === 'video' ? '영상 교체' : '영상 넣기'}</button></div>
      ${s.mediaKind === 'video' && s.stillId ? `<div class="row"><button data-act="back" data-i="${i}">↩ 그림으로 되돌리기</button></div>` : ''}` : ''}
    </div></div>`).join('')}`);
  L.el.querySelectorAll('.imgc canvas').forEach((c) => thumb(c, p, p.scenes[+c.closest('.imgc').dataset.i], E.assets));
  $('#lk', L.el).oninput = (e) => { p.look = e.target.value; changed({ strip: false }); };
  L.el.querySelectorAll('textarea[data-p]').forEach((t) => { t.oninput = () => { p.scenes[+t.dataset.p].imgPrompt = t.value; changed({ strip: false }); }; });
  L.el.querySelectorAll('textarea[data-m]').forEach((t) => { t.oninput = () => { p.scenes[+t.dataset.m].moveText = t.value; changed({ strip: false }); }; });
  const reopen = () => { const y = $('.sheet', L.el).scrollTop; L.close(); imageSheet(); const sh = $('.backdrop:last-child .sheet', layers); if (sh) sh.scrollTop = y; };
  let busy = false;
  const fill = async (kind) => {
    const files = await pickFiles(kind === 'video' ? 'video/*' : 'image/*', true); if (!files.length) return;
    // 받은 순서(= 장면 순서)대로 넣도록 저장된 시각 순으로 정렬. 그림은 그림 없는 장면부터, 영상은 아직 안 움직이는 장면부터 채운다.
    files.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, undefined, { numeric: true }));
    let target = p.scenes.filter((s) => (kind === 'video' ? s.mediaKind !== 'video' : !s.mediaId));
    if (!target.length) target = p.scenes.slice();
    toast(kind === 'video' ? '영상을 넣는 중…' : '그림을 넣는 중…');
    let n = 0;
    for (let k = 0; k < files.length && k < target.length; k++) if (await putMedia(target[k], files[k])) n++;
    reopen();
    const unit = kind === 'video' ? '개' : '장';
    toast(files.length > target.length ? `${n}${unit}를 넣었어요 (남는 ${files.length - target.length}${unit}는 뺐어요)` : `${n}${unit}를 넣었어요`);
    setTimeout(maybeAutoFx, 600);
  };
  wire(L, {
    copy: (b) => copyText(buildPrompt(p, +b.dataset.i), `장면 ${+b.dataset.i + 1} 프롬프트를 복사했어요`),
    send: (b) => (p.char && !p.char.show && p.char.imageId ? sendWithImage(buildPrompt(p, +b.dataset.i), p.char.imageId) : sendText(buildPrompt(p, +b.dataset.i))),
    allSend: () => (p.char && !p.char.show && p.char.imageId ? sendWithImage(buildAllPrompts(p), p.char.imageId) : sendText(buildAllPrompts(p))),
    all: () => copyText(buildAllPrompts(p), `${p.scenes.length}개 장면 프롬프트를 한꺼번에 복사했어요`),
    mcopy: (b) => copyText(buildMotionPrompt(p, +b.dataset.i), `장면 ${+b.dataset.i + 1} 모션 주문서를 복사했어요`),
    msend: (b) => { const s = p.scenes[+b.dataset.i]; sendWithImage(buildMotionPrompt(p, +b.dataset.i), stillOf(s)); },
    put: async (b) => {
      const i = +b.dataset.i, [f] = await pickFiles('image/*'); if (!f) return;
      if (await putMedia(p.scenes[i], f)) { reopen(); maybeAutoFx(); }
    },
    vput: async (b) => {
      const i = +b.dataset.i, [f] = await pickFiles('video/*'); if (!f) return;
      if (await putMedia(p.scenes[i], f)) { reopen(); toast('움직이는 영상을 넣었어요'); }
    },
    back: (b) => {
      const s = p.scenes[+b.dataset.i];
      s.mediaId = s.stillId; s.mediaKind = 'image'; s.stillId = null; if (s.motion === 'none') s.motion = 'zoomIn';
      changed({ audio: true }); reopen();
    },
    talk: (b) => { const s = p.scenes[+b.dataset.i]; s.talk = !s.talk; changed({ audio: false }); reopen(); setTimeout(maybeAutoFx, 300); },
    bulk: () => fill('image'),
    bulkV: () => fill('video'),
    fx: async () => { await autoFx(p, E.assets); changed({ audio: true }); E.t = 0; reopen(); toast('✨ 장면별 효과를 추천해 적용했어요'); },
    ai: async (b) => {
      if (busy) return;
      if (!getKey()) { toast('먼저 Gemini API 키를 입력해 주세요'); return settingsSheet(); }
      busy = true; b.textContent = '작성 중…';
      try {
        const { generateImageIdeas } = await import('./ai.js');
        const out = await generateImageIdeas({ title: p.name, scenes: p.scenes, character: p.char && !p.char.show ? p.char : null });
        p.scenes.forEach((s, i) => { if (out.images[i]) s.imgPrompt = out.images[i]; if (out.motions?.[i]) s.moveText = out.motions[i]; });
        if (out.look) p.look = out.look;
        changed({ strip: false });
        if (L.el.isConnected) reopen();
        toast('장면 설명을 만들었어요');
      } catch (e) { console.warn(e); toast(e.message || 'AI 요청에 실패했어요'); busy = false; b.textContent = '🤖 AI 장면 설명'; }
    },
  });
}
// 장면 하나에 파일을 넣는다.
// 그림: 화면 움직임 유지. 영상: 원래 그림은 stillId로 기억(되돌리기·다시 주문용).
// AI 음성이 있는 장면은 음성 길이에 맞춘 장면 길이를 그대로 두고, 영상 소리는 끈다 (영상이 짧으면 마지막 화면에서 멈춤).
async function putMedia(s, f) {
  const E = cur, p = E.p;
  try {
    const m = await importFile(p, f); const a = await loadAsset(m.id); E.assets.set(m.id, a);
    if (m.kind === 'video' && s.mediaKind === 'image') s.stillId = s.mediaId;
    if (m.kind === 'image') s.stillId = null;
    s.mediaId = m.id; s.mediaKind = m.kind;
    if (m.kind === 'video') {
      s.motion = 'none'; s.trimStart = 0;
      if (s.ttsId || (s.narration || '').trim()) s.clipAudio = false;
      else s.duration = Math.max(1, Math.min(15, Math.round(a.dur * 2) / 2));
    } else if (s.motion === 'none') s.motion = 'zoomIn';
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
  if (p.autoFxDone || !p.scenes.length || p.scenes.some((s) => !s.mediaId && !s.talk)) return;
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
const stepRow = (k, label, [less, more]) => `<label>${label} <b data-sv="${k}"></b></label><div class="row"><button data-step="${k}" data-d="-1">${less}</button><button data-step="${k}" data-d="1">${more}</button><button data-step="${k}" data-d="0">기본</button></div>`;
async function styleSheet() {
  const E = cur, p = E.p, st = p.style;
  const chars = (await db.all('characters')).filter((c) => c.imageId);
  const c = p.char;
  const colors = ['#ffffff', '#ffe600', '#00e5ff', '#ff5c8a', '#7dff7a', '#ff9d2e'].map((c) => ({ v: c, css: c }));
  const L = sheet('스타일', `
    <label>템플릿 — 누르면 전체 분위기가 한 번에 바뀝니다</label>${chips('tpl', Object.entries(TEMPLATES).map(([k, v]) => [k, v[0]]), '')}
    <label>자막 스타일</label>${chips('caption', [['outline', '테두리'], ['box', '박스'], ['highlight', '형광펜'], ['neon', '네온'], ['shadow', '그림자']], st.caption)}
    <label>자막 색</label>${swatches('color', colors, st.color)}
    <label>글꼴</label>${chips('font', [['gothic', '고딕'], ['serif', '명조']], st.font)}
    <div class="sec" style="margin-top:16px">위 자막 (장면 제목)</div>
    ${stepRow('size', '크기', ['－ 작게', '＋ 크게'])}
    ${stepRow('capY', '높이', ['▲ 위로', '▼ 아래로'])}
    <div class="sec" style="margin-top:16px">아래 자막 (대사)</div>
    <label>보이기</label>${chips('subtitle', [['1', '켜기'], ['0', '끄기']], p.subtitle === false ? '0' : '1')}
    ${stepRow('subSize', '크기', ['－ 작게', '＋ 크게'])}
    ${stepRow('subY', '높이', ['▲ 위로', '▼ 아래로'])}
    <label>캐릭터 진행자</label>${chips('char', [['', '없음'], ...chars.map((x) => [x.id, esc(x.name)]), ...(c && !chars.some((x) => x.id === c.id) ? [[c.id, esc(c.name)]] : [])], c ? c.id : '')}
    ${c ? `<label>구석에 작은 캐릭터 창 띄우기</label>${chips('show', [['0', '끄기 — 장면 그림 안에 등장'], ['1', '켜기']], c.show ? '1' : '0')}
    ${c.show ? `<label>위치 — 원을 눌러 고르세요</label><div class="posgrid">${['tl', 'tc', 'tr', 'ml', '', 'mr', 'bl', 'bc', 'br'].map((k) => (k ? `<button data-pos="${k}" class="${charPos(c) === k ? 'on' : ''}" aria-label="${k}"></button>` : '<span>🎬</span>')).join('')}</div>
    ${stepRow('scale', '캐릭터 창 크기', ['－ 작게', '＋ 크게'])}` : ''}` : ''}
    <label>장면 전환</label>${chips('transition', [['fade', '페이드'], ['slide', '슬라이드'], ['zoom', '줌'], ['none', '없음']], p.transition)}
    <label>모든 장면에 일괄 적용 — 자막 위치</label>${chips('all.textPos', [['top', '위'], ['center', '가운데'], ['bottom', '아래']], '')}
    <label>모든 장면에 일괄 적용 — 자막 효과</label>${chips('all.textAnim', [['pop', '팝'], ['fade', '페이드'], ['slide', '슬라이드'], ['type', '타자기'], ['none', '없음']], '')}`);
  wire(L, {});
  // 크기·높이는 버튼으로만 바꾼다 (화면을 위아래로 밀다가 실수로 바뀌지 않게)
  // 위치·크기는 움직이는 동안 미리보기에 바로 보이게, 해당 자막이 보이는 장면 시점으로 맞춘다
  const showText = () => { E.t = sceneStart(p, E.sel) + Math.min(1, p.scenes[E.sel]?.duration / 2 || 0); };
  const STEPS = {
    size: [st, 'size', 84, 4, 48, 140, (v) => v],
    capY: [st, 'capY', CAP_Y, 0.02, 0.04, 0.6, (v) => `위에서 ${Math.round(v * 100)}%`],
    subSize: [st, 'subSize', 54, 2, 34, 96, (v) => v],
    subY: [st, 'subY', SUB_Y, 0.02, 0.5, 0.97, (v) => `위에서 ${Math.round(v * 100)}%`],
    scale: [c || {}, 'scale', 1, 0.1, 0.6, 1.6, (v) => `${Math.round(v * 100)}%`],
  };
  const showVal = (k) => { const [o, f, d, , , , fmtv] = STEPS[k]; const el = $(`[data-sv="${k}"]`, L.el); if (el) el.textContent = fmtv(o[f] ?? d); };
  Object.keys(STEPS).forEach(showVal);
  L.el.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
    const k = b.dataset.step, [o, f, d, step, lo, hi] = STEPS[k], dir = +b.dataset.d;
    o[f] = dir ? Math.round(Math.min(hi, Math.max(lo, (o[f] ?? d) + dir * step)) * 100) / 100 : d;
    showVal(k); showText(); changed({ strip: k === 'size' });
  });
  L.el.querySelectorAll('.posgrid button').forEach((b) => b.onclick = () => {
    c.pos = b.dataset.pos; L.el.querySelectorAll('.posgrid button').forEach((x) => x.classList.toggle('on', x === b));
    showText(); changed({ strip: false });
  });
  bindChips(L.el, async (k, v) => {
    if (k === 'char') {
      const x = chars.find((y) => y.id === v);
      if (!v) { p.char = null; E.assets.talker = null; E.assets.poses = null; p.scenes.forEach((x) => { x.talk = false; x.pose = null; }); }
      else if (x && (!c || c.id !== x.id)) {
        p.char = charOf(x); autoPoses(p);
        try { const a = await loadAsset(x.imageId); if (a) E.assets.set(x.imageId, a); } catch {}
        await setupTalker(E);
      }
      changed({ audio: true }); L.close(); styleSheet(); return;
    }
    if (k === 'show') { c.show = v === '1'; changed({ strip: false }); L.close(); styleSheet(); return; }
    if (k === 'tpl') {
      const [, style, tr, pos, anim] = TEMPLATES[v];
      Object.assign(st, style); p.transition = tr; p.scenes.forEach((x) => { x.transition = ''; });
      p.scenes.forEach((s) => { s.textPos = pos; s.textAnim = anim; });
      changed(); L.close(); styleSheet(); return;
    }
    if (k === 'subtitle') p.subtitle = v === '1';
    else if (k === 'transition') { p.transition = v; p.scenes.forEach((x) => { x.transition = ''; }); }
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

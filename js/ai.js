// AI 대본·AI 음성 — 사용자의 Gemini API 키(Google AI Studio, 무료 등급)로 기기에서 직접 호출한다.
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/interactions';
// 대본 작성에 쓸 모델. 설정에서 고른 것을 먼저 쓰고, 한도 초과·사용 불가·무응답이면 나머지를 차례로 시도한다.
export const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];
export const getModel = () => { try { const m = localStorage.getItem('model.gemini'); return MODELS.includes(m) ? m : MODELS[0]; } catch { return MODELS[0]; } };
const fail = (code, msg) => Object.assign(new Error(msg), { code });
const TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
export const VOICES = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'];

// 키는 여러 개를 줄바꿈으로 저장할 수 있다. 한 키가 한도에 걸리거나, 잘못됐거나, 응답이 없으면 다음 키로 넘어간다.
export const getKeys = () => { try { return (localStorage.getItem('key.gemini') || '').split(/[\s,]+/).filter(Boolean); } catch { return []; } };
let cursor = 0; // 마지막으로 성공한 키부터 쓴다

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 한 모델에 대해 등록된 키를 차례로 시도한다. 실패하면 이유(code)를 달아 던진다:
//  limit(한도 초과) · model(모델 없음) · noresp(무응답·서버 오류·연결 실패) · key(키 오류)
async function call(body, timeout) {
  const keys = getKeys();
  let limited = 0, bad = 0, silent = 0;
  for (let n = 0; n < keys.length; n++) {
    const idx = (cursor + n) % keys.length;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    let r, j;
    try {
      r = await fetch(URL_, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': keys[idx] }, body: JSON.stringify(body) });
      j = await r.json().catch(() => ({}));
    } catch { silent++; continue; } // 시간 초과·연결 실패 → 다음 키
    finally { clearTimeout(timer); }
    if (r.ok) { cursor = idx; return j; }
    const msg = j.error?.message || '';
    if (r.status === 429) { limited++; continue; }
    if (r.status === 401 || r.status === 403 || /API key/i.test(msg)) { bad++; continue; }
    if (r.status === 404) throw fail('model', `AI 모델(${body.model})을 찾을 수 없어요. 앱 업데이트가 필요할 수 있어요.`);
    if (r.status >= 500) { silent++; continue; } // 서버 쪽 오류 → 다음 키
    throw new Error(`AI 요청 실패 (${r.status}): ${msg}`);
  }
  if (limited) throw fail('limit', '모든 모델과 키가 무료 사용 한도를 넘었어요. 잠시 후 다시 시도하거나 키를 추가해 주세요.');
  if (silent) throw fail('noresp', navigator.onLine === false ? '인터넷 연결을 확인해 주세요.' : 'AI 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.');
  throw fail('key', keys.length > 1 ? `등록된 Gemini API 키 ${bad}개가 모두 올바르지 않아요. 설정에서 확인해 주세요.` : 'Gemini API 키가 올바르지 않아요. 설정에서 확인해 주세요.');
}

// 모델을 차례로 바꿔 가며 호출한다. 각 모델마다 등록된 키를 모두 시도하고,
// 전부 한도에 걸렸을 때만 20초 기다렸다가 한 번 더 돈다.
async function callAny(models, body, timeout, onWait) {
  let err;
  for (let round = 0; round < 2; round++) {
    let limited = false;
    for (const model of models) {
      try { return await call({ model, ...body }, timeout); } catch (e) {
        if (!e.code || e.code === 'key') throw e; // 키 오류·요청 오류는 모델을 바꿔도 소용없다
        err = e; limited = limited || e.code === 'limit';
      }
    }
    if (!limited || round) break;
    onWait && onWait(); await sleep(20000);
  }
  throw err;
}
const callText = (body) => { const first = getModel(); return callAny([first, ...MODELS.filter((m) => m !== first)], body, 25000); };

// 응답 안에서 원하는 종류(text/audio)의 조각을 모은다. 입력 메아리와 생각 과정은 건너뛴다.
function parts(res, type) {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.type === 'user_input' || o.type === 'thought') return;
    if (o.type === type && (typeof o.text === 'string' || typeof o.data === 'string')) out.push(o);
    else Object.values(o).forEach(walk);
  };
  walk(res);
  return out;
}

const SCHEMA = {
  type: 'object', required: ['title', 'look', 'scenes', 'description', 'hashtags'],
  properties: {
    title: { type: 'string' },
    look: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object', required: ['caption', 'narration', 'image', 'motion'],
        properties: { caption: { type: 'string' }, narration: { type: 'string' }, image: { type: 'string' }, motion: { type: 'string' } },
      },
    },
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
};

const IMAGE_RULES = `- image: 이 장면의 배경으로 쓸 세로(9:16) 이미지를 이미지 생성 AI에게 주문하는 그림 설명. 무엇이 어디에 어떻게 보이는지(피사체·행동·배경·구도·조명·색감)를 2~3문장으로 구체적으로 씁니다. 그림은 화면 전체를 꽉 채우고(빈 여백·단색 띠 없이), 자막이 올라갈 아래쪽 1/4에는 얼굴·중요한 물건이 오지 않게 합니다. 그림 안에 글자·간판 문구·로고는 넣지 않습니다. 앞 장면에 나온 인물·물건이 다시 나오면 같은 생김새로 다시 묘사합니다.
- motion: 이 그림을 영상 생성 AI로 4~8초 움직이게 만들 때의 움직임 설명 1~2문장. 인물의 동작·몸짓·표정 변화(예: 손을 펼치며 설명하다 고개를 끄덕인다)와 카메라 움직임(예: 천천히 다가간다)을 구체적으로 씁니다.
- look: 모든 장면 이미지에 공통으로 적용할 화풍 한 문장 (예: 밝은 자연광의 실사 사진, 따뜻한 파스텔 톤 일러스트). 주제와 분위기에 어울리게 고릅니다.`;

const GUIDE = `당신은 인스타그램 릴스·유튜브 쇼츠 전문 대본 작가입니다. 아래 주제로 세로형 숏폼 영상 대본을 한국어로 써 주세요.

영상은 장면 단위로 구성되고, 각 장면은 화면 자막 한 덩어리와 내레이션 한 문장으로 이루어집니다. 시청자는 소리를 끈 채 보는 경우가 많으므로 자막만 읽어도 내용이 전달되어야 합니다.

- 첫 장면은 스크롤을 멈추게 하는 훅입니다. 마지막 장면은 저장·팔로우·댓글 같은 행동 유도로 끝냅니다.
- caption: 화면 위쪽에 크게 뜨는 장면 제목. 그 장면의 핵심을 한눈에 읽히도록 22자 이내로 씁니다.
- narration: 그 장면에서 읽을 내레이션 한 문장. 화면 아래쪽에 대사 자막으로도 그대로 표시됩니다. 음성 합성으로 읽히므로 자연스러운 말투로, 이모지·특수기호 없이 씁니다. 한국어 내레이션은 1초에 약 6자 속도입니다.
${IMAGE_RULES}
- title: 프로젝트 이름으로 쓸 20자 이내 제목.
- description: 업로드할 때 붙일 설명글 2~3문장.
- hashtags: '#'을 포함한 해시태그 5~8개.

사실 정보가 필요한 주제에서는 확실하지 않은 수치나 고유명사를 지어내지 말고 일반적인 표현을 씁니다.`;

// 캐릭터가 진행하는 영상: 말투·외형·지난 편을 대본 작가에게 알려 준다
function charGuide(ch, prev) {
  if (!ch) return '';
  let g = `\n\n[진행 캐릭터]\n이 영상은 캐릭터 '${ch.name}'이(가) 화면 구석에 나와 시청자에게 직접 설명하는 형식입니다.
- 성격·말투: ${ch.persona || '친근하고 밝은 말투'}
- narration은 이 캐릭터가 말하는 대사입니다. 캐릭터의 말투로, 시청자에게 말을 거는 1인칭 구어체로 씁니다. 첫 장면에서 자연스럽게 자기 이름을 밝혀도 좋습니다.
${ch.face ? `- 캐릭터는 화면 구석 창과 첫·마지막 장면에 직접 나와 말합니다. 그러므로 image에는 캐릭터를 그리지 말고, 장면 내용을 보여 주는 배경·소품·상황·다른 사람만 묘사합니다.
- motion에는 그림 속 사물·사람·카메라의 움직임을 씁니다.` : `- image에는 이 캐릭터가 장면 내용에 맞는 행동을 하며 등장합니다. 매 장면 캐릭터 외형을 그대로 다시 묘사해 생김새가 같게 합니다.
- motion에는 캐릭터가 시청자에게 이 장면의 말을 하며 설명하는 몸짓(손짓·표정·고개 끄덕임 등)을 씁니다.`}
- 캐릭터 외형: ${ch.look || ''}`;
  if (prev && prev.length) g += `\n\n[시리즈]\n이 캐릭터의 지난 영상들입니다. 이번 영상은 그다음 편입니다. 지난 내용을 반복하지 말고, 첫 장면이나 둘째 장면에서 지난 편을 한마디로 짧게 언급해 이어지는 느낌을 줍니다.\n${prev.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
  return g;
}

export async function generateScript({ topic, tone, seconds, character, previous }) {
  const res = await callText({
    input: `${GUIDE}${charGuide(character, previous)}\n\n주제: ${topic}\n분위기: ${tone}\n목표 길이: 약 ${seconds}초 (내레이션 총 ${Math.round(seconds * 6)}자 안팎, 장면 ${Math.max(3, Math.round(seconds / 4))}개 안팎)`,
    response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
  });
  const text = (typeof res.output_text === 'string' ? res.output_text : parts(res, 'text').map((p) => p.text).join('')).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('AI 응답을 읽지 못했어요. 다시 시도해 주세요.'); }
  if (!out.scenes?.length) throw new Error('대본이 비어 있어요. 다른 주제로 다시 시도해 주세요.');
  return out;
}

// 캐릭터 설정 만들기: 짧은 콘셉트 → 이름·외형(그림 주문용)·성격·말투
const CHAR_SCHEMA = {
  type: 'object', required: ['name', 'look', 'persona'],
  properties: { name: { type: 'string' }, look: { type: 'string' }, persona: { type: 'string' } },
};
export async function generateCharacter(concept) {
  const res = await callText({
    input: `당신은 숏폼 영상용 캐릭터 디자이너입니다. 아래 콘셉트로 영상에 계속 등장할 진행자 캐릭터를 설정해 주세요. 한국어로 답하세요.

- name: 부르기 쉬운 캐릭터 이름 (8자 이내). 콘셉트에 이름이 있으면 그대로 씁니다.
- look: 이미지 생성 AI가 매번 똑같은 캐릭터를 그릴 수 있도록 하는 외형 설명. 화풍(3D·일러스트·실사 등), 몸 형태와 비율, 얼굴·눈·표정, 머리, 색상, 옷·소품, 특징을 구체적으로 3~5문장으로 씁니다.
- persona: 영상에서 말할 때의 성격과 말투 1~2문장 (예: 밝고 다정한 반말, 문장 끝에 '~해요'를 자주 씀).

콘셉트: ${concept}`,
    response_format: { type: 'text', mime_type: 'application/json', schema: CHAR_SCHEMA },
  });
  const text = (typeof res.output_text === 'string' ? res.output_text : parts(res, 'text').map((p) => p.text).join('')).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(text); } catch { throw new Error('AI 응답을 읽지 못했어요. 다시 시도해 주세요.'); }
}

// 이미 있는 장면(대본으로 만들기·직접 입력)에 이미지 설명을 붙인다
const IMG_SCHEMA = {
  type: 'object', required: ['look', 'images'],
  properties: { look: { type: 'string' }, images: { type: 'array', items: { type: 'string' } }, motions: { type: 'array', items: { type: 'string' } } },
};
export async function generateImageIdeas({ title, scenes, character }) {
  const list = scenes.map((s, i) => `${i + 1}. 자막: ${s.text || '(없음)'}${s.narration ? ` / 내레이션: ${s.narration}` : ''}`).join('\n');
  const res = await callText({
    input: `당신은 숏폼 영상의 아트 디렉터입니다. 아래 세로형 영상의 장면마다 배경 이미지를 이미지 생성 AI로 만들려고 합니다. 한국어로 답하세요.

- images: 장면 순서대로 정확히 ${scenes.length}개. 각 항목은 그 장면 이미지를 주문하는 그림 설명입니다. 무엇이 어디에 어떻게 보이는지(피사체·행동·배경·구도·조명·색감)를 2~3문장으로 구체적으로 씁니다. 그림은 화면 전체를 꽉 채우고(빈 여백·단색 띠 없이), 자막이 올라갈 아래쪽 1/4에는 얼굴·중요한 물건이 오지 않게 합니다.
- motions: 장면 순서대로 정확히 ${scenes.length}개. 그 그림을 영상 생성 AI로 4~8초 움직이게 만들 때의 움직임(인물 동작·표정, 카메라 움직임) 1~2문장.${character ? `\n- 이 영상의 진행 캐릭터 '${character.name}'(외형: ${character.look})가 장면마다 등장해 설명합니다. images에 캐릭터를 같은 생김새로 넣고, motions에는 캐릭터가 말하며 설명하는 몸짓을 씁니다.` : ''} 그림 안에 글자·간판 문구·로고는 넣지 않습니다. 같은 인물·물건이 여러 장면에 나오면 매번 같은 생김새로 묘사합니다.
- look: 모든 장면 이미지에 공통으로 적용할 화풍 한 문장.

영상 제목: ${title}
장면:
${list}`,
    response_format: { type: 'text', mime_type: 'application/json', schema: IMG_SCHEMA },
  });
  const text = (typeof res.output_text === 'string' ? res.output_text : parts(res, 'text').map((p) => p.text).join('')).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('AI 응답을 읽지 못했어요. 다시 시도해 주세요.'); }
  if (!out.images?.length) throw new Error('이미지 설명을 받지 못했어요. 다시 시도해 주세요.');
  return out;
}

// 24kHz 16비트 모노 PCM에 WAV 머리말을 붙인다 (머리말 없이 올 때 대비)
function toWav(pcm) {
  const h = new DataView(new ArrayBuffer(44)), w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, 24000, true); h.setUint32(28, 48000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, pcm.length, true);
  return new Blob([h, pcm], { type: 'audio/wav' });
}

export async function synth(text, voice, style, onWait) {
  const content = { type: 'text', text };
  if (style) content.annotations = [{ type: 'speech_metadata', style }];
  const res = await callAny(TTS_MODELS, {
    input: [{ type: 'user_input', content: [content] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  }, 45000, onWait);
  const b64 = parts(res, 'audio').map((p) => p.data).join('');
  if (!b64) throw new Error('음성 데이터를 받지 못했어요. 다시 시도해 주세요.');
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const riff = u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46;
  return riff ? new Blob([u8], { type: 'audio/wav' }) : toWav(u8);
}

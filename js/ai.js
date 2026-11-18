// AI 대본·AI 음성 — 사용자의 Gemini API 키(Google AI Studio, 무료 등급)로 기기에서 직접 호출한다.
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const TEXT_MODEL = 'gemini-3.8-flash';
const TTS_MODEL = 'gemini-3.8-flash-tts';
export const VOICES = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'];

// 키는 여러 개를 줄바꿈으로 저장할 수 있다. 한 키가 한도에 걸리거나 잘못됐으면 다음 키로 넘어간다.
export const getKeys = () => { try { return (localStorage.getItem('key.gemini') || '').split(/[\s,]+/).filter(Boolean); } catch { return []; } };
let cursor = 0; // 마지막으로 성공한 키부터 쓴다

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(body, onWait, waits = 2) {
  const keys = getKeys();
  let limited = 0, bad = 0, last = '';
  for (let n = 0; n < keys.length; n++) {
    const idx = (cursor + n) % keys.length;
    let r;
    try {
      r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': keys[idx], 'Api-Revision': '2026-05-20' }, body: JSON.stringify(body) });
    } catch { throw new Error('인터넷 연결을 확인해 주세요.'); }
    const j = await r.json().catch(() => ({}));
    if (r.ok) { cursor = idx; return j; }
    last = j.error?.message || '';
    if (r.status === 429) { limited++; continue; } // 한도 초과 → 다음 키
    if (r.status === 401 || r.status === 403 || /API key/i.test(last)) { bad++; continue; } // 잘못된 키 → 다음 키
    if (r.status === 404) throw new Error(`AI 모델(${body.model})을 찾을 수 없어요. 앱 업데이트가 필요할 수 있어요.`);
    throw new Error(`AI 요청 실패 (${r.status}): ${last}`);
  }
  if (limited && waits > 0) { // 쓸 수 있는 키가 모두 한도에 걸림 → 잠시 기다렸다 다시
    onWait && onWait(); await sleep(20000);
    return call(body, onWait, waits - 1);
  }
  if (limited) throw new Error(`등록된 키 ${keys.length}개가 모두 무료 사용 한도를 넘었어요. 잠시 후 다시 시도하거나 키를 추가해 주세요.`);
  throw new Error(keys.length > 1 ? `등록된 Gemini API 키 ${bad}개가 모두 올바르지 않아요. 설정에서 확인해 주세요.` : 'Gemini API 키가 올바르지 않아요. 설정에서 확인해 주세요.');
}

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
  type: 'object', required: ['title', 'scenes', 'description', 'hashtags'],
  properties: {
    title: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object', required: ['caption', 'narration', 'emoji'],
        properties: { caption: { type: 'string' }, narration: { type: 'string' }, emoji: { type: 'string' } },
      },
    },
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
};

const GUIDE = `당신은 인스타그램 릴스·유튜브 쇼츠 전문 대본 작가입니다. 아래 주제로 세로형 숏폼 영상 대본을 한국어로 써 주세요.

영상은 장면 단위로 구성되고, 각 장면은 화면 자막 한 덩어리와 내레이션 한 문장으로 이루어집니다. 시청자는 소리를 끈 채 보는 경우가 많으므로 자막만 읽어도 내용이 전달되어야 합니다.

- 첫 장면은 스크롤을 멈추게 하는 훅입니다. 마지막 장면은 저장·팔로우·댓글 같은 행동 유도로 끝냅니다.
- caption: 화면에 크게 뜨는 자막. 한눈에 읽히도록 22자 이내의 짧은 구어체로 씁니다.
- narration: 그 장면에서 읽을 내레이션 한 문장. 음성 합성으로 읽히므로 자연스러운 말투로, 이모지·특수기호 없이 씁니다. 한국어 내레이션은 1초에 약 6자 속도입니다.
- emoji: 장면 분위기에 맞는 이모지 딱 1개.
- title: 프로젝트 이름으로 쓸 20자 이내 제목.
- description: 업로드할 때 붙일 설명글 2~3문장.
- hashtags: '#'을 포함한 해시태그 5~8개.

사실 정보가 필요한 주제에서는 확실하지 않은 수치나 고유명사를 지어내지 말고 일반적인 표현을 씁니다.`;

export async function generateScript({ topic, tone, seconds }) {
  const res = await call({
    model: TEXT_MODEL,
    input: `${GUIDE}\n\n주제: ${topic}\n분위기: ${tone}\n목표 길이: 약 ${seconds}초 (내레이션 총 ${Math.round(seconds * 6)}자 안팎, 장면 ${Math.max(3, Math.round(seconds / 4))}개 안팎)`,
    response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
  });
  const text = (typeof res.output_text === 'string' ? res.output_text : parts(res, 'text').map((p) => p.text).join('')).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('AI 응답을 읽지 못했어요. 다시 시도해 주세요.'); }
  if (!out.scenes?.length) throw new Error('대본이 비어 있어요. 다른 주제로 다시 시도해 주세요.');
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
  const res = await call({
    model: TTS_MODEL,
    input: [{ type: 'user_input', content: [content] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  }, onWait);
  const b64 = parts(res, 'audio').map((p) => p.data).join('');
  if (!b64) throw new Error('음성 데이터를 받지 못했어요. 다시 시도해 주세요.');
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const riff = u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46;
  return riff ? new Blob([u8], { type: 'audio/wav' }) : toWav(u8);
}

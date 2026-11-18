// AI 대본 작성 — 사용자의 Claude API 키로 휴대폰에서 직접 호출한다 (중간 서버 없음).
import Anthropic from './vendor/anthropic-sdk.mjs';

export const keys = {
  get: (k) => { try { return localStorage.getItem('key.' + k) || ''; } catch { return ''; } },
  set: (k, v) => { try { v ? localStorage.setItem('key.' + k, v) : localStorage.removeItem('key.' + k); } catch {} },
};

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'scenes', 'description', 'hashtags'],
  properties: {
    title: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['caption', 'narration', 'emoji'],
        properties: { caption: { type: 'string' }, narration: { type: 'string' }, emoji: { type: 'string' } },
      },
    },
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `당신은 인스타그램 릴스·유튜브 쇼츠 전문 대본 작가입니다. 주어진 주제로 세로형 숏폼 영상 대본을 한국어로 씁니다.

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
  const client = new Anthropic({ apiKey: keys.get('claude'), dangerouslyAllowBrowser: true });
  let res;
  try {
    res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // 안전 분류기가 거절하면 서버가 대체 모델로 자동 재시도
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `주제: ${topic}\n분위기: ${tone}\n목표 길이: 약 ${seconds}초 (내레이션 총 ${Math.round(seconds * 6)}자 안팎, 장면 ${Math.max(3, Math.round(seconds / 4))}개 안팎)` }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude API 키가 올바르지 않아요. 설정에서 확인해 주세요.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('이 API 키로는 사용할 수 없는 요청이에요.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('요청이 너무 많거나 사용 한도를 넘었어요. 잠시 후 다시 시도해 주세요.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('인터넷 연결을 확인해 주세요.');
    if (e instanceof Anthropic.APIError) throw new Error(`AI 요청 실패 (${e.status}): ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('이 주제로는 대본을 만들 수 없어요. 다른 주제로 시도해 주세요.');
  if (res.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 잘렸어요. 길이를 줄여 다시 시도해 주세요.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text);
  if (!out.scenes?.length) throw new Error('대본이 비어 있어요. 다시 시도해 주세요.');
  return out;
}

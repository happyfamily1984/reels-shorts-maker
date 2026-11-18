// AI 음성(TTS) — Google Cloud Text-to-Speech를 사용자의 API 키로 휴대폰에서 직접 호출한다.
const BASE = 'https://texttospeech.googleapis.com/v1';

async function call(url, init) {
  let r;
  try { r = await fetch(url, init); } catch { throw new Error('인터넷 연결을 확인해 주세요.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 400 && /API key not valid/i.test(j.error?.message || '')) throw new Error('Google API 키가 올바르지 않아요. 설정에서 확인해 주세요.');
    if (r.status === 403) throw new Error('이 키로 Text-to-Speech API를 쓸 수 없어요. Google Cloud에서 API 사용 설정을 확인해 주세요.');
    if (r.status === 429) throw new Error('음성 합성 사용 한도를 넘었어요. 잠시 후 다시 시도해 주세요.');
    throw new Error(`음성 합성 실패 (${r.status}): ${j.error?.message || ''}`);
  }
  return j;
}

// 한국어 음성 목록 (계정에서 실제로 쓸 수 있는 것만 내려온다)
export async function listVoices(key) {
  const j = await call(`${BASE}/voices?languageCode=ko-KR&key=${encodeURIComponent(key)}`);
  return (j.voices || []).map((v) => ({ name: v.name, gender: v.ssmlGender === 'MALE' ? '남성' : v.ssmlGender === 'FEMALE' ? '여성' : '중성' }));
}

export async function synth(key, text, voice, rate) {
  const j = await call(`${BASE}/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: { text }, voice: { languageCode: 'ko-KR', name: voice }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate } }),
  });
  const bin = atob(j.audioContent), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: 'audio/mpeg' });
}

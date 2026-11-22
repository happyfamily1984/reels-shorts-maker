// 말하는 사진: 사진 한 장의 얼굴 위치(478개 점)를 찾아, 그 그물을 조금씩 일그러뜨려
// 입(턱)이 음성에 맞춰 벌어지고, 눈을 깜빡이고, 고개가 살짝 움직이게 한다. 휴대폰 안에서만 돌아간다(무료·무제한).
//  - 얼굴 찾기: MediaPipe Face Landmarker (js/vendor/mediapipe, 처음 한 번만 사진을 분석해 점을 저장)
//  - 그리기: WebGL로 사진을 삼각형 그물에 입혀 변형 → 2D 캔버스에 그대로 그릴 수 있는 캔버스를 돌려준다
import Delaunator from './vendor/delaunator.mjs';

/* ───────── 얼굴 찾기 ───────── */
let landmarkerP = null;
async function landmarker() {
  if (!landmarkerP) {
    landmarkerP = (async () => {
      const base = new URL('./vendor/mediapipe/', import.meta.url).href;
      const { FilesetResolver, FaceLandmarker } = await import('./vendor/mediapipe/vision_bundle.mjs');
      const fs = await FilesetResolver.forVisionTasks(base + 'wasm');
      return FaceLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: base + 'face_landmarker.task', delegate: 'CPU' },
        runningMode: 'IMAGE', numFaces: 1,
      });
    })();
    landmarkerP.catch(() => { landmarkerP = null; });
  }
  return landmarkerP;
}
// 사진에서 얼굴 점들을 찾는다. 결과: [x0,y0,x1,y1,...] (사진 픽셀 좌표) 또는 null(얼굴 없음)
export async function findFace(bitmap) {
  const lm = await landmarker();
  const r = lm.detect(bitmap);
  const f = r.faceLandmarks && r.faceLandmarks[0];
  if (!f) return null;
  const out = new Float32Array(f.length * 2);
  f.forEach((p, i) => { out[i * 2] = p.x * bitmap.width; out[i * 2 + 1] = p.y * bitmap.height; });
  return Array.from(out, (v) => Math.round(v * 10) / 10);
}

/* ───────── 얼굴 부위 (MediaPipe 점 번호) ───────── */
const INNER_UP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const INNER_LO = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const OUTER_UP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const OUTER_LO = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
const L_UP = [246, 161, 160, 159, 158, 157, 173], L_LO = [7, 163, 144, 145, 153, 154, 155];
const R_UP = [466, 388, 387, 386, 385, 384, 398], R_LO = [249, 390, 373, 374, 380, 381, 382];
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

/* ───────── 그물 만들기 ───────── */
// 얼굴 점 + 얼굴 둘레 바깥 고리(목·머리까지 부드럽게 이어지게) + 사진 가장자리(고정) 로 삼각형 그물을 만든다
export function createTalker(img, pts) {
  const W = img.width, H = img.height, n = pts.length / 2;
  const P = (i) => [pts[i * 2], pts[i * 2 + 1]];
  let cx = 0, cy = 0; for (const i of OVAL) { cx += P(i)[0]; cy += P(i)[1]; } cx /= OVAL.length; cy /= OVAL.length;
  const faceH = Math.hypot(P(152)[0] - P(10)[0], P(152)[1] - P(10)[1]), faceW = Math.hypot(P(454)[0] - P(234)[0], P(454)[1] - P(234)[1]);
  const src = [...pts], kind = new Array(n).fill(1); // 1: 얼굴, 0.5: 고리, 0: 고정
  for (const k of [1.25, 1.6]) for (const i of OVAL) { // 두 겹의 고리
    const [x, y] = P(i); src.push(cx + (x - cx) * k, cy + (y - cy) * k); kind.push(k < 1.4 ? 0.55 : 0.15);
  }
  const step = Math.max(W, H) / 8;
  for (let x = 0; x <= W; x += W / Math.ceil(W / step)) { src.push(x, 0, x, H); kind.push(0, 0); }
  for (let y = step; y < H; y += H / Math.ceil(H / step)) { src.push(0, y, W, y); kind.push(0, 0); }
  const tri = new Delaunator(src).triangles;

  // 변형에 쓰는 값들
  const mouthY = (P(13)[1] + P(14)[1]) / 2, mouthX = (P(13)[0] + P(14)[0]) / 2;
  const chin = P(152), lipH = Math.max(2, P(14)[1] - P(13)[1]);
  const mouthHalf = Math.max(4, Math.abs(P(291)[0] - P(61)[0]) / 2);
  const arc = (x) => { const d = (x - mouthX) / mouthHalf; return Math.max(0, 1 - d * d); }; // 입 가운데 1 → 입꼬리 0
  const upIdx = new Set([...INNER_UP, ...OUTER_UP]), loIdx = new Set([...INNER_LO, ...OUTER_LO]);
  const eyeOpenL = P(145)[1] - P(159)[1], eyeOpenR = P(374)[1] - P(386)[1];
  const lidL = new Set(L_UP), lidR = new Set(R_UP);
  const N = src.length / 2;

  /* WebGL */
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true });
  if (!gl) throw new Error('WebGL을 쓸 수 없어요');
  const sh = (type, code) => { const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `attribute vec2 p; attribute vec2 u; uniform vec2 sz; varying vec2 v;
    void main(){ v = u / sz; gl_Position = vec4(p / sz * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0); }`));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `precision mediump float; uniform sampler2D t; uniform vec4 col; varying vec2 v;
    void main(){ gl_FragColor = col.a > 0.0 ? col : texture2D(t, v); }`));
  gl.linkProgram(prog); gl.useProgram(prog);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const aP = gl.getAttribLocation(prog, 'p'), aU = gl.getAttribLocation(prog, 'u');
  const uSz = gl.getUniformLocation(prog, 'sz'), uCol = gl.getUniformLocation(prog, 'col');
  gl.uniform2f(uSz, W, H);
  const bufP = gl.createBuffer(), bufU = gl.createBuffer(), bufI = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufU); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(src), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufI); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tri), gl.STATIC_DRAW);
  const bufM = gl.createBuffer(), dst = new Float32Array(src.length);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // open: 입 벌림 0~1, blink: 눈 감김 0~1, yaw/pitch/roll: 고개 (-1~1 정도의 작은 값)
  function render({ open = 0, blink = 0, roll = 0, nod = 0, turn = 0 } = {}) {
    const jaw = Math.min(open, 0.9) * faceH * 0.06;
    for (let i = 0; i < N; i++) {
      let x = src[i * 2], y = src[i * 2 + 1];
      const w = kind[i];
      if (i < n) {
        // 턱·아랫입술: 입 선 아래쪽은 아래로 (가운데일수록 많이, 턱선 양옆은 덜)
        // 입술: 입 가운데가 가장 많이, 입꼬리는 그대로 → 둥근 입 모양으로 벌어진다
        if (loIdx.has(i)) y += jaw * arc(x);
        else if (upIdx.has(i)) y -= jaw * 0.15 * arc(x);
        else if (y > mouthY) {
          // 턱: 입 아래 살과 턱끝은 아래로 (얼굴 가운데일수록 많이, 턱선 양옆은 덜). 입술 바로 아래는 입술 모양을 따라간다
          const side = Math.min(1, Math.abs(x - mouthX) / (faceW * 0.5));
          const k = Math.min(1, (y - mouthY) / Math.max(1, chin[1] - mouthY));
          y += jaw * Math.max(0, 1 - side * side) * (arc(x) * (1 - k) + k * 0.95);
        }
        // 눈 깜빡임: 윗눈꺼풀을 아래로
        if (lidL.has(i)) y += blink * eyeOpenL * 0.95;
        if (lidR.has(i)) y += blink * eyeOpenR * 0.95;
      } else if (w > 0 && y > mouthY && Math.abs(x - mouthX) < faceW * 0.6) {
        y += jaw * 0.35 * w; // 턱 아래 고리도 조금 따라 내려간다(목이 자연스럽게)
      }
      // 고개: 턱 아래를 축으로 살짝 기울이고 끄덕이고 돌린다 (얼굴 1, 고리는 덜, 가장자리 0)
      if (w > 0) {
        const dx = x - cx, dy = y - (chin[1] + faceH * 0.3), a = roll * 0.06 * w;
        x = cx + dx * Math.cos(a) - dy * Math.sin(a) + turn * faceW * 0.05 * w;
        y = chin[1] + faceH * 0.3 + dx * Math.sin(a) + dy * Math.cos(a) + nod * faceH * 0.025 * w;
      }
      dst[i * 2] = x; dst[i * 2 + 1] = y;
    }
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(uCol, 0, 0, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.bufferData(gl.ARRAY_BUFFER, dst, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufU); gl.enableVertexAttribArray(aU); gl.vertexAttribPointer(aU, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufI); gl.drawElements(gl.TRIANGLES, tri.length, gl.UNSIGNED_SHORT, 0);
    // 벌어진 입 안쪽: 안쪽 입술 선으로 둘러싼 곳을 어두운 입속 색으로, 위쪽에 이를 살짝
    if (open > 0.04) {
      const poly = [...INNER_UP, ...INNER_LO.slice(1, -1).reverse()].map((i) => [dst[i * 2], dst[i * 2 + 1]]);
      const mx = poly.reduce((s, p) => s + p[0], 0) / poly.length, my = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const fan = [mx, my]; for (const p of poly) fan.push(p[0], p[1]); fan.push(poly[0][0], poly[0][1]);
      gl.disableVertexAttribArray(aU);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufM); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fan), gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
      const a = Math.min(1, open * 3);
      gl.uniform4f(uCol, 0.16 * a, 0.05 * a, 0.06 * a, a); gl.drawArrays(gl.TRIANGLE_FAN, 0, fan.length / 2);
      // 윗니: 안쪽 윗입술 선 바로 아래 얇은 띠
      const teeth = [];
      for (let k = 2; k < INNER_UP.length - 2; k++) {
        const i = INNER_UP[k], j = INNER_LO[k];
        const x = dst[i * 2], y = dst[i * 2 + 1], y2 = dst[j * 2 + 1];
        teeth.push(x, y, x, y + Math.min(lipH * 0.9 + jaw * 0.12, (y2 - y) * 0.4));
      }
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(teeth), gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
      const ta = a * 0.9; gl.uniform4f(uCol, 0.95 * ta, 0.94 * ta, 0.9 * ta, ta); gl.drawArrays(gl.TRIANGLE_STRIP, 0, teeth.length / 2);
    }
    return cv;
  }
  // 얼굴 틀: 가운데·크기 (화면에 맞춰 자를 때 쓴다)
  const face = { x: cx, y: cy, w: faceW, h: faceH };
  return { canvas: cv, render, width: W, height: H, face };
}

// 시간 t(초)와 음성 크기 amp(0~1)로 표정 값을 만든다 (깜빡임은 3~5초마다, 고개는 천천히, 말할 때 조금 더)
export function poseAt(t, amp) {
  const bp = (t + 0.7) % 4.1, blink = bp < 0.16 ? Math.sin(bp / 0.16 * Math.PI) : 0;
  return {
    open: Math.min(1, amp * 1.15),
    blink,
    roll: Math.sin(t * 0.9) * 0.6 + amp * Math.sin(t * 5.3) * 0.5,
    nod: Math.sin(t * 1.3) * 0.4 + amp * Math.sin(t * 7.1) * 0.6,
    turn: Math.sin(t * 0.55) * 0.5,
  };
}

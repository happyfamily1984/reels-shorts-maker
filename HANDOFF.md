# 작업 인계 (새 세션용)

새 세션에서는 **"HANDOFF.md 읽고 ccr-5697dca0-7wngzw 브랜치에서 이어서 해"** 라고 시작하면 됩니다.
APK를 다시 만들 계획이면 서명 키 파일 2개(`shorts.jks`, `shorts-keystore-password.txt`)를 첫 메시지에 첨부하세요.

## 현재 상태
- 작업 브랜치: `ccr-5697dca0-7wngzw` (모든 코드가 여기에 푸시돼 있음. 기본 브랜치에는 병합 안 됨)
- 최신 버전: **2.6** (`android/app/build.gradle`의 versionCode 17 / versionName 2.6), 웹 캐시 `sw.js` VERSION v19
- 다음 버전을 낼 때마다 versionCode·versionName·`sw.js` VERSION을 함께 올린다.

## APK 빌드 (클라우드 세션)
안드로이드 SDK는 세션 컨테이너에 없으므로 처음 한 번 설치한다.
```
export ANDROID_HOME=/root/android-sdk
mkdir -p $ANDROID_HOME/cmdline-tools && cd /tmp
curl -sSfLo ct.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -qo ct.zip -d $ANDROID_HOME/cmdline-tools && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
```
빌드 (서명 키 별칭 `shorts`, 키 비밀번호 = 저장소 비밀번호):
```
export SHORTS_KEYSTORE=<shorts.jks 경로> SHORTS_KEYSTORE_PASS=<비밀번호>
cd android && gradle assembleRelease      # → app/build/outputs/apk/release/app-release.apk
```
- 서명 확인: `apksigner verify --print-certs` → SHA-256 `e8be880f633d4e14036bc37fe2715976e3d9a6b6d7408cb98affd5618e5464a1` 이어야 기존 앱 위에 덮어 설치된다.
- 키가 다르면 기존 앱을 지우고 다시 깔아야 하고, 그러면 앱 안의 영상·캐릭터가 지워진다(먼저 설정 → 💾 백업).
- 만든 APK는 `out/`(git 제외)에 복사해 사용자에게 파일로 보낸다.

## 사용자 규칙 (전역 지침)
- 항상 한국어로 답한다.
- 뒤로가기: 열린 창 닫기 → 이전 화면 → 홈에서는 "앱을 종료하겠습니까?" 확인 후 종료 (`js/app.js`의 backStack, 안드로이드 `onBackPressed` → `window.__back`).

## 구조 요약
- `js/app.js` 화면 전체 (홈·캐릭터·편집기·시트·백업), `js/render.js` 프레임 그리기(자막·캐릭터 창·말하는 장면), `js/talk.js` 말하는 캐릭터 엔진,
  `js/ai.js` Gemini(대본·이미지 설명·캐릭터 설정·TTS), `js/exporter.js` MP4 인코딩, `js/db.js` IndexedDB(projects·media·characters).
- `android/` WebView 껍데기: 파일 선택, 갤러리 저장·공유(`fileEnd`), 그림+글 함께 보내기(`shareImage`), 클립보드(`copy`), 글 보내기(`shareText`), 백업 저장(`backupEnd`).
- 외부 라이브러리: MediaPipe Tasks Vision 0.10.21(얼굴 478점), delaunator 5.0.1 — `js/vendor/`.

## 주요 기능 흐름
- AI 대본(장면 제목·대사·그림 설명·움직임 설명) → 🖼 이미지 시트에서 장면별 그림 주문서 보내기/복사 → 받은 그림 넣기(아래 단색 빈 띠 자동 잘라냄) → 모든 장면 차면 효과 자동 추천.
- 🎬 모션: 장면 그림+움직임 주문서를 Gemini·ChatGPT·Kling 등으로 보내 받은 영상을 장면에 넣기.
- 캐릭터(홈 "내 캐릭터"): 대표 사진(배경 자동 제거 + 원본 보관 + 얼굴 점), 아바타 사진 세트 10자세, 입 모양 세트 4장(반쯤·크게·오·눈 감음).
  격자(2×2 등)로 받은 그림은 앱이 잘라 넣는다.
- 말하는 캐릭터: 입 모양 사진이 있으면 얼굴 점으로 맞춰 입·눈 부분만 겹침(`createFrameTalker`), 없으면 그물 변형(`createTalker`). 음성 크기(`talkEnvelope`)로 입을 연다.
  장면을 "캐릭터가 말하기"로 바꾸면 화면 가득, 아니면 8방향 중 고른 위치의 작은 동그란 창.
- 스타일: 위 자막/아래 대사 자막의 크기·높이를 버튼으로 조절(슬라이더는 스크롤 중 실수로 바뀌어 버튼으로 바꿈).
- 설정: Gemini API 키(여러 개), 대본 모델, 💾 백업 파일 만들기 / 📂 백업 불러오기(`.rsmbak`, API 키는 포함 안 됨).

## 시험 방법 (이 환경)
`python3 -m http.server 8765`로 띄우고 Playwright(Chromium, WebGL은 `--use-gl=swiftshader`)로 화면을 조작.
Gemini 호출은 `page.route('**/v1beta/interactions', …)`로 가짜 응답(대본 JSON, TTS는 24kHz PCM base64).
내보낸 MP4는 ffmpeg로 프레임을 뽑아 확인.

## 아직 실제로 확인 못 한 것
- 실제 휴대폰에서: 말하는 캐릭터(MediaPipe wasm 로딩 포함), 입 모양 사진 겹치기 품질, 그림+글 공유가 각 앱에 그대로 넘어가는지, 백업 파일 저장·복원.
- 실제 Gemini 호출(대본·음성)과 실제 이미지 AI가 "입만 바꾸기"·격자 순서를 지키는지.
- 2.4의 "캐릭터 그림 불러오지 못함" 수정은 원인 추정(파일 한 번만 읽힘)으로 고쳤고, 흉내 낸 환경에서만 확인함.

## 사용자가 원했던 방향 (참고)
- 사진으로 만든 실사 캐릭터가 실제로 말하고 움직이는 영상. 무료가 우선. 유료 말하는 아바타 API(HeyGen·D-ID·Kling 아바타)나 Veo는 비용 문제로 보류.
- 다음 후보: Hugging Face 무료 공개 모델(MuseTalk·SadTalker)로 "고화질 다시 만들기"(하루 몇 개 제한), 한 장면 안에서 자세 바꾸기.

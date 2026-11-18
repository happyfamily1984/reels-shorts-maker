# 🎬 릴스·쇼츠 메이커

휴대폰만으로 인스타그램 릴스·유튜브 쇼츠용 세로(9:16) 영상을 만드는 웹앱(PWA)입니다.
**서버도 PC도 필요 없습니다.** 영상 인코딩까지 전부 휴대폰 브라우저 안에서 처리합니다.

## 사용법
1. 휴대폰 Chrome으로 앱 주소를 열고 메뉴 → **홈 화면에 추가**(앱처럼 설치, 오프라인 동작)
2. **＋ 새 영상 만들기**
   - 🤖 AI로 만들기: 주제만 적으면 대본·자막·이모지·해시태그까지 작성 (Claude API 키 필요)
   - 📝 대본으로 만들기: 글을 붙여넣으면 문장마다 장면·자막 자동 생성
   - 🖼 사진·영상으로 만들기: 갤러리에서 여러 개 선택
3. 장면 편집(자막·길이·움직임·스티커·영상 구간 자르기·나누기), 스타일(템플릿·자막 디자인·전환),
   오디오(내장 음악·내 음악 파일·AI 음성·내레이션 녹음)
4. **내보내기** → MP4 완성 → 인스타·유튜브로 바로 공유하거나 기기에 저장

## API 키 (선택 기능)
홈 화면 ⚙️ 설정에서 입력합니다. 키는 기기에만 저장되고 해당 서비스로만 직접 전송됩니다.
| 기능 | 필요한 키 | 발급처 |
|---|---|---|
| AI 대본 작성 | Claude API 키 | Claude Console (platform.claude.com) |
| AI 음성(TTS) | Google Cloud API 키 | Google Cloud Console에서 Cloud Text-to-Speech API 사용 설정 후 발급 |

키가 없어도 나머지 기능(편집·내장 음악·내보내기)은 모두 동작합니다.

## 적용 기술
| 기술 | 용도 |
|---|---|
| Canvas 2D 렌더 엔진 | 미리보기와 결과물이 동일한 프레임 합성 (켄번스, 자막 효과, 전환) |
| WebCodecs + mp4-muxer | 기기 내 H.264/AAC MP4 고속 인코딩 |
| MediaRecorder | WebCodecs 미지원 브라우저용 대체 내보내기, 내레이션 녹음 |
| Web Audio (OfflineAudioContext) | 배경음악·내레이션·클립 소리 믹싱 |
| Claude API (Anthropic SDK, 구조화 출력) | AI 대본·자막·해시태그 생성 |
| Google Cloud Text-to-Speech | 장면별 AI 음성 내레이션 |
| Web Audio 신시사이저 | 음원 파일 없이 내장 음악 5종을 즉석 생성 |
| IndexedDB | 프로젝트·미디어를 기기에 저장 (자동 저장) |
| Service Worker + Manifest | 설치형 PWA, 오프라인 실행 |
| Web Share API | 완성 영상을 인스타·유튜브 앱으로 바로 전달 |
| Screen Wake Lock | 내보내는 동안 화면 꺼짐 방지 |
| GitHub Actions + Pages | 푸시하면 자동 배포 (PC를 켜둘 필요 없음) |

## 배포 (최초 1회 설정)
저장소 **Settings → Pages → Source 를 "GitHub Actions"** 로 바꾸면, 기본 브랜치에 푸시할 때마다
`https://<계정>.github.io/reels-shorts-maker/` 로 자동 배포됩니다.

## 구조
- `index.html`, `css/style.css` — 화면
- `js/app.js` — 화면 흐름(홈·편집기·시트), 뒤로가기 처리
- `js/render.js` — 프레임 렌더·오디오 믹싱
- `js/exporter.js` — 영상 인코딩
- `js/ai.js`, `js/tts.js` — AI 대본, AI 음성
- `js/music.js` — 내장 음악 생성
- `js/db.js` — 저장소
- `sw.js` — 오프라인 캐시 (배포 시 `VERSION` 올리기)

## 로컬 실행
`python3 -m http.server` 후 `http://localhost:8000`

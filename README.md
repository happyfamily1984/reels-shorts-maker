# 🎬 릴스·쇼츠 메이커

휴대폰만으로 인스타그램 릴스·유튜브 쇼츠용 세로(9:16) 영상을 만드는 웹앱(PWA)입니다.
**서버도 PC도 필요 없습니다.** 영상 인코딩까지 전부 휴대폰 브라우저 안에서 처리합니다.

## 사용법
1. 휴대폰 Chrome으로 앱 주소를 열고 메뉴 → **홈 화면에 추가**(앱처럼 설치, 오프라인 동작)
2. **＋ 새 영상 만들기**
   - 📝 대본으로 만들기: 글을 붙여넣으면 문장마다 장면·자막 자동 생성
   - 🖼 사진·영상으로 만들기: 갤러리에서 여러 개 선택
3. 장면 편집(자막·길이·움직임), 스타일(자막 디자인·전환), 오디오(배경음악·내레이션 녹음)
4. **내보내기** → MP4 완성 → 인스타·유튜브로 바로 공유하거나 기기에 저장

## 적용 기술
| 기술 | 용도 |
|---|---|
| Canvas 2D 렌더 엔진 | 미리보기와 결과물이 동일한 프레임 합성 (켄번스, 자막 효과, 전환) |
| WebCodecs + mp4-muxer | 기기 내 H.264/AAC MP4 고속 인코딩 |
| MediaRecorder | WebCodecs 미지원 브라우저용 대체 내보내기, 내레이션 녹음 |
| Web Audio (OfflineAudioContext) | 배경음악·내레이션·클립 소리 믹싱 |
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
- `js/db.js` — 저장소
- `sw.js` — 오프라인 캐시 (배포 시 `VERSION` 올리기)

## 로컬 실행
`python3 -m http.server` 후 `http://localhost:8000`

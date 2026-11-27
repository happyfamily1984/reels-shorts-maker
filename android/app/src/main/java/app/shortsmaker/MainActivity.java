package app.shortsmaker;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 웹앱을 담는 껍데기. APK 안의 파일을 https://appassets.androidplatform.net/ 주소로 내주어
 * (보안 컨텍스트) 저장소·영상 인코딩·마이크가 브라우저와 똑같이 동작하게 한다.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/www/index.html";
    private static final int REQ_FILE = 1, REQ_MIC = 2;
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html"); MIME.put("css", "text/css");
        MIME.put("js", "text/javascript"); MIME.put("mjs", "text/javascript");
        MIME.put("json", "application/json"); MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml"); MIME.put("png", "image/png");
        MIME.put("wasm", "application/wasm"); MIME.put("webp", "image/webp"); // 얼굴 찾기(MediaPipe) 엔진
    }

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest micRequest;
    private File outFile;
    private FileOutputStream outStream;
    private String outName, outMime;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#07070f"));
        setContentView(web);
        // 상태바·내비게이션바·키보드에 가리지 않도록 여백을 준다
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            ((View) v.getParent()).setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        web.addJavascriptInterface(new Bridge(), "Android");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null; // 외부 요청(AI API)은 그대로 통과
                String path = u.getPath() == null ? "" : u.getPath().replaceFirst("^/", "");
                if (path.isEmpty() || path.endsWith("/")) path += "index.html";
                String ext = path.contains(".") ? path.substring(path.lastIndexOf('.') + 1) : "";
                String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
                try {
                    InputStream in = getAssets().open(path);
                    boolean text = mime.startsWith("text/") || mime.contains("json") || mime.contains("svg");
                    return new WebResourceResponse(mime, text ? "utf-8" : null, in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new java.io.ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (HOST.equals(req.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception ignored) { }
                return true; // 바깥 링크는 기본 브라우저로
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                String[] types = params.getAcceptTypes();
                boolean any = types == null || types.length == 0 || (types.length == 1 && types[0].isEmpty());
                if (any) i.setType("*/*");
                else if (types.length == 1) i.setType(types[0]);
                else { i.setType("*/*"); i.putExtra(Intent.EXTRA_MIME_TYPES, types); }
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "파일 선택"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsMic = false;
                    for (String r : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
                    if (!wantsMic) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        micRequest = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                    }
                });
            }
        });

        if (state == null) web.loadUrl(START); else web.restoreState(state);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_FILE || fileCallback == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                uris = new Uri[n];
                for (int i = 0; i < n; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(uris);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req != REQ_MIC || micRequest == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            micRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            micRequest.deny();
        }
        micRequest = null;
    }

    /** 뒤로가기는 웹앱이 처리한다: 열린 창 닫기 → 이전 화면 → 홈에서 종료 확인 */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.__back ? (window.__back(), true) : false", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    /** 웹앱에서 window.Android.* 로 부르는 기능들 */
    private class Bridge {
        @JavascriptInterface
        public boolean copy(String text) {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("prompt", text));
                return true;
            } catch (Exception e) { return false; }
        }

        // 글을 다른 앱(ChatGPT·Gemini 등)으로 보낸다 — 공유 창에서 앱을 고른다
        @JavascriptInterface
        public void shareText(String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "프롬프트 보내기"));
            });
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(MainActivity.this::finishAndRemoveTask);
        }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        // 완성 영상은 크기가 커서 조각으로 나눠 받는다: fileBegin → fileChunk… → fileEnd
        @JavascriptInterface
        public synchronized void fileBegin(String name, String mime) throws Exception {
            if (outStream != null) outStream.close();
            outName = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            outMime = mime;
            outFile = new File(getCacheDir(), "export.tmp");
            outStream = new FileOutputStream(outFile);
        }

        @JavascriptInterface
        public synchronized void fileChunk(String b64) throws Exception {
            outStream.write(Base64.decode(b64, Base64.DEFAULT));
        }

        /** fileBegin·fileChunk로 받은 그림을 Pictures/ShortsMaker에 저장하고, 글과 함께 다른 앱(Gemini·ChatGPT 등)으로 보낸다. */
        @JavascriptInterface
        public synchronized String shareImage(String text) {
            try {
                outStream.close();
                outStream = null;
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, outName);
                v.put(MediaStore.Images.Media.MIME_TYPE, outMime);
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ShortsMaker");
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) return "그림을 준비하지 못했어요";
                try (InputStream in = new FileInputStream(outFile); OutputStream out = getContentResolver().openOutputStream(uri)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                getContentResolver().update(uri, v, null, null);
                outFile.delete();
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(outMime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_TEXT, text);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, "움직이는 영상 만들기")));
                return "ok";
            } catch (Exception e) {
                return "보내지 못했어요: " + e.getMessage();
            }
        }

        /** 백업 파일: 다운로드/ShortsMaker 폴더에 저장하고 공유 창(구글 드라이브·카톡 등)을 연다 */
        @JavascriptInterface
        public synchronized String backupEnd() {
            try {
                outStream.close();
                outStream = null;
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, outName);
                v.put(MediaStore.Downloads.MIME_TYPE, outMime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ShortsMaker");
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) return "저장 위치를 만들지 못했어요";
                try (InputStream in = new FileInputStream(outFile); OutputStream out = getContentResolver().openOutputStream(uri)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                v.clear();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, v, null, null);
                outFile.delete();
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(outMime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, "백업 파일 보관하기")));
                return "다운로드/ShortsMaker 폴더에 저장했어요. 구글 드라이브 등에도 올려 두세요";
            } catch (Exception e) {
                return "백업 저장에 실패했어요: " + e.getMessage();
            }
        }

        /** action: "save"(갤러리에 저장) 또는 "share"(저장 후 공유 창 열기). 사용자에게 보여줄 문구를 돌려준다. */
        @JavascriptInterface
        public synchronized String fileEnd(String action) {
            try {
                outStream.close();
                outStream = null;
                ContentValues v = new ContentValues();
                v.put(MediaStore.Video.Media.DISPLAY_NAME, outName);
                v.put(MediaStore.Video.Media.MIME_TYPE, outMime);
                v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/ShortsMaker");
                v.put(MediaStore.Video.Media.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) return "저장 위치를 만들지 못했어요";
                try (InputStream in = new FileInputStream(outFile); OutputStream out = getContentResolver().openOutputStream(uri)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                v.clear();
                v.put(MediaStore.Video.Media.IS_PENDING, 0);
                getContentResolver().update(uri, v, null, null);
                outFile.delete();
                if ("share".equals(action)) {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(outMime);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    runOnUiThread(() -> startActivity(Intent.createChooser(send, "영상 공유")));
                    return "갤러리(Movies/ShortsMaker)에 저장하고 공유 창을 열었어요";
                }
                return "갤러리(Movies/ShortsMaker)에 저장했어요";
            } catch (Exception e) {
                return "저장에 실패했어요: " + e.getMessage();
            }
        }
    }
}

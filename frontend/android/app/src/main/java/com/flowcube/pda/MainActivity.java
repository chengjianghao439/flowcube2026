package com.flowcube.pda;

import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PdaAppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();

        // ── 1. 屏幕常亮（仓库作业不锁屏）─────────────────────────────────
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // ── 2. 显示系统状态栏与底部导航栏（普通 App 模式）────────────────
        // 不隐藏系统 UI，让页面布局自动适配安全区域
        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);

        // ── 3. 键盘弹出时自动上移内容，避免遮挡输入框 ────────────────────
        window.setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
        );

        // ── 4. WebView 性能优化 ───────────────────────────────────────────
        if (getBridge() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();

            // 开启硬件加速渲染
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

            // 文本大小不随系统字体缩放（工业设备字号固定）
            settings.setTextZoom(100);

            // 禁止用户手动缩放（扫码场景不需要捏合缩放）
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);

            // 允许 JavaScript（Capacitor 默认已开启，显式确认）
            settings.setJavaScriptEnabled(true);

            // DOM Storage（localStorage / sessionStorage）
            settings.setDomStorageEnabled(true);

            // 缓存模式：优先使用缓存，断网也可打开已缓存页面
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);

            // 混合内容（HTTP + HTTPS 共存，局域网内网需要）
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }

    @Override
    public void onBackPressed() {
        // 物理返回键：优先让 WebView 返回历史页面
        // 若已是 /pda 根页面则不退出 App（防止误操作）
        if (getBridge() != null && getBridge().getWebView().canGoBack()) {
            getBridge().getWebView().goBack();
        }
        // 不调用 super，防止退出 App
    }
}

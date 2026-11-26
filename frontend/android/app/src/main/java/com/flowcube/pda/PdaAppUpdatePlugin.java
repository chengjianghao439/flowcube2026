package com.flowcube.pda;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.system.Os;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PdaAppUpdate")
public class PdaAppUpdatePlugin extends Plugin {

    private static final long MAX_APK_BYTES = 150L * 1024 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private boolean hasInstallPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void getInstallPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", hasInstallPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (hasInstallPermission()) {
            call.resolve();
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("无法打开安装授权设置");
            return;
        }

        Intent settingsIntent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(settingsIntent);
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("无法打开安装授权设置", error);
            }
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url");
        String expectedSha256 = call.getString("sha256");
        String operationId = call.getString("operationId");
        Integer expectedVersionCode = call.getInt("versionCode");
        if (operationId == null || operationId.isEmpty() || expectedVersionCode == null || expectedVersionCode < 1) {
            call.reject("更新操作或版本信息不完整");
            return;
        }
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            call.reject("更新地址不能为空");
            return;
        }

        if (expectedSha256 == null || !expectedSha256.matches("[0-9a-fA-F]{64}")) {
            call.reject("更新清单缺少有效的 SHA-256 摘要");
            return;
        }
        final URL downloadUrl;
        try {
            downloadUrl = trustedDownloadUrl(rawUrl.trim());
        } catch (Exception error) {
            call.reject("更新地址必须来自安装包配置的 HTTPS 服务器");
            return;
        }
        call.resolve();

        executor.execute(() -> {
            File partial = null;
            try {
                if (!hasInstallPermission()) {
                    emitProgress(operationId, "permission_required", 0, "请开启此应用的安装授权");
                    return;
                }
                emitProgress(operationId, "starting", 0, "准备下载更新包");
                partial = downloadApk(downloadUrl, operationId);
                File apkFile = partial;
                if (!expectedSha256.equalsIgnoreCase(sha256Of(apkFile))) {
                    throw new Exception("更新包 SHA-256 校验失败");
                }
                verifyApkVersion(apkFile, expectedVersionCode);
                apkFile = new File(partial.getParentFile(), expectedSha256.toLowerCase(Locale.ROOT) + ".apk");
                Os.rename(partial.getAbsolutePath(), apkFile.getAbsolutePath());
                partial = null;
                emitProgress(operationId, "downloaded", 100, "下载完成，准备安装");
                installApk(apkFile, operationId);
            } catch (Exception e) {
                emitProgress(operationId, "error", 0, e.getMessage() == null ? "下载失败" : e.getMessage());
            } finally {
                if (partial != null) partial.delete();
            }
        });
    }

    private String sha256Of(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = fis.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : digest.digest()) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private URL trustedDownloadUrl(String rawUrl) throws Exception {
        try (BufferedReader input = new BufferedReader(new InputStreamReader(
                getContext().getAssets().open("public/native-update-origin.txt"), StandardCharsets.UTF_8))) {
            return validateUpdateUrl(input.readLine(), rawUrl);
        }
    }

    static URL validateUpdateUrl(String origin, String rawUrl) throws Exception {
        if (origin == null) throw new Exception("未配置更新源");
        URI trusted = new URI(origin.trim());
        URI candidate = new URI(rawUrl);
        if (!"https".equalsIgnoreCase(trusted.getScheme()) || !"https".equalsIgnoreCase(candidate.getScheme())
                || trusted.getHost() == null || !trusted.getHost().equalsIgnoreCase(candidate.getHost())
                || trusted.getUserInfo() != null || candidate.getUserInfo() != null || candidate.getFragment() != null
                || (trusted.getPort() < 0 ? 443 : trusted.getPort()) != (candidate.getPort() < 0 ? 443 : candidate.getPort())) {
            throw new Exception("更新地址与已配置来源不匹配");
        }
        return candidate.toURL();
    }

    private File downloadApk(URL url, String operationId) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        File partial = null;
        boolean complete = false;
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache, no-store");
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new Exception("更新服务器未返回完整安装包");
            long contentLength = connection.getContentLength();
            if (contentLength <= 0 || contentLength > MAX_APK_BYTES) throw new Exception("更新包长度无效或超出大小限制");

            File parent = new File(getContext().getCacheDir(), "updates");
            if (!parent.isDirectory() && !parent.mkdirs()) throw new Exception("无法创建更新目录");
            partial = File.createTempFile("pda-", ".part", parent);
            long downloaded = 0;
            int lastProgress = -1;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    downloaded += read;
                    if (downloaded > MAX_APK_BYTES || downloaded > contentLength) throw new Exception("更新包超出声明长度");
                    output.write(buffer, 0, read);
                    int progress = (int) (downloaded * 100 / contentLength);
                    if (progress != lastProgress) {
                        lastProgress = progress;
                        emitProgress(operationId, "downloading", progress, "正在下载更新包");
                    }
                }
            }
            if (downloaded != contentLength) throw new Exception("更新包下载不完整，请重试");
            complete = true;
            return partial;
        } finally {
            connection.disconnect();
            if (!complete && partial != null) partial.delete();
        }
    }

    @SuppressWarnings("deprecation")
    private long versionCodeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private void verifyApkVersion(File apkFile, int expectedVersionCode) throws Exception {
        PackageManager packageManager = getContext().getPackageManager();
        String packageName = getContext().getPackageName();
        PackageInfo archive = packageManager.getPackageArchiveInfo(apkFile.getAbsolutePath(), 0);
        if (archive == null || !packageName.equals(archive.packageName)) {
            throw new Exception("更新包与当前应用不匹配");
        }
        long installedVersion = versionCodeOf(packageManager.getPackageInfo(packageName, 0));
        long archiveVersion = versionCodeOf(archive);
        if (archiveVersion <= installedVersion) {
            throw new Exception("更新包版本不高于当前版本");
        }
        if (archiveVersion != expectedVersionCode) {
            throw new Exception("更新包版本与更新清单不符");
        }
    }

    private void installApk(File apkFile, String operationId) {
        Activity activity = getActivity();
        if (activity == null) {
            emitProgress(operationId, "error", 100, "安装界面无法打开");
            return;
        }

        if (!hasInstallPermission()) {
            emitProgress(operationId, "permission_required", 100, "请开启此应用的安装授权");
            return;
        }

        Uri apkUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apkFile
        );

        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(installIntent);
                emitProgress(operationId, "installing", 100, "已打开系统安装界面");
            } catch (RuntimeException error) {
                emitProgress(operationId, "error", 100, "安装界面无法打开");
            }
        });
    }

    private void emitProgress(String operationId, String status, int progress, String message) {
        JSObject payload = new JSObject();
        payload.put("operationId", operationId);
        payload.put("status", status);
        payload.put("progress", progress);
        payload.put("message", message == null ? "" : message);
        notifyListeners("updateProgress", payload);
    }

}

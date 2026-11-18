package com.flowcube.pda;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PdaAppUpdate")
public class PdaAppUpdatePlugin extends Plugin {

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
        String version = call.getString("version", "latest");
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

        final String downloadUrl = rawUrl.trim();
        final String safeVersion = version == null ? "latest" : version.trim();
        call.resolve();

        executor.execute(() -> {
            try {
                if (!hasInstallPermission()) {
                    emitProgress(operationId, "permission_required", 0, "请开启此应用的安装授权");
                    return;
                }
                emitProgress(operationId, "starting", 0, "准备下载更新包");
                File apkFile = downloadApk(downloadUrl, safeVersion, operationId);
                // APK sha256 校验（2026-08-21 审计 E 修复）：服务端下发哈希，
                // 下载完成后比对——哈希不匹配说明包被替换（API 基址被指到恶意
                // 服务器等），拒绝安装
                if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                    String actual = sha256Of(apkFile);
                    if (!expectedSha256.trim().equalsIgnoreCase(actual)) {
                        emitProgress(operationId, "error", 0, "更新包校验失败（sha256 不匹配），已中止安装");
                        if (apkFile.exists()) apkFile.delete();
                        return;
                    }
                }
                verifyApkVersion(apkFile, expectedVersionCode);
                emitProgress(operationId, "downloaded", 100, "下载完成，准备安装");
                installApk(apkFile, operationId);
            } catch (Exception e) {
                emitProgress(operationId, "error", 0, e.getMessage() == null ? "下载失败" : e.getMessage());
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

    private File downloadApk(String downloadUrl, String version, String operationId) throws Exception {
        HttpURLConnection connection = null;
        InputStream inputStream = null;
        FileOutputStream outputStream = null;
        try {
            URL url = new URL(downloadUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setRequestMethod("GET");
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache, no-store, must-revalidate");
            connection.setRequestProperty("Pragma", "no-cache");
            connection.connect();

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                throw new Exception("服务器返回异常：" + responseCode);
            }

            int contentLength = connection.getContentLength();
            inputStream = connection.getInputStream();

            File parentDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (parentDir == null) {
                parentDir = getContext().getCacheDir();
            }
            if (parentDir == null || (!parentDir.exists() && !parentDir.mkdirs())) {
                throw new Exception("无法创建更新目录");
            }

            File apkFile = new File(parentDir, "JiXu-Flow-PDA-" + sanitizeVersion(version) + ".apk");
            if (apkFile.exists() && !apkFile.delete()) {
                throw new Exception("旧更新包无法覆盖，请清理后重试");
            }

            outputStream = new FileOutputStream(apkFile);
            byte[] buffer = new byte[8192];
            long downloaded = 0;
            int read;
            int lastProgress = -1;

            while ((read = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, read);
                downloaded += read;
                if (contentLength > 0) {
                    int progress = (int) Math.min(100, Math.round((downloaded * 100f) / contentLength));
                    if (progress != lastProgress) {
                        lastProgress = progress;
                        emitProgress(operationId, "downloading", progress, "正在下载更新包");
                    }
                }
            }

            outputStream.flush();
            return apkFile;
        } finally {
            if (outputStream != null) outputStream.close();
            if (inputStream != null) inputStream.close();
            if (connection != null) connection.disconnect();
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

    private String sanitizeVersion(String version) {
        String safe = version == null ? "latest" : version.trim();
        return safe.isEmpty() ? "latest" : safe.replaceAll("[^0-9A-Za-z._-]", "_");
    }
}

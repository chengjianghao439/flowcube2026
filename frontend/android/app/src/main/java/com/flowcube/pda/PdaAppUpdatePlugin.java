package com.flowcube.pda;

import android.content.Intent;
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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PdaAppUpdate")
public class PdaAppUpdatePlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url");
        String version = call.getString("version", "latest");
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            call.reject("更新地址不能为空");
            return;
        }

        final String downloadUrl = rawUrl.trim();
        final String safeVersion = version == null ? "latest" : version.trim();
        call.resolve();

        executor.execute(() -> {
            try {
                emitProgress("starting", 0, "准备下载更新包");
                File apkFile = downloadApk(downloadUrl, safeVersion);
                emitProgress("downloaded", 100, "下载完成，准备安装");
                installApk(apkFile);
            } catch (Exception e) {
                emitProgress("error", 0, e.getMessage() == null ? "下载失败" : e.getMessage());
            }
        });
    }

    private File downloadApk(String downloadUrl, String version) throws Exception {
        HttpURLConnection connection = null;
        InputStream inputStream = null;
        FileOutputStream outputStream = null;
        try {
            URL url = new URL(downloadUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setRequestMethod("GET");
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

            File apkFile = new File(parentDir, "FlowCubePDA-" + sanitizeVersion(version) + ".apk");
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
                        emitProgress("downloading", progress, "正在下载更新包");
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

    private void installApk(File apkFile) {
        if (getActivity() == null) {
            emitProgress("error", 100, "安装界面无法打开");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PackageManager packageManager = getContext().getPackageManager();
            if (!packageManager.canRequestPackageInstalls()) {
                Intent settingsIntent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> startActivity(settingsIntent));
                emitProgress("permission_required", 100, "请允许安装未知来源应用后，再次点击更新");
                return;
            }
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

        getActivity().runOnUiThread(() -> {
            emitProgress("installing", 100, "已打开安装界面，请按系统提示完成安装");
            startActivity(installIntent);
        });
    }

    private void emitProgress(String status, int progress, String message) {
        JSObject payload = new JSObject();
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

package com.flowcube.pda;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * PDA 设备凭据加密存储（2026-08-21 权衡修复）。
 *
 * 用 Android Keystore 生成不可导出的 AES-256 密钥，凭据经 AES-GCM 加密后存
 * SharedPreferences——明文不再落盘。密钥由系统级 Keystore 保护（硬件隔离/强PIN
 * 保护），应用进程无法导出。替换原 localStorage 明文存储。
 *
 * WebView 侧（浏览器/非原生）无 Keystore，回退到内存态存储（不持久化，
 * 每次启动需重新绑定——现场 PDA 是真机 APK，走原生路径，不受影响）。
 */
@CapacitorPlugin(name = "SecureStorage")
public class SecureStoragePlugin extends Plugin {

    private static final String KEY_ALIAS = "flowcube_pda_secure_key";
    private static final String PREFS_NAME = "flowcube_secure";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String SEP = ".";

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        SecretKey existing = (SecretKey) ks.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;

        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    private byte[] encrypt(SecretKey key, String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        byte[] enc = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[iv.length + enc.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(enc, 0, out, iv.length, enc.length);
        return out;
    }

    private String decrypt(SecretKey key, byte[] data) throws Exception {
        int ivLen = 12; // GCM 标准 IV 12 字节
        byte[] iv = new byte[ivLen];
        byte[] enc = new byte[data.length - ivLen];
        System.arraycopy(data, 0, iv, 0, ivLen);
        System.arraycopy(data, ivLen, enc, 0, enc.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(enc), StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void setItem(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || value == null) {
            call.reject("key 和 value 必填");
            return;
        }
        try {
            SecretKey secretKey = getOrCreateKey();
            byte[] enc = encrypt(secretKey, value);
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(key, Base64.encodeToString(enc, Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("加密存储失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getItem(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("key 必填");
            return;
        }
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String encoded = prefs.getString(key, null);
            if (encoded == null) {
                call.resolve(new JSObject().put("value", (String) null));
                return;
            }
            SecretKey secretKey = getOrCreateKey();
            String plain = decrypt(secretKey, Base64.decode(encoded, Base64.NO_WRAP));
            call.resolve(new JSObject().put("value", plain));
        } catch (Exception e) {
            // 密钥不可用（Keystore 异常）时视为不存在，避免把损坏数据当凭据
            call.resolve(new JSObject().put("value", (String) null));
        }
    }

    @PluginMethod
    public void removeItem(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("key 必填");
            return;
        }
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(key).apply();
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().clear().apply();
        call.resolve();
    }

    /** 供 MainActivity 注册 */
    @NonNull
    public static String getPluginName() {
        return "SecureStorage";
    }
}

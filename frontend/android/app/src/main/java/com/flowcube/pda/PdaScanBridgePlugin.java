package com.flowcube.pda;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.device.ScanManager;
import android.device.scanner.configuration.PropertyID;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "PdaScanBridge")
public class PdaScanBridgePlugin extends Plugin {
    private static final String TAG = "PdaScanBridge";
    private static final String DEFAULT_ACTION = "android.intent.ACTION_DECODE_DATA";
    private static final String DEFAULT_BARCODE_KEY = "barcode_string";
    private static final String RESTORE_PREFS = "pda_scan_bridge";
    private static final String RESTORE_KEYBOARD = "restore_keyboard";

    private ScanManager scanManager;
    private ScannerModeLease modeLease;
    private String scanAction = DEFAULT_ACTION;
    private String barcodeKey = DEFAULT_BARCODE_KEY;
    private boolean receiverRegistered;
    private boolean enabled;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            String barcode = ScannerIntentPolicy.barcode(
                intent.getAction(), scanAction, intent.getStringExtra(barcodeKey)
            );
            if (barcode == null) return;
            JSObject data = new JSObject();
            data.put("barcode", barcode);
            notifyListeners("scan", data);
        }
    };

    @Override public void load() {
        try {
            scanManager = new ScanManager();
            SharedPreferences prefs = getContext().getSharedPreferences(RESTORE_PREFS, Context.MODE_PRIVATE);
            modeLease = new ScannerModeLease(new ScannerModeLease.Scanner() {
                @Override public int getOutputMode() { return scanManager.getOutputMode(); }
                @Override public boolean switchOutputMode(int target) {
                    return scanManager.switchOutputMode(target);
                }
            }, new ScannerModeLease.RestoreStore() {
                @Override public boolean keyboardRestorePending() {
                    return prefs.getBoolean(RESTORE_KEYBOARD, false);
                }
                @Override public boolean setKeyboardRestorePending(boolean value) {
                    // 切模式前同步落盘，进程异常退出后仍能在下次启动时恢复。
                    return prefs.edit().putBoolean(RESTORE_KEYBOARD, value).commit();
                }
            });
            // 先处理上次进程异常退出留下的设备模式，再启用已在 i6310pro 真机验证的广播接收。
            if (!modeLease.release()) {
                Log.w(TAG, "启动时未能恢复设备键盘扫码模式");
            } else if (startReceiving()) enabled = true;
        } catch (Throwable error) {
            // 非该厂商设备仍可使用既有键盘扫码；广播名沿用文档默认值。
            Log.w(TAG, "厂商扫码接口不可用，保留键盘扫码", error);
        }
    }

    @Override protected void handleOnResume() {
        if (enabled && !startReceiving()) enabled = false;
    }

    @PluginMethod public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", enabled && receiverRegistered);
        result.put("available", modeLease != null);
        call.resolve(result);
    }

    @PluginMethod public void setEnabled(PluginCall call) {
        Boolean requested = call.getBoolean("enabled");
        if (requested == null) {
            call.reject("缺少 enabled 参数");
            return;
        }
        if (requested) {
            if (!startReceiving()) {
                enabled = false;
                call.reject("设备广播扫码不可用，请继续使用输入框扫码");
                return;
            }
            enabled = true;
        } else {
            enabled = false;
            if (!stopReceiving()) {
                call.reject("未能恢复设备键盘扫码模式，请退出并重新打开应用");
                return;
            }
        }
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    private boolean startReceiving() {
        if (receiverRegistered) return true;
        if (modeLease == null) return false;
        readBroadcastSettings();
        try {
            IntentFilter filter = new IntentFilter(scanAction);
            // 只接收系统/本应用内广播；不能把可伪造的条码交给业务写操作。
            ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
            receiverRegistered = true;
        } catch (RuntimeException error) {
            Log.w(TAG, "无法监听扫码广播，保留键盘扫码", error);
            return false;
        }
        try {
            if (modeLease.acquire()) return true;
            Log.w(TAG, "设备未切换到广播模式，保留键盘扫码");
        } catch (Throwable error) {
            Log.w(TAG, "设备广播模式不可用，保留键盘扫码", error);
        }
        stopReceiving();
        return false;
    }

    @Override protected void handleOnPause() {
        stopReceiving();
    }

    @Override protected void handleOnDestroy() {
        stopReceiving();
    }

    private void readBroadcastSettings() {
        if (scanManager == null) return;
        try {
            String[] settings = scanManager.getParameterString(new int[] {
                PropertyID.WEDGE_INTENT_ACTION_NAME,
                PropertyID.WEDGE_INTENT_DATA_STRING_TAG
            });
            if (settings != null && settings.length >= 2) {
                if (settings[0] != null && !settings[0].isEmpty()) scanAction = settings[0];
                if (settings[1] != null && !settings[1].isEmpty()) barcodeKey = settings[1];
            }
        } catch (Throwable error) {
            Log.w(TAG, "无法读取广播参数，使用厂商文档默认值", error);
        }
    }

    private boolean stopReceiving() {
        if (receiverRegistered) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (RuntimeException error) {
                Log.w(TAG, "取消扫码广播监听失败", error);
            } finally {
                receiverRegistered = false;
            }
        }
        if (modeLease != null) {
            try {
                if (!modeLease.release()) {
                    Log.w(TAG, "未能恢复设备原有的键盘扫码模式");
                    return false;
                }
            } catch (Throwable error) {
                Log.w(TAG, "恢复设备扫码模式失败", error);
                return false;
            }
        }
        return true;
    }
}

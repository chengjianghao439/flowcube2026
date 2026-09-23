package com.flowcube.pda;

final class ScannerModeLease {
    interface Scanner {
        int getOutputMode();
        boolean switchOutputMode(int target);
    }

    interface RestoreStore {
        boolean keyboardRestorePending();
        boolean setKeyboardRestorePending(boolean value);
    }

    private final Scanner scanner;
    private final RestoreStore store;
    private boolean active;
    private boolean restoreKeyboard;

    ScannerModeLease(Scanner scanner) {
        this(scanner, new RestoreStore() {
            @Override public boolean keyboardRestorePending() { return false; }
            @Override public boolean setKeyboardRestorePending(boolean value) { return true; }
        });
    }

    ScannerModeLease(Scanner scanner, RestoreStore store) {
        this.scanner = scanner;
        this.store = store;
    }

    boolean acquire() {
        if (active) return true;
        int originalMode = scanner.getOutputMode();
        if (originalMode == 1) {
            if (!store.setKeyboardRestorePending(true)) return false;
            if (!scanner.switchOutputMode(0)) {
                store.setKeyboardRestorePending(false);
                return false;
            }
            restoreKeyboard = true;
        } else if (originalMode == 0 && store.keyboardRestorePending()) {
            // 上次进程被系统结束后仍留在广播模式；本次离开应用时恢复键盘模式。
            restoreKeyboard = true;
        }
        // 0 是广播；其他未知值不改设备设置，仍可尝试接收厂商广播。
        active = true;
        return true;
    }

    boolean release() {
        if (!active && !store.keyboardRestorePending()) return true;
        if (!active && scanner.getOutputMode() != 0) {
            return store.setKeyboardRestorePending(false);
        }
        if (!active) restoreKeyboard = true;
        if (restoreKeyboard && !scanner.switchOutputMode(1)) return false;
        boolean clearMarker = restoreKeyboard;
        restoreKeyboard = false;
        active = false;
        // 即使落盘清标记失败，设备此时已是键盘模式；内存不能仍声称持有广播模式。
        if (clearMarker && !store.setKeyboardRestorePending(false)) return false;
        return true;
    }
}

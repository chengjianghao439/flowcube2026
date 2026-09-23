package com.flowcube.pda;

final class ScannerIntentPolicy {
    private ScannerIntentPolicy() {}

    static String barcode(String action, String expectedAction, String rawBarcode) {
        if (action == null || !action.equals(expectedAction) || rawBarcode == null) return null;
        String barcode = rawBarcode.trim();
        return barcode.isEmpty() ? null : barcode;
    }
}

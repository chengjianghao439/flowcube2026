package com.flowcube.pda;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class ScannerIntentPolicyTest {
    @Test public void acceptsOnlyMatchingBroadcastWithBarcode() {
        assertEquals("I000123", ScannerIntentPolicy.barcode(
            "android.intent.ACTION_DECODE_DATA",
            "android.intent.ACTION_DECODE_DATA",
            " I000123 "
        ));
        assertNull(ScannerIntentPolicy.barcode("other.action", "android.intent.ACTION_DECODE_DATA", "I000123"));
        assertNull(ScannerIntentPolicy.barcode("android.intent.ACTION_DECODE_DATA", "android.intent.ACTION_DECODE_DATA", " "));
        assertNull(ScannerIntentPolicy.barcode("android.intent.ACTION_DECODE_DATA", "android.intent.ACTION_DECODE_DATA", null));
    }
}

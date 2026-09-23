package com.flowcube.pda;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ScannerModeLeaseTest {
    private static final class FakeScanner implements ScannerModeLease.Scanner {
        int mode;
        int switchCount;
        boolean allowSwitch = true;

        FakeScanner(int mode) { this.mode = mode; }

        @Override public int getOutputMode() { return mode; }

        @Override public boolean switchOutputMode(int target) {
            switchCount++;
            if (!allowSwitch) return false;
            mode = target;
            return true;
        }
    }

    private static final class FakeStore implements ScannerModeLease.RestoreStore {
        boolean pending;
        boolean allowSave = true;
        boolean allowClear = true;
        @Override public boolean keyboardRestorePending() { return pending; }
        @Override public boolean setKeyboardRestorePending(boolean value) {
            if (value && !allowSave) return false;
            if (!value && !allowClear) return false;
            pending = value;
            return true;
        }
    }

    @Test public void keyboardModeIsRestoredAfterFlowcubeReleasesScanner() {
        FakeScanner scanner = new FakeScanner(1);
        ScannerModeLease lease = new ScannerModeLease(scanner);
        assertTrue(lease.acquire());
        assertEquals(0, scanner.mode);
        assertTrue(lease.release());
        assertEquals(1, scanner.mode);
        assertEquals(2, scanner.switchCount);
    }

    @Test public void broadcastModeIsLeftUntouched() {
        FakeScanner scanner = new FakeScanner(0);
        ScannerModeLease lease = new ScannerModeLease(scanner);
        assertTrue(lease.acquire());
        assertTrue(lease.release());
        assertEquals(0, scanner.switchCount);
    }

    @Test public void failedSwitchDoesNotClaimBroadcastMode() {
        FakeScanner scanner = new FakeScanner(1);
        scanner.allowSwitch = false;
        ScannerModeLease lease = new ScannerModeLease(scanner);
        assertFalse(lease.acquire());
        assertTrue(lease.release());
        assertEquals(1, scanner.mode);
        assertEquals(1, scanner.switchCount);
    }

    @Test public void nextLaunchRestoresKeyboardAfterPreviousProcessDied() {
        FakeScanner scanner = new FakeScanner(0);
        FakeStore store = new FakeStore();
        store.pending = true;
        ScannerModeLease lease = new ScannerModeLease(scanner, store);
        assertTrue(lease.acquire());
        assertTrue(lease.release());
        assertEquals(1, scanner.mode);
        assertFalse(store.pending);
    }

    @Test public void nextLaunchRestoresKeyboardWithoutReenablingExperimentalMode() {
        FakeScanner scanner = new FakeScanner(0);
        FakeStore store = new FakeStore();
        store.pending = true;
        ScannerModeLease lease = new ScannerModeLease(scanner, store);
        assertTrue(lease.release());
        assertEquals(1, scanner.mode);
        assertFalse(store.pending);
    }

    @Test public void failedRestoreMarkerWriteNeverSwitchesScannerMode() {
        FakeScanner scanner = new FakeScanner(1);
        FakeStore store = new FakeStore();
        store.allowSave = false;
        ScannerModeLease lease = new ScannerModeLease(scanner, store);
        assertFalse(lease.acquire());
        assertEquals(1, scanner.mode);
        assertEquals(0, scanner.switchCount);
    }

    @Test public void failedMarkerClearDoesNotKeepLeaseActiveAfterKeyboardRestored() {
        FakeScanner scanner = new FakeScanner(1);
        FakeStore store = new FakeStore();
        ScannerModeLease lease = new ScannerModeLease(scanner, store);
        assertTrue(lease.acquire());
        store.allowClear = false;
        assertFalse(lease.release());
        assertEquals(1, scanner.mode);
        store.allowClear = true;
        assertTrue(lease.acquire());
        assertEquals(0, scanner.mode);
    }
}

package com.flowcube.pda;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class PdaUpdateOriginTest {
    private static final String ORIGIN = "https://updates.example.test";

    @Test public void sameHttpsOriginIncludesEffectivePort() throws Exception {
        assertEquals("/apk/download", PdaAppUpdatePlugin.validateUpdateUrl(
            ORIGIN, ORIGIN + ":443/apk/download?code=7").getPath());
        assertThrows(Exception.class, () -> PdaAppUpdatePlugin.validateUpdateUrl(ORIGIN, ORIGIN + ":8443/apk/download"));
        assertThrows(Exception.class, () -> PdaAppUpdatePlugin.validateUpdateUrl(ORIGIN, "https://files.example.test/apk/download"));
        assertThrows(Exception.class, () -> PdaAppUpdatePlugin.validateUpdateUrl(ORIGIN, "http://updates.example.test/apk/download"));
        assertThrows(Exception.class, () -> PdaAppUpdatePlugin.validateUpdateUrl(null, ORIGIN + "/apk/download"));
    }
}

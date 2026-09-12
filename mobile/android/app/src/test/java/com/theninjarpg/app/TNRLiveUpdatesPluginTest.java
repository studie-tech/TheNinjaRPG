package com.theninjarpg.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class TNRLiveUpdatesPluginTest {
    @Test
    public void acceptsWholeNumberBridgeTimestamps() {
        assertEquals(Long.valueOf(1789226133850L),
            TNRLiveUpdatesPlugin.parseEpochMilliseconds(1789226133850L));
    }

    @Test
    public void acceptsFloatingPointBridgeTimestamps() {
        assertEquals(Long.valueOf(1789226133850L),
            TNRLiveUpdatesPlugin.parseEpochMilliseconds(1789226133850.5));
    }

    @Test
    public void rejectsInvalidDeadlines() {
        for (Object value : new Object[] {null, "1789226133850", 0, -1,
                Double.NaN, Double.POSITIVE_INFINITY, Double.MAX_VALUE}) {
            assertNull(TNRLiveUpdatesPlugin.parseEpochMilliseconds(value));
        }
    }
}

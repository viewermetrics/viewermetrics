// Shared timeout calculation utilities
// Used by content scripts loaded via HTML script tags
// For ES6 modules (background service), use timeout-utils.module.js instead

/**
 * Calculate auto-adjusted timeout based on authenticated user count
 * @param {number} totalAuthenticatedCount - Total number of authenticated users
 * @returns {number} Timeout duration in milliseconds
 */
function calculateAutoTimeout(totalAuthenticatedCount) {
    if (!totalAuthenticatedCount) {
        return null; // Caller should use default
    }

    // Tiered timeout system (optimized for concurrent API processing):
    let timeoutMinutes;

    if (totalAuthenticatedCount < 1000) {
        timeoutMinutes = 1.5; // 1 minutes
    } else if (totalAuthenticatedCount < 5000) {
        timeoutMinutes = 2; // 2 minutes
    } else if (totalAuthenticatedCount < 10000) {
        timeoutMinutes = 2.5; // 2.5 minutes
    } else if (totalAuthenticatedCount < 15000) {
        timeoutMinutes = 3; // 3 minutes
    } else {
        // 15000+ viewers: 3 minutes base + 15 seconds per 5000 viewers
        timeoutMinutes = 3 + Math.floor((totalAuthenticatedCount - 15000) / 5000) * 0.25;
    }

    return timeoutMinutes * 60000; // Convert to milliseconds
}

/**
 * Calculate auto-adjusted request interval based on authenticated user count
 * @param {number} totalAuthenticatedCount - Total number of authenticated users
 * @returns {number} Request interval in milliseconds
 */
function calculateAutoRequestInterval(totalAuthenticatedCount) {
    if (!totalAuthenticatedCount) {
        return null; // Caller should use default
    }

    // Tiered request interval:
    // <1000 users: 5 seconds
    // <5000 users: 2 seconds
    // 5000+ users: 1 second
    if (totalAuthenticatedCount < 1000) return 5000;
    if (totalAuthenticatedCount < 5000) return 2000;
    return 1000;
}

// Expose globally for browser contexts
window.TimeoutUtils = {
    calculateAutoTimeout,
    calculateAutoRequestInterval
};

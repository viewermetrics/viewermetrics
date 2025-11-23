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

    // Tiered timeout system:
    // <200 users: 1 minute
    // <500 users: 2 minutes
    // <1000 users: 3 minutes
    // <5000 users: 4 minutes
    // 5000+ users: 5 minutes base + 1 minute per 2000 additional users
    let timeoutMinutes;

    if (totalAuthenticatedCount < 200) {
        timeoutMinutes = 1;
    } else if (totalAuthenticatedCount < 500) {
        timeoutMinutes = 2;
    } else if (totalAuthenticatedCount < 1000) {
        timeoutMinutes = 3;
    } else if (totalAuthenticatedCount < 5000) {
        timeoutMinutes = 4;
    } else {
        // 5000+ viewers: 5 minutes base + 1 minute per 2000 viewers
        timeoutMinutes = 5 + Math.floor((totalAuthenticatedCount - 5000) / 2000);
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
    // <500 users: 5 seconds
    // <1000 users: 2 seconds
    // 1000+ users: 1 second
    if (totalAuthenticatedCount < 500) return 5000;
    if (totalAuthenticatedCount < 1000) return 2000;
    return 1000;
}

// Expose globally for browser contexts
window.TimeoutUtils = {
    calculateAutoTimeout,
    calculateAutoRequestInterval
};

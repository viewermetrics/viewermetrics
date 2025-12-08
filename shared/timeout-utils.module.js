// ES6 module version for background service worker
// Import this file in ES6 modules

/**
 * Calculate auto-adjusted timeout based on authenticated user count
 * @param {number} totalAuthenticatedCount - Total number of authenticated users
 * @returns {number} Timeout duration in milliseconds
 */
export function calculateAutoTimeout(totalAuthenticatedCount) {
    if (!totalAuthenticatedCount) {
        return null; // Caller should use default
    }

    // Tiered timeout system (optimized for concurrent API processing):
    // Based on real performance: 33,000 users = 60-120 seconds
    // Base timeout starts at 1 minute + calculated value
    // <1000 users: 45 seconds + 1 minute = 1:45
    // <5000 users: 1 minute + 1 minute = 2 minutes
    // <15000 users: 90 seconds + 1 minute = 2:30
    // 15000+ users: 2 minutes base + 10 seconds per 10000 additional users + 1 minute
    let timeoutMinutes;

    if (totalAuthenticatedCount < 1000) {
        timeoutMinutes = 0.75; // 45 seconds
    } else if (totalAuthenticatedCount < 5000) {
        timeoutMinutes = 1; // 1 minute
    } else if (totalAuthenticatedCount < 15000) {
        timeoutMinutes = 1.5; // 90 seconds
    } else {
        // 15000+ viewers: 2 minutes base + 10 seconds per 10000 viewers
        timeoutMinutes = 2 + Math.floor((totalAuthenticatedCount - 15000) / 10000) * 0.167;
    }

    // Add 1 minute base timeout to calculated value
    const baseMinutes = 1;
    return (timeoutMinutes + baseMinutes) * 60000; // Convert to milliseconds
}

/**
 * Calculate auto-adjusted request interval based on authenticated user count
 * @param {number} totalAuthenticatedCount - Total number of authenticated users
 * @returns {number} Request interval in milliseconds
 */
export function calculateAutoRequestInterval(totalAuthenticatedCount) {
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

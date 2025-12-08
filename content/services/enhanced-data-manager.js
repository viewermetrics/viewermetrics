// Enhanced Data Manager with observer pattern and better memory management
// Bot detection constants
const BOT_DATE_RANGE_MONTHS_FROM_NOW = 1; // Exclude accounts created in past 1 month from bot detection
const BOT_DATE_RANGE_START = '2020-01-01'; // Bot detection date range start - can be changed here without modifying settings

window.EnhancedDataManager = class DataManager {
  constructor(settingsManager, errorHandler, apiClient) {
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.apiClient = apiClient;
    this.exportManager = new window.ExportManager(errorHandler);

    this.state = {
      viewers: new Map(),
      history: [],
      metadata: {
        lastUpdated: null,
        totalRequests: 0,
        sessionStart: Date.now(),
        errors: []
      },
      // Historical viewing state
      showingLive: true,
      showingHistoryPoint: null
    };

    // Performance optimization caches
    this.viewerListCache = {
      lastCacheTime: 0,
      lastParams: null,
      cachedResult: null,
      cacheTimeout: settingsManager.get('viewerListCacheTimeout')
    };

    this.observers = new Set();
    this.pendingUserInfo = new Set();
    this.isActive = false;
    this.cleanupInterval = null;
    this.heatmapProcessInterval = null;
    this.heatmapEnabled = true; // Heatmap tracking enabled by default
    this.isAnalysisMode = false; // Analysis mode for viewing imported historical data
    this.analysisMetadata = null; // Store metadata about imported session

    // Time tracking data for heatmap (persists even after viewer removal)
    // Structure: Map<username, { createdAt, currentTimeInStream, pastTimeInStream }>
    this.timeTrackingData = new Map();

    this.initCleanupInterval();
    // Don't auto-start heatmap processing - wait for user to enable it

    // Subscribe to API client events for background tracking updates
    if (this.apiClient) {
      this.apiClient.subscribe((event, data) => {
        if (event === 'apiStatusUpdated') {
          // Notify observers that stats might have changed due to pending count update
          this.notify('pendingUpdated', { pendingCount: data.pendingCount });
        }
      });
    }
  }

  initCleanupInterval() {
    // Run cleanup every minute for more responsive timeout adjustments
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.settingsManager.get('cleanupInterval'));
  }

  initHeatmapProcessing() {
    // Heatmap now processes synchronously with history updates (no interval needed)
    // Keeping this method for backward compatibility but it does nothing
  }

  enableHeatmap() {
    this.heatmapEnabled = true;
    // Immediately process data when enabling
    this.processHeatmapData();
    this.notify('heatmapEnabled', { enabled: true });
  }

  disableHeatmap() {
    this.heatmapEnabled = false;
    this.notify('heatmapEnabled', { enabled: false });
  }

  isHeatmapEnabled() {
    return this.heatmapEnabled;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.heatmapProcessInterval) {
      clearInterval(this.heatmapProcessInterval);
      this.heatmapProcessInterval = null;
    }
    this.observers.clear();
  }

  // Observer pattern for UI updates
  subscribe(callback) {
    this.observers.add(callback);
    return () => this.observers.delete(callback); // Return unsubscribe function
  }

  unsubscribe(callback) {
    this.observers.delete(callback);
  }

  notify(event, data) {
    // Invalidate viewer list cache when data changes for performance
    if (event === 'viewersUpdated' || event === 'userInfoUpdated' || event === 'dataCleared' || event === 'viewersSynced') {
      this.invalidateViewerListCache();
    }

    this.observers.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        this.errorHandler?.handle(error, 'DataManager Observer', { event, data });
      }
    });
  }

  // Immutable state updates with validation
  updateState(updates) {
    try {
      const oldState = { ...this.state };
      this.state = { ...this.state, ...updates };
      this.state.metadata.lastUpdated = Date.now();
      this.notify('stateChanged', { oldState, newState: this.state });
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager State Update', updates);
    }
  }

  // Memory management and cleanup
  cleanup() {
    try {
      const config = this.settingsManager.get();
      const now = Date.now();

      // Clean old history data using configurable retention period
      const historyCutoff = now - (config.historyRetentionHours * 60 * 60 * 1000);
      const oldHistoryCount = this.state.history.length;
      this.state.history = this.state.history.filter(h => h.timestamp > historyCutoff);

      // Limit history points
      if (this.state.history.length > config.maxHistoryPoints) {
        this.state.history = this.state.history.slice(-config.maxHistoryPoints);
      }

      // Skip viewer timeout cleanup if background tracking is active or in analysis mode
      // Background service handles viewer cleanup in that case
      // Analysis mode preserves all imported viewers for historical analysis
      let timedOutCount = 0;
      if (!this.isAnalysisMode && (!this.apiClient || !this.apiClient.isBackgroundTracking)) {
        timedOutCount = this.removeTimedOutViewers();
      }

      // Enhanced viewer cleanup: Remove viewers inactive for 24+ hours BEFORE memory-based cleanup
      // Skip in analysis mode to preserve imported historical data
      const currentTime = Date.now();
      const inactivityThreshold = 24 * 60 * 60 * 1000; // 24 hours
      let inactiveCount = 0;

      // First pass: Remove viewers inactive for 24+ hours (skip in analysis mode)
      if (!this.isAnalysisMode) {
        for (const [username, viewer] of this.state.viewers) {
          if (viewer.lastSeen && (currentTime - viewer.lastSeen > inactivityThreshold)) {
            this.state.viewers.delete(username);
            this.pendingUserInfo.delete(username);
            inactiveCount++;
          }
        }
      }

      if (inactiveCount > 0) {
        console.log(`Inactivity cleanup: removed ${inactiveCount} viewers inactive for 24+ hours`);
      }

      // Second pass: Memory-based cleanup if still needed
      const estimatedMemory = this.state.viewers.size * 200; // ~200 bytes per viewer
      const maxMemoryMB = 50; // 50 MB limit for viewer data
      const maxMemoryBytes = maxMemoryMB * 1024 * 1024;

      if (estimatedMemory > maxMemoryBytes) {
        const targetSize = Math.floor(maxMemoryBytes / 200); // Target viewer count for memory limit
        const originalSize = this.state.viewers.size;

        const sorted = Array.from(this.state.viewers.entries())
          .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
          .slice(0, targetSize);

        this.state.viewers = new Map(sorted);

        // Clean pending info for removed viewers
        const remainingUsernames = new Set(sorted.map(([username]) => username));
        this.pendingUserInfo.forEach(username => {
          if (!remainingUsernames.has(username)) {
            this.pendingUserInfo.delete(username);
          }
        });

        console.log(`Memory cleanup: removed ${originalSize - targetSize} viewers (${originalSize} -> ${targetSize})`);
      } else if (this.state.viewers.size > config.maxViewerListSize) {
        // Fallback to config limit if memory-based limit isn't triggered
        const originalSize = this.state.viewers.size;
        const sorted = Array.from(this.state.viewers.entries())
          .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
          .slice(0, config.maxViewerListSize);

        this.state.viewers = new Map(sorted);

        // Clean pending info for removed viewers
        const remainingUsernames = new Set(sorted.map(([username]) => username));
        this.pendingUserInfo.forEach(username => {
          if (!remainingUsernames.has(username)) {
            this.pendingUserInfo.delete(username);
          }
        });
      }

      const historyCleanup = oldHistoryCount - this.state.history.length;

      if (historyCleanup > 0 || timedOutCount > 0) {
        this.notify('cleanup', { historyCleanup, viewerCleanup: timedOutCount });
      }

    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Cleanup');
    }
  }

  // Viewer management with validation
  addViewers(usernames) {
    // Don't add viewers in analysis mode (viewing historical data)
    if (this.isAnalysisMode) {
      return [];
    }

    if (!Array.isArray(usernames)) {
      throw new Error('usernames must be an array');
    }

    const now = Date.now();
    const newUsers = [];
    let updated = false;

    try {
      for (const username of usernames) {
        if (typeof username !== 'string' || username.trim() === '') {
          continue;
        }

        const cleanUsername = username.trim().toLowerCase();

        if (!this.state.viewers.has(cleanUsername)) {
          this.state.viewers.set(cleanUsername, {
            username: cleanUsername,
            id: null,
            firstSeen: now,
            lastSeen: now,
            createdAt: null,
            description: null,
            hasDescription: false,
            profileImageURL: null,
            accountsOnSameDay: 0,
            followingCount: undefined,
            isFollower: undefined,
            hasPendingInfo: true,
            metadata: {
              apiAttempts: 0,
              lastApiAttempt: null,
              errors: []
            }
          });
          newUsers.push(cleanUsername);
          this.pendingUserInfo.add(cleanUsername);
          updated = true;
        } else {
          const viewer = this.state.viewers.get(cleanUsername);
          if (viewer.lastSeen !== now) {
            viewer.lastSeen = now;
            updated = true;
          }

          // Update time tracking data if viewer qualifies (creation date >= 2020-01-01)
          this.updateTimeTrackingData(cleanUsername, viewer);
        }
      }

      if (updated) {
        this.state.metadata.lastUpdated = now;

        if (newUsers.length > 0) {
          this.notify('newViewers', newUsers);
        }
        this.notify('viewersUpdated', { total: this.state.viewers.size, new: newUsers.length });
      }

      return newUsers;
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Add Viewers', { usernames });
      return [];
    }
  }

  removeViewer(username) {
    if (typeof username !== 'string' || username.trim() === '') {
      return false;
    }

    const cleanUsername = username.trim().toLowerCase();

    try {
      // Get viewer data before removal to archive time tracking
      const viewer = this.state.viewers.get(cleanUsername);
      if (viewer) {
        this.archiveViewerTimeData(cleanUsername, viewer);
      }

      // Remove from viewers map
      const wasRemoved = this.state.viewers.delete(cleanUsername);

      // Remove from pending user info
      this.pendingUserInfo.delete(cleanUsername);

      if (wasRemoved) {
        this.state.metadata.lastUpdated = Date.now();
        this.notify('viewersUpdated', {
          total: this.state.viewers.size,
          removed: [cleanUsername]
        });
        return true;
      }

      return false;
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Remove Viewer', { username });
      return false;
    }
  }

  // Create a safe viewer object with proper metadata structure
  createSafeViewer(viewer) {
    return {
      username: viewer.username,
      firstSeen: viewer.firstSeen,
      lastSeen: viewer.lastSeen,
      timeInStream: viewer.timeInStream || 0,
      isAuthenticated: viewer.isAuthenticated || true,
      createdAt: viewer.createdAt || null,
      id: viewer.id || null,
      hasPendingInfo: !viewer.createdAt && !viewer.id,
      metadata: {
        apiAttempts: 0,
        lastApiAttempt: null,
        firstAttempt: null
      }
    };
  }

  // Sync data manager viewers with background cleaned data (for cleanup events)
  syncWithBackgroundData(cleanedViewers, removedUsernames = null) {
    try {
      const oldViewerCount = this.state.viewers.size;
      let removedCount = 0;

      if (removedUsernames && removedUsernames.length > 0) {
        // Delta update: only remove specific viewers (much more efficient)
        for (const username of removedUsernames) {
          const lowercaseUsername = username.toLowerCase();
          if (this.state.viewers.has(lowercaseUsername)) {
            this.state.viewers.delete(lowercaseUsername);
            this.pendingUserInfo.delete(lowercaseUsername);
            removedCount++;
          }
        }
      } else if (cleanedViewers) {
        // Full sync fallback: clear and repopulate (expensive for large lists)
        this.state.viewers.clear();

        // Invalidate cache when data changes significantly
        this.invalidateViewerListCache();

        for (const viewer of cleanedViewers) {
          const username = viewer.username.toLowerCase();

          // Preserve ALL viewer data from background service
          const fullViewer = {
            ...viewer, // Keep all fields from background service
            username, // Ensure lowercase username
            // Ensure metadata exists for local operations
            metadata: viewer.metadata || {
              apiAttempts: 0,
              lastApiAttempt: null,
              firstAttempt: null
            }
          };

          this.state.viewers.set(username, fullViewer);
        }
        removedCount = oldViewerCount - this.state.viewers.size;
      }

      const newViewerCount = this.state.viewers.size;

      // Notify observers of the sync
      this.notify('viewersSynced', {
        oldCount: oldViewerCount,
        newCount: newViewerCount,
        removedCount
      });

    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Sync With Background Data');
    }
  }

  // Update viewers from background tracking data
  updateViewers(data) {
    try {
      // Don't clear existing viewers - update incrementally
      let newViewersCount = 0;

      // Add/update viewers from background data
      if (data.viewers) {
        for (const viewer of data.viewers) {
          const username = viewer.username.toLowerCase();
          const existingViewer = this.state.viewers.get(username);

          if (!existingViewer) {
            // Add new viewer with safety checks for metadata
            const safeViewer = this.createSafeViewer(viewer);
            this.state.viewers.set(username, safeViewer);
            newViewersCount++;
          } else {
            // Update existing viewer
            existingViewer.lastSeen = viewer.lastSeen;
            existingViewer.timeInStream = viewer.timeInStream || existingViewer.timeInStream;
            existingViewer.isAuthenticated = viewer.isAuthenticated || existingViewer.isAuthenticated;

            // Update user info if available
            if (viewer.createdAt && !existingViewer.createdAt) {
              existingViewer.createdAt = viewer.createdAt;
              existingViewer.hasPendingInfo = false;
            }
            if (viewer.id && !existingViewer.id) {
              existingViewer.id = viewer.id;
              existingViewer.hasPendingInfo = false;
            }
          }
        }
      }

      // Update metadata
      this.state.metadata.lastUpdated = Date.now();
      if (data.authenticatedCount !== undefined) {
        this.state.metadata.authenticatedCount = data.authenticatedCount;
      }

      // Notify observers
      this.notify('viewersUpdated', {
        total: this.state.viewers.size,
        new: newViewersCount,
        authenticatedCount: data.authenticatedCount
      });

      // Also notify about user info updates if any viewers had info updated
      if (newViewersCount > 0) {
        this.notify('userInfoUpdated', {
          total: this.state.viewers.size
        });
      }

      return true;
    } catch (error) {
      console.error('Error updating viewers from background data:', error);
      return false;
    }
  }

  // Update user info with error handling
  updateUserInfo(userInfoArray) {
    if (!Array.isArray(userInfoArray)) {
      throw new Error('userInfoArray must be an array');
    }

    let updated = false;
    const processed = [];

    try {
      for (const userInfo of userInfoArray) {
        if (!userInfo || !userInfo.username) continue;

        const username = userInfo.username.toLowerCase();
        const viewer = this.state.viewers.get(username);

        if (!viewer) continue;

        // Ensure metadata object exists
        if (!viewer.metadata) {
          viewer.metadata = {
            apiAttempts: 0,
            lastApiAttempt: null,
            firstAttempt: null
          };
        }

        // Remove from pending
        this.pendingUserInfo.delete(username);
        viewer.hasPendingInfo = false;
        viewer.metadata.lastApiAttempt = Date.now();

        if (userInfo.createdAt) {
          viewer.createdAt = userInfo.createdAt;
          viewer.id = userInfo.id;

          // Store description and set hasDescription boolean
          viewer.description = userInfo.description || null;
          viewer.hasDescription = !!(userInfo.description && userInfo.description.trim().length > 0);

          // Store profile image URL
          viewer.profileImageURL = userInfo.profileImageURL || null;

          // Update time tracking data now that we have creation date
          this.updateTimeTrackingData(username, viewer);

          updated = true;
        } else {
          // Failed to get info
          viewer.metadata.apiAttempts++;
          if (viewer.metadata.apiAttempts >= 3) {
            // Stop trying after 3 attempts
            viewer.hasPendingInfo = false;
            console.log(`Giving up on user info for ${username} after ${viewer.metadata.apiAttempts} attempts`);
          } else {
            // Re-add to pending for retry (with delay handled in getPendingUsernames)
            viewer.hasPendingInfo = true;
          }
        }

        processed.push(username);
      }

      if (updated) {
        this.detectBots();
        this.notify('userInfoUpdated', processed);
      }

      return processed;
    } catch (error) {
      // Log error to console for debugging
      console.error('Error updating user info:', error);
      this.errorHandler?.handle(error, 'DataManager Update User Info', { userInfoArray });
      return [];
    }
  }

  // Update user following data for bot detection
  updateUserFollowingData(username, followingData) {
    try {
      if (!username || !followingData) return false;

      const viewer = this.state.viewers.get(username.toLowerCase());
      if (!viewer) return false;

      // Update following data
      viewer.followingCount = followingData.followingCount || 0;
      viewer.isFollower = followingData.isFollower || false;

      // Re-run bot detection
      this.detectBots();

      return true;
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Update User Following Data', { username, followingData });
      return false;
    }
  }



  // Bot detection with improved algorithm
  detectBots() {
    try {
      const config = this.settingsManager.get();
      const startDate = new Date(BOT_DATE_RANGE_START);
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() - BOT_DATE_RANGE_MONTHS_FROM_NOW);

      // Step 1: Build monthly and daily counts
      const { monthlyCounts, dayCounts } = this.buildAccountCreationCounts(startDate, endDate);

      // Step 2: Set same-day account counts for each viewer
      this.setAccountsOnSameDay(dayCounts);

      // Step 3: Calculate baseline statistics
      const baselineStats = this.calculateBaselineStats(monthlyCounts, startDate);

      // Step 4: Detect bots with initial threshold (excluding top 5 months for more accurate baseline)
      let maxExpectedAccounts = this.calculateMaxExpectedAccounts(
        baselineStats.totalPostStartMonthsExcludingTopx,
        baselineStats.totalPostStartAccountsExcludingTopx
      );

      // Store the calculated threshold before applying any override
      if (window.trackingPageManager) {
        window.trackingPageManager.calculatedBotThreshold = maxExpectedAccounts;
      }

      // Check for manual override from bot threshold slider
      if (window.trackingPageManager && !window.trackingPageManager.botThresholdLocked &&
        window.trackingPageManager.botThresholdOverride !== null) {
        maxExpectedAccounts = window.trackingPageManager.botThresholdOverride;
      } else {
        // Update the slider with the calculated value (if unlocked)
        if (window.trackingPageManager) {
          window.trackingPageManager.updateBotThresholdSlider(maxExpectedAccounts);
        }
      }

      let result = this.calculateBotCounts(monthlyCounts, startDate, maxExpectedAccounts);

      // Step 5: Refine threshold if needed and recalculate
      // Temp removed
      /*      const refinedThreshold = this.calculateRefinedThreshold(result.totalNonBots);
      
            if (refinedThreshold < maxExpectedAccounts) {
              maxExpectedAccounts = refinedThreshold;
              result = this.calculateBotCounts(monthlyCounts, startDate, maxExpectedAccounts);
            }
      */
      // Step 6: Apply minimum threshold (10% rule)
      const stats = this.getStats();
      if (this.shouldIgnoreBotDetection(result.totalBots, stats.accountsWithDates)) {
        result = this.resetBotCounts(result.monthData);
      }

      // Step 7: Store results in state
      this.storeBotDetectionResults(result, maxExpectedAccounts, baselineStats.averagePreStartAccounts);

      if (result.totalBots > 0) {
        this.notify('botsDetected', Math.round(result.totalBots));
      }

    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Bot Detection');
    }
  }

  // Helper: Build monthly and daily account creation counts
  buildAccountCreationCounts(startDate, endDate) {
    const monthlyCounts = new Map();
    const dayCounts = new Map();

    for (const viewer of this.state.viewers.values()) {
      if (!viewer.createdAt) continue;

      const createdDate = new Date(viewer.createdAt);
      if (createdDate > endDate) continue;

      const monthKey = createdDate.toISOString().split('T')[0].slice(0, 7); // YYYY-MM
      const dayKey = createdDate.toISOString().split('T')[0]; // YYYY-MM-DD

      monthlyCounts.set(monthKey, (monthlyCounts.get(monthKey) || 0) + 1);
      dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    }

    return { monthlyCounts, dayCounts };
  }

  // Helper: Set accountsOnSameDay for each viewer
  setAccountsOnSameDay(dayCounts) {
    for (const viewer of this.state.viewers.values()) {
      if (!viewer.createdAt) {
        viewer.accountsOnSameDay = 0;
        continue;
      }

      const createdDate = new Date(viewer.createdAt);
      const dayKey = createdDate.toISOString().split('T')[0];
      viewer.accountsOnSameDay = dayCounts.get(dayKey) || 0;
    }
  }

  // Helper: Calculate baseline statistics (pre and post start date)
  calculateBaselineStats(monthlyCounts, startDate) {
    let totalPreStartAccounts = 0;
    let totalPreStartMonths = 0;
    let totalPostStartAccounts = 0;
    let totalPostStartMonths = 0;
    const postStartMonths = [];

    for (const [monthKey, count] of monthlyCounts.entries()) {
      const monthDate = new Date(monthKey + '-01');

      if (monthDate < startDate) {
        totalPreStartAccounts += count;
        totalPreStartMonths++;
      } else {
        totalPostStartAccounts += count;
        totalPostStartMonths++;
        postStartMonths.push({ monthKey, count });
      }
    }

    const averagePreStartAccounts = totalPreStartMonths > 0
      ? totalPreStartAccounts / totalPreStartMonths
      : 0;

    // Calculate total excluding top 5 months (for more accurate baseline)
    let totalPostStartAccountsExcludingTopx = totalPostStartAccounts;
    let monthsToIgnore = totalPostStartMonths < 20 ? 5 : 10; // Ignore more months if more data available
    let totalPostStartMonthsExcludingTopx = totalPostStartMonths;

    if (postStartMonths.length > monthsToIgnore) {
      // Sort months by count (descending) and exclude top X months
      const sortedMonths = [...postStartMonths].sort((a, b) => b.count - a.count);
      const topxTotal = sortedMonths.slice(0, monthsToIgnore).reduce((sum, m) => sum + m.count, 0);
      totalPostStartAccountsExcludingTopx = totalPostStartAccounts - topxTotal;
      totalPostStartMonthsExcludingTopx = totalPostStartMonths - monthsToIgnore;
    } else {
      // If we have monthsToIgnore or fewer months, use all of them (no exclusion)
      totalPostStartAccountsExcludingTopx = totalPostStartAccounts;
      totalPostStartMonthsExcludingTopx = totalPostStartMonths;
    }

    return {
      totalPreStartAccounts,
      totalPreStartMonths,
      totalPostStartAccounts,
      totalPostStartMonths,
      totalPostStartAccountsExcludingTopx,
      totalPostStartMonthsExcludingTopx,
      averagePreStartAccounts
    };
  }

  // Helper: Calculate maximum expected accounts per month
  calculateMaxExpectedAccounts(totalPostStartMonthsExcludingTopx, totalPostStartExcludingTopx) {
    // Safety check: prevent division by zero
    if (totalPostStartMonthsExcludingTopx === 0 || !isFinite(totalPostStartMonthsExcludingTopx)) {
      return 5; // Return minimum threshold if no valid data
    }

    // If we have less than 5 unique months, use default expected value of 5
    // No big stream will have less than 5 unique months, so we shouldn't calculate from limited data
    if (totalPostStartMonthsExcludingTopx <= 5) {
      return 5; // Return default threshold for insufficient data
    }

    let maxExpected = Math.ceil((totalPostStartExcludingTopx / totalPostStartMonthsExcludingTopx) * 5);

    // Ensure the result is finite and reasonable
    if (!isFinite(maxExpected) || maxExpected < 0) {
      return 5; // Return minimum threshold if calculation fails
    }

    return Math.max(maxExpected, 5); // Minimum of 5
  }

  // Helper: Calculate refined threshold based on non-bot accounts
  calculateRefinedThreshold(totalNonBots) {
    let refined = Math.ceil(totalNonBots / 5);
    return Math.max(refined, 5); // Minimum of 5
  }

  // Helper: Calculate bot counts for each month
  calculateBotCounts(monthlyCounts, startDate, maxExpectedAccounts) {
    let totalBots = 0;
    let totalAccounts = 0;
    let totalNonBots = 0;
    const monthData = [];
    const now = new Date();

    // Calculate 12 months after BOT_DATE_RANGE_START
    const botStartDate = new Date(BOT_DATE_RANGE_START);
    const twelveMonthsAfterStart = new Date(botStartDate);
    twelveMonthsAfterStart.setMonth(twelveMonthsAfterStart.getMonth() + 12);

    for (const [monthKey, count] of monthlyCounts.entries()) {
      const monthDate = new Date(monthKey + '-01');

      if (monthDate < startDate) continue;

      // Calculate month age (how many months ago from now)
      const monthAge = (now.getFullYear() - monthDate.getFullYear()) * 12 +
        (now.getMonth() - monthDate.getMonth());

      // Apply time-based decay for recent months (0-12 months old)
      // Recent months get more lenient thresholds to avoid false positives during growth
      let thresholdMultiplier = 1.0;

      // Check if month is in early bot detection period (BOT_START_DATE to +12 months)
      if (monthDate >= botStartDate && monthDate < twelveMonthsAfterStart) {
        thresholdMultiplier = 1.5; // Early detection period: More lenient due to COVID growth
      } else if (monthAge < 3) {
        thresholdMultiplier = 2; // 0-3 months: Very lenient
      } else if (monthAge < 6) {
        thresholdMultiplier = 1.5; // 4-6 months: Moderately lenient
      } else if (monthAge < 9) {
        thresholdMultiplier = 1.25; // 7-9 months: Slightly lenient
      }

      // 12+ months and beyond early period: No decay (strict detection)

      const adjustedThreshold = maxExpectedAccounts * thresholdMultiplier;

      // Calculate bots for this month
      let bots = Math.max(0, count - adjustedThreshold);

      // If bots detected, use stricter threshold (1/3 of adjusted)
      if (bots > 0) {
        bots = Math.max(0, count - (adjustedThreshold / 3));
      }

      const nonBots = count - bots;

      monthData.push({
        month: monthKey,
        nonBots: Math.round(nonBots),
        bots: Math.round(bots)
      });

      totalBots += bots;
      totalAccounts += count;
      totalNonBots += nonBots;
    }

    return { totalBots, totalAccounts, totalNonBots, monthData };
  }

  // Helper: Check if bot detection should be ignored (< 10% threshold)
  shouldIgnoreBotDetection(botsDetected, accountsWithDates) {
    if (accountsWithDates === 0) return true;

    const botPercentage = (botsDetected / accountsWithDates) * 100;
    return botPercentage < 10;
  }

  // Helper: Reset bot counts (when below threshold)
  resetBotCounts(monthData) {
    const resetMonthData = monthData.map(month => ({
      ...month,
      nonBots: month.nonBots + month.bots,
      bots: 0
    }));

    return {
      totalBots: 0,
      totalAccounts: monthData.reduce((sum, m) => sum + m.nonBots + m.bots, 0),
      totalNonBots: monthData.reduce((sum, m) => sum + m.nonBots + m.bots, 0),
      monthData: resetMonthData
    };
  }

  // Helper: Store bot detection results in state
  storeBotDetectionResults(result, maxExpected, averagePreStart) {
    this.state.metadata.botsDetected = Math.round(result.totalBots);
    this.state.metadata.accountGraphMonthData = result.monthData;
    this.state.metadata.accountsInBotRange = Math.round(result.totalAccounts);
    this.state.metadata.maxExpectedPostStartAccounts = Math.ceil(maxExpected);
    this.state.metadata.averagePreStartAccounts = Math.ceil(averagePreStart);
  }

  // Time Tracking for Heatmap - Update current time in stream
  updateTimeTrackingData(username, viewer) {
    try {
      // Track all viewers with creation date
      if (!viewer.createdAt) return;

      // Calculate current time in stream
      const now = Date.now();
      const timeInStream = viewer.lastSeen - viewer.firstSeen;

      // Get or create time tracking entry
      let trackingEntry = this.timeTrackingData.get(username);

      if (!trackingEntry) {
        // Create new entry with all viewer data
        trackingEntry = {
          username: username,
          id: viewer.id || null,
          createdAt: viewer.createdAt,
          firstSeen: viewer.firstSeen,
          lastSeen: viewer.lastSeen,
          currentTimeInStream: timeInStream,
          pastTimeInStream: 0
        };
        this.timeTrackingData.set(username, trackingEntry);
      } else {
        // Update existing entry
        trackingEntry.currentTimeInStream = timeInStream;
        trackingEntry.lastSeen = viewer.lastSeen;
        // Update ID if it wasn't set before
        if (viewer.id && !trackingEntry.id) {
          trackingEntry.id = viewer.id;
        }
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Update Time Tracking', { username });
    }
  }

  // Time Tracking for Heatmap - Archive viewer's time when removed
  archiveViewerTimeData(username, viewer) {
    try {
      // Track all viewers with creation date
      if (!viewer.createdAt) return;

      const trackingEntry = this.timeTrackingData.get(username);

      if (trackingEntry) {
        // Add current time to past time and reset current
        trackingEntry.pastTimeInStream += trackingEntry.currentTimeInStream;
        trackingEntry.currentTimeInStream = 0;
        trackingEntry.lastSeen = viewer.lastSeen;
        // Update ID if it wasn't set before
        if (viewer.id && !trackingEntry.id) {
          trackingEntry.id = viewer.id;
        }
      } else {
        // Create entry with just past time
        const timeInStream = viewer.lastSeen - viewer.firstSeen;
        this.timeTrackingData.set(username, {
          username: username,
          id: viewer.id || null,
          createdAt: viewer.createdAt,
          firstSeen: viewer.firstSeen,
          lastSeen: viewer.lastSeen,
          currentTimeInStream: 0,
          pastTimeInStream: timeInStream
        });
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Archive Viewer Time', { username });
    }
  }

  // Process heatmap data every 30 seconds
  processHeatmapData() {
    try {
      // First, update current time for all active viewers
      const now = Date.now();
      for (const [username, trackingEntry] of this.timeTrackingData.entries()) {
        const viewer = this.state.viewers.get(username);
        if (viewer) {
          // Viewer is still active, recalculate current time
          trackingEntry.currentTimeInStream = viewer.lastSeen - viewer.firstSeen;
        }
      }

      // Structure: Map<month, Map<timeRounded, totalTime>>
      const heatmapData = new Map();

      // Fixed time buckets: 0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240 (minutes)
      const timeBuckets = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

      // Helper function to find the appropriate bucket for a given time
      // Times less than 5 go to 0, less than 10 go to 5, etc.
      const findTimeBucket = (minutes) => {
        if (minutes < 5) return 0;
        if (minutes >= 240) return 240; // Cap at 240

        // Find the bucket this time belongs to (use lower boundary)
        for (let i = timeBuckets.length - 1; i >= 0; i--) {
          if (minutes >= timeBuckets[i]) {
            return timeBuckets[i];
          }
        }
        return 0; // Fallback to 0 bucket
      };

      for (const [username, trackingEntry] of this.timeTrackingData.entries()) {
        const createdDate = new Date(trackingEntry.createdAt);
        const monthKey = createdDate.toISOString().split('T')[0].slice(0, 7); // YYYY-MM

        // Calculate total time (current + past)
        const totalTimeMs = trackingEntry.currentTimeInStream + trackingEntry.pastTimeInStream;
        const totalTimeMinutes = Math.ceil(totalTimeMs / 60000); // Convert to minutes, ceil to count any partial minute

        // Find the appropriate bucket for this time
        const timeRounded = findTimeBucket(totalTimeMinutes);

        // Get or create month map
        if (!heatmapData.has(monthKey)) {
          heatmapData.set(monthKey, new Map());
        }

        const monthMap = heatmapData.get(monthKey);

        // Add to existing value or create new entry
        const currentValue = monthMap.get(timeRounded) || 0;
        monthMap.set(timeRounded, currentValue + 1); // Count of viewers at this time duration
      }

      // Convert to array format for easier use in charts
      // Format: [{ month, timeRounded, count }]

      // Generate all months from BOT_DATE_RANGE_START to now (show all months)
      const config = this.settingsManager.get();
      const startDate = new Date(BOT_DATE_RANGE_START);
      const endDate = new Date(); // Current date - no restriction

      const allMonths = [];
      const currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const lastMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

      while (currentMonth <= lastMonth) {
        const monthKey = currentMonth.toISOString().split('T')[0].slice(0, 7); // YYYY-MM
        allMonths.push(monthKey);
        currentMonth.setMonth(currentMonth.getMonth() + 1);
      }

      // Only include months that have actual data to reduce chart complexity
      const heatmapArray = [];
      for (const [month, timeMap] of heatmapData.entries()) {
        for (const [timeRounded, count] of timeMap.entries()) {
          heatmapArray.push({
            month: month,
            time: timeRounded,
            count: count
          });
        }
      }

      // Store in state metadata
      this.state.metadata.heatmapData = heatmapArray;

      // Notify observers
      this.notify('heatmapUpdated', { data: heatmapArray });

    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Process Heatmap Data');
    }
  }

  // Get current heatmap data
  getHeatmapData() {
    return this.state.metadata.heatmapData || [];
  }

  // History management
  addHistoryPoint(totalViewers, authenticatedNonBots, bots, totalAuthenticated = 0) {
    // Don't add history points in analysis mode (viewing historical data)
    if (this.isAnalysisMode) {
      return;
    }

    try {
      const config = this.settingsManager.get();
      const now = Date.now();

      this.state.history.push({
        timestamp: now,
        totalViewers: Math.max(0, totalViewers || 0),
        authenticatedNonBots: Math.max(0, (totalAuthenticated || 0) - (bots || 0)), // totalAuthenticated - bots
        bots: Math.max(0, bots || 0),
        totalAuthenticated: Math.max(0, totalAuthenticated || 0), // Count from viewer list calls
        accountGraphMonthData: this.state.metadata.accountGraphMonthData || [],
        accountsInBotRange: this.state.metadata.accountsInBotRange || 0,
        maxExpectedPostStartAccounts: this.state.metadata.maxExpectedPostStartAccounts || 0,
        averagePreStartAccounts: this.state.metadata.averagePreStartAccounts || 0,
        usersFound: this.state.viewers.size || 0,
        accountsWithDates: Array.from(this.state.viewers.values()).filter(v => v.createdAt).length || 0
      });

      // Limit history size
      if (this.state.history.length > config.maxHistoryPoints) {
        this.state.history = this.state.history.slice(-config.maxHistoryPoints);
      }

      // Clean graph zero data if enabled and we have enough data
      if (config.cleanGraphZeroData && this.state.history.length > 60) {
        this.cleanZeroDataFromStart();
      }

      // Process heatmap data if enabled
      if (this.heatmapEnabled) {
        this.processHeatmapData();
      }

      this.notify('historyUpdated', this.state.history.length);
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Add History Point',
        { totalViewers, authenticatedNonBots, bots, totalAuthenticated });
    }
  }

  // Update the latest history point with new authenticated count
  updateLatestHistoryAuthenticated(totalAuthenticated) {
    try {
      if (this.state.history.length > 0) {
        const latest = this.state.history[this.state.history.length - 1];
        latest.totalAuthenticated = Math.max(0, totalAuthenticated || 0);
        // Recalculate authenticatedNonBots based on new totalAuthenticated
        latest.authenticatedNonBots = Math.max(0, (latest.totalAuthenticated || 0) - (latest.bots || 0));
        this.notify('historyUpdated', this.state.history.length);
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Update Latest History Authenticated', { totalAuthenticated });
    }
  }

  getEffectiveTimeoutDuration() {
    const config = this.settingsManager.get();
    if (!config.autoAdjustTimeout) {
      return config.timeoutDuration;
    }

    // Get the latest total authenticated count
    const latest = this.state.history[this.state.history.length - 1];
    const totalAuthenticatedCount = latest?.totalAuthenticated || 0;

    const calculatedTimeout = this.settingsManager.calculateAutoTimeout(totalAuthenticatedCount);

    return calculatedTimeout;
  }

  getEffectiveRequestInterval() {
    const config = this.settingsManager.get();
    if (!config.autoAdjustRequestInterval) {
      return config.requestInterval;
    }

    // Get the latest total authenticated count
    const latest = this.state.history[this.state.history.length - 1];
    const totalAuthenticatedCount = latest?.totalAuthenticated || 0;

    const calculatedInterval = this.settingsManager.calculateAutoRequestInterval(totalAuthenticatedCount);

    return calculatedInterval;
  }

  // Data retrieval methods
  getStats() {
    try {
      const viewers = Array.from(this.state.viewers.values());
      const authenticatedNonBots = this.state.metadata.authenticatedCount - (this.state.metadata.botsDetected || 0);
      const bots = this.state.metadata.botsDetected || 0;

      // Get pending count based on tracking mode
      const pendingInfo = this.apiClient?.isBackgroundTracking ?
        (this.apiClient._pendingCount || 0) :
        this.pendingUserInfo.size;

      return {
        totalUsersFound: viewers.length,
        authenticatedNonBots,
        bots,
        pendingInfo,
        accountsWithDates: viewers.filter(v => v.createdAt).length
      };
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Get Stats');
      return { totalUsersFound: 0, authenticatedNonBots: 0, bots: 0, pendingInfo: 0, accountsWithDates: 0 };
    }
  }

  getHistory() {
    return [...this.state.history]; // Return copy
  }

  // Historical viewing methods
  isShowingLive() {
    return this.state.showingLive;
  }

  getShowingHistoryPoint() {
    return this.state.showingHistoryPoint;
  }

  setHistoryPoint(historyPoint) {
    try {
      this.state.showingLive = false;
      this.state.showingHistoryPoint = historyPoint;
      this.notify('historyPointChanged', { showingLive: false, historyPoint });
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Set History Point', historyPoint);
    }
  }

  setLiveMode() {
    try {
      this.state.showingLive = true;
      this.state.showingHistoryPoint = null;
      this.notify('historyPointChanged', { showingLive: true, historyPoint: null });
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Set Live Mode');
    }
  }

  getAuthenticatedCount() {
    // Return the fixed authenticated count from the viewer list API
    return this.state.metadata.authenticatedCount || 0;
  }

  getPendingUsernames(limit = 20) {
    const now = Date.now();
    const validPending = [];
    const toRemove = [];

    for (const username of this.pendingUserInfo) {
      const viewer = this.state.viewers.get(username);

      if (!viewer) {
        // Viewer no longer exists, remove from pending
        toRemove.push(username);
        continue;
      }

      // Ensure metadata object exists
      if (!viewer.metadata) {
        viewer.metadata = {
          apiAttempts: 0,
          lastApiAttempt: null,
          firstAttempt: null
        };
      }

      // Skip if already has creation date info
      if (viewer.createdAt) {
        toRemove.push(username);
        continue;
      }

      // Skip if exceeded max attempts
      if (viewer.metadata.apiAttempts >= 3) {
        toRemove.push(username);
        continue;
      }

      // Skip if request is stuck (no response for 5 minutes)
      if (viewer.metadata.lastApiAttempt && (now - viewer.metadata.lastApiAttempt) > 300000) {
        console.log(`Removing stuck user info request for ${username}, last attempt ${Math.round((now - viewer.metadata.lastApiAttempt) / 1000)}s ago`);
        viewer.metadata.apiAttempts = 3; // Mark as failed
        toRemove.push(username);
        continue;
      }

      // Skip if recently attempted (within last 30 seconds)
      if (viewer.metadata.lastApiAttempt && (now - viewer.metadata.lastApiAttempt) < 30000) {
        continue;
      }

      validPending.push(username);
    }

    // Clean up invalid entries
    for (const username of toRemove) {
      this.pendingUserInfo.delete(username);
      const viewer = this.state.viewers.get(username);
      if (viewer) {
        viewer.hasPendingInfo = false;
      }
    }

    return validPending.slice(0, limit);
  }

  getViewerList(page = 1, pageSize = 50, searchTerm = '', sortBy = 'timeInStream', dateFilter = 'all') {
    try {
      const config = this.settingsManager.get();
      pageSize = Math.min(pageSize, config.pageSize * 2); // Limit page size

      // Check cache first for performance with large datasets
      const currentTime = Date.now();
      const cacheKey = `${page}-${pageSize}-${searchTerm}-${sortBy}-${dateFilter}`;

      if (this.viewerListCache.cachedResult &&
        this.viewerListCache.lastParams === cacheKey &&
        currentTime - this.viewerListCache.lastCacheTime < this.viewerListCache.cacheTimeout) {
        return this.viewerListCache.cachedResult;
      }

      let viewers = Array.from(this.state.viewers.values());

      // Filter by search term
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        viewers = viewers.filter(v => v.username.includes(term));
      }

      // Filter by account creation date
      if (dateFilter && dateFilter !== 'all') {
        const [filterYear, filterMonth] = dateFilter.split('-').map(Number);
        viewers = viewers.filter(viewer => {
          if (!viewer.createdAt) return false;

          const createdDate = new Date(viewer.createdAt);
          const createdYear = createdDate.getFullYear();
          const createdMonth = createdDate.getMonth() + 1; // getMonth() returns 0-11, we want 1-12

          return createdYear === filterYear && createdMonth === filterMonth;
        });
      }

      // Sort viewers
      const now = Date.now();
      viewers.sort((a, b) => {
        switch (sortBy) {
          case 'username':
            return a.username.localeCompare(b.username);
          case 'createdAt':
            if (!a.createdAt && !b.createdAt) return 0;
            if (!a.createdAt) return 1;
            if (!b.createdAt) return -1;
            return new Date(a.createdAt) - new Date(b.createdAt);
          case 'timeInStream':
          default:
            // Handle null/undefined firstSeen values
            const aTime = a.firstSeen ? now - a.firstSeen : 0;
            const bTime = b.firstSeen ? now - b.firstSeen : 0;
            return bTime - aTime; // Descending: longest time first
        }
      });

      // Add computed properties
      viewers = viewers.map(viewer => ({
        ...viewer,
        timeInStream: viewer.firstSeen ? now - viewer.firstSeen : 0,
        hasPendingInfo: this.pendingUserInfo.has(viewer.username)
      }));

      // Pre-compute date formatting in idle time for better performance
      this.scheduleIdleProcessing((viewerList, deadline) => {
        for (const viewer of viewerList) {
          if (deadline.timeRemaining() <= 1) break; // Stop if running out of idle time

          if (viewer.createdAt && !viewer._formattedCreatedDate) {
            const date = new Date(viewer.createdAt);
            const day = date.getDate();
            const month = date.toLocaleDateString('en-US', { month: 'short' });
            const year = date.getFullYear();
            viewer._formattedCreatedDate = `${day} ${month} ${year}`;
          }
        }
      }, viewers);

      // Paginate
      const totalPages = Math.ceil(viewers.length / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const pageViewers = viewers.slice(startIndex, endIndex);

      const result = {
        viewers: pageViewers,
        currentPage: page,
        totalPages,
        totalUsersFound: viewers.length,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      };

      // Cache the result for performance
      this.viewerListCache.cachedResult = result;
      this.viewerListCache.lastParams = cacheKey;
      this.viewerListCache.lastCacheTime = currentTime;

      return result;
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Get Viewer List',
        { page, pageSize, searchTerm, sortBy });
      return { viewers: [], currentPage: 1, totalPages: 0, totalUsersFound: 0, hasNextPage: false, hasPrevPage: false };
    }
  }

  // Schedule non-critical processing during idle time
  scheduleIdleProcessing(callback, data) {
    if (window.requestIdleCallback) {
      window.requestIdleCallback((deadline) => {
        try {
          callback(data, deadline);
        } catch (error) {
          this.errorHandler?.handle(error, 'DataManager Idle Processing');
        }
      });
    } else {
      // Fallback for browsers without requestIdleCallback
      setTimeout(() => callback(data, { timeRemaining: () => 5 }), 0);
    }
  }

  // Performance optimization - invalidate cache when data changes
  invalidateViewerListCache() {
    this.viewerListCache.cachedResult = null;
    this.viewerListCache.lastParams = null;
    this.viewerListCache.lastCacheTime = 0;
  }

  getCreationDateHistogram() {
    try {
      const config = this.settingsManager.get();
      const startDate = new Date(BOT_DATE_RANGE_START);
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() - BOT_DATE_RANGE_MONTHS_FROM_NOW);

      const histogram = new Map();

      for (const viewer of this.state.viewers.values()) {
        if (!viewer.createdAt) continue;

        const createdDate = new Date(viewer.createdAt);
        if (createdDate < startDate || createdDate > endDate) continue;

        const monthKey = createdDate.getFullYear() + '-' +
          String(createdDate.getMonth() + 1).padStart(2, '0');

        histogram.set(monthKey, (histogram.get(monthKey) || 0) + 1);
      }

      return Array.from(histogram.entries())
        .map(([date, count]) => ({ date: date + '-01', count }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Get Creation Date Histogram');
      return [];
    }
  }

  removeTimedOutViewers() {
    try {
      const config = this.settingsManager.get();
      const now = Date.now();
      const effectiveTimeout = this.getEffectiveTimeoutDuration();
      const cutoff = now - effectiveTimeout;
      let removed = 0;

      for (const [username, viewer] of this.state.viewers.entries()) {
        if (viewer.lastSeen < cutoff) {
          this.state.viewers.delete(username);
          this.pendingUserInfo.delete(username);
          removed++;
        }
      }

      if (removed > 0) {
        this.notify('viewersTimedOut', removed);
      }

      return removed;
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Remove Timed Out Viewers');
      return 0;
    }
  }

  cleanupStuckPendingRequests() {
    try {
      const now = Date.now();
      let cleaned = 0;

      for (const username of this.pendingUserInfo) {
        const viewer = this.state.viewers.get(username);

        if (!viewer) {
          // Viewer no longer exists
          this.pendingUserInfo.delete(username);
          cleaned++;
          continue;
        }

        // Ensure metadata object exists
        if (!viewer.metadata) {
          viewer.metadata = {
            apiAttempts: 0,
            lastApiAttempt: null,
            firstAttempt: null
          };
        }

        // Check for stuck requests (older than 10 minutes)
        if (viewer.metadata.lastApiAttempt && (now - viewer.metadata.lastApiAttempt) > 600000) {
          console.log(`Cleaning up stuck pending request for ${username}, stuck for ${Math.round((now - viewer.metadata.lastApiAttempt) / 60000)} minutes`);
          this.pendingUserInfo.delete(username);
          viewer.hasPendingInfo = false;
          viewer.metadata.apiAttempts = Math.max(viewer.metadata.apiAttempts, 3); // Mark as failed
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} stuck pending user info requests`);
      }

      return cleaned;
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Cleanup Stuck Pending Requests');
      return 0;
    }
  }

  clear() {
    try {
      this.state.viewers.clear();
      this.state.history = [];
      this.pendingUserInfo.clear();
      this.timeTrackingData.clear(); // Clear heatmap data
      this.state.metadata = {
        lastUpdated: null,
        totalRequests: 0,
        sessionStart: Date.now(),
        errors: [],
        heatmapData: [] // Reset heatmap data
      };

      this.notify('dataCleared');
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Clear');
    }
  }

  // Debug and monitoring methods
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async getDebugInfo() {
    // Get data usage stats from API client
    let dataUsage = {
      total: { bytesSent: 0, bytesReceived: 0, apiCalls: 0 },
      lastMinute: { bytesSent: 0, bytesReceived: 0 },
      requestCount: 0
    };

    try {
      // Get data usage stats from background service
      const response = await chrome.runtime.sendMessage({
        type: 'getDataUsageStats'
      });
      if (response) {
        dataUsage = response;
      }
    } catch (error) {
      console.warn('Could not get data usage stats:', error);
    }

    const descriptionStats = this.getDescriptionStats();

    // Get pending count based on tracking mode
    const pendingCount = this.apiClient?.isBackgroundTracking ?
      (this.apiClient._pendingCount || 0) :
      this.pendingUserInfo.size;

    return {
      viewerCount: this.state.viewers.size,
      historyPoints: this.state.history.length,
      pendingInfo: pendingCount,
      observerCount: this.observers.size,
      lastUpdated: this.state.metadata.lastUpdated,
      sessionDuration: Date.now() - this.state.metadata.sessionStart,
      descriptionStats: {
        total: descriptionStats.total,
        withData: descriptionStats.withData,
        withDescriptions: descriptionStats.withDescriptions,
        withoutDescriptions: descriptionStats.withoutDescriptions,
        descriptionPercentage: descriptionStats.descriptionPercentage
      },
      dataUsage: {
        totalSent: this.formatBytes(dataUsage.total.bytesSent),
        totalReceived: this.formatBytes(dataUsage.total.bytesReceived),
        totalApiCalls: dataUsage.total.apiCalls || 0,
        lastMinuteSent: this.formatBytes(dataUsage.lastMinute.bytesSent),
        lastMinuteReceived: this.formatBytes(dataUsage.lastMinute.bytesReceived),
        requestsLastMinute: dataUsage.requestCount
      }
    };
  }

  cleanZeroDataFromStart() {
    try {
      // Find the first point with viewers > 0
      let firstNonZeroIndex = -1;
      for (let i = 0; i < this.state.history.length; i++) {
        if (this.state.history[i].totalViewers > 0) {
          firstNonZeroIndex = i;
          break;
        }
      }

      // If we found non-zero data and there are more than 5 zero points before it
      if (firstNonZeroIndex > 5) {
        // Keep only 5 points before the first non-zero point
        const pointsToKeep = Math.max(0, firstNonZeroIndex - 5);
        const removedPoints = this.state.history.splice(0, pointsToKeep);

        console.log(`Graph cleaned: Removed ${removedPoints.length} zero viewer data points, keeping 5 minutes before stream start`);
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'DataManager Clean Zero Data From Start');
    }
  }

  // Helper methods for description filtering
  getUsersWithDescriptions() {
    return Array.from(this.state.viewers.values()).filter(viewer => viewer.hasDescription);
  }

  getUsersWithoutDescriptions() {
    return Array.from(this.state.viewers.values()).filter(viewer =>
      viewer.createdAt && !viewer.hasDescription);
  }

  getDescriptionStats() {
    const allUsers = Array.from(this.state.viewers.values());
    const usersWithData = allUsers.filter(viewer => viewer.createdAt);
    const usersWithDescriptions = allUsers.filter(viewer => viewer.hasDescription);

    return {
      total: allUsers.length,
      withData: usersWithData.length,
      withDescriptions: usersWithDescriptions.length,
      withoutDescriptions: usersWithData.length - usersWithDescriptions.length,
      descriptionPercentage: usersWithData.length > 0 ?
        Math.round((usersWithDescriptions.length / usersWithData.length) * 100) : 0
    };
  }

  getAvailableAccountCreationMonths() {
    try {
      const config = this.settingsManager.get();
      const startDate = new Date(BOT_DATE_RANGE_START);
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() - BOT_DATE_RANGE_MONTHS_FROM_NOW);

      const monthsMap = new Map();

      // Get all viewers and count by month
      const viewers = Array.from(this.state.viewers.values());

      viewers.forEach(viewer => {
        if (!viewer.createdAt) return;

        const createdDate = new Date(viewer.createdAt);

        // Check if date is within the bot detection range
        if (createdDate < startDate || createdDate > endDate) return;

        const year = createdDate.getFullYear();
        const month = createdDate.getMonth() + 1;
        const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
        const monthLabel = createdDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        if (!monthsMap.has(monthKey)) {
          monthsMap.set(monthKey, {
            value: monthKey,
            label: monthLabel,
            count: 0,
            date: new Date(year, month - 1, 1) // For sorting
          });
        }

        monthsMap.get(monthKey).count++;
      });

      // Convert to array and sort by date (newest first)
      const monthsArray = Array.from(monthsMap.values());
      monthsArray.sort((a, b) => b.date - a.date);

      return monthsArray;
    } catch (error) {
      console.error('Error getting available months:', error);
      return [];
    }
  }

  // Export tracking data methods
  exportTrackingDataAsCSV(channelName = '') {
    const data = this.getExportTrackingData();
    return this.exportManager.exportTrackingDataAsCSV(channelName, data);
  }

  exportTrackingDataAsXML(channelName = '') {
    const data = this.getExportTrackingData();
    return this.exportManager.exportTrackingDataAsXML(channelName, data);
  }

  exportTrackingDataAsSQL(channelName = '') {
    const data = this.getExportTrackingData();
    return this.exportManager.exportTrackingDataAsSQL(channelName, data);
  }

  getExportTrackingData() {
    const exportData = [];

    // Combine viewer data with time tracking data
    for (const [username, trackingEntry] of this.timeTrackingData.entries()) {
      const viewer = this.state.viewers.get(username);
      const totalTime = trackingEntry.currentTimeInStream + trackingEntry.pastTimeInStream;

      // Use trackingEntry data first, fallback to viewer data
      const id = trackingEntry.id || viewer?.id || null;
      const firstSeen = trackingEntry.firstSeen ? new Date(trackingEntry.firstSeen).toISOString() :
        (viewer ? new Date(viewer.firstSeen).toISOString() : null);
      const lastSeen = trackingEntry.lastSeen ? new Date(trackingEntry.lastSeen).toISOString() :
        (viewer ? new Date(viewer.lastSeen).toISOString() : null);

      exportData.push({
        username: username,
        id: id,
        createdAt: trackingEntry.createdAt || null,
        firstSeen: firstSeen,
        lastSeen: lastSeen,
        timeInStream: totalTime
      });
    }

    // Sort by username
    exportData.sort((a, b) => a.username.localeCompare(b.username));

    return exportData;
  }

  // Export viewer graph history data methods
  exportViewerGraphDataAsCSV(channelName = '') {
    const data = this.getViewerGraphHistoryData();
    return this.exportManager.exportViewerGraphDataAsCSV(channelName, data);
  }

  exportViewerGraphDataAsXML(channelName = '') {
    const data = this.getViewerGraphHistoryData();
    return this.exportManager.exportViewerGraphDataAsXML(channelName, data);
  }

  exportViewerGraphDataAsSQL(channelName = '') {
    const data = this.getViewerGraphHistoryData();
    return this.exportManager.exportViewerGraphDataAsSQL(channelName, data);
  }

  exportViewerGraphDataAsJSON(channelName = '') {
    const data = this.getViewerGraphHistoryData();
    return this.exportManager.exportViewerGraphDataAsJSON(channelName, data);
  }

  exportTrackingDataAsJSON(channelName = '') {
    const data = this.getExportTrackingData();
    return this.exportManager.exportTrackingDataAsJSON(channelName, data);
  }

  // Export full state as JSON (for complete session backup/restore)
  exportFullStateAsJSON(channelName = '') {
    try {
      const fullStateData = {
        timeTrackingData: Array.from(this.timeTrackingData.entries()),
        history: this.state.history,
        viewers: Array.from(this.state.viewers.entries()),
        metadata: {
          ...this.state.metadata,
          exportedAt: new Date().toISOString()
        }
      };
      return this.exportManager.exportFullStateAsJSON(channelName, fullStateData);
    } catch (error) {
      this.errorHandler?.handle(error, 'Export Full State');
      throw error;
    }
  }

  // Import full state from JSON and enter analysis mode
  importFullStateFromJSON(jsonString) {
    try {
      const importData = JSON.parse(jsonString);

      // Validate import data structure
      if (!importData.version || !importData.type || importData.type !== 'full_state') {
        throw new Error('Invalid import file format');
      }

      if (!importData.channel) {
        throw new Error('Import file missing channel name');
      }

      // Enter analysis mode (stops all data modifications)
      this.isAnalysisMode = true;
      this.analysisMetadata = {
        channel: importData.channel,
        exportedAt: importData.exportedAt,
        importedAt: new Date().toISOString()
      };

      // Clear pending user info (no API requests in analysis mode)
      this.pendingUserInfo.clear();

      // Restore time tracking data
      if (importData.timeTrackingData) {
        this.timeTrackingData = new Map(importData.timeTrackingData);
      }

      // Restore history
      if (importData.history) {
        this.state.history = importData.history;
      }

      // Restore viewers (preserved for analysis)
      if (importData.viewers) {
        this.state.viewers = new Map(importData.viewers);
      }

      // Restore metadata (but update lastUpdated)
      if (importData.metadata) {
        this.state.metadata = {
          ...importData.metadata,
          lastUpdated: Date.now()
        };
      }

      // Process heatmap data if enabled
      if (this.heatmapEnabled) {
        this.processHeatmapData();
      }

      // Notify all observers of the import and analysis mode
      this.notify('analysisMode', {
        enabled: true,
        channel: importData.channel,
        exportedAt: importData.exportedAt,
        importedAt: new Date().toISOString(),
        trackingDataCount: this.timeTrackingData.size,
        historyPoints: this.state.history.length,
        viewerCount: this.state.viewers.size
      });

      return {
        success: true,
        channel: importData.channel,
        exportedAt: importData.exportedAt,
        trackingDataCount: this.timeTrackingData.size,
        historyPoints: this.state.history.length,
        viewerCount: this.state.viewers.size
      };
    } catch (error) {
      this.errorHandler?.handle(error, 'Import Full State');
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Exit analysis mode and clear data
  exitAnalysisMode() {
    try {
      this.isAnalysisMode = false;
      this.analysisMetadata = null;

      // Clear all data
      this.clear();

      // Notify observers
      this.notify('analysisMode', { enabled: false });

      return { success: true };
    } catch (error) {
      this.errorHandler?.handle(error, 'Exit Analysis Mode');
      return { success: false, error: error.message };
    }
  }

  // Check if in analysis mode
  isInAnalysisMode() {
    return this.isAnalysisMode;
  }

  // Get analysis mode metadata
  getAnalysisMetadata() {
    return this.analysisMetadata;
  }

  getViewerGraphHistoryData() {
    // Return history data with formatted structure for export
    return this.state.history.map(point => ({
      timestamp: new Date(point.timestamp).toISOString(),
      totalViewers: point.totalViewers || 0,
      totalAuthenticated: point.totalAuthenticated || 0,
      authenticatedNonBots: point.authenticatedNonBots || 0,
      bots: point.bots || 0
    }));
  }
}


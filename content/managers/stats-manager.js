// Stats Manager for handling statistics display and updates
window.StatsManager = class StatsManager {
  constructor(dataManager, settingsManager, errorHandler, apiClient) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.apiClient = apiClient;
  }

  updateStats() {
    try {
      const stats = this.dataManager.getStats();

      if (this.dataManager.isShowingLive()) {
        const history = this.dataManager.getHistory();
        const latestTotal = history.length > 0 ? history[history.length - 1].totalViewers : 0;
        const latestHistoryPoint = history.length > 0 ? history[history.length - 1] : null;

        // In analysis mode, use last history point data instead of live (empty) data
        const isAnalysisMode = this.dataManager.isInAnalysisMode && this.dataManager.isInAnalysisMode();

        // Use the fixed authenticated count from API, not the calculated totalViewers
        const fixedAuthenticatedCount = isAnalysisMode && latestHistoryPoint
          ? latestHistoryPoint.totalAuthenticated
          : this.dataManager.getAuthenticatedCount();

        // Calculate percentages
        const fixedAuthenticatedPercentage = fixedAuthenticatedCount && latestTotal
          ? this.formatPercentage((fixedAuthenticatedCount / latestTotal) * 100)
          : 0;

        // Calculate authenticated non-bots based on bot calculation type
        // When live, use current stats values (not historical snapshot)
        // In analysis mode, use last history point values
        const botCalculationType = window.trackingPageManager ? window.trackingPageManager.botCalculationType : 0;
        let authenticatedNonBots;
        let accountsWithDates, bots;

        if (isAnalysisMode && latestHistoryPoint) {
          accountsWithDates = latestHistoryPoint.accountsWithDates || 0;
          bots = latestHistoryPoint.bots || 0;
        } else {
          accountsWithDates = stats.accountsWithDates || 0;
          bots = stats.bots || 0;
        }

        if (botCalculationType === 1) {
          // High Churn mode: authenticatedNonBots = accountsWithDates - bots
          authenticatedNonBots = Math.max(0, accountsWithDates - bots);
        } else {
          // Normal mode: authenticatedNonBots = totalAuthenticated - bots
          authenticatedNonBots = fixedAuthenticatedCount - bots;
        }
        const authenticatedNonBotsPercentage = fixedAuthenticatedCount > 0
          ? this.formatPercentageFloor((authenticatedNonBots / fixedAuthenticatedCount) * 100)
          : 0;

        const botPercentage = accountsWithDates > 0
          ? this.formatPercentage((bots / accountsWithDates) * 100)
          : 0;

        // Color coding
        const percentageColor = this.getAuthenticatedPercentageColor(fixedAuthenticatedPercentage);
        const nonBotPercentageColor = this.getAuthenticatedPercentageColor(authenticatedNonBotsPercentage);
        const botStyle = this.getBotPercentageStyle(botPercentage);

        // Calculate bot percentage from total authenticated (same as users)
        // Use the calculated bots value based on bot calculation type
        let displayBots;
        if (botCalculationType === 1) {
          // High Churn mode: bots = totalAuthenticated - (accountsWithDates - algorithmBots)
          // This matches the graph calculation exactly
          displayBots = Math.max(0, fixedAuthenticatedCount - (accountsWithDates - bots));
        } else {
          // Normal mode: use regular bots
          displayBots = bots;
        }

        const botPercentageFromAuth = fixedAuthenticatedCount > 0
          ? this.formatPercentageCeil((displayBots / fixedAuthenticatedCount) * 100)
          : 0;
        const botPercentageColor = '#ff4444';

        // Update individual stat panels with percentages
        this.updateElement('tvm-viewers', latestTotal.toString());
        this.updateElement('tvm-authenticated-users',
          `${fixedAuthenticatedCount || 0} (<span style="color: ${percentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${percentageColor} !important; background: none !important;">${fixedAuthenticatedPercentage}%</span>)`
        );
        this.updateElement('tvm-non-bots',
          `${Math.max(0, authenticatedNonBots)} (<span style="color: ${nonBotPercentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${nonBotPercentageColor} !important; background: none !important;">${authenticatedNonBotsPercentage}%</span>)`
        );

        // Show nothing if bot percentage is 0
        if (botPercentageFromAuth === '0' || botPercentageFromAuth === 0) {
          this.updateElement('tvm-bots', '');
        } else {
          this.updateElement('tvm-bots',
            `${displayBots} (<span style="color: ${botPercentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${botPercentageColor} !important; background: none !important;">${botPercentageFromAuth}%</span>)`
          );
        }

        // Show total users found in our viewer list (not the API's authenticated count)
        // In analysis mode, use last history point value
        const totalUsersFound = isAnalysisMode && latestHistoryPoint
          ? latestHistoryPoint.totalUsersFound || stats.totalUsersFound
          : stats.totalUsersFound;
        this.updateElement('tvm-authenticated', totalUsersFound.toString());

        // Update scanned breakdown with bot percentage (only show percentage if bots exist)
        if (bots > 0) {
          const botPercentageScanned = accountsWithDates > 0 ? Math.round((bots / accountsWithDates) * 100) : 0;
          this.updateElement('tvm-bots-count',
            `${bots} <span style="color: #999; font-size: 11px;">(${botPercentageScanned}%)</span>`
          );
        } else {
          this.updateElement('tvm-bots-count', bots.toString());
        }
        this.updateElement('tvm-users-count', accountsWithDates.toString());
      } else {
        const historyPoint = this.dataManager.getShowingHistoryPoint();
        if (historyPoint) {

          const latestTotal = historyPoint.totalViewers;

          // Use the fixed authenticated count from API, not the calculated totalViewers
          const fixedAuthenticatedCount = historyPoint.totalAuthenticated;

          // Calculate percentages
          const fixedAuthenticatedPercentage = fixedAuthenticatedCount && latestTotal
            ? this.formatPercentage((fixedAuthenticatedCount / latestTotal) * 100)
            : 0;

          // Calculate authenticated non-bots based on bot calculation type
          const botCalculationType = window.trackingPageManager ? window.trackingPageManager.botCalculationType : 0;
          let authenticatedNonBots;
          if (botCalculationType === 1) {
            // High Churn mode: authenticatedNonBots = accountsWithDates - bots
            authenticatedNonBots = Math.max(0, (historyPoint.accountsWithDates || 0) - historyPoint.bots);
          } else {
            // Normal mode: authenticatedNonBots = totalAuthenticated - bots
            authenticatedNonBots = fixedAuthenticatedCount - historyPoint.bots;
          }
          const authenticatedNonBotsPercentage = fixedAuthenticatedCount > 0
            ? this.formatPercentageFloor((authenticatedNonBots / fixedAuthenticatedCount) * 100)
            : 0;

          const botPercentage = historyPoint.accountsWithDates > 0
            ? this.formatPercentage((historyPoint.bots / historyPoint.accountsWithDates) * 100)
            : 0;

          // Color coding
          const percentageColor = this.getAuthenticatedPercentageColor(fixedAuthenticatedPercentage);
          const nonBotPercentageColor = this.getAuthenticatedPercentageColor(authenticatedNonBotsPercentage);
          const botStyle = this.getBotPercentageStyle(botPercentage);

          // Calculate bot percentage from total authenticated (same as users)
          // Use the calculated bots value based on bot calculation type
          let displayBots;
          if (botCalculationType === 1) {
            // High Churn mode: bots = totalAuthenticated - (accountsWithDates - algorithmBots)
            // This matches the graph calculation exactly
            displayBots = Math.max(0, fixedAuthenticatedCount - ((historyPoint.accountsWithDates || 0) - (historyPoint.bots || 0)));
          } else {
            // Normal mode: use regular bots
            displayBots = historyPoint.bots;
          }

          const botPercentageFromAuth = fixedAuthenticatedCount > 0
            ? this.formatPercentageCeil((displayBots / fixedAuthenticatedCount) * 100)
            : 0;
          const botPercentageColor = '#ff4444';

          // Update individual stat panels with percentages
          this.updateElement('tvm-viewers', latestTotal.toString());
          this.updateElement('tvm-authenticated-users',
            `${fixedAuthenticatedCount || 0} (<span style="color: ${percentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${percentageColor} !important; background: none !important;">${fixedAuthenticatedPercentage}%</span>)`
          );
          this.updateElement('tvm-non-bots',
            `${Math.max(0, authenticatedNonBots)} (<span style="color: ${nonBotPercentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${nonBotPercentageColor} !important; background: none !important;">${authenticatedNonBotsPercentage}%</span>)`
          );

          // Show nothing if bot percentage is 0
          if (botPercentageFromAuth === '0' || botPercentageFromAuth === 0) {
            this.updateElement('tvm-bots', '');
          } else {
            this.updateElement('tvm-bots',
              `${displayBots} (<span style="color: ${botPercentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${botPercentageColor} !important; background: none !important;">${botPercentageFromAuth}%</span>)`
            );
          }

          // Show total users found in our viewer list (not the API's authenticated count)
          this.updateElement('tvm-authenticated', historyPoint.usersFound.toString());

          // Update scanned breakdown with bot percentage (only show percentage if bots exist)
          if (historyPoint.bots > 0) {
            const botPercentageScanned = historyPoint.accountsWithDates > 0 ? Math.round((historyPoint.bots / historyPoint.accountsWithDates) * 100) : 0;
            this.updateElement('tvm-bots-count',
              `${historyPoint.bots} <span style="color: #999; font-size: 11px;">(${botPercentageScanned}%)</span>`
            );
          } else {
            this.updateElement('tvm-bots-count', historyPoint.bots.toString());
          }
          this.updateElement('tvm-users-count', historyPoint.accountsWithDates.toString());
        } else {
          // No history point, clear stats
          this.updateElement('tvm-viewers', 'No data');
          this.updateElement('tvm-authenticated-users', 'No data');
          this.updateElement('tvm-non-bots', 'No data');
          this.updateElement('tvm-bots', 'No data');
          this.updateElement('tvm-authenticated', 'No data');
          this.updateElement('tvm-bots-count', 'No data');
          this.updateElement('tvm-users-count', 'No data');
        }

      }
      // Update pending info
      this.updateElement('tvm-pending', stats.pendingInfo.toString());

      // Update bot ratio display
      this.updateBotRatioDisplay();

      // Update API calls display
      this.updateApiCallsDisplay();

      // Update effective displays  
      this.updateEffectiveTimeoutDisplay();
      this.updateEffectiveRequestIntervalDisplay();

    } catch (error) {
      this.errorHandler?.handle(error, 'StatsManager Update Stats');
    }
  }

  updateViewerCount(count, authenticatedCount = null, timestamp = null) {
    try {
      // Update viewer count display
      this.updateElement('tvm-total-viewers', count.toString());

      if (authenticatedCount !== null) {
        this.updateElement('tvm-authenticated', authenticatedCount.toString());
      }

    } catch (error) {
      this.errorHandler?.handle(error, 'StatsManager Update Viewer Count');
    }
  }

  updateBotRatioDisplay() {
    try {
      return; // Disabled for now
      const botRatioInfo = document.getElementById('tvm-actual-viewers-stats');
      if (!botRatioInfo) return;

      const stats = this.dataManager.getStats();

      // Only show if there are bots
      if (stats.bots === 0) {
        botRatioInfo.style.display = 'none';
        return;
      }

      let totalViewers, bots;

      if (this.dataManager.isShowingLive()) {
        const history = this.dataManager.getHistory();
        totalViewers = history.length > 0 ? history[history.length - 1].totalViewers : 0;
        bots = stats.bots;
      } else {
        const historyPoint = this.dataManager.getShowingHistoryPoint();
        if (!historyPoint) {
          botRatioInfo.style.display = 'none';
          return;
        }
        totalViewers = historyPoint.totalViewers;
        bots = historyPoint.bots;
      }

      // Calculate actual viewers (total minus bots)
      const actualViewers = Math.max(0, totalViewers - bots);

      // Calculate percentage (actual / total)
      const percentage = totalViewers > 0
        ? ((actualViewers / totalViewers) * 100)
        : 0;

      // Update display elements
      this.updateElement('tvm-actual-viewers', actualViewers.toString());
      this.updateElement('tvm-total-viewers-ratio', totalViewers.toString());

      const percentageElement = document.getElementById('tvm-viewer-percentage');
      if (percentageElement) {
        percentageElement.textContent = `${Math.round(percentage)}%`;
        percentageElement.style.color = '#ff4444';  // Always red (shows bot impact)
        percentageElement.style.fontWeight = 'bold';
      }

      botRatioInfo.style.display = 'block';

    } catch (error) {
      this.errorHandler?.handle(error, 'StatsManager Update Bot Ratio Display');
    }
  }

  getAuthenticatedPercentageColor(percentage) {
    const num = parseFloat(percentage);
    if (num >= 80) return '#00ff88';
    if (num >= 65) return '#ffa500';
    return '#ff4444';
  }

  getBotPercentageStyle(percentage) {
    const num = parseFloat(percentage);
    if (num > 15) {
      return 'color: #ff4444 !important; font-weight: bold; -webkit-text-fill-color: #ff4444 !important; background: none !important;';
    } else if (num >= 5) {
      return 'color: #ffa500 !important; font-weight: bold; -webkit-text-fill-color: #ffa500 !important; background: none !important;';
    }
    return '';
  }

  formatPercentage(percentage) {
    // Simply return integer - decimals were visually unhelpful
    return Math.round(percentage).toString();
  }

  formatPercentageFloor(percentage) {
    const value = parseFloat(percentage);
    // Show 1 decimal place if under 1% for better precision on low percentages
    if (value < 1 && value > 0) {
      return Math.floor(value * 10) / 10;
    }
    return Math.floor(value).toString();
  }

  formatPercentageCeil(percentage) {
    const value = parseFloat(percentage);
    // Show 1 decimal place if over 99% but under 100% for heavily botted streams
    if (value > 99 && value < 100) {
      return Math.ceil(value * 10) / 10;
    }
    return Math.ceil(value).toString();
  }

  updateElement(id, content) {
    const element = document.getElementById(id);
    if (element) {
      if (typeof content === 'string' && content.includes('<span')) {
        element.innerHTML = content;
      } else {
        element.textContent = content;
      }
    }
  }

  updateEffectiveTimeoutDisplay() {
    try {
      const config = this.settingsManager.get();
      const effectiveTimeoutDisplay = document.getElementById('tvm-effective-timeout');
      const effectiveTimeoutValue = document.getElementById('tvm-effective-timeout-value');

      if (!effectiveTimeoutDisplay || !effectiveTimeoutValue) return;

      if (config.autoAdjustTimeout) {
        // Get effective timeout from data manager
        if (this.dataManager && typeof this.dataManager.getEffectiveTimeoutDuration === 'function') {
          const effectiveTimeout = this.dataManager.getEffectiveTimeoutDuration();
          const timeoutMinutes = (effectiveTimeout / 60000).toFixed(1);
          effectiveTimeoutValue.textContent = timeoutMinutes;
          effectiveTimeoutDisplay.style.display = 'block';
        } else {
          effectiveTimeoutDisplay.style.display = 'none';
        }
      } else {
        effectiveTimeoutDisplay.style.display = 'none';
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'StatsManager Update Effective Timeout Display');
    }
  }

  updateEffectiveRequestIntervalDisplay() {
    try {
      const config = this.settingsManager.get();
      const effectiveRequestIntervalDisplay = document.getElementById('tvm-effective-request-interval');
      const effectiveRequestIntervalValue = document.getElementById('tvm-effective-request-interval-value');

      if (!effectiveRequestIntervalDisplay || !effectiveRequestIntervalValue) return;

      if (config.autoAdjustRequestInterval) {
        // Get effective request interval from data manager
        if (this.dataManager && typeof this.dataManager.getEffectiveRequestInterval === 'function') {
          const effectiveInterval = this.dataManager.getEffectiveRequestInterval();
          const intervalSeconds = (effectiveInterval / 1000).toFixed(1);
          effectiveRequestIntervalValue.textContent = intervalSeconds;
          effectiveRequestIntervalDisplay.style.display = 'block';
        } else {
          effectiveRequestIntervalDisplay.style.display = 'none';
        }
      } else {
        effectiveRequestIntervalDisplay.style.display = 'none';
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'StatsManager Update Effective Request Interval Display');
    }
  }

  updateApiCallsDisplay() {
    try {
      // In background tracking, API calls are managed by background service
      // Try to get rate limit status from the API client
      if (this.apiClient && this.apiClient._rateLimitStatus) {
        const rateLimitStatus = this.apiClient._rateLimitStatus;
        const used = rateLimitStatus.requestCount || 0;
        const available = rateLimitStatus.available || (rateLimitStatus.maxRequests - used);
        const max = rateLimitStatus.maxRequests || 5000;
        this.updateElement('tvm-api-calls', `${available}/${max}`);
      } else {
        // Fallback to default display
        this.updateElement('tvm-api-calls', '0/5000');
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'StatsManager Update API Calls Display');
    }
  }

  setStartTime(startTime = null) {
    try {
      const startTimeElement = document.getElementById('tvm-start-time');
      if (!startTimeElement) return;

      const time = startTime || new Date();
      const timeString = time.toLocaleString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(',', '') + ' UTC';

      startTimeElement.textContent = `Started: ${timeString}`;
    } catch (error) {
      this.errorHandler?.handle(error, 'StatsManager Set Start Time');
    }
  }
}

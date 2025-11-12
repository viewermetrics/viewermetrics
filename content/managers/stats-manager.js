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

        // Use the fixed authenticated count from API, not the calculated totalViewers
        const fixedAuthenticatedCount = this.dataManager.getAuthenticatedCount();

        // Calculate percentages
        const fixedAuthenticatedPercentage = fixedAuthenticatedCount && latestTotal
          ? this.formatPercentage((fixedAuthenticatedCount / latestTotal) * 100)
          : 0;

        // Calculate authenticated non-bots
        const authenticatedNonBots = fixedAuthenticatedCount - stats.bots;
        const authenticatedNonBotsPercentage = authenticatedNonBots >= 0 && latestTotal
          ? this.formatPercentage((authenticatedNonBots / latestTotal) * 100)
          : 0;

        const botPercentage = stats.accountsWithDates > 0
          ? this.formatPercentage((stats.bots / stats.accountsWithDates) * 100)
          : 0;

        // Color coding
        const percentageColor = this.getAuthenticatedPercentageColor(fixedAuthenticatedPercentage);
        const nonBotPercentageColor = this.getAuthenticatedPercentageColor(authenticatedNonBotsPercentage);
        const botStyle = this.getBotPercentageStyle(botPercentage);

        // Update elements
        const totalViewersDisplay = stats.bots > 0
          ? `${latestTotal} / ${fixedAuthenticatedCount || 0} (<span style="color: ${percentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${percentageColor} !important; background: none !important;">${fixedAuthenticatedPercentage}%</span>) / ${Math.max(0, authenticatedNonBots)} (<span style="color: ${nonBotPercentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${nonBotPercentageColor} !important; background: none !important;">${authenticatedNonBotsPercentage}%</span>)`
          : `${latestTotal} / ${fixedAuthenticatedCount || 0} (<span style="color: ${percentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${percentageColor} !important; background: none !important;">${fixedAuthenticatedPercentage}%</span>)`;

        this.updateElement('tvm-total-viewers', totalViewersDisplay);

        // Show total users found in our viewer list (not the API's authenticated count)
        this.updateElement('tvm-authenticated', stats.totalUsersFound.toString());

        this.updateElement('tvm-bots',
          botStyle
            ? `${stats.bots} / ${stats.accountsWithDates} (<span style="${botStyle}">${botPercentage}%</span>)`
            : `${stats.bots} / ${stats.accountsWithDates} (${botPercentage}%)`
        );
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

          // Calculate authenticated non-bots
          const authenticatedNonBots = fixedAuthenticatedCount - historyPoint.bots;
          const authenticatedNonBotsPercentage = authenticatedNonBots >= 0 && latestTotal
            ? this.formatPercentage((authenticatedNonBots / latestTotal) * 100)
            : 0;

          const botPercentage = historyPoint.accountsWithDates > 0
            ? this.formatPercentage((historyPoint.bots / historyPoint.accountsWithDates) * 100)
            : 0;

          // Color coding
          const percentageColor = this.getAuthenticatedPercentageColor(fixedAuthenticatedPercentage);
          const nonBotPercentageColor = this.getAuthenticatedPercentageColor(authenticatedNonBotsPercentage);
          const botStyle = this.getBotPercentageStyle(botPercentage);

          // Update elements
          const totalViewersDisplay = historyPoint.bots > 0
            ? `${latestTotal} / ${fixedAuthenticatedCount || 0} (<span style="color: ${percentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${percentageColor} !important; background: none !important;">${fixedAuthenticatedPercentage}%</span>) / ${Math.max(0, authenticatedNonBots)} (<span style="color: ${nonBotPercentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${nonBotPercentageColor} !important; background: none !important;">${authenticatedNonBotsPercentage}%</span>)`
            : `${latestTotal} / ${fixedAuthenticatedCount || 0} (<span style="color: ${percentageColor} !important; font-weight: bold; -webkit-text-fill-color: ${percentageColor} !important; background: none !important;">${fixedAuthenticatedPercentage}%</span>)`;

          this.updateElement('tvm-total-viewers', totalViewersDisplay);

          // Show total users found in our viewer list (not the API's authenticated count)
          this.updateElement('tvm-authenticated', historyPoint.usersFound.toString());

          this.updateElement('tvm-bots',
            botStyle
              ? `${historyPoint.bots} / ${historyPoint.accountsWithDates} (<span style="${botStyle}">${botPercentage}%</span>)`
              : `${historyPoint.bots} / ${historyPoint.accountsWithDates} (${botPercentage}%)`
          );
        } else {
          // No history point, clear stats
          this.updateElement('tvm-total-viewers', 'No data');
          this.updateElement('tvm-authenticated', 'No data');
          this.updateElement('tvm-bots', 'No data');
        }

      }
      // Update pending info
      this.updateElement('tvm-pending', stats.pendingInfo.toString());

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

    // If you want to keep one decimal place instead, use this:
    const num = parseFloat(percentage);
    if (num >= 100) {
      return Math.round(num).toString();
    } else {
      return num.toFixed(1);
    }
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
        const max = rateLimitStatus.maxRequests || 500;
        this.updateElement('tvm-api-calls', `${available}/${max}`);
      } else {
        // Fallback to default display
        this.updateElement('tvm-api-calls', '0/500');
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

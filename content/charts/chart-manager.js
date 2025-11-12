// Chart Manager for handling chart operations with Chart.js
window.ChartManager = class ChartManager {
  constructor(dataManager, settingsManager, errorHandler, channelName = null, uiManager = null) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.uiManager = uiManager;
    this.channelName = channelName;
    this.mainChart = new MainChart(dataManager, settingsManager, errorHandler, channelName);
    this.creationChart = new CreationChart(dataManager, settingsManager, errorHandler, uiManager);
    this.isInitialized = false;
    this.isPaused = false;
    this.autoPauseTimer = null;
    this.lastViewerCount = 0;

    // Chart update throttling to improve performance with large datasets
    this.lastChartUpdate = 0;
    this.chartUpdateThrottle = settingsManager.get('chartUpdateThrottle');
    this.pendingUpdate = false;
    this.updateTimer = null;

    // Subscribe to data changes
    this.dataManager.subscribe((event, data) => {
      this.handleDataChange(event, data);
    });

    // Subscribe to config changes
    this.settingsManager.subscribe((config) => {
      this.handleConfigChange(config);
    });
  }

  setChannelName(channelName) {
    this.channelName = channelName;
    // Update charts if they exist
    this.mainChart.setChannelName(channelName);
    if (this.creationChart.chart) this.creationChart.chart.update('none');
  }

  resizeCharts() {
    try {
      this.mainChart.resize();
      this.creationChart.resize();
    } catch (error) {
      console.error('Error resizing charts:', error);
    }
  }

  handleDataChange(event, data) {
    try {
      switch (event) {
        case 'historyUpdated':
        case 'userInfoUpdated':
        case 'viewersUpdated':
        case 'botsDetected':
          this.throttledUpdateGraphs();

          // Update creation chart threshold if auto-adjustment is enabled
          if (this.creationChart && (event === 'historyUpdated' || event === 'userInfoUpdated' || event === 'botsDetected')) {
            if (this.creationChart.updateThreshold()) {
              this.throttledUpdateCreationChart();
            }
          }
          break;
        case 'historyPointChanged':
          // Update both charts when history point changes
          this.updateGraphs();
          this.updateCreationChart();
          break;
        case 'dataCleared':
          this.clearGraphs();
          break;
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'ChartManager Data Change Handler', { event, data });
    }
  }

  handleConfigChange(config) {
    try {
      // Update chart throttle if changed
      if (config.chartUpdateThrottle !== undefined) {
        this.chartUpdateThrottle = config.chartUpdateThrottle;
      }

      // Handle auto-pause configuration changes
      if (!config.autoPauseGraphsOnZeroViewers && this.autoPauseTimer) {
        // If auto-pause was disabled and there's an active timer, clear it
        clearTimeout(this.autoPauseTimer);
        this.autoPauseTimer = null;
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'ChartManager Config Change Handler', { config });
    }
  }

  async initGraphs() {
    try {
      // Wait for Chart.js to be available
      if (typeof Chart === 'undefined') {
        await ChartUtils.waitForChartJS();
      }

      await this.mainChart.init();
      await this.creationChart.init();
      this.isInitialized = true;

    } catch (error) {
      this.errorHandler?.handle(error, 'ChartManager Init Graphs');
    }
  }

  // Throttled update methods to improve performance with large datasets
  throttledUpdateGraphs() {
    const now = Date.now();

    // If enough time has passed since last update, update immediately
    if (now - this.lastChartUpdate >= this.chartUpdateThrottle) {
      this.updateGraphs();
      this.lastChartUpdate = now;
      this.pendingUpdate = false;

      // Clear any pending timer
      if (this.updateTimer) {
        clearTimeout(this.updateTimer);
        this.updateTimer = null;
      }
    } else if (!this.pendingUpdate) {
      // Schedule an update for when the throttle period expires
      this.pendingUpdate = true;
      const delay = this.chartUpdateThrottle - (now - this.lastChartUpdate);

      this.updateTimer = setTimeout(() => {
        this.updateGraphs();
        this.lastChartUpdate = Date.now();
        this.pendingUpdate = false;
        this.updateTimer = null;
      }, delay);
    }
  }

  throttledUpdateCreationChart() {
    // For creation chart updates, use the same throttling logic but only update creation chart
    const now = Date.now();

    if (now - this.lastChartUpdate >= this.chartUpdateThrottle) {
      this.updateCreationChart();
    } else if (!this.pendingUpdate) {
      // Schedule an update for when the throttle period expires
      const delay = this.chartUpdateThrottle - (now - this.lastChartUpdate);

      setTimeout(() => {
        this.updateCreationChart();
      }, delay);
    }
  }

  updateGraphs() {
    if (!this.isInitialized) return;

    try {
      // Check for auto-pause conditions
      this.checkAutoPauseConditions();

      // Only update if not paused
      if (!this.isPaused) {
        this.updateMainChart();
        this.updateCreationChart();
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'ChartManager Update Graphs');
    }
  }

  updateMainChart() {
    this.mainChart.update();
  }

  updateCreationChart() {
    this.creationChart.update();
  }

  clearGraphs() {
    try {
      this.mainChart.clear();
      this.creationChart.clear();
    } catch (error) {
      this.errorHandler?.handle(error, 'ChartManager Clear Graphs');
    }
  }

  pauseGraphs() {
    this.isPaused = true;
    // Clear auto-pause timer since we're manually pausing
    if (this.autoPauseTimer) {
      clearTimeout(this.autoPauseTimer);
      this.autoPauseTimer = null;
    }
  }

  resumeGraphs() {
    this.isPaused = false;
    // Update graphs immediately when resuming
    if (this.isInitialized) {
      this.updateMainChart();
      this.updateCreationChart();
    }
  }

  checkAutoPauseConditions() {
    const config = this.settingsManager.get();
    if (!config.autoPauseGraphsOnZeroViewers) return;

    const history = this.dataManager.getHistory();
    const currentViewers = history.length > 0 ? history[history.length - 1].totalViewers : 0;

    // If viewers dropped to 0 and we haven't started a timer yet
    if (currentViewers === 0 && this.lastViewerCount > 0 && !this.autoPauseTimer && !this.isPaused) {
      this.autoPauseTimer = setTimeout(() => {
        if (!this.isPaused) {
          this.pauseGraphs();
          // Dispatch event to update UI
          const event = new CustomEvent('tvm-graphs-auto-paused');
          document.dispatchEvent(event);
        }
      }, config.autoPauseDelay);
    }

    // If viewers returned, clear the timer
    if (currentViewers > 0 && this.autoPauseTimer) {
      clearTimeout(this.autoPauseTimer);
      this.autoPauseTimer = null;
    }

    this.lastViewerCount = currentViewers;
  }

  destroy() {
    // Clean up throttling timer
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    // Clean up auto-pause timer
    if (this.autoPauseTimer) {
      clearTimeout(this.autoPauseTimer);
      this.autoPauseTimer = null;
    }

    // Destroy charts
    this.mainChart.destroy();
    this.creationChart.destroy();

    this.isInitialized = false;
  }
}

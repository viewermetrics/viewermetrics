// Tracking Page Manager
class TrackingPageManager {
  constructor() {
    this.channelName = null;
    this.isTracking = false;
    this.trackingMetrics = null;
    this.debugUpdateInterval = null;
    this.hasUserInteracted = false; // Track if user has interacted with page

    // Bot threshold control
    this.calculatedBotThreshold = null; // Store the original calculated threshold
    this.botThresholdOverride = null;
    this.botThresholdLocked = true;

    // Page ID for coordination
    this.pageId = 'tracking_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    this.init();
  }

  async init() {
    console.log('Tracking page initializing...');

    // Set up beforeunload confirmation
    this.setupBeforeUnloadConfirmation();

    // Check for existing tracking lock
    const canProceed = await this.checkTrackingLock();
    if (!canProceed) {
      return; // Another page is active
    }

    // Set up event listeners
    this.setupEventListeners();

    // Check for channel parameter in URL or storage
    await this.loadChannelInfo();

    // Listen for messages from content scripts
    this.setupMessageListeners();

    // Acquire tracking lock
    await this.acquireTrackingLock();

    // Start tracking if we have a channel name
    if (this.channelName) {
      await this.startTracking();
    }
  }

  setupBeforeUnloadConfirmation() {
    // Remove existing listeners if present to prevent duplicates
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
    }

    // Track user interaction to enable beforeunload
    const markInteraction = () => {
      this.hasUserInteracted = true;
    };

    // Listen for any user interaction
    ['click', 'keydown', 'scroll', 'mousemove'].forEach(eventType => {
      document.addEventListener(eventType, markInteraction, { once: true });
    });

    // Intercept keyboard shortcuts for refresh
    this.keydownHandler = (e) => {
      if (!this.isTracking) return;

      // Check for F5 or Ctrl+R (refresh shortcuts)
      const isRefresh = e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.ctrlKey && e.key === 'R');

      if (isRefresh) {
        e.preventDefault();

        // Show custom confirmation dialog
        const confirmed = confirm(
          'You are currently tracking a channel. Refreshing will stop tracking and lose all data.\n\n' +
          'Are you sure you want to refresh?'
        );

        if (confirmed) {
          // User confirmed, allow refresh
          this.isTracking = false;
          location.reload();
        }
      }

      // Check for Ctrl+W (close tab)
      if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
        if (this.isTracking) {
          e.preventDefault();

          const confirmed = confirm(
            'You are currently tracking a channel. Closing this tab will stop tracking and lose all data.\n\n' +
            'Are you sure you want to close?'
          );

          if (confirmed) {
            this.isTracking = false;
            window.close();
          }
        }
      }
    };

    document.addEventListener('keydown', this.keydownHandler);

    // Only enable beforeunload after user interaction to avoid Chrome warning
    this.beforeUnloadHandler = (e) => {
      if (this.isTracking && this.hasUserInteracted) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  async checkTrackingLock() {
    try {
      const result = await chrome.storage.local.get(['trackingPageLock']);

      if (result.trackingPageLock) {
        const lock = result.trackingPageLock;
        const timeSince = Date.now() - lock.timestamp;

        // If lock is older than 2 minutes, consider it stale
        if (timeSince > 2 * 60 * 1000) {
          console.log('Stale tracking lock found, clearing it');
          await chrome.storage.local.remove(['trackingPageLock']);
          return true;
        }

        // If this is a new page request (has channel info from storage), take over immediately
        const hasChannelRequest = await chrome.storage.local.get(['trackingPageChannel']);
        if (hasChannelRequest.trackingPageChannel) {
          console.log('New tracking request detected, taking over from existing page');
          await chrome.storage.local.remove(['trackingPageLock']);
          return true;
        }

        // Otherwise, show waiting message for manual page loads
        this.showWaitingMessage(lock);
        await this.waitForLockRelease();
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error checking tracking lock:', error);
      return true; // Proceed if we can't check
    }
  }

  async acquireTrackingLock() {
    const lock = {
      pageId: this.pageId,
      timestamp: Date.now(),
      channelName: this.channelName || 'unknown'
    };

    await chrome.storage.local.set({ trackingPageLock: lock });
    console.log('Acquired tracking lock for page:', this.pageId);

    // Start periodic lock updates
    this.startLockUpdates();
  }

  async releaseTrackingLock() {
    try {
      const result = await chrome.storage.local.get(['trackingPageLock']);
      if (result.trackingPageLock?.pageId === this.pageId) {
        await chrome.storage.local.remove(['trackingPageLock']);
        console.log('Released tracking lock');
      }
    } catch (error) {
      console.error('Error releasing tracking lock:', error);
    }
  }

  startLockUpdates() {
    this.lockUpdateInterval = setInterval(async () => {
      try {
        const result = await chrome.storage.local.get(['trackingPageLock']);
        if (result.trackingPageLock?.pageId === this.pageId) {
          // Update timestamp to keep lock alive
          const updatedLock = {
            ...result.trackingPageLock,
            timestamp: Date.now(),
            channelName: this.channelName || 'unknown'
          };
          await chrome.storage.local.set({ trackingPageLock: updatedLock });
        }
      } catch (error) {
        console.warn('Error updating tracking lock:', error);
      }
    }, 30000); // Update every 30 seconds
  }

  startDebugUpdates() {
    if (this.debugUpdateInterval) {
      clearInterval(this.debugUpdateInterval);
    }

    this.debugUpdateInterval = setInterval(() => {
      if (this.trackingMetrics && this.trackingMetrics.uiManager) {
        this.trackingMetrics.uiManager.updateDebugInfo();
      }
    }, 5000); // Update debug info every 5 seconds
  }

  async waitForLockRelease() {
    return new Promise((resolve) => {
      const checkLock = async () => {
        try {
          const result = await chrome.storage.local.get(['trackingPageLock']);
          if (!result.trackingPageLock) {
            this.hideWaitingMessage();
            resolve();
            return;
          }

          // Check again in 2 seconds
          setTimeout(checkLock, 2000);
        } catch (error) {
          resolve(); // Assume lock is released on error
        }
      };

      checkLock();
    });
  }

  showWaitingMessage(lock) {
    const content = document.getElementById('tvm-tracking-content');
    content.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <h2>Another tracking page is active</h2>
        <p>Currently tracking: <strong>${lock.channelName}</strong></p>
        <p>Close the other tracking page to use this one, or this page will automatically take over when the other closes.</p>
        <div class="tvm-loading-spinner" style="margin: 20px auto;"></div>
        <p style="color: #adadb8; font-size: 14px;">Waiting for other page to close...</p>
      </div>
    `;
  }

  hideWaitingMessage() {
    // Will be cleared when we initialize the UI
  }

  async loadChannelInfo() {
    try {
      // Check URL parameters first
      const urlParams = new URLSearchParams(window.location.search);
      const channelFromUrl = urlParams.get('channel');

      if (channelFromUrl) {
        this.channelName = channelFromUrl.toLowerCase();
        console.log('Channel from URL:', this.channelName);
        return;
      }

      // Check storage for channel switch request
      const result = await chrome.storage.local.get(['trackingPageChannel']);
      if (result.trackingPageChannel) {
        this.channelName = result.trackingPageChannel;
        console.log('Channel from storage:', this.channelName);
        // Clear the storage value
        await chrome.storage.local.remove(['trackingPageChannel']);
        return;
      }

      // No channel specified, show channel selection
      this.showChannelSelection();
    } catch (error) {
      console.error('Error loading channel info:', error);
      this.showChannelSelection();
    }
  }

  showChannelSelection() {
    const content = document.getElementById('tvm-tracking-content');
    content.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <h2>No Channel Specified</h2>
        <p>This page was opened without a channel to track.</p>
        <p>Please use the "Start Tracking" button on a channel page to begin tracking.</p>
        <button id="tvm-close-btn-alt" class="tvm-btn tvm-btn-secondary">Close Page</button>
      </div>
    `;

    document.getElementById('tvm-close-btn-alt')?.addEventListener('click', () => {
      window.close();
    });
  }

  setupEventListeners() {
    // Switch channel button
    document.getElementById('tvm-switch-channel-btn')?.addEventListener('click', async () => {
      await this.promptChannelSwitch();
    });

    // Close button
    document.getElementById('tvm-close-btn')?.addEventListener('click', async () => {
      await this.closeAndStopTracking();
    });

    // Heatmap stats reset button
    document.getElementById('tvm-heatmap-stats-reset')?.addEventListener('click', () => {
      if (this.trackingMetrics?.chartManager?.heatmapChart) {
        this.trackingMetrics.chartManager.heatmapChart.resetStatsFilter();
      }
    });

    // Bot threshold slider controls
    this.setupBotThresholdControls();

    // Handle page unload - cleanup only (confirmation handled in setupBeforeUnloadConfirmation)
    window.addEventListener('unload', async () => {
      await this.cleanup();
    });
  }

  setupBotThresholdControls() {
    const lockButton = document.getElementById('tvm-bot-threshold-lock');
    const slider = document.getElementById('tvm-bot-threshold-slider');
    const valueDisplay = document.getElementById('tvm-bot-threshold-value');

    if (!lockButton || !slider || !valueDisplay) return;

    // Initialize state
    this.botThresholdLocked = true;
    this.botThresholdOverride = null;

    // Lock/unlock button
    lockButton.addEventListener('click', () => {
      this.botThresholdLocked = !this.botThresholdLocked;

      if (this.botThresholdLocked) {
        // Lock: disable slider, show Auto, remove unlocked class
        slider.disabled = true;
        valueDisplay.textContent = 'Auto';
        lockButton.classList.remove('unlocked');
        lockButton.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
          </svg>
        `;
        this.botThresholdOverride = null;
      } else {
        // Unlock: enable slider, show value, add unlocked class, show unlocked icon
        slider.disabled = false;
        lockButton.classList.add('unlocked');
        lockButton.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75l1.94.5C9.46 3.61 10.64 3 12 3c1.71 0 3.1 1.39 3.1 3.1V8H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
          </svg>
        `;
        // Update value based on current slider position
        this.updateBotThresholdValue(slider.value);
      }

      // Re-run bot detection with new settings
      if (this.trackingMetrics?.dataManager) {
        this.trackingMetrics.dataManager.detectBots();
      }
    });

    // Slider input
    slider.addEventListener('input', (e) => {
      if (!this.botThresholdLocked) {
        this.updateBotThresholdValue(e.target.value);
      }
    });

    // Slider change (on release)
    slider.addEventListener('change', () => {
      if (!this.botThresholdLocked && this.trackingMetrics?.dataManager) {
        // Re-run bot detection when slider is released
        this.trackingMetrics.dataManager.detectBots();
      }
    });
  }

  updateBotThresholdValue(sliderValue) {
    const valueDisplay = document.getElementById('tvm-bot-threshold-value');
    if (!valueDisplay) return;

    // Use the stored calculated threshold for slider range
    const calculatedMax = this.calculatedBotThreshold || 50;

    // Slider represents 5 to 2x the calculated value (minimum of 5)
    const minValue = 5;
    const maxSliderValue = calculatedMax * 2;
    const actualValue = Math.max(minValue, Math.round(minValue + (sliderValue / 100) * (maxSliderValue - minValue)));

    this.botThresholdOverride = actualValue;
    valueDisplay.textContent = actualValue.toString();
  }

  updateBotThresholdSlider(calculatedMax) {
    const slider = document.getElementById('tvm-bot-threshold-slider');
    const valueDisplay = document.getElementById('tvm-bot-threshold-value');

    if (!slider || !valueDisplay || this.botThresholdLocked) return;

    // Update slider max to represent 5 to 2x calculated value
    // Slider stays at 0-100, but we interpret it as 5 to 2x calculatedMax
    const minValue = 5;
    const currentOverride = this.botThresholdOverride || calculatedMax;
    const maxSliderValue = calculatedMax * 2;
    const sliderPosition = Math.round(((currentOverride - minValue) / (maxSliderValue - minValue)) * 100);

    slider.value = Math.max(0, sliderPosition);
    valueDisplay.textContent = currentOverride.toString();
  }

  setupMessageListeners() {
    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
    });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'TRACKING_PAGE_SWITCH_CHANNEL':
          await this.handleChannelSwitch(message.channelName);
          sendResponse({ success: true });
          break;

        case 'TRACKING_PAGE_PING':
          sendResponse({
            success: true,
            channelName: this.channelName,
            isTracking: this.isTracking
          });
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async promptChannelSwitch() {
    // Prompt user for new channel name
    const newChannelName = prompt(
      'Enter the Twitch channel name to switch to:',
      ''
    );

    // User cancelled or entered empty string
    if (!newChannelName || !newChannelName.trim()) {
      return;
    }

    // Clean up the channel name (remove @ symbol, trim, lowercase)
    const cleanedChannelName = newChannelName.trim().toLowerCase().replace(/^@/, '');

    // Switch to the new channel
    await this.handleChannelSwitch(cleanedChannelName);
  }

  async handleChannelSwitch(newChannelName) {
    if (this.channelName === newChannelName && this.isTracking) {
      // Already tracking this channel
      return;
    }

    const shouldSwitch = this.channelName !== newChannelName;

    if (shouldSwitch && this.isTracking) {
      const confirmed = confirm(
        `Currently tracking "${this.channelName}". Stop and switch to "${newChannelName}"?`
      );

      if (!confirmed) {
        return;
      }

      // Stop current tracking
      await this.stopTracking();
    }

    // Switch to new channel
    this.channelName = newChannelName;

    // Properly cleanup existing tracking system before reinitializing
    if (this.trackingMetrics) {
      // Close any open popups and destroy popup manager before destroying UI
      if (this.trackingMetrics.uiManager && this.trackingMetrics.uiManager.popupManager) {
        this.trackingMetrics.uiManager.popupManager.destroy();
      }

      // Clean up any orphaned popups from the DOM
      if (window.PopupManager) {
        window.PopupManager.cleanupOrphanedPopups();
      }

      // Destroy chart manager to free up canvas elements
      if (this.trackingMetrics.chartManager) {
        this.trackingMetrics.chartManager.destroy();
      }

      // Destroy UI manager to clean up all event listeners
      if (this.trackingMetrics.uiManager) {
        this.trackingMetrics.uiManager.destroy();
      }

      this.trackingMetrics = null;
    }

    await this.startTracking();
  }

  async startTracking() {
    if (!this.channelName) {
      console.error('No channel name specified');
      return;
    }

    try {
      // Initialize the tracking system
      if (!this.trackingMetrics) {
        await this.initializeTrackingSystem();
      }

      // Update UI title
      document.getElementById('tvm-tracking-title').textContent =
        `${this.channelName}`;

      // Start tracking
      await this.trackingMetrics.start();
      this.isTracking = true;

      console.log('Started tracking:', this.channelName);
    } catch (error) {
      console.error('Error starting tracking:', error);
      alert('Failed to start tracking. Please check the console for details.');
    }
  }

  async stopTracking() {
    if (this.trackingMetrics && this.isTracking) {
      await this.trackingMetrics.stop();

      // Clear debug update interval
      if (this.debugUpdateInterval) {
        clearInterval(this.debugUpdateInterval);
        this.debugUpdateInterval = null;
      }

      // Destroy chart manager to free up canvas elements
      if (this.trackingMetrics.chartManager) {
        this.trackingMetrics.chartManager.destroy();
      }

      this.isTracking = false;
      console.log('Stopped tracking');
    }
  }

  async closeAndStopTracking() {
    // Show confirmation if tracking is active
    if (this.isTracking) {
      const confirmed = confirm(
        'You are currently tracking a channel. Closing will stop tracking and lose all data.\n\n' +
        'Are you sure you want to close?'
      );

      if (!confirmed) {
        return; // User cancelled
      }
    }

    // Set flag to prevent beforeunload confirmation
    this.isTracking = false;
    await this.cleanup();
    window.close();
  }

  async initializeTrackingSystem() {
    // Clean up any existing popups that might be orphaned
    if (window.PopupManager) {
      window.PopupManager.cleanupOrphanedPopups();
    }

    // Initialize the tracking system similar to content script
    const errorHandler = new window.ErrorHandler();
    const settingsManager = new window.SettingsManager(errorHandler);
    const apiClient = new window.BackgroundApiClient(errorHandler);
    const dataManager = new window.EnhancedDataManager(settingsManager, errorHandler, apiClient);
    const uiManager = new window.UIManager(dataManager, settingsManager, errorHandler, apiClient);
    const chartManager = new window.ChartManager(dataManager, settingsManager, errorHandler, this.channelName, uiManager);

    // Set chart manager reference in UI manager
    uiManager.chartManager = chartManager;

    // Load configuration
    await settingsManager.load();

    // Create tracking metrics instance
    const self = this; // Store reference to TrackingPageManager
    this.trackingMetrics = {
      errorHandler,
      settingsManager,
      apiClient,
      dataManager,
      uiManager,
      chartManager,
      channelName: this.channelName,
      isActive: false,

      async start() {
        try {
          // Check authentication
          const authResponse = await apiClient.getAuthStatus();
          if (!authResponse.hasAuth) {
            throw new Error('Authentication headers not captured. Please refresh page and try again.');
          }

          // Inject UI into our page
          const targetElement = document.getElementById('tvm-tracking-content');
          await uiManager.injectUI(this.channelName, targetElement);
          await chartManager.initGraphs();

          // Start background tracking
          const config = settingsManager.get();
          const bgTrackingResult = await apiClient.startBackgroundTracking(this.channelName, config);

          if (!bgTrackingResult.success) {
            throw new Error(bgTrackingResult.error || 'Failed to start background tracking');
          }

          this.isActive = true;
          uiManager.showContent();
          uiManager.setStartTime();

          // Start debug info updates
          self.startDebugUpdates();

          // Fetch and display channel avatar now that API client is ready
          uiManager.updateChannelAvatar(this.channelName);

          console.log('Background tracking started for channel:', this.channelName);
        } catch (error) {
          throw error;
        }
      },

      async stop() {
        try {
          this.isActive = false;

          // Stop background tracking
          await apiClient.stopBackgroundTracking();
          dataManager.clear();

          console.log('Background tracking stopped');
        } catch (error) {
          console.error('Error stopping tracking:', error);
        }
      }
    };

    // Subscribe to background tracking updates
    apiClient.subscribe((event, data) => {
      this.handleBackgroundTrackingUpdate(event, data);
    });
  }

  handleBackgroundTrackingUpdate(event, data) {
    if (!this.trackingMetrics) return;

    try {
      switch (event) {
        case 'viewersUpdated':
          this.trackingMetrics.dataManager.updateViewers(data);
          this.trackingMetrics.uiManager.updateViewerCount(data.total, data.authenticatedCount);
          break;

        case 'viewerCountUpdated':
          const stats = this.trackingMetrics.dataManager.getStats();
          const totalAuthenticated = this.trackingMetrics.dataManager.getAuthenticatedCount();
          this.trackingMetrics.dataManager.addHistoryPoint(
            data.count,
            stats.authenticatedNonBots,
            stats.bots,
            totalAuthenticated
          );
          this.trackingMetrics.uiManager.updateViewerCount(data.count, null, data.timestamp);
          break;

        case 'userInfoUpdated':
          this.trackingMetrics.dataManager.updateUserInfo(data.userInfo);
          // Note: UI will update automatically via dataManager.notify('userInfoUpdated') -> UI manager subscription
          break;

        case 'viewersCleanedUp':
          // Update data manager first to remove the viewers
          if (data.removedUsernames) {
            for (const username of data.removedUsernames) {
              this.trackingMetrics.dataManager.removeViewer(username);
            }
          }

          // Then update the UI
          this.trackingMetrics.uiManager.updateAfterCleanup(data);
          break;

        case 'apiStatusUpdated':
          // Update API status in UI if needed
          break;
      }
    } catch (error) {
      console.error('Error handling background tracking update:', error);
    }
  }

  async cleanup() {
    try {
      // Stop tracking
      await this.stopTracking();

      // Release tracking lock
      await this.releaseTrackingLock();

      // Clear intervals
      if (this.lockUpdateInterval) {
        clearInterval(this.lockUpdateInterval);
      }
      if (this.debugUpdateInterval) {
        clearInterval(this.debugUpdateInterval);
      }

      // Cleanup tracking system
      if (this.trackingMetrics) {
        // Destroy chart manager to free up canvas elements
        if (this.trackingMetrics.chartManager) {
          this.trackingMetrics.chartManager.destroy();
        }
        this.trackingMetrics.dataManager?.clear();
        // API client queue is managed by background service
      }

      console.log('Tracking page cleanup complete');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  window.trackingPageManager = new TrackingPageManager();
});
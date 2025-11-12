// API Client with rate limiting and queue management
// Background API Client - communicates with background service worker
window.BackgroundApiClient = class BackgroundTrackingClient {
  // Constants for better maintainability
  static RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff
  static MAX_RETRIES = 3;
  static DEFAULT_TIMEOUT = 30000;

  constructor(errorHandler) {
    this.errorHandler = errorHandler;
    this.channelName = null;
    this.isBackgroundTracking = false;
    this.observers = new Set();
    this.trackingData = {
      viewers: new Map(),
      history: [],
      metadata: {}
    };
    this._isShuttingDown = false;
    this._rateLimitStatus = null;
    this._pendingCount = 0;

    // Setup background message handling
    this.setupBackgroundMessageHandling();
  }

  setupBackgroundMessageHandling() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'BACKGROUND_TRACKING_UPDATE') {
        // Check if this message is intended for this tab (if targetTabId is specified)
        if (message.targetTabId) {
          // Get current tab ID to check if message is for us
          chrome.tabs.getCurrent((tab) => {
            if (tab && tab.id === message.targetTabId) {
              this.handleBackgroundUpdate(message);
            }
          });
        } else {
          // No specific target, process the message
          this.handleBackgroundUpdate(message);
        }
      }
    });
  }

  // Observer pattern for UI updates
  subscribe(callback) {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  notify(event, data) {
    for (const callback of this.observers) {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Observer callback error:', error);
      }
    }
  }

  async startBackgroundTracking(channelName, config) {
    try {
      this.channelName = channelName;

      const response = await chrome.runtime.sendMessage({
        type: 'START_BACKGROUND_TRACKING',
        channelName,
        config
      });

      if (response.success) {
        this.isBackgroundTracking = true;
        return { success: true };
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error('Error starting background tracking:', error);
      return { success: false, error: error.message };
    }
  }

  async stopBackgroundTracking() {
    try {
      if (!this.channelName) {
        return { success: true };
      }

      const response = await chrome.runtime.sendMessage({
        type: 'STOP_BACKGROUND_TRACKING',
        channelName: this.channelName
      });

      this.isBackgroundTracking = false;
      this.channelName = null;
      this.trackingData = { viewers: new Map(), history: [], metadata: {} };

      return response;
    } catch (error) {
      console.error('Error stopping background tracking:', error);
      return { success: false, error: error.message };
    }
  }

  async updateTrackingConfig(config) {
    try {
      if (!this.channelName) {
        return { success: false, error: 'No active tracking session' };
      }

      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_TRACKING_CONFIG',
        channelName: this.channelName,
        config
      });

      return response;
    } catch (error) {
      console.error('Error updating tracking config:', error);
      return { success: false, error: error.message };
    }
  }

  async getTrackingData() {
    try {
      if (!this.channelName) {
        return { success: false, error: 'No active tracking session' };
      }

      const response = await chrome.runtime.sendMessage({
        type: 'GET_TRACKING_DATA',
        channelName: this.channelName
      });

      if (response.success && response.data) {
        this.syncTrackingData(response.data);
      }

      return response;
    } catch (error) {
      console.error('Error getting tracking data:', error);
      return { success: false, error: error.message };
    }
  }

  handleBackgroundUpdate(message) {

    if (message.channelName !== this.channelName) {
      return; // Update for different channel
    }

    const { data } = message;

    switch (data.type) {
      case 'VIEWER_LIST_UPDATE':
        this.handleViewerListUpdate(data);
        break;
      case 'VIEWER_COUNT_UPDATE':
        this.handleViewerCountUpdate(data);
        break;
      case 'USER_INFO_UPDATE':
        this.handleUserInfoUpdate(data);
        break;
      case 'CLEANUP_UPDATE':
        this.handleCleanupUpdate(data);
        break;
      case 'API_STATUS_UPDATE':
        this.handleApiStatusUpdate(data);
        break;
    }
  }

  handleViewerListUpdate(data) {
    // Update local tracking data incrementally
    if (data.viewers) {
      for (const viewer of data.viewers) {
        this.trackingData.viewers.set(viewer.username, viewer);
      }
    }

    this.trackingData.metadata.authenticatedCount = data.authenticatedCount;
    this.trackingData.metadata.lastUpdated = Date.now();

    // Notify observers
    this.notify('viewersUpdated', {
      total: this.trackingData.viewers.size,
      new: data.newUsers.length,
      authenticatedCount: data.authenticatedCount,
      viewers: Array.from(this.trackingData.viewers.values()) // Pass the actual viewer data
    });
  }

  handleViewerCountUpdate(data) {
    // Add to history
    this.trackingData.history = data.history;
    this.trackingData.metadata.viewerCount = data.count;

    // Notify observers
    this.notify('viewerCountUpdated', {
      count: data.count,
      timestamp: data.timestamp,
      history: data.history
    });
  }

  handleUserInfoUpdate(data) {
    // Update viewers with user info
    for (const info of data.userInfo) {
      if (this.trackingData.viewers.has(info.username)) {
        const viewer = this.trackingData.viewers.get(info.username);
        Object.assign(viewer, info);
      }
    }

    // Notify observers
    this.notify('userInfoUpdated', {
      userInfo: data.userInfo,
      remainingPending: data.remainingPending
    });
  }

  handleCleanupUpdate(data) {

    // Handle delta update - only remove specific viewers
    if (data.removedUsernames) {
      // Delta update: remove specific viewers
      for (const username of data.removedUsernames) {
        this.trackingData.viewers.delete(username);
      }
    } else if (data.currentViewers) {
      // Legacy full update: clear and repopulate (fallback)
      this.trackingData.viewers.clear();
      for (const viewer of data.currentViewers) {
        this.trackingData.viewers.set(viewer.username, viewer);
      }
    }

    // Notify observers    
    this.notify('viewersCleanedUp', {
      removedCount: data.removedCount,
      removedUsernames: data.removedUsernames || [],
      currentCount: this.trackingData.viewers.size
    });
  }

  handleApiStatusUpdate(data) {
    // Store rate limit status and pending count for UI access
    this._rateLimitStatus = data.rateLimitStatus;
    this._pendingCount = data.pendingCount;

    // Notify observers
    this.notify('apiStatusUpdated', {
      rateLimitStatus: data.rateLimitStatus,
      pendingCount: data.pendingCount
    });
  }

  syncTrackingData(data) {
    this.trackingData.viewers.clear();
    for (const viewer of data.viewers) {
      this.trackingData.viewers.set(viewer.username, viewer);
    }
    this.trackingData.history = data.history;
    this.trackingData.metadata = data.metadata;
  }

  async getUserInfo(channelName, usernames, priority = 3) {
    return chrome.runtime.sendMessage({
      type: 'GET_USER_INFO',
      channelName,
      usernames,
      priority
    });
  }

  async getUserFollowing(usernames, options = {}, priority = 3) {
    return chrome.runtime.sendMessage({
      type: 'GET_USER_FOLLOWING',
      usernames,
      options,
      priority
    });
  }

  getRateLimitStatus() {
    // Use cached rate limit status from background updates
    return this._rateLimitStatus || {
      available: 0,
      maxRequests: 500,
      resetTime: Date.now() + 60000
    };
  }

  async getAuthStatus() {
    return chrome.runtime.sendMessage({
      type: 'GET_AUTH_STATUS'
    });
  }

  async updateApiConfig(config) {
    return chrome.runtime.sendMessage({
      type: 'UPDATE_API_CONFIG',
      config
    });
  }

  async forceStartTracking(channelName) {
    return chrome.runtime.sendMessage({
      type: 'FORCE_START_TRACKING',
      channelName
    });
  }

  // Getters for compatibility
  getViewers() {
    return Array.from(this.trackingData.viewers.values());
  }

  getHistory() {
    return this.trackingData.history;
  }

  getMetadata() {
    return this.trackingData.metadata;
  }

  isTracking() {
    return this.isBackgroundTracking;
  }
};

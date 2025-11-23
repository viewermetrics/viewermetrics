// Background service worker for Viewer Metrics
import { RequestInterceptor } from './request-interceptor.js';
import { ApiManager } from './api-manager.js';
import { calculateAutoTimeout, calculateAutoRequestInterval } from '../shared/timeout-utils.module.js';

class BackgroundService {
  constructor() {
    this.requestInterceptor = new RequestInterceptor();
    this.apiManager = new ApiManager(this.requestInterceptor);
    this.activeChannels = new Map(); // channelName -> { tabId, isActive }

    // Background tracking state
    this.trackingSessions = new Map(); // channelName -> { config, intervals, data, tabId }

    this.init();
  }

  init() {
    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep channel open for async response
    });

    // Initialize request interceptor
    this.requestInterceptor.init();

    // Listen for auth header updates
    chrome.storage.session.onChanged.addListener((changes) => {
      if (changes.authHeaders) {
        this.apiManager.updateAuthHeaders(changes.authHeaders.newValue);
      }
    });

  }



  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'FORCE_START_TRACKING':
          const forceResult = await this.forceStartTracking(message.channelName, sender.tab.id);
          sendResponse(forceResult);
          break;

        case 'GET_USER_INFO':
          const userInfo = await this.apiManager.getUserInfo(
            message.channelName,
            message.usernames,
            message.priority || 3 // Default to low priority if not specified
          );
          sendResponse({ success: true, userInfo });
          break;

        case 'GET_USER_FOLLOWING':
          const followingData = await this.apiManager.getUserFollowing(
            message.usernames,
            message.options || {},
            message.priority || 3 // Default to low priority if not specified
          );
          sendResponse({ success: true, followingData });
          break;

        case 'UPDATE_API_CONFIG':
          this.apiManager.updateConfig(message.config);
          sendResponse({ success: true });
          break;

        case 'GET_AUTH_STATUS':
          const authHeaders = await chrome.storage.session.get('authHeaders');
          sendResponse({
            success: true,
            hasAuth: !!authHeaders.authHeaders
          });
          break;

        case 'GET_RATE_LIMIT_STATUS':
          const rateLimitStatus = this.apiManager.getRateLimitStatus();
          sendResponse({
            success: true,
            status: rateLimitStatus
          });
          break;

        case 'getDataUsageStats':
          const dataUsageStats = this.apiManager.getDataUsageStats();
          sendResponse(dataUsageStats);
          break;

        case 'openViewerPage':
          try {
            const viewerPageURL = chrome.runtime.getURL('pages/viewer.html');
            const tab = await chrome.tabs.create({ url: viewerPageURL });
            sendResponse({ success: true, tabId: tab.id });
          } catch (error) {
            console.error('Error opening viewer page:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'START_BACKGROUND_TRACKING':
          const startBgResult = await this.startBackgroundTracking(
            message.channelName,
            message.config,
            sender.tab.id
          );
          sendResponse(startBgResult);
          break;

        case 'STOP_BACKGROUND_TRACKING':
          const stopBgResult = await this.stopBackgroundTracking(message.channelName);
          sendResponse(stopBgResult);
          break;

        case 'GET_TRACKING_DATA':
          const trackingData = this.getTrackingData(message.channelName);
          sendResponse({ success: true, data: trackingData });
          break;

        case 'UPDATE_TRACKING_CONFIG':
          const updateResult = this.updateTrackingConfig(message.channelName, message.config);
          sendResponse(updateResult);
          break;

        case 'FORCE_STOP_ALL_TRACKING':
          console.log('Force stopping all tracking sessions');
          try {
            // Stop all tracking sessions (both old and new style)
            if (this.trackingSessions) {
              this.trackingSessions.clear();
            }
            if (this.activeChannels) {
              this.activeChannels.clear();
            }

            // Clear API manager queues and state
            if (this.apiManager && this.apiManager.clearQueue) {
              this.apiManager.clearQueue();
            }

            // Stop all intervals - use 'this' instead of 'this.backgroundService'
            this.clearAllIntervals();

            sendResponse({ success: true });
          } catch (error) {
            console.error('Error during force stop all tracking:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'OPEN_TRACKING_PAGE':
          const openTrackingResult = await this.handleOpenTrackingPage(message.channelName);
          sendResponse(openTrackingResult);
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async forceStartTracking(channelName, tabId) {
    // Stop all other tracking first
    const currentlyTracked = Array.from(this.activeChannels.keys());
    for (const tracked of currentlyTracked) {
      if (tracked !== channelName) {
        // Get the channel info BEFORE stopping tracking
        const trackedChannel = this.activeChannels.get(tracked);

        // Stop legacy tracking
        this.activeChannels.delete(tracked);
        console.log(`Stopped tracking channel: ${tracked}`);

        // Notify the other tab that tracking was stopped
        if (trackedChannel && trackedChannel.tabId) {
          try {
            await chrome.tabs.sendMessage(trackedChannel.tabId, {
              type: 'TRACKING_STOPPED_BY_OTHER_TAB',
              stoppedChannel: tracked,
              newChannel: channelName
            });
          } catch (error) {
            console.log('Could not notify other tab:', error);
          }
        }
      }
    }

    // Start tracking the new channel
    this.activeChannels.set(channelName, { tabId, isActive: true });
    console.log(`Force started tracking channel: ${channelName}`);
    return { success: true };
  }

  // Background Tracking Methods
  async startBackgroundTracking(channelName, config, tabId) {
    try {
      // Stop ALL existing tracking sessions to prevent conflicts
      const existingSessions = Array.from(this.trackingSessions.keys());
      for (const existingChannel of existingSessions) {
        console.log(`Stopping existing background tracking for ${existingChannel} before starting ${channelName}`);
        await this.stopBackgroundTracking(existingChannel);

        // Notify the tab that tracking was stopped
        const existingSession = this.trackingSessions.get(existingChannel);
        if (existingSession && existingSession.tabId !== tabId) {
          try {
            await chrome.tabs.sendMessage(existingSession.tabId, {
              type: 'TRACKING_STOPPED_BY_OTHER_TAB',
              stoppedChannel: existingChannel,
              newChannel: channelName,
              reason: 'New tracking session started'
            });
          } catch (error) {
            console.log('Could not notify other tab:', error);
          }
        }
      }

      console.log(`Starting background tracking for ${channelName}`);

      // Initialize tracking session
      const session = {
        channelName,
        tabId,
        config: {
          refreshInterval: config.refreshInterval || 30000,
          requestInterval: config.requestInterval || 5000,
          timeoutDuration: config.timeoutDuration || 300000,
          batchSize: config.batchSize || 20,
          concurrentUserInfoBatches: config.concurrentUserInfoBatches || 20,
          concurrentThreshold: config.concurrentThreshold || 1000,
          ...config
        },
        intervals: new Map(),
        data: {
          viewers: new Map(),
          history: [],
          metadata: {
            lastUpdated: null,
            totalRequests: 0,
            sessionStart: Date.now(),
            errors: [],
            viewerCount: 0,
            authenticatedCount: 0
          },
          pendingUserInfo: new Set()
        },
        // Request locks to prevent concurrent requests
        requestLocks: {
          viewerList: false,
          viewerCount: false,
          userInfo: false
        },
        // Communication failure tracking
        communicationFailures: {
          count: 0,
          firstFailure: null,
          lastFailure: null
        },
        isActive: true
      };

      this.trackingSessions.set(channelName, session);

      // Start periodic operations
      await this.setupBackgroundIntervals(session);

      return { success: true };
    } catch (error) {
      console.error('Error starting background tracking:', error);
      return { success: false, error: error.message };
    }
  }

  async stopBackgroundTracking(channelName) {
    try {
      const session = this.trackingSessions.get(channelName);
      if (!session) {
        return { success: true, message: 'No active tracking session' };
      }

      console.log(`Stopping background tracking for ${channelName}`);

      // Clear all intervals
      for (const [name, intervalId] of session.intervals) {
        clearInterval(intervalId);
      }

      // Remove session
      this.trackingSessions.delete(channelName);

      return { success: true };
    } catch (error) {
      console.error('Error stopping background tracking:', error);
      return { success: false, error: error.message };
    }
  }

  async setupBackgroundIntervals(session) {
    const { channelName, config } = session;

    try {
      // Calculate effective request interval based on current authenticated user count
      const effectiveRequestInterval = this.calculateEffectiveRequestInterval(session);

      // Viewer list fetching
      session.intervals.set('viewerList', setInterval(async () => {
        await this.backgroundFetchViewerList(session);
      }, effectiveRequestInterval));

      // Viewer count tracking  
      session.intervals.set('viewerCount', setInterval(async () => {
        await this.backgroundFetchViewerCount(session);
      }, 60000)); // Every minute

      // User info processing
      session.intervals.set('userInfo', setInterval(async () => {
        await this.backgroundFetchUserInfo(session);
      }, config.refreshInterval));

      // Cleanup timed out viewers
      session.intervals.set('cleanup', setInterval(() => {
        this.backgroundCleanupViewers(session);
      }, 60000)); // Every 1 minute

      // API status updates
      session.intervals.set('apiStatus', setInterval(async () => {
        await this.sendApiStatusUpdate(session);
      }, 5000)); // Every 5 seconds

      // Session health check - verify tab is still reachable
      session.intervals.set('healthCheck', setInterval(async () => {
        await this.checkSessionHealth(session);
      }, 10000)); // Every 10 seconds

      console.log(`Background intervals setup for ${channelName}`);

      // Wait a moment for content script to be ready, then do initial fetches
      setTimeout(async () => {
        await this.backgroundFetchViewerList(session);
        await this.backgroundFetchViewerCount(session);
      }, 1000); // 1 second delay

    } catch (error) {
      console.error('Error setting up background intervals:', error);
    }
  }

  async backgroundFetchViewerList(session) {
    // Check if request is already in progress
    if (session.requestLocks.viewerList) {
      return;
    }

    try {
      // Acquire lock
      session.requestLocks.viewerList = true;

      const { channelName } = session;
      const viewerData = await this.apiManager.getViewerList(channelName);

      if (viewerData && viewerData.viewers) {
        const timestamp = Date.now();
        const newUsers = [];
        const currentViewers = new Set(viewerData.viewers);

        // Process current viewer list
        for (const username of viewerData.viewers) {
          if (!session.data.viewers.has(username)) {
            session.data.viewers.set(username, {
              username,
              firstSeen: timestamp,
              lastSeen: timestamp,
              timeInStream: 0,
              isAuthenticated: true
            });
            newUsers.push(username);
            session.data.pendingUserInfo.add(username);
          } else {
            // Update existing viewer
            const viewer = session.data.viewers.get(username);
            viewer.lastSeen = timestamp;
          }
        }

        // Don't remove viewers immediately - let timeout system handle it
        // This prevents flickering when viewer list API has temporary issues

        // Update metadata
        session.data.metadata.lastUpdated = timestamp;
        session.data.metadata.totalRequests++;
        const oldAuthenticatedCount = session.data.metadata.authenticatedCount || 0;
        session.data.metadata.authenticatedCount = viewerData.totalAuthenticatedCount || 0;

        // Check if we need to adjust request interval based on new authenticated count
        this.checkAndUpdateRequestInterval(session, oldAuthenticatedCount);

        // Send update to content script
        await this.sendTrackingUpdate(session, {
          type: 'VIEWER_LIST_UPDATE',
          viewers: Array.from(session.data.viewers.values()),
          newUsers,
          authenticatedCount: session.data.metadata.authenticatedCount
        });

      }
    } catch (error) {
      console.error('Background viewer list fetch error:', error);
      session.data.metadata.errors.push({
        timestamp: Date.now(),
        error: error.message,
        type: 'viewerList'
      });
    } finally {
      // Always release lock
      session.requestLocks.viewerList = false;
    }
  }

  async backgroundFetchViewerCount(session) {
    // Check if request is already in progress
    if (session.requestLocks.viewerCount) {
      return;
    }

    try {
      // Acquire lock
      session.requestLocks.viewerCount = true;

      const { channelName } = session;
      const count = await this.apiManager.getViewerCount(channelName);

      const timestamp = Date.now();
      session.data.metadata.viewerCount = count;

      // Add to history
      session.data.history.push({
        timestamp,
        viewerCount: count,
        authenticatedCount: session.data.metadata.authenticatedCount
      });

      // Send update to content script
      await this.sendTrackingUpdate(session, {
        type: 'VIEWER_COUNT_UPDATE',
        count,
        timestamp,
        history: session.data.history.slice(-100) // Send last 100 points
      });

    } catch (error) {
      console.error('Background viewer count fetch error:', error);
      session.data.metadata.errors.push({
        timestamp: Date.now(),
        error: error.message,
        type: 'viewerCount'
      });
    } finally {
      // Always release lock
      session.requestLocks.viewerCount = false;
    }
  }

  async backgroundFetchUserInfo(session) {
    // Check if request is already in progress
    if (session.requestLocks.userInfo) {
      return;
    }

    try {
      // Acquire lock
      session.requestLocks.userInfo = true;

      const { channelName, config } = session;

      if (session.data.pendingUserInfo.size === 0) {
        return;
      }

      const pendingArray = Array.from(session.data.pendingUserInfo);
      const pendingCount = pendingArray.length;

      // Determine if we should use concurrent processing
      const shouldUseConcurrent = pendingCount > 1000; // Threshold for concurrent processing
      const concurrentBatches = 5; // Capped at 5 concurrent batches

      if (shouldUseConcurrent) {
        // Concurrent processing for large queues
        await this.processConcurrentUserInfo(session, pendingArray, concurrentBatches);
      } else {
        // Sequential processing for smaller queues
        await this.processSequentialUserInfo(session, pendingArray);
      }

    } catch (error) {
      console.error('Background user info fetch error:', error);

      // Still remove some batch from pending even if there was an error
      const pendingArray = Array.from(session.data.pendingUserInfo);
      const batch = pendingArray.slice(0, config.batchSize);
      for (const username of batch) {
        session.data.pendingUserInfo.delete(username);
      }

      session.data.metadata.errors.push({
        timestamp: Date.now(),
        error: error.message,
        type: 'userInfo'
      });
    } finally {
      // Always release lock
      session.requestLocks.userInfo = false;
    }
  }

  async processSequentialUserInfo(session, pendingArray) {
    const { channelName, config } = session;
    const batch = pendingArray.slice(0, config.batchSize);

    if (batch.length === 0) {
      return;
    }

    const userInfo = await this.apiManager.getUserInfo(channelName, batch);

    if (userInfo && userInfo.length > 0) {
      await this.updateViewersWithUserInfo(session, userInfo);
    }

    // Remove processed batch from pending
    for (const username of batch) {
      session.data.pendingUserInfo.delete(username);
    }
  }

  async processConcurrentUserInfo(session, pendingArray, concurrentBatches) {
    const { channelName, config } = session;
    const batchSize = config.batchSize;

    // Create multiple batches for concurrent processing
    const batches = [];
    for (let i = 0; i < concurrentBatches && i * batchSize < pendingArray.length; i++) {
      const startIndex = i * batchSize;
      const endIndex = Math.min(startIndex + batchSize, pendingArray.length);
      const batch = pendingArray.slice(startIndex, endIndex);

      if (batch.length > 0) {
        batches.push(batch);
      }
    }

    if (batches.length === 0) {
      return;
    }

    // Process all batches concurrently
    const userInfoPromises = batches.map(batch =>
      this.apiManager.getUserInfo(channelName, batch)
    );

    try {
      const results = await Promise.allSettled(userInfoPromises);

      // Collect all successful results
      const allUserInfo = [];
      const processedUsernames = new Set();

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value && result.value.length > 0) {
          allUserInfo.push(...result.value);
        }

        // Track all usernames we attempted to process (successful or not)
        batches[index].forEach(username => processedUsernames.add(username));
      });

      // Update viewers with all collected user info
      if (allUserInfo.length > 0) {
        await this.updateViewersWithUserInfo(session, allUserInfo);
      }

      // Remove all processed usernames from pending (success or failure)
      for (const username of processedUsernames) {
        session.data.pendingUserInfo.delete(username);
      }

    } catch (error) {
      console.error('Concurrent user info processing error:', error);

      // Remove usernames from all batches to prevent getting stuck
      batches.flat().forEach(username => {
        session.data.pendingUserInfo.delete(username);
      });
    }
  }

  async updateViewersWithUserInfo(session, userInfo) {
    // Update viewer data with user info
    for (const info of userInfo) {
      if (info && session.data.viewers.has(info.username)) {
        const viewer = session.data.viewers.get(info.username);
        viewer.createdAt = info.createdAt;
        viewer.id = info.id;
        // Add any other fields from getUserInfo
      }
    }

    // Send update to content script
    await this.sendTrackingUpdate(session, {
      type: 'USER_INFO_UPDATE',
      userInfo,
      remainingPending: session.data.pendingUserInfo.size
    });
  }

  async sendApiStatusUpdate(session) {
    try {
      const rateLimitStatus = this.apiManager.getRateLimitStatus();
      const pendingCount = session.data.pendingUserInfo.size;

      await this.sendTrackingUpdate(session, {
        type: 'API_STATUS_UPDATE',
        rateLimitStatus,
        pendingCount
      });
    } catch (error) {
      console.error('Error sending API status update:', error);
    }
  }

  // Calculate effective timeout duration (matching content script logic)
  calculateEffectiveTimeout(session) {
    const config = session.config;
    if (!config.autoAdjustTimeout) {
      return config.timeoutDuration;
    }

    // Get the latest total authenticated count
    const totalAuthenticatedCount = session.data.metadata.authenticatedCount || 0;

    // Use shared utility function
    const calculatedTimeout = calculateAutoTimeout(totalAuthenticatedCount);
    if (calculatedTimeout) {
      return calculatedTimeout;
    }

    // Fallback to config default if no authenticated count
    return config.timeoutDuration;

    return calculatedTimeout;
  }

  // Calculate effective request interval (matching ConfigManager.calculateAutoRequestInterval logic)
  calculateEffectiveRequestInterval(session) {
    const config = session.config;
    if (!config.autoAdjustRequestInterval) {
      return config.requestInterval;
    }

    // Get the latest total authenticated count
    const totalAuthenticatedCount = session.data.metadata.authenticatedCount || 0;

    // Use shared utility function
    const calculatedInterval = calculateAutoRequestInterval(totalAuthenticatedCount);
    if (calculatedInterval) {
      return calculatedInterval;
    }

    // Fallback to config default if no authenticated count
    return config.requestInterval;
  }

  // Check if request interval needs to be updated based on authenticated count changes
  checkAndUpdateRequestInterval(session, oldAuthenticatedCount) {
    if (!session.config.autoAdjustRequestInterval) {
      return;
    }

    const newAuthenticatedCount = session.data.metadata.authenticatedCount || 0;

    // Calculate what the old and new effective intervals would be
    const oldEffectiveInterval = this.calculateEffectiveIntervalForCount(session, oldAuthenticatedCount);
    const newEffectiveInterval = this.calculateEffectiveIntervalForCount(session, newAuthenticatedCount);

    // Only restart if the effective interval actually changed
    if (oldEffectiveInterval !== newEffectiveInterval) {
      console.log(`Auto-adjusting request interval for ${session.channelName}: ${oldEffectiveInterval / 1000}s -> ${newEffectiveInterval / 1000}s (${oldAuthenticatedCount} -> ${newAuthenticatedCount} auth users)`);

      // Restart the viewer list interval with new timing
      if (session.intervals.has('viewerList')) {
        clearInterval(session.intervals.get('viewerList'));
        session.intervals.set('viewerList', setInterval(async () => {
          await this.backgroundFetchViewerList(session);
        }, newEffectiveInterval));
      }
    }
  }

  // Helper method to calculate effective interval for a specific count
  calculateEffectiveIntervalForCount(session, authenticatedCount) {
    if (!session.config.autoAdjustRequestInterval) {
      return session.config.requestInterval;
    }

    if (!authenticatedCount || authenticatedCount === 0) {
      return session.config.requestInterval;
    }

    // Same logic as calculateEffectiveRequestInterval but for a specific count
    if (authenticatedCount < 500) {
      return 5000; // 5 seconds
    } else if (authenticatedCount < 1000) {
      return 2000; // 2 seconds
    } else {
      return 1000; // 1 second
    }
  }

  backgroundCleanupViewers(session) {
    try {
      const now = Date.now();
      // Use effective timeout calculation instead of static timeoutDuration
      const effectiveTimeout = this.calculateEffectiveTimeout(session);
      let removedCount = 0;
      const removedUsernames = [];

      const viewerCount = session.data.viewers.size;

      for (const [username, viewer] of session.data.viewers) {
        const timeSinceLastSeen = now - viewer.lastSeen;
        const shouldRemove = timeSinceLastSeen > effectiveTimeout;

        if (shouldRemove) {
          session.data.viewers.delete(username);
          session.data.pendingUserInfo.delete(username);
          removedUsernames.push(username);
          removedCount++;
        }
      }

      if (removedCount > 0) {

        // Send delta update instead of all viewer data
        this.sendTrackingUpdate(session, {
          type: 'CLEANUP_UPDATE',
          removedCount,
          removedUsernames: removedUsernames, // Only send removed usernames
          totalViewerCount: session.data.viewers.size
        });
      }
    } catch (error) {
      console.error('Background cleanup error:', error);
    }
  }

  async sendTrackingUpdate(session, data) {
    try {
      // Try to send message to the tab (works for content scripts and extension pages)
      await chrome.tabs.sendMessage(session.tabId, {
        type: 'BACKGROUND_TRACKING_UPDATE',
        channelName: session.channelName,
        data
      });

      // Reset failure tracking on successful communication
      session.communicationFailures.count = 0;
      session.communicationFailures.firstFailure = null;
      session.communicationFailures.lastFailure = null;

    } catch (error) {
      // If direct tab messaging fails, try runtime messaging for extension pages
      try {
        await chrome.runtime.sendMessage({
          type: 'BACKGROUND_TRACKING_UPDATE',
          channelName: session.channelName,
          data,
          targetTabId: session.tabId
        });

        // Reset failure tracking on successful communication
        session.communicationFailures.count = 0;
        session.communicationFailures.firstFailure = null;
        session.communicationFailures.lastFailure = null;

      } catch (runtimeError) {
        // Both methods failed - tab might be closed or content script not ready
        console.log(`Could not send tracking update to tab ${session.tabId} (failure ${session.communicationFailures.count + 1}):`, error.message);

        // Track communication failure
        const now = Date.now();
        session.communicationFailures.count++;
        session.communicationFailures.lastFailure = now;

        if (!session.communicationFailures.firstFailure) {
          session.communicationFailures.firstFailure = now;
        }

        // Check if we should stop tracking due to prolonged communication failure
        const timeSinceFirstFailure = now - session.communicationFailures.firstFailure;
        const failureThreshold = 30 * 1000; // 30 seconds

        if (timeSinceFirstFailure >= failureThreshold) {
          console.log(`Tab ${session.tabId} unreachable for ${timeSinceFirstFailure / 1000}s, stopping background tracking for ${session.channelName}`);

          // Stop tracking for this session asynchronously to avoid blocking current operation
          setTimeout(async () => {
            await this.stopBackgroundTracking(session.channelName);
          }, 0);
        }
      }
    }
  }

  async checkSessionHealth(session) {
    try {
      // Only check if we have recent communication failures
      if (session.communicationFailures.firstFailure) {
        const now = Date.now();
        const timeSinceFirstFailure = now - session.communicationFailures.firstFailure;
        const failureThreshold = 30 * 1000; // 30 seconds

        if (timeSinceFirstFailure >= failureThreshold) {
          console.log(`Session health check: Tab ${session.tabId} has been unreachable for ${timeSinceFirstFailure / 1000}s, stopping background tracking for ${session.channelName}`);

          // Stop tracking for this session
          await this.stopBackgroundTracking(session.channelName);
          return;
        }
      }

      // Try to verify the tab still exists
      try {
        const tab = await chrome.tabs.get(session.tabId);
        if (!tab) {
          console.log(`Session health check: Tab ${session.tabId} no longer exists, stopping background tracking for ${session.channelName}`);
          await this.stopBackgroundTracking(session.channelName);
        }
      } catch (tabError) {
        console.log(`Session health check: Tab ${session.tabId} is not accessible, stopping background tracking for ${session.channelName}`);
        await this.stopBackgroundTracking(session.channelName);
      }

    } catch (error) {
      console.error('Error during session health check:', error);
    }
  }

  getTrackingData(channelName) {
    const session = this.trackingSessions.get(channelName);
    if (!session) {
      return null;
    }

    return {
      viewers: Array.from(session.data.viewers.values()),
      history: session.data.history,
      metadata: session.data.metadata,
      pendingUserInfoCount: session.data.pendingUserInfo.size
    };
  }

  updateTrackingConfig(channelName, newConfig) {
    try {
      const session = this.trackingSessions.get(channelName);
      if (!session) {
        return { success: false, error: 'No active tracking session' };
      }

      console.log(`Updating tracking config for ${channelName}:`, newConfig);

      // Store old values for comparison
      const oldRequestInterval = session.config.requestInterval;
      const oldRefreshInterval = session.config.refreshInterval;

      // Update config
      session.config = { ...session.config, ...newConfig };

      // Calculate effective request interval after config update
      const effectiveRequestInterval = this.calculateEffectiveRequestInterval(session);

      // Restart intervals if request interval changed or auto-adjust setting changed
      if (newConfig.requestInterval && newConfig.requestInterval !== oldRequestInterval ||
        newConfig.autoAdjustRequestInterval !== undefined) {
        console.log(`Restarting viewer list interval: ${oldRequestInterval}ms -> ${effectiveRequestInterval}ms`);
        // Clear and restart viewer list interval
        if (session.intervals.has('viewerList')) {
          clearInterval(session.intervals.get('viewerList'));
          session.intervals.set('viewerList', setInterval(async () => {
            await this.backgroundFetchViewerList(session);
          }, effectiveRequestInterval));
        }
      }

      if (newConfig.refreshInterval && newConfig.refreshInterval !== oldRefreshInterval) {
        console.log(`Restarting user info interval: ${oldRefreshInterval}ms -> ${newConfig.refreshInterval}ms`);
        // Clear and restart user info interval
        if (session.intervals.has('userInfo')) {
          clearInterval(session.intervals.get('userInfo'));
          session.intervals.set('userInfo', setInterval(async () => {
            await this.backgroundFetchUserInfo(session);
          }, newConfig.refreshInterval));
        }
      }

      console.log(`Successfully updated tracking config for ${channelName}`);
      return { success: true };
    } catch (error) {
      console.error('Error updating tracking config:', error);
      return { success: false, error: error.message };
    }
  }



  clearAllIntervals() {
    // Clear all tracking session intervals
    if (this.trackingSessions) {
      for (const [channelName, session] of this.trackingSessions.entries()) {
        if (session.intervals) {
          for (const [key, intervalId] of session.intervals.entries()) {
            if (intervalId) {
              clearInterval(intervalId);
            }
          }
          session.intervals.clear();
        }
      }
    }
    console.log('Cleared all background tracking intervals');
  }

  async handleOpenTrackingPage(channelName) {
    try {
      // Check if tracking page is already open
      const existingTabId = await this.findExistingTrackingPage();

      if (existingTabId) {
        // Switch to existing tab and send channel name
        await chrome.tabs.update(existingTabId, { active: true });

        // Try to send channel switch message to the tracking page
        try {
          await chrome.tabs.sendMessage(existingTabId, {
            type: 'TRACKING_PAGE_SWITCH_CHANNEL',
            channelName: channelName
          });
        } catch (msgError) {
          console.warn('Could not send channel switch message to tracking page:', msgError);
        }

        return { success: true, action: 'switched', tabId: existingTabId };
      } else {
        // Store channel name for the tracking page
        await chrome.storage.local.set({
          trackingPageChannel: channelName
        });

        // Open new tracking page
        const trackingPageURL = chrome.runtime.getURL('pages/tracking.html');
        const tab = await chrome.tabs.create({
          url: trackingPageURL,
          active: true
        });

        return { success: true, action: 'opened', tabId: tab.id };
      }
    } catch (error) {
      console.error('Error opening tracking page:', error);
      return { success: false, error: error.message };
    }
  }

  async findExistingTrackingPage() {
    try {
      const tabs = await chrome.tabs.query({
        url: chrome.runtime.getURL('pages/tracking.html*')
      });

      if (tabs.length > 0) {
        // Ping the tab to make sure it's responsive
        try {
          const response = await chrome.tabs.sendMessage(tabs[0].id, {
            type: 'TRACKING_PAGE_PING'
          });

          if (response && response.success) {
            return tabs[0].id;
          }
        } catch (error) {
          // Tab is not responsive, consider it dead
          console.warn('Found tracking tab but it\'s not responsive');
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding existing tracking page:', error);
      return null;
    }
  }
}

// Initialize the background service
const backgroundService = new BackgroundService();

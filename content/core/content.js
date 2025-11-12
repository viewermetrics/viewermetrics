// Main Content Script - Modular Viewer Metrics

// Handle unhandled promise rejections for request cancellations
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.name === 'RequestCancelledError' || event.reason?.isExpected) {
    // Silently handle expected cancellation errors
    event.preventDefault();
    return;
  }
  // Let other unhandled rejections bubble up normally
});

class TwitchViewerMetrics {
  constructor() {
    // Simplified - only need basic managers for the simple UI
    this.errorHandler = new window.ErrorHandler();
    this.settingsManager = new window.SettingsManager(this.errorHandler);

    // State
    this.channelName = null;
    this.trackingPageTabId = null;

    this.init();
  }

  async init() {
    try {
      // Setup page handlers
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setup());
      } else {
        this.setup();
      }

      // Setup message listeners
      this.setupMessageListeners();
    } catch (error) {
      this.errorHandler.handle(error, 'TVM Init');
    }
  }

  setup() {
    try {
      this.detectChannel();
      this.watchForNavigation();
      this.injectSimpleUI();
    } catch (error) {
      this.errorHandler.handle(error, 'TVM Setup');
    }
  }

  detectChannel() {
    const pathParts = window.location.pathname.split('/').filter(p => p);

    if (pathParts.length > 0 && !['directory', 'videos', 'settings'].includes(pathParts[0])) {
      this.channelName = pathParts[0].toLowerCase();
    } else {
      this.channelName = null;
    }
  }

  async injectSimpleUI() {
    if (!this.channelName) return;

    try {
      // Wait for target element to be available
      const targetElement = await this.waitForElement('.channel-info-content');

      if (targetElement) {
        // Remove existing UI if present
        const existing = document.getElementById('twitch-viewer-metrics');
        if (existing) {
          existing.remove();
        }

        // Create simple UI container        
        const uiContainer = document.createElement('div');
        uiContainer.id = 'twitch-viewer-metrics';
        uiContainer.innerHTML = HTMLTemplates.generateSimpleUI(this.channelName);

        // If element with id live-channel-stream-information exists inside targetElement, insert after it
        const streamInfoElement = targetElement.querySelector('#live-channel-stream-information');
        if (streamInfoElement) {
          targetElement.insertBefore(uiContainer, streamInfoElement.nextSibling);
        } else {
          targetElement.appendChild(uiContainer);
        }


        // Setup event listener
        this.setupStartTrackingButton();
      }
    } catch (error) {
      this.errorHandler.handle(error, 'TVM Inject Simple UI');
    }
  }

  setupStartTrackingButton() {
    const startBtn = document.getElementById('tvm-start-tracking');
    if (startBtn) {
      startBtn.addEventListener('click', () => this.handleStartTracking());
    }
  }

  async handleStartTracking() {
    try {
      // Send message to background script to handle tab operations
      const response = await chrome.runtime.sendMessage({
        type: 'OPEN_TRACKING_PAGE',
        channelName: this.channelName
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to open tracking page');
      }

      console.log('Tracking page opened/switched successfully');
    } catch (error) {
      console.error('Error handling start tracking:', error);
      alert('Failed to open tracking page. Please try again.');
    }
  }



  // Simplified navigation handling
  watchForNavigation() {
    let lastChannel = this.channelName;

    new MutationObserver(() => {
      const oldChannel = lastChannel;
      this.detectChannel();

      if (oldChannel !== this.channelName) {
        console.log('Channel change detected:', oldChannel, '->', this.channelName);
        lastChannel = this.channelName;
        this.injectSimpleUI(); // Re-inject for new channel
      }
    }).observe(document, { subtree: true, childList: true });
  }

  async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Handle any messages if needed
    });
  }
}

// Initialize the simplified extension
const metrics = new TwitchViewerMetrics();

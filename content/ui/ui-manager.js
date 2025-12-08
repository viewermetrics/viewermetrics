// UI Manager for coordinating UI operations (Refactored to use specialized managers)
window.UIManager = class UIManager {
  constructor(dataManager, settingsManager, errorHandler, apiClient) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.apiClient = apiClient;
    this.uiContainer = null;
    this.isInitialized = false;
    this.channelName = null;
    this.usernameClickHandler = null; // Store handler for cleanup

    // Initialize specialized managers
    this.statsManager = new StatsManager(dataManager, settingsManager, errorHandler, apiClient);
    this.viewerListManager = new ViewerListManager(dataManager, settingsManager, errorHandler, null); // tabManager set later
    this.tabManager = new TabManager(errorHandler);
    this.popupManager = new PopupManager(dataManager, apiClient, errorHandler);
    this.settingsUI = new SettingsUI(settingsManager, this.statsManager, apiClient, errorHandler);
    this.debugManager = new DebugManager(dataManager, settingsManager, errorHandler);

    // Set tabManager reference for viewerListManager
    this.viewerListManager.tabManager = this.tabManager;

    // Subscribe to data changes
    this.dataManager.subscribe((event, data) => {
      this.handleDataChange(event, data);
    });
  }

  handleDataChange(event, data) {
    try {
      switch (event) {
        case 'viewersUpdated':
        case 'userInfoUpdated':
        case 'botsDetected':
          this.viewerListManager.scheduleViewerListUpdate();
          this.statsManager.updateStats();
          // When user info is updated, we might have new creation dates
          if (event === 'userInfoUpdated') {
            this.viewerListManager.dateFilterNeedsUpdate = true;
          }
          break;
        case 'historyUpdated':
          this.statsManager.updateStats();
          this.updateHistoryModeButton(); // Update date display when history changes
          break;
        case 'historyPointChanged':
          this.statsManager.updateStats(); // Update stats when viewing history point
          this.updateHistoryModeButton();
          break;
        case 'dataCleared':
          this.resetUI();
          break;
        case 'newViewers':
          this.statsManager.updateStats();
          break;
        case 'pendingUpdated':
          this.statsManager.updateStats();
          this.debugManager.updateDebugInfo();
          break;
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Data Change Handler', { event, data });
    }
  }

  async injectUI(channelName, targetElement) {
    try {
      // Store channel name for later use
      this.channelName = channelName;
      this.popupManager.setChannelName(channelName);

      // UI is already in static HTML, just reference the container
      this.uiContainer = targetElement.querySelector('.tvm-container');

      // Update stream name in static HTML
      const streamNameElement = this.uiContainer?.querySelector('.tvm-stream-name');
      if (streamNameElement) {
        streamNameElement.textContent = channelName;
      }

      // Setup event listeners
      this.setupEventListeners();


      // Load current settings using SettingsUI
      await this.settingsUI.loadForm();

      // Initialize viewer list update timestamp
      this.viewerListManager.lastViewerListUpdate = Date.now();

      // Update debug info since it's always visible
      this.debugManager.updateDebugInfo();

      // Note: Channel avatar will be fetched after tracking starts successfully

      this.isInitialized = true;

    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Inject UI', { channelName });
    }
  }

  removeUI() {
    // Clean up username click handler
    if (this.usernameClickHandler) {
      document.removeEventListener('click', this.usernameClickHandler);
      this.usernameClickHandler = null;
    }

    if (this.uiContainer) {
      // Reset reference to static HTML
      this.uiContainer = null;
    }
    this.isInitialized = false;
  }

  setupEventListeners() {
    try {
      // Tab management
      this.tabManager.setupTabListeners();

      // Search and filtering
      const elements = {
        search: document.getElementById('tvm-search'),
        sort: document.getElementById('tvm-sort'),
        dateFilter: document.getElementById('tvm-date-filter'),
        prevBtn: document.getElementById('tvm-prev'),
        nextBtn: document.getElementById('tvm-next'),
        prevBtnTop: document.getElementById('tvm-prev-top'),
        nextBtnTop: document.getElementById('tvm-next-top'),
        pauseResume: document.getElementById('tvm-pause-resume'),
        pageSize: document.getElementById('tvm-page-size')
      };

      // Delegate to ViewerListManager
      if (elements.search) {
        elements.search.addEventListener('input', () => this.viewerListManager.onSearchInput());
      }

      if (elements.sort) {
        elements.sort.addEventListener('change', () => this.viewerListManager.onSortChange());
      }

      if (elements.dateFilter) {
        elements.dateFilter.addEventListener('change', () => this.viewerListManager.onDateFilterChange());
      }

      // Pagination buttons
      if (elements.prevBtn) {
        elements.prevBtn.addEventListener('click', () => this.viewerListManager.changePage(-1));
      }

      if (elements.nextBtn) {
        elements.nextBtn.addEventListener('click', () => this.viewerListManager.changePage(1));
      }

      if (elements.prevBtnTop) {
        elements.prevBtnTop.addEventListener('click', () => this.viewerListManager.changePage(-1));
      }

      if (elements.nextBtnTop) {
        elements.nextBtnTop.addEventListener('click', () => this.viewerListManager.changePage(1));
      }

      // Main control buttons - removed onPauseResumeClick as it's not needed
      // The pause/resume functionality should be handled elsewhere

      // Page size change
      if (elements.pageSize) {
        elements.pageSize.addEventListener('change', () => this.handlePageSizeChange());
      }

      // History mode button
      const historyModeBtn = document.getElementById('tvm-history-mode-btn');
      if (historyModeBtn) {
        historyModeBtn.addEventListener('click', () => this.onHistoryModeButtonClick());
      }

      // Username click handlers - Use event delegation for better performance
      // Remove any existing handler first to prevent duplicates
      if (this.usernameClickHandler) {
        document.removeEventListener('click', this.usernameClickHandler);
      }

      // Create and store the handler
      this.usernameClickHandler = (event) => {
        // Check if clicked element or its parent has the username data attribute
        const usernameElement = event.target.closest('[data-username]');
        if (usernameElement && usernameElement.classList.contains('tvm-username-clickable')) {
          const username = usernameElement.getAttribute('data-username');
          if (username) {
            event.preventDefault();
            event.stopPropagation();
            this.popupManager.showUserPopup(username);
          }
        }
      };

      document.addEventListener('click', this.usernameClickHandler);

      // Settings event listeners
      this.settingsUI.setupEventListeners();

    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Setup Event Listeners');
    }
  }

  handlePageSizeChange() {
    try {
      const pageSizeSelect = document.getElementById('tvm-page-size');
      if (!pageSizeSelect) return;

      const newPageSize = parseInt(pageSizeSelect.value);
      if (newPageSize > 0) {
        this.settingsManager.update({ pageSize: newPageSize });
        this.viewerListManager.resetToFirstPage();
        this.viewerListManager.updateViewerList();
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Handle Page Size Change');
    }
  }

  onHistoryModeButtonClick() {
    try {
      // Only handle clicks when not showing live (i.e., when showing history)
      if (!this.dataManager.isShowingLive()) {
        this.dataManager.setLiveMode();
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager History Mode Button Click');
    }
  }

  updateHistoryModeButton() {
    try {
      const button = document.getElementById('tvm-history-mode-btn');
      const dateDisplay = document.getElementById('tvm-history-start-date');
      if (!button) return;

      const isShowingLive = this.dataManager.isShowingLive();
      const historyPoint = this.dataManager.getShowingHistoryPoint();

      if (isShowingLive) {
        button.textContent = 'Live';
        button.className = 'tvm-tab tvm-history-mode-tab tvm-history-mode-live';
        button.style.cursor = 'default';

        // Show the start date of history
        const history = this.dataManager.getHistory();
        if (dateDisplay && history.length > 0) {
          const firstEntry = history[0];
          const firstDate = new Date(firstEntry.timestamp);
          const dateString = firstDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC'
          });
          dateDisplay.textContent = `${dateString}`;
          dateDisplay.style.display = 'block';
        }
      } else if (historyPoint) {
        const date = new Date(historyPoint.timestamp);
        const timeString = date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'UTC'
        });
        button.textContent = `Viewing data from ${timeString}`;
        button.className = 'tvm-tab tvm-history-mode-tab tvm-history-mode-history';
        button.style.cursor = 'pointer';

        // Hide date display when viewing historical point
        if (dateDisplay) {
          dateDisplay.style.display = 'none';
        }
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Update History Mode Button');
    }
  }



  // Methods for background tracking updates
  updateViewerCount(count, authenticatedCount = null, timestamp = null) {
    try {
      // Delegate to StatsManager
      this.statsManager.updateViewerCount(count, authenticatedCount, timestamp);

      // Update stats display using StatsManager
      this.statsManager.updateStats();

      // If chart manager exists, add data point
      if (window.chartManager && timestamp) {
        window.chartManager.addDataPoint(count, timestamp);
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Update Viewer Count');
    }
  }

  updateAfterCleanup(data) {
    try {
      // Delegate to managers
      this.statsManager.updateStats();
      this.viewerListManager.updateAfterCleanup();
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Update After Cleanup');
    }
  }

  setDateFilter(yearMonth) {
    try {
      // Delegate to ViewerListManager
      this.viewerListManager.setDateFilter(yearMonth);
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Set Date Filter', { yearMonth });
    }
  }

  resetUI() {
    try {
      // Delegate to managers
      this.viewerListManager.resetUI();
      this.statsManager.updateStats();

      // Hide content
      const content = document.getElementById('tvm-content');
      if (content) {
        content.style.display = 'none';
      }

      // Clear start time
      this.statsManager.setStartTime(null);
      const startTimeElement = document.getElementById('tvm-start-time');
      if (startTimeElement) {
        startTimeElement.textContent = '--';
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Reset UI');
    }
  }

  // Public methods for external access
  showContent() {
    const content = document.getElementById('tvm-content');
    if (content) {
      content.style.display = 'block';
    }

    // Show tabs when content is shown
    const tabs = document.getElementById('tvm-tabs');
    if (tabs) {
      tabs.style.display = 'flex';
    }

    // Show history mode button when content is shown
    const historyBtn = document.getElementById('tvm-history-mode-btn');
    if (historyBtn) {
      historyBtn.style.display = 'block';
    }

    // Show bot calculation toggle when content is shown
    const botCalcToggle = document.querySelector('.tvm-bot-calc-toggle');
    if (botCalcToggle) {
      botCalcToggle.style.display = 'flex';
    }

    // Initialize history mode button
    this.updateHistoryModeButton();
  }

  updateStats() {
    this.statsManager.updateStats();
  }

  setStartTime(startTime = null) {
    this.statsManager.setStartTime(startTime);
  }

  updateViewerList() {
    this.viewerListManager.updateViewerList();
  }

  forceViewerListUpdate() {
    this.viewerListManager.forceViewerListUpdate();
  }



  setPauseResumeState(isPaused) {
    try {
      const pauseBtn = document.getElementById('tvm-pause-resume');
      if (pauseBtn) {
        pauseBtn.textContent = isPaused ? 'Resume Graphs' : 'Pause Graphs';
        pauseBtn.classList.toggle('tvm-resume', isPaused);
        pauseBtn.classList.toggle('tvm-pause', !isPaused);
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Set Pause Resume State', { isPaused });
    }
  }

  initializeDateFilter() {
    try {
      // Delegate to ViewerListManager
      this.viewerListManager.initializeDateFilter();
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Initialize Date Filter');
    }
  }

  updateDebugInfo() {
    try {
      // Delegate to DebugManager
      this.debugManager.updateDebugInfo();
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Update Debug Info');
    }
  }

  async updateChannelAvatar(channelName) {
    try {
      if (!channelName || !this.apiClient) return;

      // Fetch user info for the channel
      const userInfoResponse = await this.apiClient.getUserInfo('channel_avatar', [channelName], 1);

      if (userInfoResponse && userInfoResponse.success && userInfoResponse.userInfo && userInfoResponse.userInfo.length > 0) {
        const userInfo = userInfoResponse.userInfo[0];
        const avatarUrl = userInfo.profileImageURL;
        const description = userInfo.description;

        if (avatarUrl) {
          const trackingTitleElement = document.getElementById('tvm-tracking-title');
          if (trackingTitleElement) {
            // Update tracking title to include avatar with better layout
            trackingTitleElement.innerHTML = `
              <div style="display: flex; align-items: center; gap: 12px;">
                <img src="${avatarUrl}" alt="${channelName}" style="width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0;">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                  <div style="font-size: 20px; font-weight: 600; color: #efeff1; line-height: 1.2;">
                    ${userInfo.displayName || channelName}
                  </div>
                  ${description ? `<div style="font-size: 14px; color: #adadb8; line-height: 1.3; max-width: 1200px; word-wrap: break-word;">
                    ${description}
                  </div>` : ''}
                </div>
              </div>
            `;
          }
        }
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Update Channel Avatar', { channelName });
      // Don't show error to user - avatar is non-essential
    }
  }

  updateChannelName(newChannelName) {
    try {
      // Update stored channel name
      this.channelName = newChannelName;

      // Update popup manager channel name
      if (this.popupManager) {
        this.popupManager.setChannelName(newChannelName);
      }

      // Update stream name element in charts
      if (this.uiContainer) {
        const streamNameElement = this.uiContainer.querySelector('.tvm-stream-name');
        if (streamNameElement) {
          streamNameElement.textContent = newChannelName;
        }
      }

      // Update channel avatar and name display
      this.updateChannelAvatar(newChannelName);

    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Update Channel Name', { newChannelName });
    }
  }

  destroy() {
    try {
      // Clean up UI
      this.removeUI();

      // Clean up any open popups
      if (this.popupManager) {
        this.popupManager.closeUserPopup();
      }

      // Clean up event listeners and references
      this.isInitialized = false;
      this.channelName = null;

      // Note: We don't destroy the managers themselves as they might be needed again
      // if the UI is re-injected. They are lightweight and don't hold heavy resources.

    } catch (error) {
      this.errorHandler?.handle(error, 'UIManager Destroy');
    }
  }
}
// Popup Manager for handling user popup operations
window.PopupManager = class PopupManager {
  // Static method to clean up any orphaned popups
  static cleanupOrphanedPopups() {
    const existingPopup = document.getElementById('tvm-user-popup');
    if (existingPopup) {
      console.log('Cleaning up orphaned popup from previous instance');

      // Clean up any stored event handlers
      if (existingPopup._handlers) {
        Object.entries(existingPopup._handlers).forEach(([eventType, handlers]) => {
          handlers.forEach(handler => {
            existingPopup.removeEventListener(eventType, handler, { capture: true });
          });
        });
      }

      existingPopup.remove();

      // Clean up any global escape handlers
      const handlers = document._popupEscapeHandlers || [];
      handlers.forEach(handler => {
        document.removeEventListener('keydown', handler);
      });
      document._popupEscapeHandlers = [];
    }
  }

  constructor(dataManager, apiClient, errorHandler) {
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    this.errorHandler = errorHandler;
    this.currentEscapeHandler = null;
    this.channelName = null;
  }

  setChannelName(channelName) {
    this.channelName = channelName;
  }

  async showUserPopup(username) {
    try {
      // Get user data from data manager
      const viewer = this.dataManager.state.viewers.get(username.toLowerCase());

      // If viewer data is not found, it might be during a channel switch
      // Instead of showing an error, proceed with API fetching
      if (!viewer) {
        console.log(`Viewer data for ${username} not found locally, fetching from API...`);
      }

      // Show loading popup first
      this.showLoadingPopup(username);

      // Get additional data from API if not already available
      let userInfo = viewer?.profileImageURL ?
        { profileImageURL: viewer.profileImageURL, ...viewer } : null;

      const apiCalls = [];

      // Only fetch user info if we don't have profile image data
      if (!userInfo) {
        apiCalls.push(this.apiClient.getUserInfo(this.channelName || 'unknown', [username], 1)); // High priority for popup
      }

      // Always fetch following data
      apiCalls.push(this.apiClient.getUserFollowing([username], { limit: 50, getAllPages: false }, 1)); // High priority for popup

      const results = await Promise.all(apiCalls);

      // Extract results based on what we fetched
      if (!userInfo) {
        const userInfoResponse = results[0];
        userInfo = userInfoResponse.userInfo?.[0];
        const following = results[1]?.followingData?.[0];

        // If we don't have local viewer data, create a minimal viewer object
        const viewerData = viewer || {
          username: username,
          displayName: username,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          isBot: false,
          authenticated: true,
          seen: 1
        };

        // Close loading popup and show full popup
        this.closeUserPopup();
        this.showFullUserPopup(viewerData, userInfo, following);
      } else {
        const following = results[0]?.followingData?.[0];

        // If we don't have local viewer data, create a minimal viewer object
        const viewerData = viewer || {
          username: username,
          displayName: username,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          isBot: false,
          authenticated: true,
          seen: 1
        };

        // Close loading popup and show full popup
        this.closeUserPopup();
        this.showFullUserPopup(viewerData, userInfo, following);
      }

    } catch (error) {
      this.errorHandler?.handle(error, 'PopupManager Show User Popup', { username });
      this.closeUserPopup();
      alert('Failed to load user data');
    }
  }

  showLoadingPopup(username) {
    // Clean up any orphaned popups from previous instances first
    PopupManager.cleanupOrphanedPopups();

    // Clean up any existing popup first
    this.closeUserPopup();

    const popup = document.createElement('div');
    popup.id = 'tvm-user-popup';
    popup.className = 'tvm-user-popup';
    popup.innerHTML = HTMLTemplates.generateLoadingPopup(username);

    document.body.appendChild(popup);
    // Don't setup event listeners for loading popup since it will be replaced
  }

  showFullUserPopup(viewer, userInfo, following) {
    // Clean up any orphaned popups from previous instances first
    PopupManager.cleanupOrphanedPopups();

    // Clean up any existing popup first
    this.closeUserPopup();

    const popup = document.createElement('div');
    popup.id = 'tvm-user-popup';
    popup.className = 'tvm-user-popup';
    popup.innerHTML = HTMLTemplates.generateFullUserPopup(viewer, userInfo, following);

    document.body.appendChild(popup);
    this.setupPopupEventListeners(); // Only setup listeners for the final popup

    // Setup following list interactions
    if (following?.follows?.length > 0) {
      this.setupFollowingInteractions(following.follows);
    }
  }

  setupFollowingInteractions(followingList) {
    // Store following data for use in event handlers
    this.currentFollowingList = followingList;
    this.isFullListLoaded = false;

    console.log('Following interactions set up for', followingList.length, 'items');
  }

  setupPopupEventListeners() {
    const popup = document.getElementById('tvm-user-popup');
    if (!popup) {
      console.warn('Popup not found when setting up event listeners');
      return;
    }

    // Check if event listeners are already set up
    if (popup._handlersSetup) {
      console.log('Event listeners already set up for this popup, skipping');
      return;
    }

    // Clean up any existing event handlers first
    this.cleanupPopupHandlers(popup);

    // Use event delegation with more specific targeting
    const mainHandler = (event) => {
      console.log('Popup event:', event.type, event.target.className, event.target.id);

      // Close button
      if (event.target.matches('.tvm-user-popup-close')) {
        console.log('Popup close button clicked');
        event.preventDefault();
        event.stopPropagation();
        this.closeUserPopup();
        return;
      }

      // Click outside to close (on popup background)
      if (event.target === popup) {
        console.log('Clicked outside popup, closing');
        event.preventDefault();
        event.stopPropagation();
        this.closeUserPopup();
        return;
      }
    };

    // Input event handler for search
    const inputHandler = (event) => {
      if (event.target.matches('#tvm-following-search')) {
        console.log('Search input changed');
        this.updateFollowingDisplay();
      }
    };

    // Change event handler for sort
    const changeHandler = (event) => {
      if (event.target.matches('#tvm-following-sort')) {
        console.log('Sort changed');
        this.updateFollowingDisplay();
      }
    };

    // Button click handler for load full list
    const buttonHandler = async (event) => {
      if (event.target.matches('#tvm-load-full-following')) {
        console.log('Load Full List button clicked');
        event.preventDefault();
        event.stopPropagation();
        await this.handleLoadFullList();
      }
    };

    // Add all event listeners (use capture phase and once:false to prevent duplicates)
    popup.addEventListener('click', mainHandler, { capture: true });
    popup.addEventListener('input', inputHandler, { capture: true });
    popup.addEventListener('change', changeHandler, { capture: true });
    popup.addEventListener('click', buttonHandler, { capture: true }); // Separate for buttons

    // Store references for cleanup
    popup._handlers = {
      click: [mainHandler, buttonHandler],
      input: [inputHandler],
      change: [changeHandler]
    };

    // Mark that handlers are set up
    popup._handlersSetup = true;

    // Escape key to close (this needs to be on document)
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeUserPopup();
      }
    };

    // Remove any existing escape handler first
    if (this.currentEscapeHandler) {
      document.removeEventListener('keydown', this.currentEscapeHandler);

      // Remove from global tracking
      if (document._popupEscapeHandlers) {
        const index = document._popupEscapeHandlers.indexOf(this.currentEscapeHandler);
        if (index > -1) {
          document._popupEscapeHandlers.splice(index, 1);
        }
      }
    }

    // Add new escape handler
    document.addEventListener('keydown', handleEscape);

    // Store the escape handler globally for cleanup
    if (!document._popupEscapeHandlers) {
      document._popupEscapeHandlers = [];
    }
    document._popupEscapeHandlers.push(handleEscape);
    this.currentEscapeHandler = handleEscape;

    console.log('Popup event listeners set up successfully');
  }

  cleanupPopupHandlers(popup) {
    if (popup._handlers) {
      // Remove all stored handlers with the same options they were added with
      Object.entries(popup._handlers).forEach(([eventType, handlers]) => {
        handlers.forEach(handler => {
          popup.removeEventListener(eventType, handler, { capture: true });
        });
      });
      popup._handlers = null;
    }
    popup._handlersSetup = false;
  }

  updateFollowingDisplay() {
    // This will be called when search or sort changes
    if (this.currentFollowingList) {
      const searchInput = document.getElementById('tvm-following-search');
      const sortSelect = document.getElementById('tvm-following-sort');
      const searchTerm = searchInput?.value.toLowerCase() || '';
      const sortBy = sortSelect?.value || 'followedAt';

      let filteredList = this.currentFollowingList.filter(follow =>
        follow.user.login.toLowerCase().includes(searchTerm) ||
        follow.user.displayName.toLowerCase().includes(searchTerm)
      );

      if (sortBy === 'login') {
        filteredList.sort((a, b) => a.user.login.localeCompare(b.user.login));
      } else {
        filteredList.sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
      }

      const listContainer = document.getElementById('tvm-following-list');
      if (listContainer) {
        listContainer.innerHTML = HTMLTemplates.generateFollowingList(
          filteredList,
          null,
          !this.isFullListLoaded && this.currentFollowingList.length >= 50
        );
      }
    }
  }

  async handleLoadFullList() {
    try {
      // Get username from popup title
      const popupTitle = document.querySelector('.tvm-user-popup-header h3');
      const username = popupTitle?.textContent;

      if (!username) {
        throw new Error('Could not determine username');
      }

      // Get user data from data manager
      const viewer = this.dataManager.state.viewers.get(username.toLowerCase());
      if (!viewer) {
        console.log(`Viewer data for ${username} not found locally, opening viewer page with minimal data...`);
      }

      // Prepare data for the new tab (use fallback if viewer data not available)
      const viewerData = viewer ? {
        username: viewer.username,
        id: viewer.id,
        createdAt: viewer.createdAt,
        firstSeen: viewer.firstSeen,
        lastSeen: viewer.lastSeen,
        description: viewer.description,
        profileImageURL: viewer.profileImageURL,
        followingCount: viewer.followingCount,
        isFollower: viewer.isFollower,
        accountsOnSameDay: viewer.accountsOnSameDay
      } : {
        username: username,
        id: null,
        createdAt: null,
        firstSeen: null,
        lastSeen: null,
        description: null,
        profileImageURL: null,
        followingCount: null,
        isFollower: null,
        accountsOnSameDay: null
      };

      // Store data in chrome storage for the new tab to access
      await chrome.storage.local.set({ viewerPageData: viewerData });

      // Send message to background script to open new tab
      chrome.runtime.sendMessage({
        type: 'openViewerPage'
      }, (response) => {
        if (response && response.success) {
          // Optionally close the current popup
          this.closeUserPopup();
        } else {
          console.error('Failed to open viewer page:', response?.error);
          alert('Failed to open viewer page. Please try again.');
        }
      });

    } catch (error) {
      console.error('Error opening viewer page:', error);
      alert('Failed to open viewer page. Please try again.');
    }
  }

  closeUserPopup() {
    const popup = document.getElementById('tvm-user-popup');
    if (popup) {
      // Clean up event listeners before removing
      this.cleanupPopupHandlers(popup);
      popup.remove();
    }

    // Clean up stored following data
    this.currentFollowingList = null;
    this.isFullListLoaded = false;

    // Clean up escape key listener
    if (this.currentEscapeHandler) {
      document.removeEventListener('keydown', this.currentEscapeHandler);

      // Remove from global tracking
      if (document._popupEscapeHandlers) {
        const index = document._popupEscapeHandlers.indexOf(this.currentEscapeHandler);
        if (index > -1) {
          document._popupEscapeHandlers.splice(index, 1);
        }
      }

      this.currentEscapeHandler = null;
    }
  }

  // Add a cleanup method to be called when PopupManager is being destroyed
  destroy() {
    // Close any open popup
    this.closeUserPopup();

    // Clean up all escape handlers
    if (document._popupEscapeHandlers) {
      document._popupEscapeHandlers.forEach(handler => {
        document.removeEventListener('keydown', handler);
      });
      document._popupEscapeHandlers = [];
    }
  }
}
// Viewer Details Page
class ViewerPageManager {
  constructor() {
    this.userData = null;
    this.followingData = [];
    this.filteredData = [];
    this.isLoading = false;

    // Loading lock configuration
    this.lockTimeout = 10000; // 10 seconds timeout
    this.lockUpdateInterval = null;
    this.pageId = `viewer_page_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    this.init();
  }

  async checkLoadingLock() {
    try {
      // Load user data first to get username for lock
      await this.loadUserDataForLock();

      const result = await chrome.storage.local.get(['viewerPageLoadingLock']);
      const existingLock = result.viewerPageLoadingLock;

      if (existingLock) {
        const now = Date.now();
        const lockAge = now - existingLock.timestamp;

        // Check if lock has timed out (10 seconds)
        if (lockAge > this.lockTimeout) {
          console.log('Loading lock timed out, proceeding with load');
          await this.acquireLoadingLock();
          return true;
        }

        // Another page is currently loading
        console.log('Another viewer page is loading, waiting...');
        this.showWaitingMessage(existingLock);

        // Poll for lock release
        return this.waitForLockRelease();
      }

      // No lock exists, acquire it
      await this.acquireLoadingLock();
      return true;

    } catch (error) {
      console.error('Error checking loading lock:', error);
      // If there's an error, proceed anyway to avoid blocking
      return true;
    }
  }

  async loadUserDataForLock() {
    try {
      // Get user data from chrome storage for lock purposes
      const result = await chrome.storage.local.get(['viewerPageData']);

      if (result.viewerPageData) {
        this.userData = result.viewerPageData;
      }
    } catch (error) {
      console.error('Error loading user data for lock:', error);
    }
  }

  async acquireLoadingLock() {
    const lock = {
      pageId: this.pageId,
      timestamp: Date.now(),
      username: this.userData?.username || 'unknown'
    };

    await chrome.storage.local.set({ viewerPageLoadingLock: lock });
    console.log('Acquired loading lock for page:', this.pageId);

    // Start periodic lock updates
    this.startLockUpdates();
  }

  async releaseLoadingLock() {
    try {
      await chrome.storage.local.remove(['viewerPageLoadingLock']);
      console.log('Released loading lock for page:', this.pageId);

      // Stop lock updates
      if (this.lockUpdateInterval) {
        clearInterval(this.lockUpdateInterval);
        this.lockUpdateInterval = null;
      }
    } catch (error) {
      console.error('Error releasing loading lock:', error);
    }
  }

  startLockUpdates() {
    // Update the lock timestamp every 2 seconds during loading
    this.lockUpdateInterval = setInterval(async () => {
      try {
        const result = await chrome.storage.local.get(['viewerPageLoadingLock']);
        const currentLock = result.viewerPageLoadingLock;

        // Only update if we still own the lock
        if (currentLock && currentLock.pageId === this.pageId) {
          currentLock.timestamp = Date.now();
          await chrome.storage.local.set({ viewerPageLoadingLock: currentLock });
        } else {
          // We no longer own the lock, stop updates
          clearInterval(this.lockUpdateInterval);
          this.lockUpdateInterval = null;
        }
      } catch (error) {
        console.error('Error updating loading lock:', error);
      }
    }, 2000);
  }

  async waitForLockRelease() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const result = await chrome.storage.local.get(['viewerPageLoadingLock']);
          const existingLock = result.viewerPageLoadingLock;

          if (!existingLock || (Date.now() - existingLock.timestamp) > this.lockTimeout) {
            clearInterval(checkInterval);
            console.log('Lock released or timed out, proceeding with load');
            await this.acquireLoadingLock();
            this.hideWaitingMessage();
            resolve(true);
          }
        } catch (error) {
          console.error('Error checking lock release:', error);
          clearInterval(checkInterval);
          resolve(true); // Proceed on error
        }
      }, 1000);
    });
  }

  showWaitingMessage(lock) {
    const waitingHtml = `
      <div id="tvm-waiting-overlay" class="tvm-waiting-overlay">
        <div class="tvm-waiting-content">
          <div class="tvm-loading-spinner"></div>
          <h2>Please Wait</h2>
          <p>Another viewer page is currently loading data.</p>
          <p>Loading: <strong>${lock.username}</strong></p>
          <p class="tvm-waiting-note">This prevents overloading servers with multiple concurrent requests.</p>
          <p class="tvm-waiting-timeout">Will proceed automatically if the other page doesn't finish within 10 seconds.</p>
          <button id="tvm-waiting-close" class="tvm-btn tvm-btn-secondary">Close This Tab</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', waitingHtml);

    // Add close button functionality
    document.getElementById('tvm-waiting-close').addEventListener('click', () => {
      window.close();
    });
  }

  hideWaitingMessage() {
    const overlay = document.getElementById('tvm-waiting-overlay');
    if (overlay) {
      overlay.remove();
    }
  }

  async init() {
    console.log('Viewer page initializing...');

    // Check for loading lock before doing anything
    const canProceed = await this.checkLoadingLock();
    if (!canProceed) {
      return; // Another page is loading, this page will wait
    }

    // Set up event listeners
    this.setupEventListeners();

    // Display user profile (data already loaded during lock check)
    if (this.userData) {
      this.displayUserProfile();
      document.getElementById('tvm-loading-username').textContent = this.userData.username;
    } else {
      this.showError('No user data found. Please try opening the viewer page again.');
      return;
    }

    // Start loading following data
    this.loadFollowingData();
  }

  setupEventListeners() {
    // Close tab button
    document.getElementById('tvm-close-btn').addEventListener('click', async () => {
      await this.releaseLoadingLock();
      window.close();
    });

    // Search functionality
    document.getElementById('tvm-search').addEventListener('input', (e) => {
      this.filterData(e.target.value);
    });

    // Sort functionality
    document.getElementById('tvm-sort').addEventListener('change', (e) => {
      this.sortData(e.target.value);
    });

    // Following grid click handler - Use event delegation to avoid multiple handlers
    const grid = document.getElementById('tvm-following-grid');
    grid.addEventListener('click', (e) => {
      const item = e.target.closest('.tvm-following-item[data-twitch-login]');
      if (item) {
        const login = item.getAttribute('data-twitch-login');
        if (login) {
          window.open(`https://twitch.tv/${login}`, '_blank');
        }
      }
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', async () => {
      await this.releaseLoadingLock();
    });

    window.addEventListener('unload', async () => {
      await this.releaseLoadingLock();
    });
  }



  displayUserProfile() {
    const data = this.userData;

    // Update title and username
    document.getElementById('tvm-viewer-title').textContent = `${data.username} - Viewer Details`;
    document.getElementById('tvm-profile-username').textContent = data.username;

    // Update profile image
    const profileImage = data.profileImageURL || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/41780b5a-def8-11e9-94d9-784f43822e80-profile_image-300x300.png';
    document.getElementById('tvm-profile-image').src = profileImage;

    // Update stats
    document.getElementById('tvm-stat-id').textContent = data.id || 'Unknown';
    document.getElementById('tvm-stat-created').textContent = data.createdAt ?
      new Date(data.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown';
    document.getElementById('tvm-stat-first-seen').textContent =
      new Date(data.firstSeen).toLocaleString();
    document.getElementById('tvm-stat-last-seen').textContent =
      new Date(data.lastSeen).toLocaleString();

    // Calculate time in stream
    const timeInStream = this.formatDuration(Date.now() - data.firstSeen);
    document.getElementById('tvm-stat-time-stream').textContent = timeInStream;

    // Following count will be updated when data loads
    document.getElementById('tvm-stat-following-count').textContent = 'Loading...';

    // Show description if available
    if (data.description && data.description !== 'No description available') {
      document.getElementById('tvm-profile-description').style.display = 'block';
      document.getElementById('tvm-description-text').textContent = data.description;
    }
  }

  async loadFollowingData() {
    if (this.isLoading) return;

    this.isLoading = true;
    this.showLoading();

    // Reset data for fresh load
    this.followingData = [];
    this.filteredData = [];
    this.displayFollowingGrid(); // Clear existing grid

    try {
      console.log('Loading full following data for:', this.userData.username);

      // Send message to background script to get full following data
      const response = await chrome.runtime.sendMessage({
        type: 'GET_USER_FOLLOWING',
        usernames: [this.userData.username],
        options: {
          limit: 100,
          getAllPages: true
        }
      });

      if (response && response.success && response.followingData) {
        const followingData = response.followingData[0];

        if (followingData && followingData.follows) {
          // Show data progressively as it loads
          await this.displayFollowsProgressively(followingData.follows);
        } else if (followingData && followingData.error) {
          throw new Error(followingData.error);
        } else {
          this.followingData = [];
        }
      } else {
        throw new Error(response?.error || 'Failed to load following data');
      }

      this.hideLoading();
      this.isLoading = false;

      // Release the loading lock after all data is loaded and enriched
      await this.releaseLoadingLock();

    } catch (error) {
      console.error('Error loading following data:', error);
      this.showError(`Failed to load following data: ${error.message}`);
      this.hideLoading();
      this.isLoading = false;

      // Release the loading lock even if there was an error
      await this.releaseLoadingLock();
    }
  }

  async displayFollowsProgressively(follows) {
    const batchSize = 20;

    for (let i = 0; i < follows.length; i += batchSize) {
      const batch = follows.slice(i, i + batchSize);

      // Add batch to our data
      this.followingData.push(...batch);

      // Update count display
      document.getElementById('tvm-stat-following-count').textContent =
        `${this.followingData.length} of ${follows.length}`;

      // Update display
      this.filteredData = [...this.followingData];
      this.sortData('followedAt');
      this.displayFollowingGrid();

      // Small delay to show progressive loading
      if (i + batchSize < follows.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Final count update
    document.getElementById('tvm-stat-following-count').textContent = this.followingData.length;

    console.log(`Progressively loaded ${this.followingData.length} follows`);

    // Now simulate enrichment updates
    this.simulateEnrichmentUpdates();
  }

  async simulateEnrichmentUpdates() {
    // Simulate avatars and creation dates being updated as enrichment completes
    const updateInterval = 200; // Update every 200ms
    const itemsPerUpdate = 5;

    for (let i = 0; i < this.followingData.length; i += itemsPerUpdate) {
      await new Promise(resolve => setTimeout(resolve, updateInterval));

      // Trigger a re-render to show updated avatars/dates
      this.displayFollowingGrid();
    }
  }

  filterData(searchTerm) {
    if (!searchTerm.trim()) {
      this.filteredData = [...this.followingData];
    } else {
      const term = searchTerm.toLowerCase();
      this.filteredData = this.followingData.filter(follow => {
        const user = follow.user || follow;
        const username = user.displayName || user.login || '';
        const login = user.login || '';
        return username.toLowerCase().includes(term) || login.toLowerCase().includes(term);
      });
    }

    this.displayFollowingGrid();
  }

  sortData(sortType) {
    this.filteredData.sort((a, b) => {
      const userA = a.user || a;
      const userB = b.user || b;

      switch (sortType) {
        case 'followedAt':
          const dateA = new Date(a.followedAt || a.followed_at || 0);
          const dateB = new Date(b.followedAt || b.followed_at || 0);
          return dateB - dateA; // Newest first
        case 'followedAt-asc':
          const dateAsc1 = new Date(a.followedAt || a.followed_at || 0);
          const dateAsc2 = new Date(b.followedAt || b.followed_at || 0);
          return dateAsc1 - dateAsc2; // Oldest first
        case 'live-username':
          // Sort by live status first (live users first), then by username A-Z
          const isLiveA = userA.stream && userA.stream.id ? 1 : 0;
          const isLiveB = userB.stream && userB.stream.id ? 1 : 0;
          if (isLiveA !== isLiveB) {
            return isLiveB - isLiveA; // Live users first
          }
          // If same live status, sort by username A-Z
          const liveUsernameA = userA.login || userA.displayName || '';
          const liveUsernameB = userB.login || userB.displayName || '';
          return liveUsernameA.localeCompare(liveUsernameB);
        case 'login':
          const loginA = userA.login || userA.displayName || '';
          const loginB = userB.login || userB.displayName || '';
          return loginA.localeCompare(loginB);
        case 'login-desc':
          const loginDescA = userA.login || userA.displayName || '';
          const loginDescB = userB.login || userB.displayName || '';
          return loginDescB.localeCompare(loginDescA);
        default:
          return 0;
      }
    });

    this.displayFollowingGrid();
  }

  displayFollowingGrid() {
    const grid = document.getElementById('tvm-following-grid');

    grid.innerHTML = '';

    this.filteredData.forEach(follow => {
      const item = document.createElement('div');
      item.className = 'tvm-following-item';

      // Handle both placeholder and real API data structures
      const user = follow.user || follow;
      const username = user.displayName || user.login || 'Unknown';
      const login = user.login || username.toLowerCase();
      const followDateTime = new Date(follow.followedAt || follow.followed_at || Date.now());
      const followDate = followDateTime.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
        followDateTime.toLocaleTimeString();

      // Avatar with loading state
      const avatarUrl = user.profileImageURL || user.profile_image_url ||
        'https://static-cdn.jtvnw.net/user-default-pictures-uv/41780b5a-def8-11e9-94d9-784f43822e80-profile_image-300x300.png';

      // Creation date with loading state
      const createdDate = user.createdAt ?
        new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) :
        'Loading...';

      // Check if user is currently streaming
      const isStreaming = user.stream && user.stream.id;

      item.innerHTML = `
        <div class="tvm-following-avatar">
          <img src="${avatarUrl}" alt="${username}" class="tvm-following-user-avatar" 
               style="${!user.profileImageURL ? 'opacity: 0.5;' : ''}">
          ${!user.profileImageURL ? '<div class="tvm-avatar-loading"></div>' : ''}
          ${isStreaming ? '<div class="tvm-streaming-indicator" title="Currently Live"></div>' : ''}
        </div>
        <div class="tvm-following-info">
          <div class="tvm-following-name">${username}</div>
          <div class="tvm-following-date">${followDate}</div>
          <div class="tvm-following-created ${!user.createdAt ? 'loading' : ''}">Created: ${createdDate}</div>
        </div>
      `;

      // Store login in data attribute for event delegation
      item.style.cursor = 'pointer';
      item.setAttribute('data-twitch-login', login);

      grid.appendChild(item);
    });

    grid.style.display = 'grid';
  }

  showLoading() {
    document.getElementById('tvm-loading').style.display = 'block';
    document.getElementById('tvm-error').style.display = 'none';
    document.getElementById('tvm-following-grid').style.display = 'none';
  }

  hideLoading() {
    document.getElementById('tvm-loading').style.display = 'none';
  }

  showError(message) {
    document.getElementById('tvm-error-text').textContent = message;
    document.getElementById('tvm-error').style.display = 'block';
    document.getElementById('tvm-loading').style.display = 'none';
    document.getElementById('tvm-following-grid').style.display = 'none';
    document.getElementById('tvm-pagination').style.display = 'none';
  }

  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  new ViewerPageManager();
});
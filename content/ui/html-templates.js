// HTML Templates for generating UI components
window.HTMLTemplates = class HTMLTemplates {
  static generateSimpleUI(channelName) {
    // Get icon URL safely
    const iconUrl = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL('icons/icon128.png')
      : '';

    return `
      <div class="tvm-container tvm-simple">
        <div class="tvm-simple-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="tvm-simple-icon">${iconUrl ? `<img src="${iconUrl}" alt="TVM" style="width: 48px; height: 48px;">` : '📊'}</div>
            <div>
              <div class="tvm-simple-title">Viewer Metrics</div>
              <div class="tvm-simple-subtitle">Track and analyze viewers for ${channelName}</div>
            </div>
          </div>
          <button id="tvm-start-tracking" class="tvm-btn tvm-btn-primary">
            Start Tracking
          </button>
        </div>
      </div>
    `;
  }

  static generateLoadingContent(username) {
    return `
      <div style="text-align: center; padding: 40px;">
        <div class="tvm-loading-spinner"></div>
        <p>Loading user data...</p>
      </div>
    `;
  }

  static generateErrorContent(username) {
    const capitalizedUsername = FormatUtils.capitalizeUsername(username);
    return `
      <div class="tvm-panel-error">
        <p>Failed to load data for ${capitalizedUsername}</p>
        <p style="font-size: 12px; margin-top: 10px; color: #adadb8;">Click the username in the viewer list to retry</p>
      </div>
    `;
  }

  static generatePanelContent(viewer, userInfo, following) {
    const capitalizedUsername = FormatUtils.capitalizeUsername(viewer.username);
    const profileImage = userInfo?.profileImageURL || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/41780b5a-def8-11e9-94d9-784f43822e80-profile_image-300x300.png';
    const description = viewer.description || 'No description available';

    // Format dates
    const createdDate = FormatUtils.formatCreatedDate(viewer.createdAt);
    const firstSeen = FormatUtils.formatDateTime(viewer.firstSeen);
    const lastSeen = FormatUtils.formatDateTime(viewer.lastSeen);

    // Calculate timeInStream manually since it's a computed property
    const now = Date.now();
    const calculatedTimeInStream = viewer.firstSeen ? now - viewer.firstSeen : 0;
    const timeInStream = FormatUtils.formatDuration(calculatedTimeInStream);

    // Following data
    const followingCount = following?.totalCount || 0;
    const followingList = following?.follows || [];
    const followingError = following?.error;

    return `
      <div class="tvm-user-profile" style="margin-bottom: 15px;">
        <img src="${profileImage}" alt="${capitalizedUsername}" style="width: 60px; height: 60px; border-radius: 50%; border: 2px solid #2e2e35;">
        <div style="margin-top: 10px; font-size: 13px; line-height: 1.6;">
          <strong>ID:</strong> ${viewer.id || 'Unknown'}<br>
          <strong>Created:</strong> ${createdDate}<br>
          <strong>Accounts Same Day:</strong> ${viewer.accountsOnSameDay}<br>
          ${viewer.followingCount !== undefined ? `<strong>Following Count:</strong> ${viewer.followingCount}<br>` : ''}
          ${viewer.isFollower !== undefined ? `<strong>Follows Channel:</strong> ${viewer.isFollower ? '✅ Yes' : '❌ No'}<br>` : ''}
          <strong>First Seen:</strong> ${firstSeen}<br>
          <strong>Last Seen:</strong> ${lastSeen}<br>
          <strong>Time in Stream:</strong> ${timeInStream}
        </div>
      </div>
      
      ${description !== 'No description available' ? `
        <div class="tvm-user-description" style="margin-bottom: 15px; padding: 12px; background: #1f1f23; border-radius: 4px; border-left: 3px solid #9147ff;">
          <strong style="font-size: 13px;">Description:</strong><br>
          <div class="tvm-description-text" style="margin-top: 6px; font-style: italic; color: #adadb8; font-size: 12px; line-height: 1.5;">${description}</div>
        </div>
      ` : ''}

      <div class="tvm-user-following">
        <div class="tvm-following-header">
          <h4>Following (${followingCount} total)</h4>
          ${followingCount > 0 ? `
            <button id="tvm-load-full-following" class="tvm-btn tvm-btn-small">
              Open Full View
            </button>
          ` : ''}
        </div>
        ${followingList.length > 0 ? `
          <div class="tvm-following-controls">
            <input type="text" id="tvm-following-search" placeholder="Search follows..." class="tvm-search-input">
            <select id="tvm-following-sort" class="tvm-sort-select">
              <option value="followedAt">Sort by Follow Date</option>
              <option value="login">Sort by Username</option>
            </select>
          </div>
        ` : ''}
        <div id="tvm-following-list">
          ${this.generateFollowingList(followingList, followingError, followingCount > 50)}
        </div>
      </div>
    `;
  }

  static generateFollowingList(followingList, error, isPartialList = false) {
    if (error) {
      return `<div class="tvm-error">Error loading following data: ${error}</div>`;
    }

    if (followingList.length === 0) {
      return '<p class="tvm-empty">No channels found</p>';
    }

    let html = '';

    // Add notice if this is partial data
    if (isPartialList) {
      html += '<div style="text-align: center; margin-bottom: 10px; padding: 8px; background: rgba(145, 71, 255, 0.1); border-radius: 4px; font-size: 12px; color: #adadb8;">Showing first 50 follows. Click "Open Full View" to see all.</div>';
    }

    html += '<div class="tvm-following-grid">';

    for (const follow of followingList) {
      const followDateTime = new Date(follow.followedAt);
      const followDate = followDateTime.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const avatarUrl = follow.user.profileImageURL || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/41780b5a-def8-11e9-94d9-784f43822e80-profile_image-300x300.png';

      html += `
        <div class="tvm-following-item" data-login="${follow.user.login}">
          <img src="${avatarUrl}" alt="${follow.user.displayName}" class="tvm-following-avatar">
          <div class="tvm-following-name">${follow.user.displayName}</div>
          <div class="tvm-following-date">${followDate}</div>
        </div>
      `;
    }

    html += '</div>';

    return html;
  }
}
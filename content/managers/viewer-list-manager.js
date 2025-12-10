// Viewer List Manager for handling viewer list display and pagination
window.ViewerListManager = class ViewerListManager {
  constructor(dataManager, settingsManager, errorHandler, tabManager) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.tabManager = tabManager;
    this.currentPage = 1;
    this.lastViewerListUpdate = 0;
    this.currentDateFilter = 'all'; // Internal date filter state (no dropdown)
    this.skipBotStatsUpdate = false; // Flag to skip bot stats during pagination
    this.showAllMonths = false; // Toggle state for showing all months
  }

  scheduleViewerListUpdate() {
    try {
      const now = Date.now();
      const viewerListUpdateInterval = this.settingsManager.get('viewerListUpdateInterval');

      // Only update if enough time has passed since last update
      if (now - this.lastViewerListUpdate >= viewerListUpdateInterval) {
        this.updateViewerList();
        this.lastViewerListUpdate = now;
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Schedule Viewer List Update');
    }
  }

  forceViewerListUpdate() {
    try {
      this.updateViewerList();
      this.lastViewerListUpdate = Date.now();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Force Viewer List Update');
    }
  }

  updateViewerList() {
    try {
      const searchTerm = document.getElementById('tvm-search')?.value || '';
      const sortBy = document.getElementById('tvm-sort')?.value || 'timeInStream';
      const dateFilter = this.currentDateFilter || 'all';

      const config = this.settingsManager.get();
      const result = this.dataManager.getViewerList(this.currentPage, config.pageSize, searchTerm, sortBy, dateFilter);

      const listContent = document.getElementById('tvm-list-content');
      const pagination = document.getElementById('tvm-pagination');
      const paginationTop = document.getElementById('tvm-pagination-top');

      if (!listContent || !pagination || !paginationTop) return;

      if (result.viewers.length === 0) {
        listContent.innerHTML = '<p class="tvm-empty">No viewers found</p>';
        pagination.style.display = 'none';
        paginationTop.style.display = 'none';
        return;
      }

      // Build viewer list DOM and append directly
      listContent.textContent = '';
      listContent.appendChild(this.generateViewerListDOM(result.viewers));

      // Update both pagination controls
      this.updatePagination(result, pagination, paginationTop);

      // Update bot stats panels
      this.updateBotStatsPanels();

    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Update Viewer List');
    }
  }

  generateViewerListDOM(viewers) {
    // Use document fragment for better performance with large datasets
    const fragment = document.createDocumentFragment();
    const table = document.createElement('table');
    table.className = 'tvm-table';

    // Create header
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th style="width: 200px;">Username</th><th style="width: 120px; text-align: right;">Created</th><th style="width: 100px; text-align: right;">Time</th><th style="width: 60px; text-align: right; padding: 12px 8px;">Count</th><th style="width: auto; max-width: 300px;">Bio</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // Batch DOM operations for better performance
    const rowsFragment = document.createDocumentFragment();

    for (const viewer of viewers) {
      const timeStr = FormatUtils.formatDuration(viewer.timeInStream);
      const pendingIcon = viewer.hasPendingInfo ? '⏳' : '';
      const statusIcons = pendingIcon;

      // Capitalize first letter of username
      const capitalizedUsername = viewer.username.charAt(0).toUpperCase() + viewer.username.slice(1);

      // Format created date to "23 Mar 2023" format (cached date formatting)
      let createdDate = '-';
      if (viewer.createdAt) {
        // Cache formatted dates to avoid repeated calculations
        if (!viewer._formattedCreatedDate) {
          const date = new Date(viewer.createdAt);
          const day = date.getDate();
          const month = date.toLocaleDateString('en-US', { month: 'short' });
          const year = date.getFullYear();
          viewer._formattedCreatedDate = `${day} ${month} ${year}`;
        }
        createdDate = viewer._formattedCreatedDate;
      }

      // Account count for separate column
      const accountCount = viewer.accountsOnSameDay > 0 ? viewer.accountsOnSameDay : '';

      // Avatar image
      const avatarUrl = viewer.profileImageURL || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/41780b5a-def8-11e9-94d9-784f43822e80-profile_image-300x300.png';

      // Bio text (let CSS handle truncation)
      const bioText = viewer.description || '';

      const row = document.createElement('tr');
      row.innerHTML = `
          <td style="width: 200px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <img src="${avatarUrl}" alt="${viewer.username}" class="tvm-avatar tvm-username-clickable" data-username="${viewer.username}" style="width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; cursor: pointer;">
              <span class="tvm-username-clickable tvm-username-link" data-username="${viewer.username}">${capitalizedUsername}</span> ${statusIcons}
            </div>
          </td>
          <td style="text-align: right; vertical-align: middle;">${createdDate}</td>
          <td style="text-align: right; vertical-align: middle;">${timeStr}</td>
          <td style="text-align: right; font-size: 12px; color: #999; padding: 2px 8px; vertical-align: middle;">${accountCount}</td>
          <td style="max-width: 300px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; vertical-align: middle; font-size: 12px; color: #adadb8;" title="${bioText}">${bioText}</td>
      `;

      rowsFragment.appendChild(row);
    }

    tbody.appendChild(rowsFragment);
    table.appendChild(tbody);
    fragment.appendChild(table);

    // Return the fragment directly instead of converting to HTML string
    return fragment;
  }

  updatePagination(result, pagination, paginationTop) {
    if (result.totalPages > 1) {
      // Update bottom pagination
      pagination.style.display = 'flex';
      const pageInfo = document.getElementById('tvm-page-info');
      const prevBtn = document.getElementById('tvm-prev');
      const nextBtn = document.getElementById('tvm-next');

      if (pageInfo) pageInfo.textContent = `Page ${result.currentPage} of ${result.totalPages} (${result.totalUsersFound} viewers)`;
      if (prevBtn) prevBtn.disabled = !result.hasPrevPage;
      if (nextBtn) nextBtn.disabled = !result.hasNextPage;

      // Update top pagination
      paginationTop.style.display = 'flex';
      const pageInfoTop = document.getElementById('tvm-page-info-top');
      const prevBtnTop = document.getElementById('tvm-prev-top');
      const nextBtnTop = document.getElementById('tvm-next-top');

      if (pageInfoTop) pageInfoTop.textContent = `Page ${result.currentPage} of ${result.totalPages} (${result.totalUsersFound} viewers)`;
      if (prevBtnTop) prevBtnTop.disabled = !result.hasPrevPage;
      if (nextBtnTop) nextBtnTop.disabled = !result.hasNextPage;
    } else {
      pagination.style.display = 'none';
      paginationTop.style.display = 'none';
    }
  }

  changePage(delta) {
    try {
      this.currentPage += delta;
      if (this.currentPage < 1) this.currentPage = 1;
      this.skipBotStatsUpdate = true; // Skip expensive bot stats during pagination
      this.updateViewerList();
      this.skipBotStatsUpdate = false;
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Change Page', { delta });
    }
  }

  onSearchInput() {
    try {
      // Reset to first page when searching
      this.currentPage = 1;
      this.skipBotStatsUpdate = true; // Skip expensive bot stats during search
      this.updateViewerList();
      this.skipBotStatsUpdate = false;
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Search Input');
    }
  }

  onSortChange() {
    try {
      // Reset to first page when changing sort
      this.currentPage = 1;
      this.skipBotStatsUpdate = true; // Skip expensive bot stats during sort
      this.updateViewerList();
      this.skipBotStatsUpdate = false;
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Sort Change');
    }
  }

  clearDateFilter() {
    try {
      // Clear date filter and reset to first page
      this.currentPage = 1;
      this.currentDateFilter = 'all';
      this.updateViewerList();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Clear Date Filter');
    }
  }

  setDateFilter(yearMonth) {
    try {
      // Set date filter internally and reset to first page
      this.currentPage = 1;
      this.currentDateFilter = yearMonth;
      this.updateViewerList();

      // Switch to viewers tab when month is clicked
      this.tabManager.switchTab('viewers');
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Set Date Filter', { yearMonth });
    }
  }

  resetToFirstPage() {
    this.currentPage = 1;
  }

  updateAfterCleanup() {
    try {
      // Update viewer list to reflect the cleanup
      this.updateViewerList();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Update After Cleanup');
    }
  }

  resetUI() {
    try {
      this.currentPage = 1;
      this.clearBotStatsPanels();
      this.forceViewerListUpdate();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Reset UI');
    }
  }

  clearBotStatsPanels() {
    try {
      const monthsContainer = document.getElementById('tvm-top-months-list');
      const daysContainer = document.getElementById('tvm-top-days-list');

      if (monthsContainer) {
        monthsContainer.innerHTML = '<p class="tvm-empty">No data available</p>';
      }

      if (daysContainer) {
        daysContainer.innerHTML = '<p class="tvm-empty">No data available</p>';
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Clear Bot Stats Panels');
    }
  }

  updateBotStatsPanels() {
    try {
      // Skip during pagination only
      if (this.skipBotStatsUpdate) {
        return;
      }

      this.updateTopBottedMonths();
      this.updateTopSameDayCounts();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Update Bot Stats Panels');
    }
  } updateTopBottedMonths() {
    try {
      const container = document.getElementById('tvm-top-months-list');
      if (!container) return;

      // Get either top 10 or all months based on toggle state
      const limit = this.showAllMonths ? 999999 : 10;
      const allMonths = this.dataManager.getTopBottedMonths(limit);

      if (allMonths.length === 0) {
        container.innerHTML = '<p class="tvm-empty">No data available</p>';
        return;
      }

      // If showing all months, sort by date descending (newest first)
      const topMonths = this.showAllMonths
        ? allMonths.sort((a, b) => b.date - a.date)
        : allMonths;

      const dateFilter = this.currentDateFilter || 'all';

      // Update toggle button text
      const toggleBtn = document.getElementById('tvm-toggle-all-months');
      if (toggleBtn) {
        toggleBtn.textContent = this.showAllMonths ? '📋 Top 10' : '📅 Show All';
      }

      // Render clear filter button in separate container (outside scroll area)
      const clearFilterContainer = document.getElementById('tvm-clear-date-filter-container');
      if (clearFilterContainer) {
        if (dateFilter !== 'all') {
          clearFilterContainer.style.display = 'block';
          clearFilterContainer.innerHTML = `
            <div class="tvm-bot-item" id="tvm-clear-date-filter" style="cursor: pointer; background: #2c2c3e; border-left: 3px solid #00b8d4;">
              <span class="tvm-bot-item-label">✕ Clear Filter</span>
              <span class="tvm-bot-item-count"></span>
            </div>
          `;
        } else {
          clearFilterContainer.style.display = 'none';
          clearFilterContainer.innerHTML = '';
        }
      }

      // Build list of months
      let html = '';

      html += topMonths.map(month => {
        const isActive = dateFilter === month.monthKey ? ' active' : '';
        return `
          <div class="tvm-bot-item${isActive}" data-month="${month.monthKey}">
            <span class="tvm-bot-item-label">${month.monthName}</span>
            <span class="tvm-bot-item-count">${month.count}</span>
          </div>
        `;
      }).join('');

      container.innerHTML = html;

      // Add scrollable class to top months list
      container.classList.add('scrollable');

      // Add clear button handler
      const clearBtn = document.getElementById('tvm-clear-date-filter');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => this.clearDateFilter());
      }

      // Add click handlers for month items
      container.querySelectorAll('.tvm-bot-item[data-month]').forEach(item => {
        item.addEventListener('click', () => {
          const monthKey = item.getAttribute('data-month');
          this.setDateFilter(monthKey);
        });
      });
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Update Top Botted Months');
    }
  }

  updateTopSameDayCounts() {
    try {
      const container = document.getElementById('tvm-top-days-list');
      if (!container) return;

      const topDays = this.dataManager.getTopSameDayCounts(25);

      if (topDays.length === 0) {
        container.innerHTML = '<p class="tvm-empty">No data available</p>';
        return;
      }

      const dateFilter = this.currentDateFilter || 'all';

      container.innerHTML = topDays.map((day, index) => {
        // Extract year from dayKey (YYYY-MM-DD format)
        const [year, month, dayNum] = day.dayKey.split('-').map(Number);
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        const isActive = dateFilter === monthKey ? ' active' : '';

        return `
          <div class="tvm-bot-item${isActive}" data-month="${monthKey}">
            <span class="tvm-bot-item-label">${day.dayName}</span>
            <span class="tvm-bot-item-count">${day.count}</span>
          </div>
        `;
      }).join('');

      // Add click handlers
      container.querySelectorAll('.tvm-bot-item').forEach(item => {
        item.addEventListener('click', () => {
          const monthKey = item.getAttribute('data-month');
          this.setDateFilter(monthKey);
        });
      });
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Update Top Same Day Counts');
    }
  }
}

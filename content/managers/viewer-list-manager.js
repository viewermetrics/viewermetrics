// Viewer List Manager for handling viewer list display and pagination
window.ViewerListManager = class ViewerListManager {
  constructor(dataManager, settingsManager, errorHandler, tabManager) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.tabManager = tabManager;
    this.currentPage = 1;
    this.lastViewerListUpdate = 0;
    this.lastDateFilterUpdate = 0;
    this.dateFilterNeedsUpdate = false;
    this.dateFilterInUse = false;
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
      // Check if date filter needs updating (once per day or when flagged), but not if user is actively using it
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (!this.dateFilterInUse && (this.dateFilterNeedsUpdate || now - this.lastDateFilterUpdate > oneDayMs)) {
        this.initializeDateFilter();
        this.dateFilterNeedsUpdate = false;
      }

      const searchTerm = document.getElementById('tvm-search')?.value || '';
      const sortBy = document.getElementById('tvm-sort')?.value || 'timeInStream';
      const dateFilter = document.getElementById('tvm-date-filter')?.value || 'all';

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

      // Build viewer list HTML
      listContent.innerHTML = this.generateViewerListHTML(result.viewers);

      // Update both pagination controls
      this.updatePagination(result, pagination, paginationTop);

    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Update Viewer List');
    }
  }

  generateViewerListHTML(viewers) {
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

    // Convert to HTML string for compatibility with existing code
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(fragment);
    return tempDiv.innerHTML;
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
      this.updateViewerList();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Change Page', { delta });
    }
  }

  onSearchInput() {
    try {
      // Reset to first page when searching
      this.currentPage = 1;
      this.updateViewerList();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Search Input');
    }
  }

  onSortChange() {
    try {
      // Reset to first page when changing sort
      this.currentPage = 1;
      this.updateViewerList();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Sort Change');
    }
  }

  onDateFilterChange() {
    try {
      // Reset to first page when changing date filter
      this.currentPage = 1;
      this.updateViewerList();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Date Filter Change');
    }
  }

  initializeDateFilter() {
    try {
      const dateFilterSelect = document.getElementById('tvm-date-filter');
      if (!dateFilterSelect) return;

      // Preserve current selection
      const currentValue = dateFilterSelect.value || 'all';

      // Clear existing options
      dateFilterSelect.innerHTML = '<option value="all">All Dates</option>';

      // Get available months from data manager
      const availableMonths = this.dataManager.getAvailableAccountCreationMonths();

      // Add monthly options for available data
      availableMonths.forEach(monthData => {
        const option = document.createElement('option');
        option.value = monthData.value;
        option.textContent = `${monthData.label} (${monthData.count})`;
        dateFilterSelect.appendChild(option);
      });

      // Restore previous selection if it still exists in the new options
      if (currentValue !== 'all') {
        const optionExists = Array.from(dateFilterSelect.options).some(option => option.value === currentValue);
        if (optionExists) {
          dateFilterSelect.value = currentValue;
        } else {
          // If the previously selected option no longer exists, reset to 'all'
          dateFilterSelect.value = 'all';
        }
      }

      // Update timestamp
      this.lastDateFilterUpdate = Date.now();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Initialize Date Filter');
    }
  }

  setDateFilter(yearMonth) {
    try {
      const dateFilterSelect = document.getElementById('tvm-date-filter');
      if (!dateFilterSelect) return;

      dateFilterSelect.value = yearMonth;
      this.onDateFilterChange();

      // Switch to viewers tab when creation graph is clicked
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
      this.forceViewerListUpdate();
    } catch (error) {
      this.errorHandler?.handle(error, 'ViewerListManager Reset UI');
    }
  }
}

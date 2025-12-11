class ViewerDetailManager {
    static instance = null;
    static PANEL_ANIMATION_DURATION = 300;

    constructor(dataManager, apiClient, errorHandler) {
        // Validate singleton
        if (ViewerDetailManager.instance) {
            throw new Error('ViewerDetailManager: Only one instance is allowed. Use ViewerDetailManager.instance or call destroy() first.');
        }

        this.dataManager = dataManager;
        this.apiClient = apiClient;
        this.errorHandler = errorHandler;

        this.currentViewer = null;
        this.currentUserInfo = null;
        this.currentFollowing = null;
        this.currentUsername = null;

        this.panelElement = document.getElementById('tvm-viewer-detail-panel');
        this.panelTitle = document.getElementById('tvm-panel-title');
        this.panelBody = document.getElementById('tvm-panel-body');

        if (!this.panelElement || !this.panelTitle || !this.panelBody) {
            throw new Error('ViewerDetailManager: Required panel elements not found in DOM');
        }

        this._handlersSetup = false;
        this.setupPanelEventListeners();

        // Set singleton instance
        ViewerDetailManager.instance = this;
    }

    setupPanelEventListeners() {
        if (this._handlersSetup) {
            return;
        }

        // Close button handler
        this.panelElement.addEventListener('click', (e) => {
            if (e.target.classList.contains('tvm-panel-close')) {
                this.hideViewerPanel();
            }
        });

        // Following item click handler
        this.panelElement.addEventListener('click', (e) => {
            const item = e.target.closest('.tvm-following-item[data-login]');
            if (item) {
                const login = item.getAttribute('data-login');
                if (login) {
                    window.open(`https://www.twitch.tv/${login}`, '_blank');
                }
            }
        });

        // Search input handler
        this.panelElement.addEventListener('input', (e) => {
            if (e.target.id === 'tvm-following-search') {
                this.updateFollowingDisplay();
            }
        });

        // Sort select handler
        this.panelElement.addEventListener('change', (e) => {
            if (e.target.id === 'tvm-following-sort') {
                this.updateFollowingDisplay();
            }
        });

        // Load full list button handler
        this.panelElement.addEventListener('click', async (e) => {
            if (e.target.id === 'tvm-load-full-following') {
                await this.handleLoadFullList();
            }
        });

        this._handlersSetup = true;
    }

    async showViewerPanel(username) {
        try {
            this.currentUsername = username;
            this.showLoadingPanel(username);

            // Get viewer from data manager
            const viewer = this.dataManager.state.viewers.get(username.toLowerCase());

            // If viewer data is not found, show error
            if (!viewer) {
                console.log(`Viewer data for ${username} not found locally`);
                this.showErrorPanel(username);
                return;
            }

            // Get additional data from API if not already available
            let userInfo = viewer?.profileImageURL ?
                { profileImageURL: viewer.profileImageURL, ...viewer } : null;

            const apiCalls = [];

            // Only fetch user info if we don't have profile image data
            if (!userInfo) {
                apiCalls.push(this.apiClient.getUserInfo('unknown', [username], 1)); // High priority for panel
            }

            // Always fetch following data
            apiCalls.push(this.apiClient.getUserFollowing([username], { limit: 50, getAllPages: false }, 1)); // High priority for panel

            const results = await Promise.all(apiCalls);

            // Extract results based on what we fetched
            let followingData;
            if (!userInfo) {
                const userInfoResponse = results[0];
                userInfo = userInfoResponse.userInfo?.[0];
                followingData = results[1]?.followingData?.[0];
            } else {
                followingData = results[0]?.followingData?.[0];
            }

            // Verify still showing the same user
            if (this.currentUsername !== username) {
                return;
            }

            if (!viewer) {
                this.showErrorPanel(username);
                return;
            }

            this.currentViewer = viewer;
            this.currentUserInfo = userInfo;
            this.currentFollowing = followingData;

            this.showFullPanel(viewer, userInfo, followingData);

        } catch (error) {
            this.errorHandler.handle(error, 'ViewerDetailManager Show Viewer Panel');
            this.showErrorPanel(username);
        }
    }

    showLoadingPanel(username) {
        const capitalizedUsername = FormatUtils.capitalizeUsername(username);
        this.panelTitle.textContent = capitalizedUsername;
        this.panelBody.innerHTML = HTMLTemplates.generateLoadingContent(username);
        this.panelBody.scrollTop = 0;

        if (!this.panelElement.classList.contains('tvm-panel-visible')) {
            this.panelElement.style.display = ''; // Remove inline display: none
            this.panelElement.classList.remove('tvm-panel-hiding');
            this.panelElement.classList.add('tvm-panel-visible');
        }
    }

    showFullPanel(viewer, userInfo, following) {
        const capitalizedUsername = FormatUtils.capitalizeUsername(viewer.username);
        this.panelTitle.textContent = capitalizedUsername;
        this.panelBody.innerHTML = HTMLTemplates.generatePanelContent(viewer, userInfo, following);
        this.panelBody.scrollTop = 0;

        if (!this.panelElement.classList.contains('tvm-panel-visible')) {
            this.panelElement.style.display = ''; // Remove inline display: none
            this.panelElement.classList.remove('tvm-panel-hiding');
            this.panelElement.classList.add('tvm-panel-visible');
        }
    }

    showErrorPanel(username) {
        const capitalizedUsername = FormatUtils.capitalizeUsername(username);
        this.panelTitle.textContent = capitalizedUsername;
        this.panelBody.innerHTML = HTMLTemplates.generateErrorContent(username);
        this.panelBody.scrollTop = 0;

        if (!this.panelElement.classList.contains('tvm-panel-visible')) {
            this.panelElement.style.display = ''; // Remove inline display: none
            this.panelElement.classList.remove('tvm-panel-hiding');
            this.panelElement.classList.add('tvm-panel-visible');
        }
    }

    hideViewerPanel() {
        if (!this.panelElement.classList.contains('tvm-panel-visible')) {
            return;
        }

        this.panelElement.classList.add('tvm-panel-hiding');

        setTimeout(() => {
            this.panelElement.classList.remove('tvm-panel-visible', 'tvm-panel-hiding');
            this.panelElement.style.display = 'none'; // Add inline display: none back
            this.currentUsername = null;
        }, ViewerDetailManager.PANEL_ANIMATION_DURATION);
    }

    isVisible() {
        return this.panelElement.classList.contains('tvm-panel-visible') &&
            !this.panelElement.classList.contains('tvm-panel-hiding');
    }

    getCurrentUsername() {
        return this.currentUsername;
    }

    updateFollowingDisplay() {
        if (!this.currentFollowing || !this.currentFollowing.follows) {
            return;
        }

        const searchInput = document.getElementById('tvm-following-search');
        const sortSelect = document.getElementById('tvm-following-sort');
        const followingListContainer = document.getElementById('tvm-following-list');

        if (!followingListContainer) {
            return;
        }

        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const sortBy = sortSelect ? sortSelect.value : 'followedAt';

        // Filter following list
        let filteredList = [...this.currentFollowing.follows];
        if (searchTerm) {
            filteredList = filteredList.filter(follow =>
                follow.user.displayName.toLowerCase().includes(searchTerm) ||
                follow.user.login.toLowerCase().includes(searchTerm)
            );
        }

        // Sort following list
        if (sortBy === 'followedAt') {
            filteredList.sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
        } else if (sortBy === 'login') {
            filteredList.sort((a, b) => a.user.login.localeCompare(b.user.login));
        }

        // Regenerate following list HTML
        followingListContainer.innerHTML = HTMLTemplates.generateFollowingList(
            filteredList,
            null,
            this.currentFollowing.totalCount > 50 && this.currentFollowing.follows.length <= 50
        );
    }

    async handleLoadFullList() {
        if (!this.currentUsername || !this.currentViewer) {
            return;
        }

        try {
            // Prepare data for the viewer page
            const viewerData = {
                username: this.currentViewer.username,
                id: this.currentViewer.id,
                createdAt: this.currentViewer.createdAt,
                firstSeen: this.currentViewer.firstSeen,
                lastSeen: this.currentViewer.lastSeen,
                description: this.currentViewer.description,
                profileImageURL: this.currentViewer.profileImageURL,
                followingCount: this.currentViewer.followingCount,
                isFollower: this.currentViewer.isFollower,
                accountsOnSameDay: this.currentViewer.accountsOnSameDay
            };

            // Store data in chrome storage for the new tab to access
            await chrome.storage.local.set({ viewerPageData: viewerData });

            // Send message to background script to open new tab
            chrome.runtime.sendMessage({
                type: 'openViewerPage'
            });

        } catch (error) {
            this.errorHandler.handle(error, 'ViewerDetailManager Open Viewer Page');
            alert('Failed to open viewer page. Please try again.');
        }
    }

    cleanupPanelHandlers() {
        // Event listeners are on the persistent panel element, no cleanup needed
        // This method exists for potential future use
    }

    destroy() {
        this.hideViewerPanel();
        this.currentViewer = null;
        this.currentUserInfo = null;
        this.currentFollowing = null;
        this.currentUsername = null;
        ViewerDetailManager.instance = null;
    }
}

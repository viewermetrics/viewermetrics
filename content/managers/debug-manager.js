// Debug Manager for handling debug information display
window.DebugManager = class DebugManager {
  constructor(dataManager, settingsManager, errorHandler) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
  }

  async updateDebugInfo() {
    try {
      const debugContent = document.getElementById('tvm-debug-content');
      if (!debugContent) return;

      const debugInfo = await this.dataManager.getDebugInfo();
      const html = `
        <div><strong>Debug Information:</strong></div>
        <div>Users Found: ${debugInfo.viewerCount}</div>
        <div>History Points: ${debugInfo.historyPoints}</div>
        <div>Pending Info: ${debugInfo.pendingInfo}</div>
        <div>Observers: ${debugInfo.observerCount}</div>
        <div>Session Duration: ${FormatUtils.formatDuration(debugInfo.sessionDuration)}</div>
        <div>Last Updated: ${debugInfo.lastUpdated ? new Date(debugInfo.lastUpdated).toLocaleTimeString() : 'Never'}</div>
        <div><strong>Description Stats:</strong></div>
        <div>Users with descriptions: ${debugInfo.descriptionStats.withDescriptions} / ${debugInfo.descriptionStats.withData} (${debugInfo.descriptionStats.descriptionPercentage}%)</div>
        <div>Users without descriptions: ${debugInfo.descriptionStats.withoutDescriptions}</div>
        <div><strong>API Data Usage:</strong></div>
        <div>Total API Calls: ${debugInfo.dataUsage.totalApiCalls}</div>
        <div>Total Sent: ${debugInfo.dataUsage.totalSent}</div>
        <div>Total Received: ${debugInfo.dataUsage.totalReceived}</div>
        <div>Last Minute Sent: ${debugInfo.dataUsage.lastMinuteSent}</div>
        <div>Last Minute Received: ${debugInfo.dataUsage.lastMinuteReceived}</div>
        <div>Requests/min: ${debugInfo.dataUsage.requestsLastMinute}</div>
        <div style="margin-top: 10px; text-align: right;">
          <button id="tvm-clear-storage-btn" class="tvm-btn tvm-btn-danger" style="font-size: 10px; padding: 4px 8px;">Clear Local Storage</button>
        </div>
      `;

      debugContent.innerHTML = html;

      // Attach event listener to the clear storage button
      const clearStorageBtn = document.getElementById('tvm-clear-storage-btn');
      if (clearStorageBtn) {
        clearStorageBtn.onclick = () => this.clearLocalStorage();
      }
    } catch (error) {
      this.errorHandler?.handle(error, 'DebugManager Update Debug Info');
    }
  }

  async clearLocalStorage() {
    try {
      const confirmed = confirm(
        'This will clear all saved settings and data for Viewer Metrics.\n\n' +
        'This includes:\n' +
        '• All configuration settings\n' +
        '• Saved authentication data\n' +
        '• Any cached viewer data\n\n' +
        'The extension will reset to default settings.\n\n' +
        'Are you sure you want to continue?'
      );

      if (!confirmed) return;

      // Clear all Chrome storage for this extension
      await chrome.storage.local.clear();

      // Show confirmation
      alert('Local storage cleared successfully!\n\nThe page will reload to apply changes.');

      // Reload the page to reset everything
      window.location.reload();

    } catch (error) {
      console.error('Failed to clear local storage:', error);
      alert('Failed to clear local storage. Check console for details.');
      this.errorHandler?.handle(error, 'DebugManager Clear Local Storage');
    }
  }

  async getSystemInfo() {
    try {
      return {
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        extensionVersion: chrome.runtime.getManifest?.()?.version || 'unknown'
      };
    } catch (error) {
      this.errorHandler?.handle(error, 'DebugManager Get System Info');
      return {};
    }
  }

  async exportDebugData() {
    try {
      const debugInfo = await this.dataManager.getDebugInfo();
      const systemInfo = await this.getSystemInfo();
      const config = this.settingsManager.get();

      const exportData = {
        timestamp: new Date().toISOString(),
        systemInfo,
        debugInfo,
        config: {
          // Only export non-sensitive config data
          requestInterval: config.requestInterval,
          timeoutDuration: config.timeoutDuration,
          maxHistoryPoints: config.maxHistoryPoints,
          pageSize: config.pageSize,
          refreshInterval: config.refreshInterval
        }
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `twitch-viewer-metrics-debug-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

    } catch (error) {
      this.errorHandler?.handle(error, 'DebugManager Export Debug Data');
      alert('Failed to export debug data. Check console for details.');
    }
  }
}

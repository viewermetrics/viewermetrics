// Centralized error handling and logging
window.ErrorHandler = class ErrorHandler {
  constructor() {
    this.errors = [];
    this.maxErrors = 100;
  }

  handle(error, context = '', data = null) {
    // Ignore errors caused by extension context invalidation (extension reload/update)
    if (this.isExtensionContextInvalidated(error)) {
      console.log(`[${context}] Extension context invalidated - extension likely reloading`);
      return;
    }

    const errorInfo = {
      message: error.message,
      stack: error.stack,
      context,
      data,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    this.errors.push(errorInfo);

    // Keep only recent errors
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }

    // Log to console for debugging
    console.error(`[${context}]`, error, data);

    // Store error for debugging
    this.reportError(errorInfo);
  }

  isExtensionContextInvalidated(error) {
    const message = error?.message || '';
    return message.includes('Extension context invalidated') ||
      message.includes('message port closed') ||
      message.includes('Cannot access');
  }

  async reportError(errorInfo) {
    try {
      const stored = await chrome.storage.local.get('errorLog');
      const errorLog = stored.errorLog || [];
      errorLog.push(errorInfo);

      // Keep only last 50 errors
      if (errorLog.length > 50) {
        errorLog.splice(0, errorLog.length - 50);
      }

      await chrome.storage.local.set({ errorLog });
    } catch (e) {
      console.error('Failed to store error log:', e);
    }
  }

  getRecentErrors(count = 10) {
    return this.errors.slice(-count);
  }

  async getStoredErrors() {
    try {
      const stored = await chrome.storage.local.get('errorLog');
      return stored.errorLog || [];
    } catch (e) {
      console.error('Failed to get stored errors:', e);
      return [];
    }
  }

  clear() {
    this.errors = [];
    chrome.storage.local.remove('errorLog');
  }

  // Wrapper for safe async operations
  async safe(operation, context = '') {
    try {
      return await operation();
    } catch (error) {
      this.handle(error, context);
      throw error;
    }
  }

  // Wrapper for safe sync operations
  safeSync(operation, context = '') {
    try {
      return operation();
    } catch (error) {
      this.handle(error, context);
      throw error;
    }
  }
}

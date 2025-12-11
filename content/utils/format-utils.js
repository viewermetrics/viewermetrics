// Format utilities for consistent formatting across components
window.FormatUtils = class FormatUtils {
  static formatDuration(ms) {
    if (ms === undefined || ms === null || isNaN(ms) || ms < 0) {
      return '0s';
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  static formatPercentage(percentage) {
    return Math.round(percentage).toString();
  }

  static capitalizeUsername(username) {
    if (!username) return '';
    return username.charAt(0).toUpperCase() + username.slice(1);
  }

  static formatCreatedDate(createdAt) {
    if (!createdAt) return 'Unknown';
    const date = new Date(createdAt);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  static formatDateTime(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  static formatCreatedDateShort(createdAt) {
    if (!createdAt) return '-';
    const date = new Date(createdAt);
    const day = date.getDate();
    const month = date.toLocaleDateString(undefined, { month: 'short' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  }

  static formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  static formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
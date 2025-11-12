// Unified Settings Manager - Simplified and centralized configuration management
window.SettingsManager = class SettingsManager {
    // Define settings schema with defaults, validation, and metadata in one place
    static SCHEMA = {
        // API Settings
        requestInterval: {
            default: 5000,
            min: 1000,
            max: 60000,
            type: 'number',
            unit: 'ms',
            uiUnit: 's',
            convert: (val, toUI) => toUI ? val / 1000 : val * 1000,
            description: 'API request interval'
        },
        timeoutDuration: {
            default: 600000,
            min: 300000,
            max: 3600000,
            type: 'number',
            unit: 'ms',
            uiUnit: 'min',
            convert: (val, toUI) => toUI ? val / 60000 : val * 60000,
            description: 'Viewer timeout duration'
        },
        maxRetries: {
            default: 3,
            min: 1,
            max: 10,
            type: 'number',
            description: 'Max API retry attempts'
        },
        retryDelay: {
            default: 1000,
            min: 500,
            max: 5000,
            type: 'number',
            unit: 'ms',
            description: 'Retry delay'
        },

        // Processing Settings
        concurrentUserInfoBatches: {
            default: 20,
            min: 1,
            max: 50,
            type: 'number',
            description: 'Concurrent user info batches'
        },
        concurrentThreshold: {
            default: 1000,
            min: 100,
            max: 10000,
            type: 'number',
            description: 'Threshold for concurrent processing'
        },

        // Feature Flags
        useGraphQLUserBasic: {
            default: true,
            type: 'boolean',
            description: 'Use GraphQL for user info'
        },
        autoAdjustTimeout: {
            default: true,
            type: 'boolean',
            description: 'Auto-adjust timeout based on viewer count'
        },
        autoAdjustRequestInterval: {
            default: true,
            type: 'boolean',
            description: 'Auto-adjust request interval based on viewer count'
        },
        autoPauseGraphsOnZeroViewers: {
            default: true,
            type: 'boolean',
            description: 'Auto-pause graphs when no viewers'
        },
        autoPauseDelay: {
            default: 300000,
            min: 60000,
            max: 600000,
            type: 'number',
            unit: 'ms',
            uiUnit: 'min',
            convert: (val, toUI) => toUI ? val / 60000 : val * 60000,
            description: 'Delay before auto-pausing graphs'
        },
        cleanGraphZeroData: {
            default: true,
            type: 'boolean',
            description: 'Clean zero data from graph start'
        },

        // Bot Detection Settings
        botPreDateRangeStart: {
            default: '2018-01-01',
            type: 'date',
            description: 'Bot pre-detection date range start'
        },
        botDateRangeStart: {
            default: '2021-01-01',
            type: 'date',
            description: 'Bot detection date range start'
        },
        botDateRangeMonthsFromNow: {
            default: 2,
            min: 0,
            max: 12,
            type: 'number',
            description: 'Ignore recent accounts (months from now)'
        },

        // Data Management
        maxHistoryPoints: {
            default: 360,
            min: 100,
            max: 1440,
            type: 'number',
            description: 'Max history data points'
        },
        maxViewerListSize: {
            default: 250000,
            min: 1000,
            max: 500000,
            type: 'number',
            description: 'Max viewer list size'
        },
        cleanupInterval: {
            default: 60000,
            min: 10000,
            max: 300000,
            type: 'number',
            unit: 'ms',
            description: 'Data cleanup interval'
        },
        stuckRequestThreshold: {
            default: 600000,
            min: 60000,
            max: 1800000,
            type: 'number',
            unit: 'ms',
            description: 'Stuck request threshold'
        },
        maxApiAttempts: {
            default: 5,
            min: 1,
            max: 10,
            type: 'number',
            description: 'Max API retry attempts per request'
        },

        // UI Settings
        pageSize: {
            default: 100,
            min: 10,
            max: 500,
            type: 'number',
            description: 'Viewer list page size'
        },
        refreshInterval: {
            default: 500,
            min: 100,
            max: 5000,
            type: 'number',
            unit: 'ms',
            description: 'UI refresh interval'
        },
        viewerListUpdateInterval: {
            default: 15000,
            min: 5000,
            max: 60000,
            type: 'number',
            unit: 'ms',
            description: 'Viewer list update interval'
        },
        viewerListCacheTimeout: {
            default: 5000,
            min: 1000,
            max: 30000,
            type: 'number',
            unit: 'ms',
            description: 'Viewer list cache timeout'
        },

        // Chart Settings
        chartAnimationDuration: {
            default: 750,
            min: 0,
            max: 2000,
            type: 'number',
            unit: 'ms',
            description: 'Chart animation duration'
        },
        chartUpdateThrottle: {
            default: 3000,
            min: 1000,
            max: 10000,
            type: 'number',
            unit: 'ms',
            description: 'Chart update throttle interval'
        },
        chartColors: {
            default: {
                totalViewers: '#00ff88',
                authenticatedNonBots: '#ffa500',
                bots: '#9147ff',
                totalAuthenticated: '#adadb8'
            },
            type: 'object',
            validate: (colors) => {
                if (typeof colors !== 'object') return false;
                const colorRegex = /^#([0-9A-F]{3}){1,2}$/i;
                return Object.values(colors).every(c => colorRegex.test(c));
            },
            description: 'Chart color scheme'
        }
    };

    constructor(errorHandler = null) {
        this.errorHandler = errorHandler;
        this.settings = this.getDefaults();
        this.listeners = new Set();
    }

    // Get default settings from schema
    getDefaults() {
        const defaults = {};
        for (const [key, config] of Object.entries(SettingsManager.SCHEMA)) {
            defaults[key] = typeof config.default === 'object'
                ? { ...config.default }
                : config.default;
        }
        return defaults;
    }

    // Load settings from storage
    async load() {
        try {
            const stored = await chrome.storage.local.get('config');
            if (stored.config) {
                // Migrate old keys if needed
                this.migrateSettings(stored.config);
                // Merge with defaults (handles new settings added in updates)
                this.settings = { ...this.settings, ...stored.config };
                // Validate and sanitize loaded settings
                this.settings = this.validateAndSanitize(this.settings);
            }
            return true;
        } catch (error) {
            this.handleError(error, 'Failed to load settings');
            return false;
        }
    }

    // Save settings to storage
    async save() {
        try {
            await chrome.storage.local.set({ config: this.settings });
            this.notifyListeners();
            return true;
        } catch (error) {
            this.handleError(error, 'Failed to save settings');
            return false;
        }
    }

    // Get setting value(s)
    get(key = null) {
        if (key === null) return { ...this.settings };
        return this.settings[key];
    }

    // Update one or more settings
    async update(updates) {
        const oldSettings = { ...this.settings };

        // Validate and sanitize updates
        const validatedUpdates = this.validateAndSanitize(updates);

        // Apply updates
        this.settings = { ...this.settings, ...validatedUpdates };

        // Save to storage
        await this.save();

        return { oldSettings, newSettings: { ...this.settings } };
    }

    // Validate and sanitize settings
    validateAndSanitize(settings) {
        const sanitized = {};

        for (const [key, value] of Object.entries(settings)) {
            const schema = SettingsManager.SCHEMA[key];

            // Skip unknown settings (backward compatibility)
            if (!schema) {
                console.warn(`Unknown setting: ${key}`);
                continue;
            }

            // Type validation and sanitization
            let cleanValue = value;

            switch (schema.type) {
                case 'number':
                    cleanValue = parseInt(value);
                    if (isNaN(cleanValue)) {
                        console.warn(`Invalid number for ${key}, using default`);
                        cleanValue = schema.default;
                    }
                    // Clamp to min/max if defined
                    if (schema.min !== undefined) cleanValue = Math.max(schema.min, cleanValue);
                    if (schema.max !== undefined) cleanValue = Math.min(schema.max, cleanValue);
                    break;

                case 'boolean':
                    cleanValue = Boolean(value);
                    break;

                case 'date':
                    const date = new Date(value);
                    if (isNaN(date.getTime())) {
                        console.warn(`Invalid date for ${key}, using default`);
                        cleanValue = schema.default;
                    } else {
                        cleanValue = value; // Keep as string
                    }
                    break;

                case 'object':
                    if (schema.validate && !schema.validate(value)) {
                        console.warn(`Invalid object for ${key}, using default`);
                        cleanValue = typeof schema.default === 'object'
                            ? { ...schema.default }
                            : schema.default;
                    } else {
                        cleanValue = typeof value === 'object' ? { ...value } : schema.default;
                    }
                    break;
            }

            sanitized[key] = cleanValue;
        }

        return sanitized;
    }

    // Validate a single setting
    validate(key, value) {
        const schema = SettingsManager.SCHEMA[key];
        if (!schema) return { valid: false, error: 'Unknown setting' };

        // Type check
        if (schema.type === 'number') {
            const num = parseInt(value);
            if (isNaN(num)) return { valid: false, error: 'Must be a number' };
            if (schema.min !== undefined && num < schema.min) {
                return { valid: false, error: `Must be at least ${schema.min}` };
            }
            if (schema.max !== undefined && num > schema.max) {
                return { valid: false, error: `Must be at most ${schema.max}` };
            }
        } else if (schema.type === 'boolean') {
            if (typeof value !== 'boolean') {
                return { valid: false, error: 'Must be true or false' };
            }
        } else if (schema.type === 'date') {
            const date = new Date(value);
            if (isNaN(date.getTime())) {
                return { valid: false, error: 'Invalid date format' };
            }
        } else if (schema.type === 'object' && schema.validate) {
            if (!schema.validate(value)) {
                return { valid: false, error: 'Invalid object format' };
            }
        }

        return { valid: true };
    }

    // Convert setting value for UI display (e.g., ms to seconds)
    toUI(key, value = null) {
        const schema = SettingsManager.SCHEMA[key];
        if (!schema) return value;

        const actualValue = value !== null ? value : this.settings[key];

        if (schema.convert) {
            return schema.convert(actualValue, true);
        }

        return actualValue;
    }

    // Convert UI value to internal format (e.g., seconds to ms)
    fromUI(key, uiValue) {
        const schema = SettingsManager.SCHEMA[key];
        if (!schema) return uiValue;

        if (schema.convert) {
            return schema.convert(uiValue, false);
        }

        return uiValue;
    }

    // Auto-adjust timeout based on viewer count
    calculateAutoTimeout(totalAuthenticatedCount) {
        if (!this.settings.autoAdjustTimeout || !totalAuthenticatedCount) {
            return this.settings.timeoutDuration;
        }

        // Base: 5 minutes, add 1 minute per 1000 viewers over 5000
        let timeoutMinutes = 5;
        if (totalAuthenticatedCount > 5000) {
            timeoutMinutes += Math.floor((totalAuthenticatedCount - 5000) / 1000);
        }

        return timeoutMinutes * 60000; // Convert to ms
    }

    // Auto-adjust request interval based on viewer count
    calculateAutoRequestInterval(totalAuthenticatedCount) {
        if (!this.settings.autoAdjustRequestInterval || !totalAuthenticatedCount) {
            return this.settings.requestInterval;
        }

        // < 500: 5s, < 1000: 2s, >= 1000: 1s
        if (totalAuthenticatedCount < 500) return 5000;
        if (totalAuthenticatedCount < 1000) return 2000;
        return 1000;
        if (totalAuthenticatedCount < 500) return 5000;
        if (totalAuthenticatedCount < 1000) return 2000;
        return 1000;
    }

    // Reset to defaults
    async resetToDefaults() {
        const oldSettings = { ...this.settings };
        this.settings = this.getDefaults();
        await this.save();
        return { oldSettings, newSettings: { ...this.settings } };
    }

    // Export settings
    export() {
        return {
            version: '3.0.0',
            timestamp: new Date().toISOString(),
            settings: { ...this.settings }
        };
    }

    // Import settings
    async import(data) {
        try {
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }

            if (!data.settings || typeof data.settings !== 'object') {
                throw new Error('Invalid settings format');
            }

            // Validate and update
            await this.update(data.settings);

            return { success: true, imported: data.timestamp || 'Unknown' };
        } catch (error) {
            this.handleError(error, 'Failed to import settings');
            return { success: false, error: error.message };
        }
    }

    // Subscribe to setting changes
    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback); // Return unsubscribe function
    }

    unsubscribe(callback) {
        this.listeners.delete(callback);
    }

    notifyListeners() {
        this.listeners.forEach(callback => {
            try {
                callback(this.settings);
            } catch (error) {
                console.error('Settings listener error:', error);
            }
        });
    }

    // Migrate old setting keys/values
    migrateSettings(settings) {
        // Migrate old chart color keys
        if (settings.chartColors) {
            if (settings.chartColors.authenticatedUsers && !settings.chartColors.authenticatedNonBots) {
                settings.chartColors.authenticatedNonBots = settings.chartColors.authenticatedUsers;
                delete settings.chartColors.authenticatedUsers;
            }
        }

        // Add more migrations as needed
    }

    // Error handling helper
    handleError(error, context) {
        console.error(`[SettingsManager] ${context}:`, error);
        if (this.errorHandler) {
            this.errorHandler.handle(error, `SettingsManager: ${context}`);
        }
    }

    // Get human-readable settings summary
    getSummary() {
        const summary = {};
        for (const [key, value] of Object.entries(this.settings)) {
            const schema = SettingsManager.SCHEMA[key];
            if (!schema) continue;

            let displayValue = value;
            if (schema.convert) {
                displayValue = schema.convert(value, true);
            }

            const unit = schema.uiUnit || schema.unit || '';
            summary[schema.description || key] = unit ? `${displayValue} ${unit}` : displayValue;
        }
        return summary;
    }
}

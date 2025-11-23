// Settings UI Helper - Simplified form management
window.SettingsUI = class SettingsUI {
    constructor(settingsManager, statsManager, apiClient, errorHandler) {
        this.settings = settingsManager;
        this.stats = statsManager;
        this.api = apiClient;
        this.errorHandler = errorHandler;
    }

    // Load all settings into UI form
    async loadForm() {
        try {
            const config = this.settings.get();

            // Load each setting into corresponding input
            this.setValue('tvm-interval', this.settings.toUI('requestInterval'));
            this.setValue('tvm-timeout', this.settings.toUI('timeoutDuration'));
            this.setChecked('tvm-auto-adjust-timeout', config.autoAdjustTimeout);
            this.setChecked('tvm-auto-adjust-request-interval', config.autoAdjustRequestInterval);
            this.setChecked('tvm-auto-pause-graphs', config.autoPauseGraphsOnZeroViewers);
            this.setChecked('tvm-clean-graph-zero-data', config.cleanGraphZeroData);
            this.setChecked('tvm-smooth-chart-lines', config.smoothChartLines);
            this.setValue('tvm-history-retention', config.historyRetentionHours);

            // Disable inputs if auto-adjust is enabled
            this.toggleInput('tvm-timeout', config.autoAdjustTimeout);
            this.toggleInput('tvm-interval', config.autoAdjustRequestInterval);

            // Update effective displays
            this.updateEffectiveDisplays();

        } catch (error) {
            this.handleError(error, 'Failed to load settings form');
        }
    }

    // Save form values to settings
    async saveForm() {
        try {
            const updates = {};

            // Collect form values
            const interval = this.getValue('tvm-interval');
            const timeout = this.getValue('tvm-timeout');

            // Validate before converting
            const intervalValidation = this.settings.validate('requestInterval', this.settings.fromUI('requestInterval', interval));
            if (!intervalValidation.valid) {
                alert(`Request Interval: ${intervalValidation.error}`);
                return false;
            }

            const timeoutValidation = this.settings.validate('timeoutDuration', this.settings.fromUI('timeoutDuration', timeout));
            if (!timeoutValidation.valid) {
                alert(`Timeout Duration: ${timeoutValidation.error}`);
                return false;
            }

            // Build updates object with converted values
            updates.requestInterval = this.settings.fromUI('requestInterval', interval);
            updates.timeoutDuration = this.settings.fromUI('timeoutDuration', timeout);
            updates.autoAdjustTimeout = this.getChecked('tvm-auto-adjust-timeout');
            updates.autoAdjustRequestInterval = this.getChecked('tvm-auto-adjust-request-interval');
            updates.autoPauseGraphsOnZeroViewers = this.getChecked('tvm-auto-pause-graphs');
            updates.cleanGraphZeroData = this.getChecked('tvm-clean-graph-zero-data');
            updates.smoothChartLines = this.getChecked('tvm-smooth-chart-lines');
            updates.historyRetentionHours = parseInt(this.getValue('tvm-history-retention')) || 12;

            // Save settings
            await this.settings.update(updates);

            // Update background tracking if active
            if (this.api && this.api.isTracking()) {
                try {
                    await this.api.updateTrackingConfig(updates);
                } catch (error) {
                    console.error('Failed to update background tracking config:', error);
                }
            }

            // Update displays
            this.updateEffectiveDisplays();

            alert('Settings saved successfully!');
            return true;

        } catch (error) {
            this.handleError(error, 'Failed to save settings');
            alert('Failed to save settings. Please try again.');
            return false;
        }
    }

    // Reset form to default values
    async resetForm() {
        try {
            const defaults = this.settings.getDefaults();

            // Update UI with defaults (don't save yet)
            this.setValue('tvm-interval', this.settings.toUI('requestInterval', defaults.requestInterval));
            this.setValue('tvm-timeout', this.settings.toUI('timeoutDuration', defaults.timeoutDuration));
            this.setChecked('tvm-auto-adjust-timeout', defaults.autoAdjustTimeout);
            this.setChecked('tvm-auto-adjust-request-interval', defaults.autoAdjustRequestInterval);
            this.setChecked('tvm-auto-pause-graphs', defaults.autoPauseGraphsOnZeroViewers);
            this.setChecked('tvm-clean-graph-zero-data', defaults.cleanGraphZeroData);
            this.setChecked('tvm-smooth-chart-lines', defaults.smoothChartLines);
            this.setValue('tvm-history-retention', defaults.historyRetentionHours);

            // Toggle inputs
            this.toggleInput('tvm-timeout', defaults.autoAdjustTimeout);
            this.toggleInput('tvm-interval', defaults.autoAdjustRequestInterval);

            // Update displays
            this.updateEffectiveDisplays();

            // Visual feedback
            this.showButtonFeedback('tvm-reset-settings', 'Defaults Loaded', '#00ff88');

        } catch (error) {
            this.handleError(error, 'Failed to reset form');
        }
    }

    // Setup event listeners for form
    setupEventListeners() {
        try {
            // Auto-adjust checkboxes
            this.addListener('tvm-auto-adjust-timeout', 'change', (e) => {
                this.toggleInput('tvm-timeout', e.target.checked);
                this.updateEffectiveDisplays();
            });

            this.addListener('tvm-auto-adjust-request-interval', 'change', (e) => {
                this.toggleInput('tvm-interval', e.target.checked);
                this.updateEffectiveDisplays();
            });

            // Save/Reset buttons
            this.addListener('tvm-save-settings', 'click', () => this.saveForm());
            this.addListener('tvm-reset-settings', 'click', () => this.resetForm());

        } catch (error) {
            this.handleError(error, 'Failed to setup event listeners');
        }
    }

    // Update effective timeout/interval displays
    updateEffectiveDisplays() {
        if (this.stats) {
            this.stats.updateEffectiveTimeoutDisplay();
            this.stats.updateEffectiveRequestIntervalDisplay();
        }
    }

    // Helper: Get element value
    getValue(id) {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value) : null;
    }

    // Helper: Set element value
    setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    // Helper: Get checkbox state
    getChecked(id) {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    }

    // Helper: Set checkbox state
    setChecked(id, checked) {
        const el = document.getElementById(id);
        if (el) el.checked = checked;
    }

    // Helper: Toggle input enabled/disabled state
    toggleInput(id, disabled) {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disabled;
            el.style.opacity = disabled ? '0.5' : '1';
            el.style.cursor = disabled ? 'not-allowed' : '';
        }
    }

    // Helper: Add event listener
    addListener(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    // Helper: Show button feedback
    showButtonFeedback(id, text, color, duration = 1500) {
        const btn = document.getElementById(id);
        if (!btn) return;

        const originalText = btn.textContent;
        const originalColor = btn.style.backgroundColor;

        btn.textContent = text;
        btn.style.backgroundColor = color;

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = originalColor;
        }, duration);
    }

    // Error handling
    handleError(error, context) {
        console.error(`[SettingsUI] ${context}:`, error);
        if (this.errorHandler) {
            this.errorHandler.handle(error, `SettingsUI: ${context}`);
        }
    }
}

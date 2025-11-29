// Heatmap Chart component for time spent in stream visualization
window.HeatmapChart = class HeatmapChart {
    constructor(dataManager, settingsManager, errorHandler, channelName = null) {
        this.dataManager = dataManager;
        this.settingsManager = settingsManager;
        this.errorHandler = errorHandler;
        this.channelName = channelName;
        this.chart = null;
        this.filteredMonth = null; // Track which month is selected for stats filtering
        this.retentionThresholdMinutes = 5; // Default 5 minutes, adjustable via slider (5-20 range)
        this.botCalculationType = 0; // 0 = Normal, 1 = High Churn
        this.summarySkipMinutes = 5; // Default 5 minutes, adjustable via slider (0-20 range)
    }

    setBotCalculationType(type) {
        this.botCalculationType = type;
        this.updateStreamStats();
    }

    setChannelName(channelName) {
        this.channelName = channelName;
        if (this.chart) {
            this.chart.update('none');
        }
    }

    resize() {
        try {
            if (this.chart) {
                this.chart.resize();
            }
        } catch (error) {
            console.error('Error resizing heatmap chart:', error);
        }
    }

    async init() {
        const ctx = document.getElementById('tvm-heatmap-graph');
        if (!ctx) {
            throw new Error('Heatmap chart canvas not found');
        }

        const config = this.settingsManager.get();
        const colors = config.chartColors;

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [], // Will be month labels
                datasets: [] // Will create one dataset per time bucket
            },
            options: {
                indexAxis: 'x', // Vertical bars
                responsive: true,
                maintainAspectRatio: false,
                animation: false, // Disable animations for better performance
                interaction: {
                    mode: 'nearest',
                    intersect: true
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const element = elements[0];
                        const monthLabel = this.chart.data.labels[element.index];
                        this.filterStatsByMonth(monthLabel);
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Account Creation Month',
                            color: '#adadb8',
                            font: { size: 12, weight: '600' }
                        },
                        ticks: {
                            color: '#adadb8',
                            font: { size: 10 },
                            maxRotation: 0,
                            minRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        },
                        grid: {
                            display: false,
                            drawBorder: false
                        }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        min: 0,
                        stacked: true,
                        title: {
                            display: true,
                            text: 'Time Spent in Stream (minutes)',
                            color: '#adadb8',
                            font: { size: 12, weight: '600' }
                        },
                        ticks: {
                            color: '#adadb8',
                            font: { size: 11 },
                            stepSize: 1,
                            precision: 0,
                            callback: function (value) {
                                // Only show integer values
                                if (!Number.isInteger(value)) return '';

                                if (value >= 60) {
                                    const hours = Math.floor(value / 60);
                                    const mins = value % 60;
                                    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
                                }
                                return `${value}m`;
                            }
                        },
                        grid: {
                            display: false,
                            drawBorder: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(24, 24, 27, 0.95)',
                        titleColor: '#efeff1',
                        bodyColor: '#efeff1',
                        borderColor: '#2e2e35',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            title: function (context) {
                                const monthLabel = context[0].label;
                                return monthLabel;
                            },
                            label: function (context) {
                                const datasetIndex = context.datasetIndex;
                                const dataIndex = context.dataIndex;
                                const dataset = context.chart.data.datasets[datasetIndex];
                                const metadata = dataset.metadata?.[dataIndex];

                                if (!metadata || metadata.count === 0) return null;

                                const count = metadata.count;
                                const time = metadata.time;
                                const hours = Math.floor(time / 60);
                                const mins = time % 60;
                                const timeStr = hours > 0 ?
                                    (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`) :
                                    `${mins}m`;

                                return [
                                    `${count} viewer${count !== 1 ? 's' : ''}`,
                                    `Time: ${timeStr}`
                                ];
                            }
                        }
                    }
                }
            }
        });

        this.update();

        // Setup summary skip threshold slider
        this.setupSummarySkipSlider();
    }

    setupSummarySkipSlider() {
        const slider = document.getElementById('tvm-summary-skip-slider');
        const label = document.getElementById('tvm-summary-skip-label');

        if (!slider || !label) return;

        slider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.summarySkipMinutes = value;
            label.textContent = `After ${value}m`;
            this.updateStreamStats();
        });
    }

    update() {
        if (!this.chart) return;

        try {
            const heatmapData = this.dataManager.getHeatmapData();

            if (!heatmapData || heatmapData.length === 0) {
                this.chart.data.labels = [];
                this.chart.data.datasets = [];
                this.chart.update('none');
                return;
            }

            // Get ALL unique months from data (including empty placeholder months)
            // Sort them in chronological order, then reverse for display (most recent at top)
            const months = [...new Set(heatmapData.map(d => d.month))].sort().reverse();

            // Convert month labels to 3-letter format (e.g., "2024-11" -> "Nov 2024")
            const monthLabels = months.map(monthKey => {
                const [year, month] = monthKey.split('-');
                const date = new Date(year, parseInt(month) - 1);
                const monthName = date.toLocaleString('en-US', { month: 'short' });
                return `${monthName} ${year}`;
            });

            // Find max count for color scaling
            const maxCount = Math.max(...heatmapData.map(d => d.count));

            // Get all unique time values and find the maximum
            const uniqueTimes = [...new Set(heatmapData.map(d => d.time))].sort((a, b) => a - b);
            const maxTime = Math.max(...uniqueTimes);

            // Create lookup map for O(1) access instead of O(n) find()
            const dataLookup = new Map();
            for (const item of heatmapData) {
                const key = `${item.month}-${item.time}`;
                dataLookup.set(key, item);
            }

            // Determine grouping interval from data (check spacing between values)
            let groupingInterval = 1;
            if (uniqueTimes.length >= 2) {
                const spacing = uniqueTimes[1] - uniqueTimes[0];
                if (spacing > 1) {
                    groupingInterval = spacing;
                }
            }

            // Use only the actual time values from the data (no padding, no gaps)
            const allTimes = uniqueTimes;

            // Create a dataset for each time bucket (stacked vertically)
            // Each dataset represents one time segment stacked across all months
            const datasets = [];

            for (let i = 0; i < allTimes.length; i++) {
                const time = allTimes[i];
                const dataForTime = months.map(month => {
                    const item = dataLookup.get(`${month}-${time}`);
                    if (item) {
                        const intensity = item.count / maxCount;
                        return {
                            value: groupingInterval, // Each segment has height of groupingInterval
                            count: item.count,
                            time: time,
                            month: month,
                            intensity: intensity
                        };
                    }
                    // No data for this month at this time - use transparent but maintain spacing
                    return { value: groupingInterval, count: 0, time: time, month: month };
                });

                datasets.push({
                    label: `${time}m`,
                    data: dataForTime.map(d => d.value),
                    backgroundColor: dataForTime.map(d => d.count > 0 ? this.getHeatColor(d.intensity) : 'rgba(0,0,0,0)'),
                    borderColor: 'transparent',
                    borderWidth: 0,
                    borderSkipped: false,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0,
                    // Store metadata for tooltips
                    metadata: dataForTime
                });
            }

            // Update chart data
            this.chart.data.labels = monthLabels;
            this.chart.data.datasets = datasets;

            // Set y-axis max to the cumulative height
            let maxY = allTimes.length * groupingInterval;
            this.chart.options.scales.y.max = maxY;

            // Update y-axis to show actual time values
            // Create custom ticks at the actual time value positions
            const customTicks = allTimes.map((time, i) => {
                // Calculate position: sum of all previous segments, plus half of current segment
                let position = i * groupingInterval + (groupingInterval / 2);
                return position;
            });

            this.chart.options.scales.y.ticks.callback = function (value, index, ticks) {
                // Find which time value this tick represents
                for (let i = 0; i < customTicks.length; i++) {
                    if (Math.abs(value - customTicks[i]) < 0.01) {
                        const time = allTimes[i];
                        if (time >= 60) {
                            const hours = Math.floor(time / 60);
                            const mins = time % 60;
                            return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
                        }
                        return `${time}m`;
                    }
                }
                return '';
            };

            // Override auto ticks to use our custom positions
            this.chart.options.scales.y.afterBuildTicks = function (scale) {
                scale.ticks = customTicks.map((position, i) => ({
                    value: position,
                    label: allTimes[i]
                }));
            };

            // Update viewer duration stats
            this.updateViewerStats(heatmapData, uniqueTimes, groupingInterval, this.filteredMonth);

            // Update stream stats from history
            this.updateStreamStats();

            this.chart.update('none');
        } catch (error) {
            this.errorHandler?.handle(error, 'Heatmap Chart Update');
        }
    }

    // Generate heat color based on intensity (0-1)
    getHeatColorGradient(intensity) {
        // Clamp intensity to 0-1 range
        intensity = Math.max(0, Math.min(1, intensity));

        // Linear interpolation between cold and hot colors
        const coldColor = { r: 32, g: 14, b: 56 };   // Coldest: dark grayish
        const hotColor = { r: 145, g: 71, b: 255 };  // Hot: bot graph purple #9147ff

        // Interpolate RGB values directly
        const r = Math.round(coldColor.r + (hotColor.r - coldColor.r) * intensity);
        const g = Math.round(coldColor.g + (hotColor.g - coldColor.g) * intensity);
        const b = Math.round(coldColor.b + (hotColor.b - coldColor.b) * intensity);

        return `rgba(${r}, ${g}, ${b}, 1)`;
    }

    // Old stepped color gradient (kept for fallback)
    getHeatColor(intensity) {
        // Clamp intensity to 0-1 range
        intensity = Math.max(0, Math.min(1, intensity));

        // Define color gradient stops
        // From dark grayish-purple (cold) to bright bot purple #9147ff (hot)
        const colorStops = [
            { intensity: 0.0, r: 32, g: 14, b: 56 },   // Coldest: dark grayish
            { intensity: 0.2, r: 60, g: 30, b: 100 },  // Very cold: very dark purple
            { intensity: 0.5, r: 100, g: 50, b: 160 }, // Cold: dark purple
            { intensity: 0.7, r: 120, g: 60, b: 200 }, // Warm: medium purple
            { intensity: 1.0, r: 145, g: 71, b: 255 }  // Hot: bot graph purple #9147ff
        ];

        // Find the two color stops to interpolate between
        let lowerStop = colorStops[0];
        let upperStop = colorStops[colorStops.length - 1];

        for (let i = 0; i < colorStops.length - 1; i++) {
            if (intensity >= colorStops[i].intensity && intensity <= colorStops[i + 1].intensity) {
                lowerStop = colorStops[i];
                upperStop = colorStops[i + 1];
                break;
            }
        }

        // Calculate the interpolation factor between the two stops
        const range = upperStop.intensity - lowerStop.intensity;
        const factor = range === 0 ? 0 : (intensity - lowerStop.intensity) / range;

        // Interpolate RGB values
        const r = Math.round(lowerStop.r + (upperStop.r - lowerStop.r) * factor);
        const g = Math.round(lowerStop.g + (upperStop.g - lowerStop.g) * factor);
        const b = Math.round(lowerStop.b + (upperStop.b - lowerStop.b) * factor);

        return `rgba(${r}, ${g}, ${b}, 1)`;
    }

    updateViewerStats(heatmapData, uniqueTimes, groupingInterval, filterMonth = null) {
        const statsContent = document.getElementById('tvm-heatmap-stats-content');
        const statsTitle = document.getElementById('tvm-heatmap-stats-title');
        const resetButton = document.getElementById('tvm-heatmap-stats-reset');
        const botStatsPanel = document.getElementById('tvm-bot-duration-stats');
        const botStatsContent = document.getElementById('tvm-bot-duration-stats-content');
        if (!statsContent) return;

        // Get bot data from creation chart (current view - live or historical)
        const accountGraphData = this.getCurrentAccountGraphData();
        const bottedMonths = new Set();
        let hasBottedMonths = false;

        if (accountGraphData && accountGraphData.length > 0) {
            accountGraphData.forEach(monthData => {
                if (monthData.bots > 0) {
                    bottedMonths.add(monthData.month);
                    hasBottedMonths = true;
                }
            });
        }

        // Filter data by month if specified
        let filteredData = heatmapData;
        if (filterMonth) {
            // Convert month label (e.g., "Nov 2024") to month key (e.g., "2024-11")
            const monthKey = this.monthLabelToKey(filterMonth);
            filteredData = heatmapData.filter(item => item.month === monthKey);
        } else {
            // Exclude botted months from regular viewer stats (only when not filtering by specific month)
            filteredData = heatmapData.filter(item => !bottedMonths.has(item.month));
        }

        // Update title and reset button
        if (statsTitle) {
            statsTitle.textContent = filterMonth ? filterMonth : 'Viewer Duration';
        }
        if (resetButton) {
            resetButton.style.display = filterMonth ? 'block' : 'none';
        }

        // Calculate viewer counts for each time bucket
        // Sum all viewers AT each specific time value across selected month(s)
        const timeBuckets = new Map();

        for (const time of uniqueTimes) {
            // Sum all viewers at exactly this time value
            let totalViewers = 0;
            for (const item of filteredData) {
                if (item.time === time) {
                    totalViewers += item.count;
                }
            }
            // Always add to map, even if 0
            timeBuckets.set(time, totalViewers);
        }

        // Convert to array and sort by time (descending - highest first)
        const bucketArray = Array.from(timeBuckets.entries())
            .sort((a, b) => b[0] - a[0]);

        // Generate HTML for stats
        let html = '';
        if (bucketArray.length === 0) {
            html = '<div style="color: #adadb8; text-align: center;">No data</div>';
        } else {
            // Find max value for scaling bars (excluding 0 values)
            const maxViewers = Math.max(...bucketArray.filter(([_, count]) => count > 0).map(([_, count]) => count));

            for (const [time, count] of bucketArray) {
                const percentage = count > 0 && maxViewers > 0 ? (count / maxViewers) * 100 : 0;
                const hours = Math.floor(time / 60);
                const mins = time % 60;
                const timeLabel = hours > 0
                    ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`)
                    : `${mins}m`;

                // Show colored bar if percentage >= 1%, empty bar if count is 0, otherwise empty
                let barHtml = '';
                if (count === 0) {
                    barHtml = '<div class="tvm-stats-bar" style="width: 100%; background: #0e0e10;"></div>';
                } else if (percentage >= 1) {
                    barHtml = `<div class="tvm-stats-bar" style="width: ${percentage}%;"></div>`;
                }

                html += `
                    <div class="tvm-stats-row">
                        <div class="tvm-stats-label">${timeLabel}</div>
                        <div class="tvm-stats-bar-container">
                            ${barHtml}
                        </div>
                        <div class="tvm-stats-value">${count > 0 ? count : ''}</div>
                    </div>
                `;
            }
        }

        statsContent.innerHTML = html;

        // Remove existing Total Authenticated element if present
        const existingTotal = statsContent.parentElement.querySelector('.tvm-heatmap-total-auth');
        if (existingTotal) {
            existingTotal.remove();
        }

        // Use instance retention threshold (adjustable via slider)
        const retentionThresholdMinutes = this.retentionThresholdMinutes;

        // Only add retention bar if we have data
        if (bucketArray.length > 0 && filteredData.length > 0) {
            // Add User Retention bar at bottom
            const totalAuthenticated = filteredData.reduce((sum, item) => sum + item.count, 0);

            // Calculate counts for under and over threshold using filtered data
            let underThresholdCount = 0;
            let overThresholdCount = 0;

            for (const item of filteredData) {
                // item.time is already the bucketed time in minutes
                // Use < so that only buckets below the threshold are counted as "under"
                if (item.time < retentionThresholdMinutes) {
                    underThresholdCount += item.count;
                } else {
                    overThresholdCount += item.count;
                }
            }

            // Calculate percentages
            const underPercent = totalAuthenticated > 0 ? Math.round((underThresholdCount / totalAuthenticated) * 100) : 0;
            const overPercent = totalAuthenticated > 0 ? Math.round((overThresholdCount / totalAuthenticated) * 100) : 0;

            // Create retention bar element
            const retentionElement = document.createElement('div');
            retentionElement.className = 'tvm-heatmap-total-auth';
            retentionElement.innerHTML = `
                <div style="margin-bottom: 6px; font-size: 12px; color: #adadb8;">Users (${totalAuthenticated.toLocaleString()} total)</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="font-size: 11px; color: #adadb8; white-space: nowrap;">&lt;${retentionThresholdMinutes}m</div>
                    <div class="tvm-retention-bar-container">
                        <div class="tvm-retention-bar-under" style="width: ${underPercent}%;" title="${underThresholdCount.toLocaleString()} users (${underPercent}%)"></div>
                        <div class="tvm-retention-bar-over" style="width: ${overPercent}%;" title="${overThresholdCount.toLocaleString()} users (${overPercent}%)"></div>
                    </div>
                    <div style="font-size: 11px; color: #adadb8; white-space: nowrap;">&gt;${retentionThresholdMinutes}m</div>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px;">
                    <span style="color: #772ce8;">${underPercent}%</span>
                    <span style="color: #9147ff;">${overPercent}%</span>
                </div>
                <div class="tvm-retention-slider-control">
                    <input type="range" class="tvm-retention-slider" min="0" max="2" step="1" value="${retentionThresholdMinutes === 5 ? 0 : retentionThresholdMinutes === 10 ? 1 : 2}">
                    <div class="tvm-retention-slider-label">${retentionThresholdMinutes}m threshold</div>
                </div>
            `;
            statsContent.parentElement.appendChild(retentionElement);

            // Add slider event listener
            const slider = retentionElement.querySelector('.tvm-retention-slider');
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const sliderValue = parseInt(e.target.value);
                    // Map slider position to fixed values: 0=5min, 1=10min, 2=20min
                    const thresholdValue = sliderValue === 0 ? 5 : sliderValue === 1 ? 10 : 20;
                    this.retentionThresholdMinutes = thresholdValue;
                    this.update(); // Re-render with new threshold
                });
            }
        }

        // Handle bot duration stats
        if (hasBottedMonths && !filterMonth && botStatsPanel && botStatsContent) {
            // Show bot stats panel
            botStatsPanel.style.display = 'flex';

            // Calculate bot stats from botted months only
            const botData = heatmapData.filter(item => bottedMonths.has(item.month));
            this.updateBotDurationStats(botData, uniqueTimes, retentionThresholdMinutes);
        } else {
            // Hide bot stats panel
            if (botStatsPanel) {
                botStatsPanel.style.display = 'none';
            }
        }
    }

    updateStreamStats() {
        const statsContent = document.getElementById('tvm-stream-stats-content');
        const labelElement = document.getElementById('tvm-summary-skip-label');
        const indicatorElement = document.querySelector('.tvm-stream-stats-indicator');
        if (!statsContent) return;

        // Get history data and filter out entries where viewers OR authenticated is 0
        const history = this.dataManager.getHistory();
        let validHistory = history.filter(h => h.totalViewers > 0 && h.totalAuthenticated > 0);

        if (validHistory.length === 0) {
            statsContent.innerHTML = '<div style="color: #adadb8; text-align: center;">No data</div>';
            if (indicatorElement) indicatorElement.style.display = 'none';
            return;
        }

        // Use stored skip threshold value
        const skipThresholdMinutes = this.summarySkipMinutes;

        // Filter out entries within the skip threshold time period from the start
        // Calculate the cutoff timestamp based on the first valid entry
        if (validHistory.length > 0) {
            const startTimestamp = validHistory[0].timestamp;
            const skipThresholdMs = skipThresholdMinutes * 60 * 1000;
            const cutoffTimestamp = startTimestamp + skipThresholdMs;

            validHistory = validHistory.filter(h => h.timestamp >= cutoffTimestamp);
        }

        // Update only the label text, not the entire indicator div
        if (labelElement) {
            labelElement.textContent = `After ${skipThresholdMinutes}m`;
        }
        if (indicatorElement) {
            indicatorElement.style.display = 'flex';
        }

        if (validHistory.length === 0) {
            statsContent.innerHTML = '<div style="color: #adadb8; text-align: center;">No data</div>';
            return;
        }

        // Calculate averages with calculation type support
        const avgViewers = Math.round(validHistory.reduce((sum, h) => sum + h.totalViewers, 0) / validHistory.length);
        const avgAuthenticated = Math.round(validHistory.reduce((sum, h) => sum + h.totalAuthenticated, 0) / validHistory.length);

        let avgNonBots, avgBots;
        if (this.botCalculationType === 1) {
            // High Churn mode
            avgNonBots = Math.round(validHistory.reduce((sum, h) => sum + Math.max(0, (h.accountsWithDates || 0) - (h.bots || 0)), 0) / validHistory.length);
            avgBots = Math.round(validHistory.reduce((sum, h) => sum + Math.max(0, (h.totalAuthenticated || 0) - ((h.accountsWithDates || 0) - (h.bots || 0))), 0) / validHistory.length);
        } else {
            // Normal mode
            avgNonBots = Math.round(validHistory.reduce((sum, h) => sum + h.authenticatedNonBots, 0) / validHistory.length);
            avgBots = Math.round(validHistory.reduce((sum, h) => sum + h.bots, 0) / validHistory.length);
        }

        // Recalculate max values from filtered history with calculation type support
        const maxViewers = Math.max(...validHistory.map(h => h.totalViewers));
        const maxAuthenticatedFiltered = Math.max(...validHistory.map(h => h.totalAuthenticated));

        let maxNonBots, maxBots;
        if (this.botCalculationType === 1) {
            // High Churn mode
            maxNonBots = Math.max(...validHistory.map(h => Math.max(0, (h.accountsWithDates || 0) - (h.bots || 0))));
            maxBots = Math.max(...validHistory.map(h => Math.max(0, (h.totalAuthenticated || 0) - ((h.accountsWithDates || 0) - (h.bots || 0)))));
        } else {
            // Normal mode
            maxNonBots = Math.max(...validHistory.map(h => h.authenticatedNonBots));
            maxBots = Math.max(...validHistory.map(h => h.bots));
        }

        // Calculate percentages
        const avgAuthPercent = avgViewers > 0 ? Math.round((avgAuthenticated / avgViewers) * 100) : 0;
        const avgNonBotsPercent = avgAuthenticated > 0 ? Math.round((avgNonBots / avgAuthenticated) * 100) : 0;
        const avgBotsPercent = avgAuthenticated > 0 ? Math.round((avgBots / avgAuthenticated) * 100) : 0;

        const maxAuthPercent = maxViewers > 0 ? Math.round((maxAuthenticatedFiltered / maxViewers) * 100) : 0;
        const maxNonBotsPercent = maxAuthenticatedFiltered > 0 ? Math.round((maxNonBots / maxAuthenticatedFiltered) * 100) : 0;
        const maxBotsPercent = maxAuthenticatedFiltered > 0 ? Math.round((maxBots / maxAuthenticatedFiltered) * 100) : 0;

        // Helper function to get percentage color
        const getPercentageColor = (percentage, isBotPercentage = false) => {
            if (isBotPercentage) {
                // Bot percentages: red if > 0%, gray if 0%
                if (percentage > 0) return '#ff4444';
                return '#adadb8';
            } else {
                // Authenticated/Non-Bot percentages: green if >= 80%, yellow if >= 65%, red otherwise
                if (percentage >= 80) return '#00ff88';
                if (percentage >= 65) return '#ffa500';
                return '#ff4444';
            }
        };

        // Generate HTML
        const html = `
            <div class="tvm-stream-stat-row">
                <div class="tvm-stream-stat-label">Avg Viewers</div>
                <div class="tvm-stream-stat-value">${avgViewers.toLocaleString()}</div>
            </div>
            <div class="tvm-stream-stat-row">
                <div class="tvm-stream-stat-label">Avg Authenticated</div>
                <div class="tvm-stream-stat-value">${avgAuthenticated.toLocaleString()}<span class="tvm-stream-stat-subvalue" style="color: ${getPercentageColor(avgAuthPercent)};">(${avgAuthPercent}%)</span></div>
            </div>
            <div class="tvm-stream-stat-row">
                <div class="tvm-stream-stat-label">Avg Users</div>
                <div class="tvm-stream-stat-value">${avgNonBots.toLocaleString()}<span class="tvm-stream-stat-subvalue" style="color: ${getPercentageColor(avgNonBotsPercent)};">(${avgNonBotsPercent}%)</span></div>
            </div>
            <div class="tvm-stream-stat-row">
                <div class="tvm-stream-stat-label">Avg Bots</div>
                <div class="tvm-stream-stat-value">${avgBots.toLocaleString()}<span class="tvm-stream-stat-subvalue" style="color: ${getPercentageColor(avgBotsPercent, true)};">(${avgBotsPercent}%)</span></div>
            </div>
            <div class="tvm-stream-stat-row" style="margin-top: 20px;">
                <div class="tvm-stream-stat-label">Max Viewers</div>
                <div class="tvm-stream-stat-value">${maxViewers.toLocaleString()}</div>
            </div>
            <div class="tvm-stream-stat-row">
                <div class="tvm-stream-stat-label">Max Authenticated</div>
                <div class="tvm-stream-stat-value">${maxAuthenticatedFiltered.toLocaleString()}<span class="tvm-stream-stat-subvalue" style="color: ${getPercentageColor(maxAuthPercent)};">(${maxAuthPercent}%)</span></div>
            </div>
            <div class="tvm-stream-stat-row">
                <div class="tvm-stream-stat-label">Max Users</div>
                <div class="tvm-stream-stat-value">${maxNonBots.toLocaleString()}<span class="tvm-stream-stat-subvalue" style="color: ${getPercentageColor(maxNonBotsPercent)};">(${maxNonBotsPercent}%)</span></div>
            </div>
            <div class="tvm-stream-stat-row">
                <div class="tvm-stream-stat-label">Max Bots</div>
                <div class="tvm-stream-stat-value">${maxBots.toLocaleString()}<span class="tvm-stream-stat-subvalue" style="color: ${getPercentageColor(maxBotsPercent, true)};">(${maxBotsPercent}%)</span></div>
            </div>
        `;

        statsContent.innerHTML = html;
    }

    clear() {
        if (this.chart) {
            this.chart.data.labels = [];
            this.chart.data.datasets = [];
            this.chart.update('none');
        }

        // Clear viewer duration stats
        const statsContent = document.getElementById('tvm-heatmap-stats-content');
        if (statsContent) {
            statsContent.innerHTML = '<div style="color: #adadb8; text-align: center;">No data</div>';
            // Remove total authenticated element if it exists
            const existingTotal = statsContent.parentElement.querySelector('.tvm-heatmap-total-auth');
            if (existingTotal) {
                existingTotal.remove();
            }
        }

        // Clear bot duration stats
        const botStatsPanel = document.getElementById('tvm-bot-duration-stats');
        const botStatsContent = document.getElementById('tvm-bot-duration-stats-content');
        if (botStatsPanel) {
            botStatsPanel.style.display = 'none';
        }
        if (botStatsContent) {
            botStatsContent.innerHTML = '<div style="color: #adadb8; text-align: center;">No data</div>';
            // Remove bot retention element if it exists
            const existingBotTotal = botStatsContent.parentElement?.querySelector('.tvm-heatmap-total-auth');
            if (existingBotTotal) {
                existingBotTotal.remove();
            }
        }

        // Clear stream stats
        const streamStatsContent = document.getElementById('tvm-stream-stats-content');
        if (streamStatsContent) {
            streamStatsContent.innerHTML = '<div style="color: #adadb8; text-align: center;">No data</div>';
        }

        // Reset filter
        this.filteredMonth = null;
        const statsTitle = document.getElementById('tvm-heatmap-stats-title');
        const resetButton = document.getElementById('tvm-heatmap-stats-reset');
        if (statsTitle) statsTitle.textContent = 'Viewer Duration';
        if (resetButton) resetButton.style.display = 'none';
    }

    filterStatsByMonth(monthLabel) {
        this.filteredMonth = monthLabel;
        // Re-update stats with the filter
        const heatmapData = this.dataManager.getHeatmapData();
        if (heatmapData && heatmapData.length > 0) {
            const uniqueTimes = [...new Set(heatmapData.map(d => d.time))].sort((a, b) => a - b);
            let groupingInterval = 1;
            if (uniqueTimes.length >= 2) {
                const spacing = uniqueTimes[1] - uniqueTimes[0];
                if (spacing > 1) {
                    groupingInterval = spacing;
                }
            }
            this.updateViewerStats(heatmapData, uniqueTimes, groupingInterval, monthLabel);
        }
    }

    resetStatsFilter() {
        this.filteredMonth = null;
        // Re-update stats without filter
        const heatmapData = this.dataManager.getHeatmapData();
        if (heatmapData && heatmapData.length > 0) {
            const uniqueTimes = [...new Set(heatmapData.map(d => d.time))].sort((a, b) => a - b);
            let groupingInterval = 1;
            if (uniqueTimes.length >= 2) {
                const spacing = uniqueTimes[1] - uniqueTimes[0];
                if (spacing > 1) {
                    groupingInterval = spacing;
                }
            }
            this.updateViewerStats(heatmapData, uniqueTimes, groupingInterval, null);
        }
    }

    getCurrentAccountGraphData() {
        // Get account graph data based on current viewing mode (live or historical)
        if (this.dataManager.isShowingLive()) {
            return this.dataManager.state.metadata.accountGraphMonthData || [];
        } else {
            const historyPoint = this.dataManager.getShowingHistoryPoint();
            return historyPoint ? (historyPoint.accountGraphMonthData || []) : [];
        }
    }

    updateBotDurationStats(botData, uniqueTimes, retentionThresholdMinutes) {
        const botStatsContent = document.getElementById('tvm-bot-duration-stats-content');
        if (!botStatsContent || botData.length === 0) return;

        // Calculate bot viewer counts for each time bucket
        const timeBuckets = new Map();

        for (const time of uniqueTimes) {
            let totalViewers = 0;
            for (const item of botData) {
                if (item.time === time) {
                    totalViewers += item.count;
                }
            }
            // Always add to map, even if 0
            timeBuckets.set(time, totalViewers);
        }

        // Convert to array and sort by time (descending)
        const bucketArray = Array.from(timeBuckets.entries())
            .sort((a, b) => b[0] - a[0]);

        if (bucketArray.length === 0) {
            botStatsContent.innerHTML = '<div style="color: #adadb8; text-align: center;">No data</div>';
            return;
        }

        // Find max value for scaling bars (excluding 0 values)
        const maxViewers = Math.max(...bucketArray.filter(([_, count]) => count > 0).map(([_, count]) => count));

        // Generate HTML for bot stats (using red colors)
        let html = '';
        for (const [time, count] of bucketArray) {
            const percentage = count > 0 && maxViewers > 0 ? (count / maxViewers) * 100 : 0;
            const hours = Math.floor(time / 60);
            const mins = time % 60;
            const timeLabel = hours > 0
                ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`)
                : `${mins}m`;

            // Show colored bar if percentage >= 1%, empty bar if count is 0, otherwise empty
            let barHtml = '';
            if (count === 0) {
                barHtml = '<div class="tvm-stats-bar tvm-bot-stats-bar" style="width: 100%; background: #0e0e10;"></div>';
            } else if (percentage >= 1) {
                barHtml = `<div class="tvm-stats-bar tvm-bot-stats-bar" style="width: ${percentage}%;"></div>`;
            }

            html += `
                <div class="tvm-stats-row">
                    <div class="tvm-stats-label">${timeLabel}</div>
                    <div class="tvm-stats-bar-container">
                        ${barHtml}
                    </div>
                    <div class="tvm-stats-value">${count > 0 ? count : ''}</div>
                </div>
            `;
        }

        botStatsContent.innerHTML = html;

        // Remove existing bot retention element if present
        const existingBotTotal = botStatsContent.parentElement.querySelector('.tvm-heatmap-total-auth');
        if (existingBotTotal) {
            existingBotTotal.remove();
        }

        // Add bot retention bar
        const totalBots = botData.reduce((sum, item) => sum + item.count, 0);

        let underThresholdCount = 0;
        let overThresholdCount = 0;

        for (const item of botData) {
            if (item.time < retentionThresholdMinutes) {
                underThresholdCount += item.count;
            } else {
                overThresholdCount += item.count;
            }
        }

        const underPercent = totalBots > 0 ? Math.round((underThresholdCount / totalBots) * 100) : 0;
        const overPercent = totalBots > 0 ? Math.round((overThresholdCount / totalBots) * 100) : 0;

        const botRetentionElement = document.createElement('div');
        botRetentionElement.className = 'tvm-heatmap-total-auth';
        botRetentionElement.innerHTML = `
            <div style="margin-bottom: 6px; font-size: 12px; color: #adadb8;">Bots (${totalBots.toLocaleString()} total)</div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="font-size: 11px; color: #adadb8; white-space: nowrap;">&lt;${retentionThresholdMinutes}m</div>
                <div class="tvm-retention-bar-container">
                    <div class="tvm-retention-bar-under" style="width: ${underPercent}%; background: #ff4444;" title="${underThresholdCount.toLocaleString()} bots (${underPercent}%)"></div>
                    <div class="tvm-retention-bar-over" style="width: ${overPercent}%; background: #cc0000;" title="${overThresholdCount.toLocaleString()} bots (${overPercent}%)"></div>
                </div>
                <div style="font-size: 11px; color: #adadb8; white-space: nowrap;">&gt;${retentionThresholdMinutes}m</div>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px;">
                <span style="color: #ff4444;">${underPercent}%</span>
                <span style="color: #cc0000;">${overPercent}%</span>
            </div>
            <div class="tvm-retention-slider-control">
                <input type="range" class="tvm-retention-slider" min="0" max="2" step="1" value="${retentionThresholdMinutes === 5 ? 0 : retentionThresholdMinutes === 10 ? 1 : 2}">
                <div class="tvm-retention-slider-label">${retentionThresholdMinutes}m threshold</div>
            </div>
        `;
        botStatsContent.parentElement.appendChild(botRetentionElement);

        // Add slider event listener for bot stats
        const slider = botRetentionElement.querySelector('.tvm-retention-slider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                const sliderValue = parseInt(e.target.value);
                // Map slider position to fixed values: 0=5min, 1=10min, 2=20min
                const thresholdValue = sliderValue === 0 ? 5 : sliderValue === 1 ? 10 : 20;
                this.retentionThresholdMinutes = thresholdValue;
                this.update(); // Re-render with new threshold
            });
        }
    }

    monthLabelToKey(monthLabel) {
        // Convert "Nov 2024" to "2024-11"
        const [monthName, year] = monthLabel.split(' ');
        const months = {
            'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
            'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
            'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        return `${year}-${months[monthName]}`;
    }

    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
};

// Main Chart component for viewer statistics
window.MainChart = class MainChart {
  constructor(dataManager, settingsManager, errorHandler, channelName = null) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.channelName = channelName;
    this.chart = null;
    this.botCalculationType = 0; // 0 = Normal, 1 = High Churn
    this.skipEntries = 0; // Number of initial entries to skip from display (0-20)
  }

  setBotCalculationType(type) {
    this.botCalculationType = type;
    this.update();
  }

  setSkipEntries(count) {
    this.skipEntries = Math.max(0, Math.min(20, count)); // Clamp between 0 and 20
    this.update();
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
      console.error('Error resizing main chart:', error);
    }
  }

  async init() {
    const ctx = document.getElementById('tvm-graph');
    if (!ctx) {
      throw new Error('Main chart canvas not found');
    }

    const config = this.settingsManager.get();
    const colors = config.chartColors;

    // Initialize smooth lines state (default on, not persisted)
    this.smoothLines = true;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Viewers',
            data: [],
            borderColor: colors.totalViewers,
            backgroundColor: 'transparent',
            borderWidth: 3,
            fill: false,
            tension: 0.6,
            cubicInterpolationMode: 'monotone',
            spanGaps: true,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointBackgroundColor: colors.totalViewers,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            order: 1
          },
          {
            label: 'Authenticated Users',
            data: [],
            borderColor: colors.authenticatedNonBots || '#ffa500',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.6,
            cubicInterpolationMode: 'monotone',
            spanGaps: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: colors.authenticatedNonBots || '#ffa500',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            borderDash: [5, 5],
            order: 2
          },
          {
            label: 'Authenticated Bots',
            data: [],
            borderColor: colors.bots,
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.6,
            cubicInterpolationMode: 'monotone',
            spanGaps: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: colors.bots,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            borderDash: [5, 5],
            order: 3
          },
          {
            label: 'Total Authenticated',
            data: [],
            borderColor: colors.totalAuthenticated,
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.6,
            cubicInterpolationMode: 'monotone',
            spanGaps: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: colors.totalAuthenticated,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            order: 4
          }
        ]
      },
      options: this.getOptions()
    });
  }

  getOptions() {
    const config = this.settingsManager.get();

    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { bottom: 10, top: -10 }
      },
      interaction: {
        intersect: false,
        mode: 'nearest',
        axis: 'x'
      },
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const element = elements[0];
          const datasetIndex = element.datasetIndex;
          const pointIndex = element.index;

          // Get the data point that was clicked
          const dataset = this.chart.data.datasets[datasetIndex];
          const dataPoint = dataset.data[pointIndex];

          if (dataPoint && dataPoint.x) {
            // Find the history point that corresponds to this timestamp
            const history = this.dataManager.getHistory();
            const historyPoint = history.find(h => h.timestamp === dataPoint.x);

            if (historyPoint) {
              this.dataManager.setHistoryPoint(historyPoint);
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'minute',
            displayFormats: {
              minute: 'HH:mm'
            },
            tooltipFormat: 'HH:mm:ss'
          },
          adapters: {
            date: {
              zone: 'UTC'
            }
          },
          ticks: {
            color: '#adadb8',
            font: { size: 11 },
            maxTicksLimit: 8,
            callback: function (value, index, values) {
              // Format ticks to show UTC time
              const date = new Date(value);
              return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'UTC',
                hour12: false
              });
            }
          },

          grid: {
            color: 'rgba(173, 173, 184, 0.1)',
            drawBorder: false,
            display: false // Remove vertical grid lines
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Viewers / Users / Bots',
            color: '#adadb8',
            font: { size: 12, weight: '600' }
          },
          ticks: {
            color: '#adadb8',
            font: { size: 11 },
            callback: function (value) {
              if (value >= 1000000) {
                return (value / 1000000).toFixed(1) + 'M';
              } else if (value >= 1000) {
                return (value / 1000).toFixed(1) + 'K';
              }
              return value;
            }
          },
          grid: {
            color: 'rgba(173, 173, 184, 0.1)',
            drawBorder: false
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#adadb8',
            font: { size: 11 },
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 20,
            generateLabels: this.generateLegendLabels.bind(this)
          }
        },
        tooltip: {
          enabled: false, // Disable default tooltip
          external: this.createExternalTooltip.bind(this)
        }
      },
      animation: {
        duration: config.chartAnimationDuration,
        easing: 'easeInOutQuart'
      },
      elements: {
        point: { hoverBorderWidth: 3 }
      }
    };
  }

  generateLegendLabels(chart) {
    const labels = Chart.defaults.plugins.legend.labels.generateLabels(chart);
    const colors = this.settingsManager.get().chartColors;

    return labels.map(label => {
      if (label.text === 'Viewers') {
        label.pointStyle = 'line';
        label.fillStyle = colors.totalViewers;
        label.strokeStyle = colors.totalViewers;
      } else if (label.text === 'Authenticated Users') {
        label.pointStyle = 'line';
        label.fillStyle = colors.authenticatedNonBots || '#ffa500';
        label.strokeStyle = colors.authenticatedNonBots || '#ffa500';
      } else if (label.text === 'Authenticated Bots') {
        label.pointStyle = 'line';
        label.fillStyle = colors.bots;
        label.strokeStyle = colors.bots;
      } else if (label.text === 'Total Authenticated') {
        label.pointStyle = 'line';
        label.fillStyle = colors.totalAuthenticated;
        label.strokeStyle = colors.totalAuthenticated;
      } else {
        label.pointStyle = 'line';
      }
      return label;
    });
  }

  createExternalTooltip(context) {
    // Get or create tooltip element
    let tooltipEl = document.getElementById('chartjs-tooltip');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'chartjs-tooltip';
      tooltipEl.style.background = 'rgba(14, 14, 16, 0.95)';
      tooltipEl.style.borderRadius = '8px';
      tooltipEl.style.color = '#efeff1';
      tooltipEl.style.opacity = '0';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.transition = 'opacity 0.15s ease';
      tooltipEl.style.padding = '12px';
      tooltipEl.style.border = '1px solid #2e2e35';
      tooltipEl.style.fontSize = '12px';
      tooltipEl.style.zIndex = '1000';
      document.body.appendChild(tooltipEl);
    }

    // Hide if no tooltip
    const tooltipModel = context.tooltip;
    if (tooltipModel.opacity === 0) {
      tooltipEl.style.opacity = '0';
      return;
    }

    // Find the closest history point based on x-axis position
    const history = this.dataManager.getHistory();
    if (!history || history.length === 0) {
      tooltipEl.style.opacity = '0';
      return;
    }

    // Get the chart and scales
    const chart = context.chart;
    const xScale = chart.scales.x;

    // Get the x-axis value from the mouse position
    // Chart.js provides this through the tooltip's dataPoints
    let hoveredTimestamp = null;

    if (tooltipModel.dataPoints && tooltipModel.dataPoints.length > 0) {
      // Get the x value from the chart data point
      hoveredTimestamp = tooltipModel.dataPoints[0].parsed.x;
    } else {
      // Fallback: try to get from pixel position
      hoveredTimestamp = xScale.getValueForPixel(tooltipModel.caretX);
    }

    if (!hoveredTimestamp) {
      tooltipEl.style.opacity = '0';
      return;
    }

    // Find closest history point to the hovered timestamp
    // When smooth lines are enabled, chart shows interpolated data,
    // so we need to find the actual closest history point
    let closestPoint = null;
    let minDistance = Infinity;

    for (const point of history) {
      const distance = Math.abs(point.timestamp - hoveredTimestamp);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
    }

    if (!closestPoint) {
      tooltipEl.style.opacity = '0';
      return;
    }

    // Build tooltip content from the original history point
    const date = new Date(closestPoint.timestamp);
    const timeStr = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC'
    }) + ' UTC';

    const config = this.settingsManager.get();
    const colors = config.chartColors;

    // Calculate values based on bot calculation type
    const totalAuthenticated = closestPoint.totalAuthenticated || 0;
    let bots, authenticatedNonBots;

    if (this.botCalculationType === 1) {
      // High Churn mode
      const accountsWithDates = closestPoint.accountsWithDates || 0;
      const quickLeavers = Math.max(0, totalAuthenticated - accountsWithDates);
      bots = closestPoint.bots + quickLeavers;
      authenticatedNonBots = accountsWithDates - closestPoint.bots;
    } else {
      // Normal mode
      bots = closestPoint.bots || 0;
      authenticatedNonBots = closestPoint.authenticatedNonBots || 0;
    }

    // Calculate bot percentage
    const botPercentage = totalAuthenticated > 0 ? ((bots / totalAuthenticated) * 100).toFixed(1) : 0;

    let innerHTML = `<div style="font-weight: 600; margin-bottom: 6px; font-size: 13px;">${timeStr}</div>`;

    // Add each metric with color indicator
    innerHTML += `
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
        <span style="width: 8px; height: 8px; background: ${colors.totalViewers}; border-radius: 50%;"></span>
        <span>Viewers: ${closestPoint.totalViewers.toLocaleString()}</span>
      </div>
    `;

    innerHTML += `
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
        <span style="width: 8px; height: 2px; background: ${colors.authenticatedNonBots || '#ffa500'};"></span>
        <span>Authenticated Users: ${Math.max(0, authenticatedNonBots).toLocaleString()}</span>
      </div>
    `;

    if (bots > 0) {
      innerHTML += `
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span style="width: 8px; height: 2px; background: ${colors.bots};"></span>
          <span>Authenticated Bots: ${bots.toLocaleString()} (${botPercentage}%)</span>
        </div>
      `;

      innerHTML += `
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="width: 8px; height: 2px; background: ${colors.totalAuthenticated};"></span>
          <span>Total Authenticated: ${totalAuthenticated.toLocaleString()}</span>
        </div>
      `;
    }

    tooltipEl.innerHTML = innerHTML;

    // Position the tooltip in fixed top-left position relative to chart
    const position = context.chart.canvas.getBoundingClientRect();

    tooltipEl.style.opacity = '1';
    tooltipEl.style.left = position.left + window.pageXOffset + 10 + 'px';
    tooltipEl.style.top = position.top + window.pageYOffset + 10 + 'px';
  } toggleSmoothLines() {
    this.smoothLines = !this.smoothLines;
    this.update();
    return this.smoothLines;
  }

  update() {
    if (!this.chart) return;

    let history = this.dataManager.getHistory();

    // Skip initial entries based on skipEntries setting
    // Cap at history.length - 1 to always show at least one point
    const actualSkip = Math.min(this.skipEntries, Math.max(0, history.length - 1));
    if (actualSkip > 0) {
      history = history.slice(actualSkip);
    }

    // Helper function to remove consecutive duplicate y-values
    const removeDuplicates = (data) => {
      if (!this.smoothLines || data.length <= 2) return data;

      const result = [data[0]]; // Always keep first point
      for (let i = 1; i < data.length - 1; i++) {
        // Keep point if y-value differs from previous
        if (data[i].y !== data[i - 1].y) {
          result.push(data[i]);
        }
      }
      result.push(data[data.length - 1]); // Always keep last point
      return result;
    };

    const totalViewersData = removeDuplicates(history.map(h => ({ x: h.timestamp, y: h.totalViewers })));

    // Calculate display values based on calculation type
    let authenticatedNonBotsData, botsData;

    if (this.botCalculationType === 1) {
      // High Churn mode: authenticatedNonBots = accountsWithDates - bots
      //                  bots = totalAuthenticated - (accountsWithDates - bots)
      authenticatedNonBotsData = removeDuplicates(history.map(h => ({
        x: h.timestamp,
        y: Math.max(0, (h.accountsWithDates || 0) - (h.bots || 0))
      })));
      botsData = removeDuplicates(history.map(h => ({
        x: h.timestamp,
        y: Math.max(0, (h.totalAuthenticated || 0) - ((h.accountsWithDates || 0) - (h.bots || 0)))
      })));
    } else {
      // Normal mode: use original stored values
      authenticatedNonBotsData = removeDuplicates(history.map(h => ({
        x: h.timestamp,
        y: h.authenticatedNonBots || 0
      })));
      botsData = removeDuplicates(history.map(h => ({ x: h.timestamp, y: h.bots || 0 })));
    }

    const totalAuthenticatedData = removeDuplicates(history.map(h => ({
      x: h.timestamp,
      y: h.totalAuthenticated || 0
    })));

    this.chart.data.datasets[0].data = totalViewersData;
    this.chart.data.datasets[1].data = authenticatedNonBotsData;
    this.chart.data.datasets[2].data = botsData;
    this.chart.data.datasets[3].data = totalAuthenticatedData;

    // Update tension and interpolation based on smooth lines setting
    const tension = this.smoothLines ? 0.6 : 0;
    const interpolationMode = this.smoothLines ? 'monotone' : 'default';
    this.chart.data.datasets[0].tension = tension;
    this.chart.data.datasets[0].cubicInterpolationMode = interpolationMode;
    this.chart.data.datasets[1].tension = tension;
    this.chart.data.datasets[1].cubicInterpolationMode = interpolationMode;
    this.chart.data.datasets[2].tension = tension;
    this.chart.data.datasets[2].cubicInterpolationMode = interpolationMode;
    this.chart.data.datasets[3].tension = tension;
    this.chart.data.datasets[3].cubicInterpolationMode = interpolationMode;

    // Hide point hover highlights when smooth lines are enabled
    // This prevents confusing hover indicators on interpolated curve points
    const hoverRadius = this.smoothLines ? 0 : [6, 5, 5, 5];
    this.chart.data.datasets[0].pointHoverRadius = this.smoothLines ? 0 : 6;
    this.chart.data.datasets[1].pointHoverRadius = this.smoothLines ? 0 : 5;
    this.chart.data.datasets[2].pointHoverRadius = this.smoothLines ? 0 : 5;
    this.chart.data.datasets[3].pointHoverRadius = this.smoothLines ? 0 : 5;

    // Check if there are no bots present
    const hasNonZeroBots = botsData.some(point => point.y > 0);

    // Auto-hide datasets that contain only zeros using Chart.js API
    const chart = this.chart;

    // Hide/show bots dataset (index 2)
    if (!hasNonZeroBots && chart.isDatasetVisible(2)) {
      chart.hide(2);
      chart.hide(3);
    } else if (hasNonZeroBots && !chart.isDatasetVisible(2)) {
      chart.show(2);
      chart.show(3);
    }

    // Calculate max value and set y-axis max to one step above the highest value
    if (history.length > 0) {
      const maxValue = Math.max(
        ...history.map(h => Math.max(
          h.totalViewers,
          h.authenticatedNonBots || 0,
          h.bots || 0,
          h.totalAuthenticated || 0
        ))
      );

      if (maxValue > 0) {
        // Calculate a nice step size based on the max value
        // This creates pretty numbers for the axis
        const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)));
        let stepSize;

        if (maxValue / magnitude < 2) {
          stepSize = magnitude / 5; // e.g., 20, 200, 2000
        } else if (maxValue / magnitude < 5) {
          stepSize = magnitude / 2; // e.g., 50, 500, 5000
        } else {
          stepSize = magnitude; // e.g., 100, 1000, 10000
        }

        // Calculate how many steps are needed to reach maxValue, then add one more
        const stepsNeeded = Math.ceil(maxValue / stepSize);
        this.chart.options.scales.y.max = (stepsNeeded + 1) * stepSize;
      } else {
        delete this.chart.options.scales.y.max; // Remove max if no data
      }
    } else {
      delete this.chart.options.scales.y.max; // Remove max if no history
    }

    this.chart.update('none');
  }

  clear() {
    if (this.chart) {
      this.chart.data.datasets.forEach(dataset => {
        dataset.data = [];
      });
      this.chart.update('none');
    }
  }

  destroy() {
    // Clean up custom tooltip
    const tooltipEl = document.getElementById('chartjs-tooltip');
    if (tooltipEl) {
      tooltipEl.remove();
    }

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}

// Main Chart component for viewer statistics
window.MainChart = class MainChart {
  constructor(dataManager, settingsManager, errorHandler, channelName = null) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.channelName = channelName;
    this.chart = null;
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
            tension: 0.4,
            cubicInterpolationMode: 'monotone',
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
            tension: 0.4,
            cubicInterpolationMode: 'monotone',
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
            tension: 0.4,
            cubicInterpolationMode: 'monotone',
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
            tension: 0.4,
            cubicInterpolationMode: 'monotone',
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
        mode: 'index'
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
            drawBorder: false
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
          backgroundColor: 'rgba(14, 14, 16, 0.95)',
          titleColor: '#efeff1',
          bodyColor: '#efeff1',
          borderColor: '#2e2e35',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          displayColors: true,
          usePointStyle: true,
          titleFont: { size: 13, weight: '600' },
          bodyFont: { size: 12 },
          callbacks: {
            title: function (context) {
              const date = new Date(context[0].parsed.x);
              return date.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone: 'UTC'
              }) + ' UTC';
            },
            label: (context) => ChartUtils.formatTooltipLabel(context, this.dataManager)
          }
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

  update() {
    if (!this.chart) return;

    const history = this.dataManager.getHistory();

    const totalViewersData = history.map(h => ({ x: h.timestamp, y: h.totalViewers }));
    const authenticatedNonBotsData = history.map(h => ({
      x: h.timestamp,
      y: h.authenticatedNonBots || 0
    }));
    const botsData = history.map(h => ({ x: h.timestamp, y: h.bots || 0 }));
    const totalAuthenticatedData = history.map(h => ({
      x: h.timestamp,
      y: h.totalAuthenticated || 0
    }));

    this.chart.data.datasets[0].data = totalViewersData;
    this.chart.data.datasets[1].data = authenticatedNonBotsData;
    this.chart.data.datasets[2].data = botsData;
    this.chart.data.datasets[3].data = totalAuthenticatedData;

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

    // Calculate max value and set y-axis max to 1.2x the highest value
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
        this.chart.options.scales.y.max = Math.ceil(maxValue * 1.2);
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
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}

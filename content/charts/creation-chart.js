// Creation Chart component for account creation date analysis
window.CreationChart = class CreationChart {
  constructor(dataManager, settingsManager, errorHandler, uiManager = null) {
    this.dataManager = dataManager;
    this.settingsManager = settingsManager;
    this.errorHandler = errorHandler;
    this.uiManager = uiManager;
    this.chart = null;
  }

  resize() {
    try {
      if (this.chart) {
        this.chart.resize();
      }
    } catch (error) {
      console.error('Error resizing creation chart:', error);
    }
  }

  async init() {
    const ctx = document.getElementById('tvm-creation-graph');
    if (!ctx) {
      throw new Error('Creation chart canvas not found');
    }

    const config = this.settingsManager.get();

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Non-Bot Accounts',
            data: [],
            backgroundColor: '#9147ff', // Purple for non-bots
            borderColor: '#9147ff',
            borderWidth: 1,
            borderRadius: 2,
            borderSkipped: false
          },
          {
            label: 'Bot Accounts',
            data: [],
            backgroundColor: '#ff4444', // Red for bots
            borderColor: '#ff4444',
            borderWidth: 1,
            borderRadius: 2,
            borderSkipped: false
          }
        ]
      },
      options: this.getOptions(config)
    });
  }

  getOptions(config) {
    const chartManager = this; // Store reference for the onClick callback

    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { bottom: 10 }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#adadb8',
            font: { size: 11 },
            usePointStyle: true,
            pointStyle: 'rect'
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
          titleFont: { size: 13, weight: '600' },
          bodyFont: { size: 12 },
          mode: 'index',
          intersect: false,
          callbacks: {
            title: function (context) {
              if (context[0] && context[0].label) {
                return context[0].label;
              }
              return '';
            },
            label: function (context) {
              const label = context.dataset.label || '';
              const value = context.parsed.y || 0;
              return `${label}: ${value} accounts`;
            },
            footer: function (tooltipItems) {
              const total = tooltipItems.reduce((sum, item) => sum + (item.parsed.y || 0), 0);
              return `Total: ${total} accounts`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            display: true,
            color: '#adadb8',
            font: { size: 11 },
            maxTicksLimit: 6
          },
          grid: {
            color: 'rgba(173, 173, 184, 0.1)',
            drawBorder: false,
            display: false // Remove vertical grid lines
          }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: {
            display: true,
            text: 'Number of Accounts',
            color: '#adadb8',
            font: { size: 12, weight: '600' }
          },
          ticks: {
            color: '#adadb8',
            font: { size: 11 },
            precision: 0,
            callback: function (value) {
              return Math.round(value);
            }
          },
          grid: {
            color: 'rgba(173, 173, 184, 0.1)',
            drawBorder: false
          }
        }
      },
      animation: {
        duration: 1000,
        easing: 'easeOutQuart'
      },
      onClick: (event, activeElements, chart) => {
        // Try to get data even if activeElements is empty
        if (activeElements.length === 0) {
          // Try to find the clicked element manually
          const canvasPosition = Chart.helpers.getRelativePosition(event, chart);
          const dataX = chart.scales.x.getValueForPixel(canvasPosition.x);

          // Find the closest data point
          const histogram = chartManager.dataManager.getCreationDateHistogram();
          if (histogram && histogram.length > 0) {
            // Find the closest bar by x position
            let closestIndex = -1;
            let closestDistance = Infinity;

            histogram.forEach((item, index) => {
              const itemDate = new Date(item.date).getTime();
              const distance = Math.abs(itemDate - dataX);
              if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
              }
            });

            if (closestIndex >= 0) {
              const date = new Date(histogram[closestIndex].date);
              const year = date.getFullYear();
              const month = date.getMonth() + 1;
              const yearMonth = `${year}-${month.toString().padStart(2, '0')}`;

              if (chartManager.uiManager) {
                chartManager.uiManager.setDateFilter(yearMonth);
              }
            }
          }
          return;
        }

        if (activeElements.length > 0 && chartManager.uiManager) {
          const activeElement = activeElements[0];
          const dataIndex = activeElement.index;
          const histogram = chartManager.dataManager.getCreationDateHistogram();

          if (histogram && histogram[dataIndex]) {
            const date = new Date(histogram[dataIndex].date);
            const year = date.getFullYear();
            const month = date.getMonth() + 1; // getMonth() returns 0-11, we want 1-12
            const yearMonth = `${year}-${month.toString().padStart(2, '0')}`;

            // Set the date filter in the UI manager
            chartManager.uiManager.setDateFilter(yearMonth);
          }
        }
      }
    };
  }

  getBarColor(context) {
    // This method is no longer used with the stacked chart format
    return 'rgba(145, 71, 255, 0.8)';
  }

  getBorderColor(context) {
    // This method is no longer used with the stacked chart format
    return '#9147ff';
  }

  updateThreshold() {
    // This method is no longer used with the new bot detection algorithm
    return false;
  }

  update() {
    if (!this.chart) return;

    // Determine data source based on viewing mode
    let accountGraphData, sourceMetadata;

    if (this.dataManager.isShowingLive()) {
      // Use live data
      accountGraphData = this.dataManager.state.metadata.accountGraphMonthData || [];
      sourceMetadata = this.dataManager.state.metadata;
    } else {
      // Use historical data
      const historyPoint = this.dataManager.getShowingHistoryPoint();
      if (historyPoint) {
        accountGraphData = historyPoint.accountGraphMonthData || [];
        sourceMetadata = historyPoint; // History point contains the metadata directly
      } else {
        accountGraphData = [];
        sourceMetadata = {};
      }
    }

    if (accountGraphData.length === 0) {
      // No data available
      this.chart.data.labels = [];
      this.chart.data.datasets[0].data = [];
      this.chart.data.datasets[1].data = [];
      this.chart.update('none');
      return;
    }

    // Sort data by month
    const sortedData = [...accountGraphData].sort((a, b) => a.month.localeCompare(b.month));

    // Extract labels and data
    const labels = sortedData.map(item => {
      const date = new Date(item.month + '-01');
      return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    });

    const nonBotData = sortedData.map(item => item.nonBots || 0);
    const botData = sortedData.map(item => item.bots || 0);

    // Calculate max value for Y-axis
    const maxValues = sortedData.map(item => (item.nonBots || 0) + (item.bots || 0));
    const maxValue = Math.max(...maxValues, 0);
    const suggestedMax = Math.ceil(maxValue * 1.1); // 10% padding

    // Update chart data
    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = nonBotData; // Non-bots
    this.chart.data.datasets[1].data = botData;    // Bots

    // Update Y-axis configuration
    this.chart.options.scales.y.suggestedMax = suggestedMax;

    this.chart.update('none');

    this.updateYAxisTitle();
  }

  updateTooltip() {
    try {
      this.removeTooltip();
    } catch (error) {
      this.errorHandler?.handle(error, 'CreationChart Update Tooltip');
    }
  }

  removeTooltip() {
    const existingTooltip = document.getElementById('tvm-creation-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }
  }

  updateStats() {
    try {
      const statsElement = document.getElementById('tvm-creation-stats');
      if (!statsElement) return;

    } catch (error) {
      this.errorHandler?.handle(error, 'CreationChart Update Stats');
    }
  }

  updateYAxisTitle() {
    try {
      if (!this.chart) return;

      // Determine data source based on viewing mode
      let accountsInBotRange;

      if (this.dataManager.isShowingLive()) {
        // Use live data
        accountsInBotRange = this.dataManager.state.metadata.accountsInBotRange || 0;
      } else {
        // Use historical data
        const historyPoint = this.dataManager.getShowingHistoryPoint();
        if (historyPoint) {
          accountsInBotRange = historyPoint.accountsInBotRange || 0;
        } else {
          accountsInBotRange = 0;
        }
      }


      // Determine data source based on viewing mode
      let metadata;

      if (this.dataManager.isShowingLive()) {
        // Use live data
        metadata = this.dataManager.state.metadata;
      } else {
        // Use historical data
        const historyPoint = this.dataManager.getShowingHistoryPoint();
        if (historyPoint) {
          metadata = historyPoint; // History point contains the metadata directly
        } else {
          metadata = {};
        }
      }

      const totalNonBots = metadata.accountGraphMonthData?.reduce((sum, month) => sum + month.nonBots, 0) || 0;
      const totalMonths = metadata.accountGraphMonthData?.length || 0;

      const averagePerMonth = totalMonths > 0 ? (totalNonBots / totalMonths).toFixed(1) : 0;

      const maxExpectedPostStartAccounts = metadata.maxExpectedPostStartAccounts || 0;
      const averagePreStartAccounts = metadata.averagePreStartAccounts || 0;

      if (averagePerMonth > 0) {
        const titleElement = document.getElementById('tvm-creation-title');
        if (titleElement) {
          titleElement.textContent = `${averagePreStartAccounts} • Expected After ${maxExpectedPostStartAccounts} • ${accountsInBotRange} accounts`;
        }
      }

      // Update percentage display
      this.updatePercentageDisplay(metadata);

      this.chart.update('none');
    } catch (error) {
      this.errorHandler?.handle(error, 'CreationChart Update Y-Axis Title');
    }
  }

  updatePercentageDisplay(metadata) {
    try {
      const percentageElement = document.getElementById('tvm-creation-percentage');
      const labelElement = document.getElementById('tvm-creation-percentage-label');
      const statsContainer = document.getElementById('tvm-creation-stats');

      if (!percentageElement || !labelElement || !statsContainer) return;

      // Get total authenticated accounts with dates
      const accountsWithDates = metadata.accountsWithDates || 0;
      const botsDetected = metadata.botsDetected || 0;
      // Get accounts in 2018-2024 range
      const accountsFrom2020 = metadata.accountsFrom2020 || 0;
      const accountsFrom2020WithoutBots = metadata.accountsFrom2020WithoutBots || 0;

      // Only show if more than 100 accounts
      if (accountsWithDates <= 100) {
        statsContainer.style.display = 'none';
        return;
      }

      statsContainer.style.display = 'flex';

      // Calculate percentage of accounts in 2018-2024 vs total
      const percentage = Math.round((accountsFrom2020 / accountsWithDates) * 100);
      const percentageWithoutBots = Math.round((accountsFrom2020WithoutBots / (accountsWithDates - botsDetected)) * 100);
      if (percentage !== percentageWithoutBots) {
        percentageElement.textContent = `${percentage}% (${percentageWithoutBots}%)`;
      } else {
        percentageElement.textContent = `${percentage}%`;
      }

      labelElement.textContent = '2020+';

    } catch (error) {
      this.errorHandler?.handle(error, 'CreationChart Update Percentage Display');
    }
  }

  clear() {
    if (this.chart) {
      this.chart.data.datasets[0].data = [];
      this.chart.data.datasets[1].data = [];
      this.chart.data.labels = [];
      this.chart.update('none');
      // Set stas to hidden
      const statsContainer = document.getElementById('tvm-creation-stats');
      if (statsContainer) {
        statsContainer.style.display = 'none';
      }
    }

    // Remove tooltip
    const existingTooltip = document.getElementById('tvm-creation-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}

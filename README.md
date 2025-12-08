# Viewer Metrics Chrome Extension

A Chrome extension that tracks and analyzes stream viewers with bot detection capabilities.

![Viewer Metrics Screenshot](assets/screenshot1.png)

## 🚀 Installation

1. Download the [latest release](https://github.com/viewermetrics/viewermetrics/releases/tag/v0.9.93) or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the project folder
5. The extension will appear in your toolbar

## ✨ Features

- Track viewer counts and authenticated users every minute
- Monitor authenticated users and detect potential bot accounts
- View detailed user profiles with following information
- Automatically identifies suspicious account creation patterns
- No manual setup required - adapts to each channel
- Visual charts show legitimate vs. bot account distribution
- Searchable list of all tracked viewers with profile details
- Auto-adjusts request rates based on stream size

## Usage

1. **Navigate to a Channel**: Go to any channel page

2. **Start Tracking**: 
   - The extension UI will appear below the stream
   - Click the "Start Tracking" button to begin monitoring viewers

3. **View Analytics**:
   - **Stats Panel**: Shows total viewers, authenticated users, and detected bots
   - **Graph**: Displays viewer trends over time (updates every minute)
   - **Viewer List**: Searchable, paginated list of all tracked viewers

## How It Works


### Viewer Tracking
1. Fetches the viewer list at configurable intervals (default: 5 seconds)
2. Tracks first seen and last seen timestamps for each viewer
3. Removes viewers who haven't been seen for 5 minutes (configurable)
4. Fetches account creation dates for new viewers in the background

**Baseline Calculation Algorithm:**
- **Pre-2020 Analysis**: Analyzes account creation patterns prior to 2020
- **Baseline Establishment**: Calculates the maximum expected accounts per month post 2020
- **Spike Detection**: Identifies months where account creation significantly exceeds the baseline
- **Automatic Classification**: Accounts created during spike periods are flagged as potential bots, ignoring half the baseline as real users
- **False Positive Removal**: Only a final bot percentage above 10% is shown

## Data Storage

- **Local Storage**: Configuration settings (persists across sessions)
- **Memory Only**: Viewer data (not persisted, cleared when tracking stops)

## Privacy & Security

- All data is stored locally in your browser
- No data is sent to external servers
- Authentication headers are captured from sites own requests
- The only outgoing requests are to the site itself
- Viewer data is cleared when tracking stops or browser closes

## License

This extension is provided as-is for educational and personal use.

## Contributing

Feel free to submit issues or pull requests for improvements.

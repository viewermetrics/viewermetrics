# Privacy Policy for Viewer Metrics

**Last Updated: November 13, 2025**

## Overview

Viewer Metrics is a browser extension designed to help Twitch streamers track and analyze their stream viewers. This privacy policy explains what data is collected, how it is used, and your rights regarding your information.

## Data Collection and Use

### Authentication Information
- **What We Collect**: The extension captures Twitch authentication tokens and OAuth headers from your browser's requests to Twitch's API.
- **How It's Used**: These tokens are used solely to authenticate API requests to Twitch on your behalf to retrieve viewer lists and user information.
- **Storage**: Authentication tokens are stored temporarily in your browser's session storage and are never transmitted to any third-party servers.

### Viewer Tracking Data
- **What We Collect**: When you actively track a channel, the extension collects and stores:
  - Viewer usernames
  - Viewer join/leave timestamps
  - Account creation dates
  - Profile information (avatars, descriptions)
  - Following relationships
- **How It's Used**: This data is used to display real-time viewer metrics, generate historical charts, and perform bot detection analysis.
- **Storage**: All viewer data is stored locally in your browser using Chrome's local storage API. No data is transmitted to external servers operated by us.

### Usage Information
- **What We Collect**: The extension stores your preferences and settings, including:
  - API request intervals
  - Timeout durations
  - Display preferences
  - Bot detection configuration
- **How It's Used**: These settings customize the extension's behavior to your preferences.
- **Storage**: All settings are stored locally in your browser.

## Data Transmission

### Twitch API Communication
- The extension makes API requests directly to Twitch's servers (gql.twitch.tv and twitch.tv) using your authentication credentials.
- These requests are necessary to retrieve viewer lists and user information.
- No data is sent to any servers controlled by Viewer Metrics or any third parties.

### No External Analytics
- The extension does NOT use Google Analytics, tracking pixels, or any third-party analytics services.
- The extension does NOT transmit usage statistics or telemetry data.

## Data Retention and Deletion

### Local Storage
- All data collected by the extension is stored locally on your device.
- You can delete all stored data at any time by:
  1. Removing the extension from your browser
  2. Clearing your browser's extension data
  3. Using Chrome's developer tools to clear local storage

### Automatic Cleanup
- The extension automatically removes viewer data that is older than 24 hours to manage memory usage.
- Timed-out viewers (inactive for your configured timeout period) are automatically removed from tracking.

## Data Security

- Authentication tokens are stored in secure browser storage (Chrome session storage).
- All API communications use HTTPS encryption.
- No data is transmitted to third parties or stored on external servers.
- The extension only accesses data on twitch.tv domains when you are actively using it.

## Third-Party Services

### Twitch API
- The extension relies on Twitch's GraphQL API to function.
- When you use this extension, you are subject to Twitch's Privacy Policy and Terms of Service.
- We recommend reviewing [Twitch's Privacy Notice](https://www.twitch.tv/p/legal/privacy-notice/) for information about how Twitch handles your data.

## Permissions Explanation

The extension requests the following permissions:

- **storage**: Store user preferences and tracking data locally on your device
- **tabs**: Open tracking and viewer detail pages when requested
- **webRequest**: Capture authentication headers from Twitch API requests
- **webRequestAuthProvider**: Extract OAuth tokens to authenticate API calls on your behalf
- **scripting**: Inject the tracking interface into Twitch channel pages
- **Host Permissions (twitch.tv)**: Access Twitch website to add extension functionality
- **Host Permissions (gql.twitch.tv)**: Make authorized API calls to retrieve viewer data

## Your Rights

You have the right to:
- **Access**: Review all data stored by the extension using Chrome's developer tools
- **Delete**: Remove all extension data by uninstalling the extension or clearing browser storage
- **Control**: Configure the extension's behavior through its settings interface
- **Withdraw Consent**: Uninstall the extension at any time to stop all data collection

## Children's Privacy

This extension is not intended for users under the age of 13. We do not knowingly collect information from children under 13. If you believe a child under 13 has used this extension, please contact us.

## Changes to This Policy

We may update this privacy policy from time to time. The "Last Updated" date at the top of this policy indicates when it was last revised. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Data Practices Summary

✅ **We DO:**
- Store data locally on your device
- Use your Twitch authentication to make API calls to Twitch
- Automatically clean up old data
- Provide full control over your data

❌ **We DO NOT:**
- Transmit your data to our servers or third parties
- Sell or share your data
- Use analytics or tracking services
- Store data in the cloud
- Access your data outside of Twitch domains

## Contact Information

For questions, concerns, or requests regarding this privacy policy or your data, please:
- Open an issue on our [GitHub repository](https://github.com/viewermetrics/viewermetrics)
- Contact us through the Chrome Web Store support page

## Compliance

This extension complies with:
- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR) principles
- California Consumer Privacy Act (CCPA) requirements

## Open Source

Viewer Metrics is open source software. You can review the complete source code to verify our privacy practices at: https://github.com/viewermetrics/viewermetrics

---

**By installing and using Viewer Metrics, you acknowledge that you have read and understood this Privacy Policy.**

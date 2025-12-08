# Changelog

All notable changes to the Viewer Metrics Chrome Extension will be documented in this file.

## [0.9.93] - 2025-12-09
- Export of viewer tracking data (CSV, XML, SQL, JSON)
- Export of viewer graph history data (CSV, XML, SQL, JSON)
- Session save and load functionality with analysis mode  

## [0.9.92] - 2025-12-03
- Fixed an issue with bot calculation

## [0.9.91] - 2025-12-03
- Implement concurrent batch processing for user info requests to maximize throughput
- Remove request-interceptor.js as we now use a simplified client ID that doesn't require auth token interception
- Always use simple headers (Client-Id) instead of intercepting authentication tokens
- More lenient calculation in botted months to avoid false positives
- Updated to use 2020 as base year as more bots have been brought online from that period

## [0.9.9] - 2025-11-29
- New High Churn mode for channels with short-lived bots
- Re-worked the stats display to be more intuitive
- Smooth lines now an easy toggle from main chart
- User retention and summary start configurable
- Bot duration separated from viewer duration
- Outgoing requests are now paused on stream end via auto-pause option
- Can now skip the first x minutes of main graph where calculations are still taking place
- Time buckets fixed and now includes all viewers seen

## [0.9.81] - 2025-11-24
### Fixed
- Quick fix to include all recent months in bot detection, as a new batch has been created

## [0.9.8] - 2025-11-23
### Added
- Time tracking system for viewer heatmap analysis
- Stream summary average and max
- Graph data smoothed
- Bot threshold override

## [0.9.7] - 2025-11-14
Minor fixes
Added ability to change user from tracking page
Improved viewer details popup

## [0.9.6] - 2025-11-12

### 🎉 Pre-Release

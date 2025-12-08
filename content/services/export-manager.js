// Export Manager - Handles data export in multiple formats (CSV, XML, SQL)
window.ExportManager = class ExportManager {
    constructor(errorHandler) {
        this.errorHandler = errorHandler;
    }

    // Export tracking histogram data
    exportTrackingDataAsCSV(channelName, trackingData) {
        try {
            // CSV header
            let csv = 'channel,username,id,created_at,first_seen,last_seen,time_in_stream_seconds\n';

            // CSV rows
            for (const entry of trackingData) {
                const channel = this.escapeCSV(channelName);
                const username = this.escapeCSV(entry.username);
                const id = this.escapeCSV(entry.id || '');
                const createdAt = this.escapeCSV(entry.createdAt || '');
                const firstSeen = this.escapeCSV(entry.firstSeen);
                const lastSeen = this.escapeCSV(entry.lastSeen);
                const timeInStreamSeconds = Math.round(entry.timeInStream / 1000);

                csv += `${channel},${username},${id},${createdAt},${firstSeen},${lastSeen},${timeInStreamSeconds}\n`;
            }

            return csv;
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Tracking Data CSV');
            throw error;
        }
    }

    exportTrackingDataAsXML(channelName, trackingData) {
        try {
            let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<viewers>\n';
            xml += `  <channel>${this.escapeXML(channelName)}</channel>\n`;

            for (const entry of trackingData) {
                xml += '  <viewer>\n';
                xml += `    <username>${this.escapeXML(entry.username)}</username>\n`;
                xml += `    <id>${this.escapeXML(entry.id || '')}</id>\n`;
                xml += `    <created_at>${this.escapeXML(entry.createdAt || '')}</created_at>\n`;
                xml += `    <first_seen>${this.escapeXML(entry.firstSeen)}</first_seen>\n`;
                xml += `    <last_seen>${this.escapeXML(entry.lastSeen)}</last_seen>\n`;
                xml += `    <time_in_stream_seconds>${Math.round(entry.timeInStream / 1000)}</time_in_stream_seconds>\n`;
                xml += '  </viewer>\n';
            }

            xml += '</viewers>';

            return xml;
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Tracking Data XML');
            throw error;
        }
    }

    exportTrackingDataAsSQL(channelName, trackingData) {
        try {
            let sql = '-- Viewer Tracking Data Export\n';
            sql += `-- Channel: ${channelName}\n`;
            sql += 'CREATE TABLE IF NOT EXISTS viewer_tracking (\n';
            sql += '  channel VARCHAR(255),\n';
            sql += '  username VARCHAR(255),\n';
            sql += '  id VARCHAR(255),\n';
            sql += '  created_at DATETIME,\n';
            sql += '  first_seen DATETIME,\n';
            sql += '  last_seen DATETIME,\n';
            sql += '  time_in_stream_seconds BIGINT,\n';
            sql += '  PRIMARY KEY (channel, username)\n';
            sql += ');\n\n';

            for (const entry of trackingData) {
                const channel = this.escapeSQL(channelName);
                const username = this.escapeSQL(entry.username);
                const id = entry.id ? `'${this.escapeSQL(entry.id)}'` : 'NULL';
                const createdAt = entry.createdAt ? `'${this.escapeSQL(entry.createdAt)}'` : 'NULL';
                const firstSeen = `'${this.escapeSQL(entry.firstSeen)}'`;
                const lastSeen = `'${this.escapeSQL(entry.lastSeen)}'`;
                const timeInStreamSeconds = Math.round(entry.timeInStream / 1000);

                sql += `INSERT INTO viewer_tracking (channel, username, id, created_at, first_seen, last_seen, time_in_stream_seconds) VALUES ('${channel}', '${username}', ${id}, ${createdAt}, ${firstSeen}, ${lastSeen}, ${timeInStreamSeconds});\n`;
            }

            return sql;
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Tracking Data SQL');
            throw error;
        }
    }

    // Export viewer graph history data
    exportViewerGraphDataAsCSV(channelName, historyData) {
        try {
            // CSV header
            let csv = 'channel,timestamp,total_viewers,total_authenticated,authenticated_users,authenticated_bots\n';

            // CSV rows
            for (const entry of historyData) {
                const channel = this.escapeCSV(channelName);
                const timestamp = this.escapeCSV(entry.timestamp);
                const totalViewers = entry.totalViewers;
                const totalAuthenticated = entry.totalAuthenticated;
                const authenticatedUsers = entry.authenticatedNonBots;
                const authenticatedBots = entry.bots;

                csv += `${channel},${timestamp},${totalViewers},${totalAuthenticated},${authenticatedUsers},${authenticatedBots}\n`;
            }

            return csv;
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Viewer Graph Data CSV');
            throw error;
        }
    }

    exportViewerGraphDataAsXML(channelName, historyData) {
        try {
            let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<viewer_history>\n';
            xml += `  <channel>${this.escapeXML(channelName)}</channel>\n`;

            for (const entry of historyData) {
                xml += '  <data_point>\n';
                xml += `    <timestamp>${this.escapeXML(entry.timestamp)}</timestamp>\n`;
                xml += `    <total_viewers>${entry.totalViewers}</total_viewers>\n`;
                xml += `    <total_authenticated>${entry.totalAuthenticated}</total_authenticated>\n`;
                xml += `    <authenticated_users>${entry.authenticatedNonBots}</authenticated_users>\n`;
                xml += `    <authenticated_bots>${entry.bots}</authenticated_bots>\n`;
                xml += '  </data_point>\n';
            } xml += '</viewer_history>';

            return xml;
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Viewer Graph Data XML');
            throw error;
        }
    }

    exportViewerGraphDataAsSQL(channelName, historyData) {
        try {
            let sql = '-- Viewer Graph History Data Export\n';
            sql += `-- Channel: ${channelName}\n`;
            sql += 'CREATE TABLE IF NOT EXISTS viewer_history (\n';
            sql += '  channel VARCHAR(255),\n';
            sql += '  timestamp DATETIME,\n';
            sql += '  total_viewers INT,\n';
            sql += '  total_authenticated INT,\n';
            sql += '  authenticated_users INT,\n';
            sql += '  authenticated_bots INT,\n';
            sql += '  PRIMARY KEY (channel, timestamp)\n';
            sql += ');\n\n';

            for (const entry of historyData) {
                const channel = this.escapeSQL(channelName);
                const timestamp = `'${this.escapeSQL(entry.timestamp)}'`;
                const totalViewers = entry.totalViewers;
                const totalAuthenticated = entry.totalAuthenticated;
                const authenticatedUsers = entry.authenticatedNonBots;
                const authenticatedBots = entry.bots;

                sql += `INSERT INTO viewer_history (channel, timestamp, total_viewers, total_authenticated, authenticated_users, authenticated_bots) VALUES ('${channel}', ${timestamp}, ${totalViewers}, ${totalAuthenticated}, ${authenticatedUsers}, ${authenticatedBots});\n`;
            } return sql;
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Viewer Graph Data SQL');
            throw error;
        }
    }

    // JSON export methods
    exportTrackingDataAsJSON(channelName, trackingData) {
        try {
            const exportData = {
                version: '1.0',
                type: 'tracking',
                channel: channelName,
                exportedAt: new Date().toISOString(),
                data: trackingData
            };
            return JSON.stringify(exportData, null, 2);
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Tracking Data JSON');
            throw error;
        }
    }

    exportViewerGraphDataAsJSON(channelName, historyData) {
        try {
            const exportData = {
                version: '1.0',
                type: 'viewer_graph',
                channel: channelName,
                exportedAt: new Date().toISOString(),
                data: historyData
            };
            return JSON.stringify(exportData, null, 2);
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Viewer Graph Data JSON');
            throw error;
        }
    }

    exportFullStateAsJSON(channelName, fullStateData) {
        try {
            const exportData = {
                version: '1.0',
                type: 'full_state',
                channel: channelName,
                exportedAt: new Date().toISOString(),
                timeTrackingData: fullStateData.timeTrackingData,
                history: fullStateData.history,
                viewers: fullStateData.viewers,
                metadata: fullStateData.metadata
            };
            return JSON.stringify(exportData, null, 2);
        } catch (error) {
            this.errorHandler?.handle(error, 'Export Full State JSON');
            throw error;
        }
    }

    // Escape utilities
    escapeCSV(str) {
        if (str === null || str === undefined) return '';
        str = String(str);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }

    escapeXML(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    escapeSQL(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/'/g, "''");
    }
};

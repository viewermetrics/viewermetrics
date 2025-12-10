// API Manager for GQL requests with rate limiting
export class ApiManager {
  constructor() {
    this.requestQueue = [];
    this.requestCount = 0;
    this.maxRequests = 5000; // API call limit per minute
    this.requestWindow = 60000; // 1 minute
    this.isProcessing = false;
    this.lastResetTime = Date.now();

    // Configuration for user data fetching method
    this.useGraphQLUserBasic = true; // Default to new GraphQL method

    // Concurrent processing configuration
    this.concurrentUserInfoBatches = 50; // Max concurrent requests (default, can be updated via config)

    // Data usage tracking
    this.dataStats = {
      totalBytesSent: 0,
      totalBytesReceived: 0,
      totalApiCalls: 0,
      recentRequests: [] // Array of { timestamp, bytesSent, bytesReceived }
    };

    this.init();
  }

  async init() {
    // Start processing queue
    this.processQueue();
  }

  updateConfig(config) {
    this.useGraphQLUserBasic = config.useGraphQLUserBasic !== undefined ?
      config.useGraphQLUserBasic : this.useGraphQLUserBasic;

    this.concurrentUserInfoBatches = config.concurrentUserInfoBatches !== undefined ?
      config.concurrentUserInfoBatches : this.concurrentUserInfoBatches;
  }

  getTwitchHeaders() {
    // Simplified headers using alternate client ID
    return {
      'Client-Id': 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp',
      'Content-Type': 'application/json'
    };
  }

  async makeRequest(url, options, priority = 2) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        url,
        options,
        priority,
        resolve,
        reject,
        timestamp: Date.now()
      });

      // Sort queue by priority (lower number = higher priority)
      this.requestQueue.sort((a, b) => a.priority - b.priority);

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    // Always use concurrent processing
    await this.processConcurrentRequests();

    this.isProcessing = false;

    // Auto-restart processing if queue has new items
    if (this.requestQueue.length > 0) {
      this.processQueue();
    }
  }

  async processConcurrentRequests() {
    // Process requests concurrently (up to concurrentUserInfoBatches at a time)

    while (this.requestQueue.length > 0) {
      // Use rolling window rate limiting (matches actual requests per minute display)
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      const requestsInLastMinute = this.dataStats.recentRequests.filter(
        req => req.timestamp > oneMinuteAgo
      ).length;

      // Check if we've hit the rate limit based on rolling window
      if (requestsInLastMinute >= this.maxRequests) {
        console.warn('Rate limit reached (rolling window), waiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Take multiple requests for concurrent processing
      const concurrentRequests = [];
      const maxConcurrent = Math.min(
        this.concurrentUserInfoBatches,
        this.maxRequests - requestsInLastMinute,
        this.requestQueue.length
      );

      for (let i = 0; i < maxConcurrent; i++) {
        const request = this.requestQueue.shift();
        if (request) {
          concurrentRequests.push(request);
        }
      }

      if (concurrentRequests.length === 0) {
        break;
      }

      // Execute requests concurrently
      await this.executeConcurrentRequests(concurrentRequests);

      // No delay - process next batch immediately to maximize throughput
    }
  }

  async executeConcurrentRequests(requests) {
    const promises = requests.map(request => this.executeRequest(request));

    try {
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error in concurrent request processing:', error);
    }
  }

  async executeRequest(request) {
    try {
      // Calculate bytes sent (approximate)
      const bytesSent = this.calculateRequestSize(request.url, request.options);

      const response = await fetch(request.url, request.options);
      this.requestCount++;

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Calculate bytes received (approximate)
      const bytesReceived = this.calculateResponseSize(data);

      // Track data usage
      this.trackDataUsage(bytesSent, bytesReceived);

      request.resolve(data);
    } catch (error) {
      console.error('Request failed:', error);
      request.reject(error);
    }
  }

  async getViewerCount(channelName) {
    const query = `
      query {
        user(login: "${channelName}") {
          stream {
            viewersCount
          }
        }
      }
    `;

    try {
      const response = await this.makeRequest(
        'https://gql.twitch.tv/gql',
        {
          method: 'POST',
          headers: this.getTwitchHeaders(),
          body: JSON.stringify({ query })
        },
        1 // High priority
      );

      return response.data?.user?.stream?.viewersCount || 0;
    } catch (error) {
      console.error('Error fetching viewer count:', error);
      return 0;
    }
  }

  async getViewerList(channelName) {
    const payload = [{
      "operationName": "CommunityTab",
      "variables": {
        "login": channelName,
      },
      "extensions": {
        "persistedQuery": {
          "version": 1,
          "sha256Hash": "92168b4434c8f4d32df14510052131c3544b929723d5f8b69bb96c96207e483e"
        }
      }
    }];

    try {
      const response = await this.makeRequest(
        'https://gql.twitch.tv/gql',
        {
          method: 'POST',
          headers: this.getTwitchHeaders(),
          body: JSON.stringify(payload)
        },
        2 // Medium priority
      );

      // Extract viewer list from response
      const viewers = [];
      const data = response[0]?.data?.user?.channel?.chatters;
      let totalAuthenticatedCount = 0;

      if (data) {
        // Get the total authenticated count
        totalAuthenticatedCount = data.count || 0;

        // Combine all viewer types
        const allViewers = [
          ...(data.broadcasters || []),
          ...(data.moderators || []),
          ...(data.vips || []),
          ...(data.viewers || []),
          ...(data.chatbots || [])
        ];

        for (const viewer of allViewers) {
          viewers.push(viewer.login);
        }
      }

      return { viewers, totalAuthenticatedCount };
    } catch (error) {
      console.error('Error fetching viewer list:', error);
      return { viewers: [], totalAuthenticatedCount: 0 };
    }
  }

  async getViewerListParallel(channelName, concurrentCalls = 50) {
    // Make multiple concurrent calls to getViewerList and combine unique results
    const promises = [];
    for (let i = 0; i < concurrentCalls; i++) {
      promises.push(this.getViewerList(channelName));
    }

    const results = await Promise.allSettled(promises);

    // Combine unique viewers from all successful calls
    const allViewersSet = new Set();
    let maxAuthenticatedCount = 0;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { viewers, totalAuthenticatedCount } = result.value;
        if (Array.isArray(viewers)) {
          viewers.forEach(viewer => allViewersSet.add(viewer));
        }
        if (totalAuthenticatedCount > maxAuthenticatedCount) {
          maxAuthenticatedCount = totalAuthenticatedCount;
        }
      }
    }

    return {
      viewers: Array.from(allViewersSet),
      totalAuthenticatedCount: maxAuthenticatedCount
    };
  }

  async getUserInfo(channelLogin, usernames, priority = 3) {
    if (this.useGraphQLUserBasic) {
      return this.getUserInfoGraphQL(usernames, [], priority);
    } else {
      return this.getUserInfoViewerCard(channelLogin, usernames, priority);
    }
  }

  async getUserInfoGraphQL(usernames, extraFields = [], priority = 3) {
    // GraphQL method using GetUserBasic operation
    // Batch requests - up to 20 users per request (GraphQL API limit)
    const batchSize = 20;
    const batches = [];
    // Always include profile image, then add any extra fields
    const standardFields = ['profileImageURL(width: 300)'];
    const allFields = [...standardFields, ...extraFields];
    const extraFieldsString = allFields.length > 0 ? ' ' + allFields.join(' ') : '';

    for (let i = 0; i < usernames.length; i += batchSize) {
      batches.push(usernames.slice(i, i + batchSize));
    }

    const allUserInfo = [];

    // Process batches concurrently using Promise.allSettled
    const batchPromises = batches.map(async (batch) => {
      const payload = batch.map(username => ({
        "operationName": "GetUserBasic",
        "variables": { "login": username },
        "query": `query GetUserBasic($login: String!) { user(login: $login) { id login displayName createdAt description${extraFieldsString} } }`
      }));

      const batchUserInfo = [];

      try {
        const response = await this.makeRequest(
          'https://gql.twitch.tv/gql',
          {
            method: 'POST',
            headers: this.getTwitchHeaders(),
            body: JSON.stringify(payload)
          },
          priority // Use the passed priority instead of hardcoded 3
        );

        // Extract user info from response
        for (let i = 0; i < response.length; i++) {
          const userData = response[i]?.data?.user;
          const requestedUsername = batch[i];

          if (userData && requestedUsername) {
            const userInfoObj = {
              username: requestedUsername,
              login: userData.login || requestedUsername, // Add login field
              displayName: userData.displayName || requestedUsername,
              createdAt: userData.createdAt,
              description: userData.description || null,
              id: userData.id
            };

            // Add all fields (standard + extra)
            allFields.forEach(field => {
              // Handle GraphQL field syntax like "profileImageURL(width: 300)" or "stream{id}"
              // Extract the actual field name (everything before the first parenthesis or curly brace)
              let actualFieldName = field;
              if (field.includes('(')) {
                actualFieldName = field.split('(')[0];
              } else if (field.includes('{')) {
                actualFieldName = field.split('{')[0];
              }

              if (userData[actualFieldName] !== undefined) {
                userInfoObj[actualFieldName] = userData[actualFieldName];
              }
            });

            batchUserInfo.push(userInfoObj);
          } else if (requestedUsername) {
            // User not found or failed to load - still add to results with null data
            const userInfoObj = {
              username: requestedUsername,
              login: requestedUsername, // Add login field
              displayName: requestedUsername,
              createdAt: null,
              description: null,
              id: null
            };

            // Add null values for all fields
            allFields.forEach(field => {
              // Handle GraphQL field syntax like "profileImageURL(width: 300)" or "stream{id}"
              // Extract the actual field name (everything before the first parenthesis or curly brace)
              let actualFieldName = field;
              if (field.includes('(')) {
                actualFieldName = field.split('(')[0];
              } else if (field.includes('{')) {
                actualFieldName = field.split('{')[0];
              }
              userInfoObj[actualFieldName] = null;
            });

            batchUserInfo.push(userInfoObj);
          }
        }
      } catch (error) {
        console.error('Error fetching user info batch (GraphQL):', error);
        // Add null entries for failed batch
        for (const username of batch) {
          const userInfoObj = {
            username: username,
            createdAt: null,
            id: null
          };

          // Add null values for standard fields
          standardFields.forEach(field => {
            // Handle GraphQL field syntax like "profileImageURL(width: 300)" or "stream{id}"
            // Extract the actual field name (everything before the first parenthesis or curly brace)
            let actualFieldName = field;
            if (field.includes('(')) {
              actualFieldName = field.split('(')[0];
            } else if (field.includes('{')) {
              actualFieldName = field.split('{')[0];
            }
            userInfoObj[actualFieldName] = null;
          });

          batchUserInfo.push(userInfoObj);
        }
      }

      return batchUserInfo;
    });

    // Wait for all batches to complete and combine results
    const results = await Promise.allSettled(batchPromises);
    for (const result of results) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        allUserInfo.push(...result.value);
      }
    }

    return allUserInfo;
  }

  async getUserFollowing(usernames, options = {}, priority = 3) {
    // Get following data for multiple users
    // Options: { limit: number, getAllPages: boolean, maxPages: number }
    const { limit = 100, getAllPages = false, maxPages = 50 } = options;

    // If we're getting all pages, use the original approach (one user at a time)
    if (getAllPages) {
      return this.getUserFollowingIndividual(usernames, options, priority);
    }

    // For single page requests, batch them for efficiency
    return this.getUserFollowingBatched(usernames, options, priority);
  }

  async getUserFollowingBatched(usernames, options = {}, priority = 3) {
    // Batched approach for single page requests (more efficient)
    const { limit = 100 } = options;
    const batchSize = 20; // GraphQL API limit per batch
    const batches = [];

    for (let i = 0; i < usernames.length; i += batchSize) {
      batches.push(usernames.slice(i, i + batchSize));
    }

    const allFollowingData = [];

    for (const batch of batches) {
      try {
        const payload = batch.map(username => ({
          "operationName": "GetUserFollowing",
          "variables": {
            login: username,
            limit: Math.min(limit, 100) // API limit per request
          },
          "query": "query GetUserFollowing($login: String!, $limit: Int!) { user(login: $login) { id login follows(first: $limit, order: DESC) { totalCount edges { followedAt node { id login displayName } } } } }"
        }));

        const response = await this.makeRequest(
          'https://gql.twitch.tv/gql',
          {
            method: 'POST',
            headers: this.getTwitchHeaders(),
            body: JSON.stringify(payload)
          },
          priority // Use the passed priority instead of hardcoded 3
        );

        // Process each user's response in the batch
        for (let i = 0; i < response.length; i++) {
          const userData = response[i]?.data?.user;
          const requestedUsername = batch[i];

          if (userData && userData.follows && requestedUsername) {
            const follows = userData.follows.edges.map(edge => ({
              followedAt: edge.followedAt,
              user: {
                id: edge.node.id,
                login: edge.node.login,
                displayName: edge.node.displayName
              }
            }));

            allFollowingData.push({
              username: requestedUsername,
              follows: follows,
              totalCount: userData.follows.totalCount,
              error: null
            });
          } else if (requestedUsername) {
            // User not found or no following data
            allFollowingData.push({
              username: requestedUsername,
              follows: [],
              totalCount: 0,
              error: userData ? null : 'User not found or no following data'
            });
          }
        }

      } catch (error) {
        console.error('Error fetching following data batch:', error);
        // Add error entries for failed batch
        for (const username of batch) {
          allFollowingData.push({
            username: username,
            follows: [],
            totalCount: 0,
            error: error.message
          });
        }
      }
    }

    // Enrich all following data with user info
    for (const userFollowing of allFollowingData) {
      if (userFollowing.follows.length > 0) {
        try {
          await this.enrichFollowsWithUserInfo(userFollowing, userFollowing.username);
        } catch (enrichError) {
          console.error(`Error enriching follows for ${userFollowing.username}:`, enrichError);
          // Continue even if enrichment fails
        }
      }
    }

    return allFollowingData;
  }

  async getUserFollowingIndividual(usernames, options = {}, priority = 3) {
    // Original individual approach for getAllPages requests
    const { limit = 100, getAllPages = false, maxPages = 50 } = options;
    const allFollowingData = [];

    for (const username of usernames) {
      try {
        const userFollowing = {
          username: username,
          follows: [],
          totalCount: 0,
          error: null
        };

        let cursor = null;
        let pageCount = 0;
        let hasNextPage = true;

        while (hasNextPage && pageCount < maxPages) {
          const variables = {
            login: username,
            limit: Math.min(limit, 100), // API limit per request
            ...(cursor && { cursor })
          };

          const payload = {
            "operationName": "GetUserFollowing",
            "variables": variables,
            "query": "query GetUserFollowing($login: String!, $limit: Int!, $cursor: Cursor) { user(login: $login) { id login follows(first: $limit, after: $cursor, order: DESC) { totalCount pageInfo { hasNextPage endCursor } edges { followedAt node { id login displayName } } } } }"
          };

          const response = await this.makeRequest(
            'https://gql.twitch.tv/gql',
            {
              method: 'POST',
              headers: this.getTwitchHeaders(),
              body: JSON.stringify(payload)
            },
            priority // Use the passed priority instead of hardcoded 3
          );

          const userData = response?.data?.user;
          if (!userData || !userData.follows) {
            userFollowing.error = 'User not found or no following data';
            break;
          }

          // Set total count from first response
          if (pageCount === 0) {
            userFollowing.totalCount = userData.follows.totalCount;
          }

          // Add follows to array
          const follows = userData.follows.edges.map(edge => ({
            followedAt: edge.followedAt,
            user: {
              id: edge.node.id,
              login: edge.node.login,
              displayName: edge.node.displayName
            }
          }));

          userFollowing.follows.push(...follows);

          // Check pagination
          const pageInfo = userData.follows.pageInfo;
          hasNextPage = getAllPages && pageInfo.hasNextPage && follows.length > 0;
          cursor = pageInfo.endCursor;
          pageCount++;

          // If not getting all pages, break after first request
          if (!getAllPages) {
            break;
          }
        }

        allFollowingData.push(userFollowing);

        // After collecting all follows, enrich with user info
        if (userFollowing.follows.length > 0) {
          try {
            await this.enrichFollowsWithUserInfo(userFollowing, username);
          } catch (enrichError) {
            console.error(`Error enriching follows for ${username}:`, enrichError);
            // Continue even if enrichment fails
          }
        }

      } catch (error) {
        console.error(`Error fetching following data for ${username}:`, error);
        allFollowingData.push({
          username: username,
          follows: [],
          totalCount: 0,
          error: error.message
        });
      }
    }

    return allFollowingData;
  }

  async enrichFollowsWithUserInfo(userFollowing, requesterUsername) {
    // Enrich follows data with user info (description, createdAt, profileImageURL)
    const followUsernames = userFollowing.follows.map(follow => follow.user.login);
    const batchSize = 20;
    const concurrentBatches = this.concurrentUserInfoBatches; // Use configurable concurrent batches

    // Create all batches first
    const allBatches = [];
    for (let i = 0; i < followUsernames.length; i += batchSize) {
      const batch = followUsernames.slice(i, i + batchSize);
      allBatches.push({ batch, startIndex: i });
    }

    console.log(`Enriching ${followUsernames.length} users in ${allBatches.length} batches with ${concurrentBatches} concurrent requests`);

    // Process batches in groups concurrently using configured value
    for (let groupStart = 0; groupStart < allBatches.length; groupStart += concurrentBatches) {
      const currentGroup = allBatches.slice(groupStart, groupStart + concurrentBatches);

      // Create promises for concurrent execution - bypass the queue system
      const batchPromises = currentGroup.map(async ({ batch, startIndex }) => {
        try {
          // Make direct API call bypassing the queue system for true concurrency
          const userInfoData = await this.makeDirectUserInfoCall(batch);

          if (userInfoData && userInfoData.length > 0) {
            // Create a map for quick lookup
            const userInfoMap = new Map();
            userInfoData.forEach(userInfo => {
              if (userInfo && userInfo.login) {
                userInfoMap.set(userInfo.login.toLowerCase(), userInfo);
              }
            });

            // Enrich the follows data
            for (let j = startIndex; j < Math.min(startIndex + batchSize, userFollowing.follows.length); j++) {
              const follow = userFollowing.follows[j];
              const userInfo = userInfoMap.get(follow.user.login.toLowerCase());

              if (userInfo) {
                // Add the enriched data to the user object
                follow.user.description = userInfo.description;
                follow.user.createdAt = userInfo.createdAt;
                follow.user.profileImageURL = userInfo.profileImageURL;
                follow.user.stream = userInfo.stream || null;
              }
            }

            return { success: true, batch, processedCount: userInfoData.length };
          } else {
            console.log('No user info data received for batch:', batch);
            return { success: false, batch, error: 'No data received' };
          }

        } catch (error) {
          console.error(`Error enriching batch starting at ${startIndex}:`, error);
          return { success: false, batch, error: error.message };
        }
      });

      // Wait for all batches in this group to complete
      const results = await Promise.allSettled(batchPromises);

      // Log progress
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      console.log(`Completed batch group ${groupStart + 1}-${Math.min(groupStart + concurrentBatches, allBatches.length)} of ${allBatches.length} (${successful}/${currentGroup.length} successful)`);

      // Add a delay between concurrent groups to avoid overwhelming the API
      if (groupStart + concurrentBatches < allBatches.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    console.log(`Finished enriching follows for ${requesterUsername}`);
  }

  async makeDirectUserInfoCall(batch) {
    // Make direct API call without going through the queue system for true concurrency
    const extraFields = ['stream{id}'];
    const standardFields = ['profileImageURL(width: 300)'];
    const allFields = [...standardFields, ...extraFields];
    const extraFieldsString = allFields.length > 0 ? ' ' + allFields.join(' ') : '';

    const payload = batch.map(username => ({
      "operationName": "GetUserBasic",
      "variables": { "login": username },
      "query": `query GetUserBasic($login: String!) { user(login: $login) { id login displayName createdAt description${extraFieldsString} } }`
    }));

    try {
      const response = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: this.getTwitchHeaders(),
        body: JSON.stringify(payload)
      });

      // Increment request count for rate limit tracking
      this.requestCount++;

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const allUserInfo = [];

      // Extract user info from response
      for (let i = 0; i < data.length; i++) {
        const userData = data[i]?.data?.user;
        const requestedUsername = batch[i];

        if (userData && requestedUsername) {
          const userInfoObj = {
            username: requestedUsername,
            login: userData.login || requestedUsername,
            displayName: userData.displayName || requestedUsername,
            createdAt: userData.createdAt,
            description: userData.description || null,
            id: userData.id
          };

          // Add all fields (standard + extra)
          allFields.forEach(field => {
            let actualFieldName = field;
            if (field.includes('(')) {
              actualFieldName = field.split('(')[0];
            } else if (field.includes('{')) {
              actualFieldName = field.split('{')[0];
            }

            if (userData[actualFieldName] !== undefined) {
              userInfoObj[actualFieldName] = userData[actualFieldName];
            }
          });

          allUserInfo.push(userInfoObj);
        } else if (requestedUsername) {
          // User not found - add null data
          const userInfoObj = {
            username: requestedUsername,
            login: requestedUsername,
            displayName: requestedUsername,
            createdAt: null,
            description: null,
            id: null
          };

          allFields.forEach(field => {
            let actualFieldName = field;
            if (field.includes('(')) {
              actualFieldName = field.split('(')[0];
            } else if (field.includes('{')) {
              actualFieldName = field.split('{')[0];
            }
            userInfoObj[actualFieldName] = null;
          });

          allUserInfo.push(userInfoObj);
        }
      }

      return allUserInfo;
    } catch (error) {
      console.error('Error in direct user info call:', error);
      throw error;
    }
  }

  async getUserInfoViewerCard(channelLogin, usernames, priority = 3) {
    // ViewerCard method (fallback when GraphQL is disabled)
    // Batch requests - up to 20 users per request (GraphQL API limit)
    const batchSize = 20;
    const batches = [];

    for (let i = 0; i < usernames.length; i += batchSize) {
      batches.push(usernames.slice(i, i + batchSize));
    }

    const allUserInfo = [];

    for (const batch of batches) {
      const payload = batch.map(username => ({
        "operationName": "ViewerCard",
        "variables": {
          "channelLogin": channelLogin,
          "hasChannelID": false,
          "giftRecipientLogin": username,
          "isViewerBadgeCollectionEnabled": true,
          "withStandardGifting": false,
          "badgeSourceChannelLogin": channelLogin
        },
        "extensions": {
          "persistedQuery": {
            "version": 1,
            "sha256Hash": "80c53fe04c79a6414484104ea573c28d6a8436e031a235fc6908de63f51c74fd"
          }
        }
      }));

      try {
        const response = await this.makeRequest(
          'https://gql.twitch.tv/gql',
          {
            method: 'POST',
            headers: this.getTwitchHeaders(),
            body: JSON.stringify(payload)
          },
          priority // Use the passed priority instead of hardcoded 3
        );

        // Extract user info from response
        for (let i = 0; i < response.length; i++) {
          const userData = response[i]?.data?.targetUser;
          const requestedUsername = batch[i];

          if (userData && requestedUsername) {
            allUserInfo.push({
              username: requestedUsername,
              createdAt: userData.createdAt,
              id: userData.id
            });
          } else if (requestedUsername) {
            // User not found or failed to load - still add to results with null data
            // This prevents the user from staying in pending queue indefinitely
            allUserInfo.push({
              username: requestedUsername,
              createdAt: null,
              id: null
            });
          }
        }
      } catch (error) {
        console.error('Error fetching user info batch (ViewerCard):', error);
        // Add null entries for failed batch
        for (const username of batch) {
          allUserInfo.push({
            username: username,
            createdAt: null,
            id: null
          });
        }
      }
    }

    return allUserInfo;
  }

  calculateRequestSize(url, options) {
    // Calculate approximate size of outgoing request
    let size = url.length;

    // Add headers size
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        size += key.length + value.length + 4; // +4 for ': ' and '\r\n'
      }
    }

    // Add body size
    if (options.body) {
      size += options.body.length;
    }

    return size;
  }

  calculateResponseSize(data) {
    // Calculate approximate size of response data
    return JSON.stringify(data).length;
  }

  trackDataUsage(bytesSent, bytesReceived) {
    const now = Date.now();

    // Update totals
    this.dataStats.totalBytesSent += bytesSent;
    this.dataStats.totalBytesReceived += bytesReceived;
    this.dataStats.totalApiCalls += 1;

    // Add to recent requests
    this.dataStats.recentRequests.push({
      timestamp: now,
      bytesSent,
      bytesReceived
    });

    // Clean up old entries (keep only last minute)
    const oneMinuteAgo = now - 60000;
    this.dataStats.recentRequests = this.dataStats.recentRequests.filter(
      req => req.timestamp > oneMinuteAgo
    );
  }

  getDataUsageStats() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Calculate last minute totals
    const lastMinuteRequests = this.dataStats.recentRequests.filter(
      req => req.timestamp > oneMinuteAgo
    );

    const lastMinuteBytesSent = lastMinuteRequests.reduce(
      (sum, req) => sum + req.bytesSent, 0
    );
    const lastMinuteBytesReceived = lastMinuteRequests.reduce(
      (sum, req) => sum + req.bytesReceived, 0
    );

    return {
      total: {
        bytesSent: this.dataStats.totalBytesSent,
        bytesReceived: this.dataStats.totalBytesReceived,
        apiCalls: this.dataStats.totalApiCalls
      },
      lastMinute: {
        bytesSent: lastMinuteBytesSent,
        bytesReceived: lastMinuteBytesReceived
      },
      requestCount: lastMinuteRequests.length
    };
  }

  getRateLimitStatus() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const requestsInLastMinute = this.dataStats.recentRequests.filter(
      req => req.timestamp > oneMinuteAgo
    ).length;

    return {
      requestCount: requestsInLastMinute,
      maxRequests: this.maxRequests,
      available: this.maxRequests - requestsInLastMinute,
      queueLength: this.requestQueue.length,
      percentUsed: (requestsInLastMinute / this.maxRequests) * 100
    };
  }
}
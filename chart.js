class ChartController {
    constructor() {
        this.GRAPHQL_ENDPOINT = 'https://node.xian.org/graphql';
        this.isInverted = true; // Track whether the pair is inverted
        this.pairs = []; // Will store all pairs
        this.currentPair = null; // Currently selected pair
        this.tokens = new Map(); // Will store token metadata (symbol, logo)
        this.rawTrades = []; // Store raw trade data for the history pane
        // Add timeframe configuration
        this.timeframes = [
            { label: '30m', minutes: 30 },
            { label: '1h', minutes: 60 },
            { label: '4h', minutes: 240 },
            { label: '1d', minutes: 1440 }
        ];
        this.currentTimeframe = this.timeframes.find(tf => tf.minutes === 60) || this.timeframes[0]; // Default to 1h
        
        const chartContainer = document.getElementById('chart-container');
        this.chartContainer = chartContainer;
        
        // Create containers for selectors
        this.createSelectors();
        
        // Chart initialization will happen after loading pairs
        this.loadPairsAndInitialize();
    }

    async loadPairsAndInitialize() {
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        
        try {
            loading.style.display = 'block';
            
            // Fetch all pairs
            await this.fetchAllPairs();
            
            if (this.pairs.length === 0) {
                throw new Error('No trading pairs found');
            }
            
            // Get query parameters
            const params = this.getQueryParams();
            
            // Set pair from query params or default to first pair
            this.currentPair = params.pair ? 
                this.pairs.find(p => p.id === params.pair) : 
                this.pairs[0];
                
            // Set timeframe from query params or keep default
            if (params.timeframe) {
                const minutes = parseInt(params.timeframe);
                this.currentTimeframe = this.timeframes.find(tf => tf.minutes === minutes) || this.currentTimeframe;
            }
            
            // Set inversion from query params or keep default
            this.isInverted = params.inverted !== undefined ? params.inverted : this.isInverted;
            
            // Update selectors to match current state
            this.updateSelectorsFromState();
            
            // Initialize the chart
            this.initializeChart();
            
            loading.style.display = 'none';
            
            // Update URL with initial state
            this.updateQueryParams();
            
        } catch (err) {
            loading.style.display = 'none';
            error.textContent = 'Error loading pairs: ' + err.message;
            error.style.display = 'block';
            console.error('Initialization error:', err);
        }
    }
    
    async fetchAllPairs() {
        console.log('Fetching all trading pairs...');
        const query = `
            query GetBalanceQuery {
                allEvents(condition: {contract: "con_pairs", event: "PairCreated"}) {
                    edges {
                        node {
                            dataIndexed
                            data
                        }
                    }
                }
            }
        `;
        
        try {
            const response = await fetch(this.GRAPHQL_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query })
            });
            
            const data = await response.json();
            console.log('Pairs API response:', data);
            
            if (!data.data?.allEvents?.edges) {
                console.error('Unexpected API response structure:', data);
                return;
            }
            
            // Process pairs and fetch token info
            this.pairs = data.data.allEvents.edges.map(edge => {
                const dataIndexed = typeof edge.node.dataIndexed === 'string' 
                    ? JSON.parse(edge.node.dataIndexed) 
                    : edge.node.dataIndexed;
                    
                const pairData = typeof edge.node.data === 'string'
                    ? JSON.parse(edge.node.data)
                    : edge.node.data;
                
                return {
                    id: pairData.pair,
                    token0: dataIndexed.token0,
                    token1: dataIndexed.token1
                };
            });
            
            console.log('Processed pairs:', this.pairs);
            
            // Collect unique tokens to fetch metadata
            const uniqueTokens = new Set();
            this.pairs.forEach(pair => {
                uniqueTokens.add(pair.token0);
                uniqueTokens.add(pair.token1);
            });
            
            console.log(`Found ${uniqueTokens.size} unique tokens, fetching metadata...`);
            
            // Fetch token metadata for all tokens at once
            await this.fetchTokensMetadata(Array.from(uniqueTokens));
            
            // Update pair selector with the loaded pairs
            this.updatePairSelector();
        } catch (error) {
            console.error('Error fetching pairs:', error);
        }
    }
    
    async fetchTokensMetadata(tokenContracts) {
        if (tokenContracts.length === 0) return;
        
        console.log(`Building metadata query for ${tokenContracts.length} tokens`);
        
        // Build a combined GraphQL query for all tokens
        let query = '';
        
        // Symbol queries
        tokenContracts.forEach((token, index) => {
            // Skip if we already have this token's metadata
            if (this.tokens.has(token)) return;
            
            query += `
                symbol_${index}: allStates(condition: {key: "${token}.metadata:token_symbol"}) {
                    nodes {
                        key
                        value
                    }
                }
                logo_${index}: allStates(condition: {key: "${token}.metadata:token_logo_url"}) {
                    nodes {
                        key
                        value
                    }
                }
            `;
        });
        
        // If we have no tokens to fetch, return early
        if (!query) {
            console.log('No new tokens to fetch metadata for');
            return;
        }
        
        // Wrap in a query operation
        const fullQuery = `
            query GetTokensMetadata {
                ${query}
            }
        `;
        
        console.log('Executing token metadata query');
        
        try {
            const response = await fetch(this.GRAPHQL_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: fullQuery })
            });
            
            const data = await response.json();
            console.log('Token metadata response:', data);
            
            if (!data.data) {
                console.error('Error fetching token metadata:', data);
                return;
            }
            
            // Process the results
            tokenContracts.forEach((token, index) => {
                // Skip if we already have this token's metadata
                if (this.tokens.has(token)) return;
                
                const symbolData = data.data[`symbol_${index}`]?.nodes[0]?.value;
                const logoData = data.data[`logo_${index}`]?.nodes[0]?.value;
                
                // Extract token contract from key if possible
                const symbol = symbolData || token;
                const logo = logoData || null;
                
                // Store token metadata
                this.tokens.set(token, {
                    contract: token,
                    symbol: typeof symbol === 'string' ? symbol : JSON.stringify(symbol),
                    logo: logo
                });
                
                console.log(`Token ${token} metadata: Symbol=${this.tokens.get(token).symbol}, Has Logo=${!!logo}`);
            });
        } catch (error) {
            console.error('Error fetching metadata for tokens:', error);
            
            // Store basic info for tokens we couldn't get metadata for
            tokenContracts.forEach(token => {
                if (!this.tokens.has(token)) {
                    this.tokens.set(token, {
                        contract: token,
                        symbol: token,
                        logo: null
                    });
                }
            });
        }
    }
    
    createSelectors() {
        console.log('Creating selectors');
        const selectorContainer = document.createElement('div');
        selectorContainer.className = 'selector-container';
        // selectorContainer.style.position = 'absolute'; // Removed
        // selectorContainer.style.top = '10px'; // Removed
        // selectorContainer.style.left = '10px'; // Removed
        // selectorContainer.style.zIndex = '5'; // Removed
        selectorContainer.style.backgroundColor = '#2a2a2a';
        selectorContainer.style.padding = '8px';
        selectorContainer.style.borderRadius = '4px';
        // selectorContainer.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)'; // Removed
        selectorContainer.style.display = 'flex';
        selectorContainer.style.gap = '10px';
        selectorContainer.style.alignItems = 'center';
        
        // Pair selector
        const pairLabel = document.createElement('label');
        pairLabel.textContent = 'Trading Pair: ';
        pairLabel.style.fontWeight = '500';
        pairLabel.style.color = '#00ffff';
        
        this.pairSelect = document.createElement('select');
        this.pairSelect.className = 'pair-select';
        // this.pairSelect.style.padding = '8px 12px'; // Handled by CSS
        // this.pairSelect.style.borderRadius = '4px'; // Handled by CSS
        // this.pairSelect.style.border = '1px solid #3a3a3a'; // Handled by CSS
        // this.pairSelect.style.minWidth = '200px'; // Handled by CSS
        
        // Timeframe selector
        const timeframeLabel = document.createElement('label');
        timeframeLabel.textContent = 'Timeframe: ';
        timeframeLabel.style.fontWeight = '500';
        timeframeLabel.style.color = '#00ffff';
        
        this.timeframeSelect = document.createElement('select');
        this.timeframeSelect.className = 'timeframe-select';
        // this.timeframeSelect.style.padding = '8px 12px'; // Handled by CSS
        // this.timeframeSelect.style.borderRadius = '4px'; // Handled by CSS
        // this.timeframeSelect.style.border = '1px solid #3a3a3a'; // Handled by CSS
        
        // Add timeframe options
        this.timeframes.forEach(tf => {
            const option = document.createElement('option');
            option.value = tf.minutes;
            option.textContent = tf.label;
            this.timeframeSelect.appendChild(option);
        });
        
        // Add event listeners
        this.pairSelect.addEventListener('change', () => {
            console.log(`Pair changed to: ${this.pairSelect.value}`);
            this.changePair(this.pairSelect.value);
        });
        
        this.timeframeSelect.addEventListener('change', () => {
            const minutes = parseInt(this.timeframeSelect.value);
            this.currentTimeframe = this.timeframes.find(tf => tf.minutes === minutes);
            console.log(`Timeframe changed to: ${this.currentTimeframe.label}`);
            this.updateQueryParams();
            this.loadChartData();
        });
        
        // Add placeholder option for pair select
        const placeholderOption = document.createElement('option');
        placeholderOption.textContent = 'Loading pairs...';
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        this.pairSelect.appendChild(placeholderOption);
        
        // Append elements
        selectorContainer.appendChild(pairLabel);
        selectorContainer.appendChild(this.pairSelect);
        selectorContainer.appendChild(timeframeLabel);
        selectorContainer.appendChild(this.timeframeSelect);
        
        document.getElementById('header-bar').appendChild(selectorContainer);
        
        console.log('Selectors created');
    }
    
    updatePairSelector() {
        console.log('Updating pair selector with loaded pairs');
        
        // Clear existing options
        this.pairSelect.innerHTML = '';
        
        if (this.pairs.length === 0) {
            const noOption = document.createElement('option');
            noOption.textContent = 'No pairs available';
            noOption.disabled = true;
            noOption.selected = true;
            this.pairSelect.appendChild(noOption);
            return;
        }
        
        // Add options for each pair
        this.pairs.forEach(pair => {
            const token0 = this.tokens.get(pair.token0);
            const token1 = this.tokens.get(pair.token1);
            
            const option = document.createElement('option');
            option.value = pair.id;
            option.textContent = `${token0?.symbol || pair.token0} / ${token1?.symbol || pair.token1}`;
            
            this.pairSelect.appendChild(option);
            console.log(`Added pair option: ${option.textContent} (ID: ${pair.id})`);
        });
        
        // Select the first option by default
        if (this.pairSelect.options.length > 0) {
            this.pairSelect.selectedIndex = 0;
        }
        
        console.log('Pair selector updated with', this.pairSelect.options.length, 'options');
    }
    
    async changePair(pairId) {
        try {
            const selectedPair = this.pairs.find(p => p.id === pairId);
            if (!selectedPair) {
                console.error(`Pair with ID ${pairId} not found`);
                return;
            }
            
            this.currentPair = selectedPair;
            console.log(`Switched to pair ${pairId}:`, this.currentPair);
            
            // Update chart title
            this.updateChartTitle();
            
            // Update URL parameters
            this.updateQueryParams();
            
            // Reload chart data for the new pair
            this.loadChartData();
        } catch (err) {
            console.error('Pair change error:', err);
            const error = document.getElementById('error');
            error.textContent = 'Error changing pair: ' + err.message;
            error.style.display = 'block';
        }
    }
    
    initializeChart() {
        if (!this.currentPair) {
            console.error('Cannot initialize chart: No pair selected');
            return;
        }
        
        // First check if LightweightCharts is available
        if (typeof LightweightCharts === 'undefined') {
            console.error('LightweightCharts library not loaded');
            document.getElementById('error').textContent = 'Chart library not loaded. Please refresh the page.';
            document.getElementById('error').style.display = 'block';
            return;
        }
        
        console.log('Initializing chart for pair', this.currentPair.id);
        
        const { createChart } = LightweightCharts;
        
        // Create the chart
        this.chart = createChart(this.chartContainer, {
            width: this.chartContainer.clientWidth,
            height: this.chartContainer.clientHeight,
            layout: {
                background: { 
                    color: '#1a1a1a'
                },
                textColor: '#d4d4d4',
                fontSize: 12,
                fontFamily: "'Inter', 'Roboto', sans-serif",
            },
            grid: {
                vertLines: { color: '#2a2a2a' },
                horzLines: { color: '#2a2a2a' }
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#2a2a2a',
                textColor: '#d4d4d4',
                fixRightEdge: true,
                fixLeftEdge: true,
            },
            crosshair: {
                mode: 1,
                vertLine: {
                    color: 'rgba(0, 163, 255, 0.25)', // Updated
                    width: 1,
                    style: 1,
                },
                horzLine: {
                    color: 'rgba(0, 163, 255, 0.25)', // Updated
                    width: 1,
                    style: 1,
                }
            },
            handleScale: {
                axisPressedMouseMove: {
                    time: true,
                    price: true,
                },
            },
        });

        // Initialize series
        this.initSeries();
        
        // Create volume tooltip
        this.createVolumeTooltip();
        
        // Update chart title
        this.updateChartTitle();
        
        // Create pair inversion toggle if it doesn't exist
        if (!this.toggleContainer) {
            this.createPairToggle();
        }
        
        // Load data for the current pair
        this.loadChartData();
        
        // Handle window resizing
        window.addEventListener('resize', () => {
            if (this.chart) {
                this.chart.applyOptions({
                    width: this.chartContainer.clientWidth,
                    height: this.chartContainer.clientHeight
                });
            }
        });
    }
    
    updateChartTitle() {
        if (!this.currentPair || !this.chart) return;
        
        const token0 = this.tokens.get(this.currentPair.token0);
        const token1 = this.tokens.get(this.currentPair.token1);
        
        const title = this.isInverted 
            ? `${token0?.symbol || this.currentPair.token0} / ${token1?.symbol || this.currentPair.token1}`
            : `${token1?.symbol || this.currentPair.token1} / ${token0?.symbol || this.currentPair.token0}`;
            
        console.log(`Setting chart title to: ${title}`);
        
        this.chart.applyOptions({
            watermark: {
                visible: true,
                text: title,
                fontSize: 20, // Updated
                horzAlign: 'center',
                vertAlign: 'center',
                color: 'rgba(0, 163, 255, 0.07)', // Updated
                fontFamily: "'Inter', 'Roboto', sans-serif",
            }
        });
    }
    
    createPairToggle() {
        // Create toggle button
        this.toggleContainer = document.createElement('div');
        this.toggleContainer.className = 'toggle-container';
        // this.toggleContainer.style.position = 'absolute'; // Removed
        // this.toggleContainer.style.top = '10px'; // Removed
        // this.toggleContainer.style.right = '10px'; // Removed
        // this.toggleContainer.style.zIndex = '5'; // Removed
        
        const toggleButton = document.createElement('button');
        toggleButton.textContent = 'Invert Pair';
        toggleButton.className = 'toggle-button';
        toggleButton.style.padding = '8px 12px';
        toggleButton.style.backgroundColor = '#f0f0f0';
        toggleButton.style.border = '1px solid #ccc';
        toggleButton.style.borderRadius = '4px';
        toggleButton.style.cursor = 'pointer';
        
        this.toggleContainer.appendChild(toggleButton);
        document.getElementById('header-bar').appendChild(this.toggleContainer);
        
        // Add event listener
        toggleButton.addEventListener('click', () => {
            this.isInverted = !this.isInverted;
            toggleButton.textContent = this.isInverted ? 'Show Original Pair' : 'Invert Pair';
            this.updateChartTitle();
            this.updateQueryParams();
            this.updateTradeHistory();
            this.loadChartData();
        });
    }
    
    async fetchSwapEvents() {
        if (!this.currentPair) {
            console.error('Cannot fetch swap events: No pair selected');
            return { candles: [], volumes: [] };
        }
        
        const query = `
            query GetSwapEvents {
                allEvents(
                    condition: {contract: "con_pairs", event: "Swap"}
                    filter: {dataIndexed: {contains: {pair: "${this.currentPair.id}"}}}
                    orderBy: CREATED_DESC
                ) {
                    edges {
                        node {
                            caller
                            signer
                            dataIndexed
                            data
                            created
                        }
                    }
                }
            }
        `;

        try {
            const response = await fetch(this.GRAPHQL_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query })
            });

            const data = await response.json();
            console.log(`Received ${data.data?.allEvents?.edges?.length || 0} swap events`);
            
            if (!data.data?.allEvents?.edges) {
                console.error('Unexpected API response structure:', data);
                return { candles: [], volumes: [] };
            }

            // Log a sample timestamp to debug
            if (data.data.allEvents.edges.length > 0) {
                console.log('Sample created timestamp:', data.data.allEvents.edges[0].node.created);
            }

            // Store raw trades for history display
            this.rawTrades = data.data.allEvents.edges.map(edge => {
                const node = edge.node;
                const dataIndexed = typeof node.dataIndexed === 'string' 
                    ? JSON.parse(node.dataIndexed) 
                    : node.dataIndexed;
                const swapData = typeof node.data === 'string' 
                    ? JSON.parse(node.data) 
                    : node.data;
                
                // Store both the original timestamp string and the Date object
                const timestampStr = node.created;
                
                // Explicitly parse UTC time to avoid timezone issues
                // The created timestamp is in ISO format like "2025-03-31T12:17:47.361237"
                const timestamp = new Date(timestampStr + 'Z'); // Ensure treating as UTC by appending Z
                
                // Debug timestamps
                // console.log('Raw timestamp:', timestampStr);
                // console.log('Parsed timestamp:', timestamp.toISOString());
                // console.log('UTC Hours:', timestamp.getUTCHours());
                
                return {
                    timestamp: timestamp,
                    timestampStr: timestampStr,
                    indexed: dataIndexed,
                    data: swapData,
                    caller: node.caller,
                    signer: node.signer
                };
            });
            
            console.log(this.rawTrades)
            // For debugging, log the first trade's timestamp information
            if (this.rawTrades.length > 0) {
                const sample = this.rawTrades[0];
                console.log('First trade timestamp details:', {
                    original: sample.timestampStr,
                    parsed: sample.timestamp.toISOString(),
                    utcHours: sample.timestamp.getUTCHours(),
                    utcMinutes: sample.timestamp.getUTCMinutes()
                });
            }
            
            if (this.rawTrades.length === 0) {
                console.warn('No trades found for this pair');
                return { candles: [], volumes: [] };
            }
            
            // Sort for chart display (oldest first)
            const tradeEvents = [...this.rawTrades]
                .sort((a, b) => a.timestamp - b.timestamp);
            
            console.log(`Processing ${tradeEvents.length} trades for chart`);
            
            // Display trade history
            this.updateTradeHistory();
            
            // Create chart data from trades
            const chartData = this.processSwapEvents(tradeEvents);
            return chartData;
        } catch (error) {
            console.error('Error fetching swap events:', error);
            return { candles: [], volumes: [] };
        }
    }
    
    determineTradeType(swapData) {
        const amount0In = parseFloat(swapData.amount0In) || 0;
        const amount0Out = parseFloat(swapData.amount0Out) || 0;
        
        if (amount0In > 0) {
            return this.isInverted ? 'BUY' : 'SELL'; // Selling token0, buying token1
        } else if (amount0Out > 0) {
            return this.isInverted ? 'SELL' : 'BUY'; // Buying token0, selling token1
        }
        return 'UNKNOWN';
    }
    
    updateTradeHistory() {
        const tableBody = document.getElementById('trade-history-body');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        if (!this.rawTrades || this.rawTrades.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `<td colspan="6" style="text-align: center; padding: 20px;">No trades found for this pair</td>`;
            tableBody.appendChild(emptyRow);
            return;
        }
        
        // Sort by timestamp (newest first) - timestamps are already in UTC
        const sortedTrades = [...this.rawTrades].sort((a, b) => b.timestamp - a.timestamp);
        
        // Get token symbols
        const token0 = this.tokens.get(this.currentPair.token0);
        const token1 = this.tokens.get(this.currentPair.token1);
        const symbol0 = token0?.symbol || this.currentPair.token0;
        const symbol1 = token1?.symbol || this.currentPair.token1;
        
        // Add rows for each trade
        sortedTrades.forEach(trade => {
            try {
                const row = document.createElement('tr');
                const time = trade.timestamp; // Already a UTC Date object
                const data = trade.data;
                
                // Format time in UTC and explicitly label it
                const hours = time.getUTCHours();
                const minutes = time.getUTCMinutes();
                const day = time.getUTCDate();
                const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} UTC`;
                
                // Format date in UTC
                const formattedDate = `${day.toString().padStart(2, '0')}-${
                    (time.getUTCMonth() + 1).toString().padStart(2, '0')}-${
                    time.getUTCFullYear()}`;
                
                // Determine trade type
                const tradeType = this.determineTradeType(data);
                
                // Calculate trade amounts
                const amount0In = parseFloat(data.amount0In) || 0;
                const amount0Out = parseFloat(data.amount0Out) || 0;
                const amount1In = parseFloat(data.amount1In) || 0;
                const amount1Out = parseFloat(data.amount1Out) || 0;
                
                // Calculate price
                let price = 0;
                if (amount0Out > 0 && amount1In > 0) {
                    price = amount1In / amount0Out;
                } else if (amount0In > 0 && amount1Out > 0) {
                    price = amount1Out / amount0In;
                }
                
                if (this.isInverted && price > 0) {
                    price = 1 / price;
                }
                
                // Set amount and value based on trade type
                let amount, value;
                if (tradeType === 'BUY') {
                    amount = this.isInverted ? amount1Out : amount0Out;
                    value = this.isInverted ? amount0In : amount1In;
                } else {
                    amount = this.isInverted ? amount1In : amount0In;
                    value = this.isInverted ? amount0Out : amount1Out;
                }
                
                // Get signer address
                const signer = trade.signer || '';
                
                // Add appropriate CSS class
                row.className = tradeType.toLowerCase() === 'buy' ? 'buy-row' : 'sell-row';
                
                // Format the row content, now with signer column
                row.innerHTML = `
                    <td class="trade-time" title="${time.toISOString()}">${formattedDate} ${formattedTime}</td>
                    <td class="trade-type">${tradeType}</td>
                    <td class="trade-price">${price.toFixed(6)}</td>
                    <td class="trade-amount">${amount.toFixed(4)} ${this.isInverted ? symbol1 : symbol0}</td>
                    <td class="trade-value">${value.toFixed(4)} ${this.isInverted ? symbol0 : symbol1}</td>
                    <td class="trade-signer">
                        ${signer ? `<a href="https://explorer.xian.org/addresses/${signer}" target="_blank" rel="noopener noreferrer">${signer.slice(0, 8)}...${signer.slice(-4)}</a>` : ''}
                    </td>
                `;
                
                tableBody.appendChild(row);
            } catch (err) {
                console.error('Error rendering trade row:', err);
            }
        });
    }
    
    processSwapEvents(tradeEvents) {
        if (tradeEvents.length === 0) return { candles: [], volumes: [] };

        const trades = [];
        
        tradeEvents.forEach(trade => {
            const price = this.calculatePrice(trade.indexed, trade.data);
            if (price !== null) {
                trades.push({
                    timestamp: new Date(trade.timestamp),
                    price: price,
                    volume: parseFloat(trade.data.amount1In || 0) + parseFloat(trade.data.amount1Out || 0) || 1
                });
            }
        });

        if (trades.length === 0) return { candles: [], volumes: [] };
        
        const mostRecentTradeTime = new Date(Math.max(...trades.map(t => t.timestamp.getTime())));
        const startDate = new Date(Math.min(...trades.map(t => t.timestamp.getTime())));
        
        console.log(`Most recent trade time: ${mostRecentTradeTime.toISOString()}`);
        console.log(`Start time: ${startDate.toISOString()}`);
        
        const currentTime = new Date();
        console.log(`Current system time: ${currentTime.toISOString()}`);
        
        // Use selected timeframe interval
        const intervalMinutes = this.currentTimeframe.minutes;
        
        // Round current time to the current interval
        const currentInterval = new Date(currentTime);
        const currentIntervalHours = currentInterval.getUTCHours();
        const currentIntervalMinutes = Math.floor(currentInterval.getUTCMinutes() / intervalMinutes) * intervalMinutes;

        currentInterval.setUTCHours(currentIntervalHours);
        currentInterval.setUTCMinutes(currentIntervalMinutes);
        currentInterval.setUTCSeconds(0, 0);
        currentInterval.setUTCMilliseconds(0);

        const endDate = currentInterval;
        
        // Round start time to interval boundary
        const startInterval = new Date(startDate);
        startInterval.setUTCMinutes(Math.floor(startInterval.getUTCMinutes() / intervalMinutes) * intervalMinutes, 0, 0);
        
        // Generate all intervals
        const intervals = [];
        let intervalTime = new Date(startInterval);
        
        while (intervalTime <= endDate) {
            intervals.push(new Date(intervalTime));
            intervalTime = new Date(intervalTime.getTime() + intervalMinutes * 60000);
        }
        
        console.log(`Generated ${intervals.length} intervals for ${this.currentTimeframe.label} timeframe`);
        console.log(`First interval: ${intervals[0].toISOString()}`);
        console.log(`Last interval: ${intervals[intervals.length-1].toISOString()}`);
        
        // ONE-PASS CANDLE CREATION WITH PERFECT CONTINUITY
        const candles = [];
        const volumes = [];
        let previousClose = null;
        let currentCandle = null;
        
        // Process each interval
        for (let i = 0; i < intervals.length; i++) {
            const intervalStart = intervals[i];
            const intervalEnd = i < intervals.length - 1 ? 
                intervals[i + 1] : 
                new Date(intervalStart.getTime() + intervalMinutes * 60000);
            
            // Find trades in this interval
            const tradesInInterval = trades.filter(trade => 
                trade.timestamp >= intervalStart && 
                trade.timestamp < intervalEnd
            );
            
            // Use UNIX timestamp for the chart library
            const timestamp = Math.floor(intervalStart.getTime() / 1000);
            const isCurrentInterval = currentTime >= intervalStart && currentTime < intervalEnd;
            
            if (isCurrentInterval) {
                console.log(`Processing current interval: ${intervalStart.toISOString()} - ${intervalEnd.toISOString()}`);
                console.log(`This interval has ${tradesInInterval.length} trades`);
            }
            
            // Calculate total volume for this interval
            const totalVolume = tradesInInterval.reduce((sum, trade) => sum + trade.volume, 0);
            
            if (i === 0 && tradesInInterval.length > 0) {
                // First candle with trades - special handling
                const firstCandle = {
                    time: timestamp,
                    open: tradesInInterval[0].price,
                    high: Math.max(...tradesInInterval.map(t => t.price)),
                    low: Math.min(...tradesInInterval.map(t => t.price)),
                    close: tradesInInterval[tradesInInterval.length - 1].price,
                    tradeCount: tradesInInterval.length
                };
                
                candles.push(firstCandle);
                previousClose = firstCandle.close;
                
                volumes.push({
                    time: timestamp,
                    value: totalVolume,
                    // Updated volume colors
                    color: firstCandle.close >= firstCandle.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
                });
                
                if (isCurrentInterval) currentCandle = firstCandle;
            } else {
                // All subsequent candles
                if (previousClose === null) {
                    // Skip until we have a first trade
                    continue;
                }
                
                if (tradesInInterval.length > 0) {
                    // Candle with trades
                    const candle = {
                        time: timestamp,
                        open: previousClose,
                        close: tradesInInterval[tradesInInterval.length - 1].price,
                        tradeCount: tradesInInterval.length
                    };
                    
                    candle.high = Math.max(candle.open, ...tradesInInterval.map(t => t.price));
                    candle.low = Math.min(candle.open, ...tradesInInterval.map(t => t.price));
                    
                    candles.push(candle);
                    previousClose = candle.close;
                    
                    volumes.push({
                        time: timestamp,
                        value: totalVolume,
                        // Updated volume colors
                        color: candle.close >= candle.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
                    });
                    
                    if (isCurrentInterval) {
                        console.log(`Current candle has trades: O=${candle.open}, C=${candle.close}, Trades=${candle.tradeCount}`);
                        currentCandle = candle;
                    }
                } else {
                    // Empty candle
                    const emptyCandle = {
                        time: timestamp,
                        open: previousClose,
                        high: previousClose,
                        low: previousClose,
                        close: previousClose,
                        tradeCount: 0
                    };
                    
                    candles.push(emptyCandle);
                    
                    volumes.push({
                        time: timestamp,
                        value: 0,
                        color: 'rgba(84, 94, 112, 0.4)' // Updated empty volume color
                    });
                    
                    if (isCurrentInterval) {
                        console.log(`Current candle is empty: Price=${previousClose}`);
                        currentCandle = emptyCandle;
                    }
                }
            }
        }
        
        console.log(`Generated ${candles.length} candles`);
        
        // Verify the current candle was created
        if (currentCandle) {
            console.log(`Current candle created at timestamp ${new Date(currentCandle.time * 1000).toISOString()}`);
        } else {
            console.log(`Failed to create current candle!`);
        }
        
        return { candles, volumes };
    }

    // Update the initSeries method
    initSeries() {
        // Remove existing series if they exist
        if (this.candlestickSeries) {
            this.chart.removeSeries(this.candlestickSeries);
        }
        if (this.volumeSeries) {
            this.chart.removeSeries(this.volumeSeries);
        }

        // Create candlestick series
        this.candlestickSeries = this.chart.addCandlestickSeries({
            upColor: '#26A69A', // Updated
            downColor: '#EF5350', // Updated
            borderVisible: true,
            wickUpColor: '#26A69A', // Updated
            wickDownColor: '#EF5350', // Updated
            borderUpColor: '#26A69A', // Updated
            borderDownColor: '#EF5350', // Updated
            priceFormat: {
                type: 'price',
                precision: 4,
                minMove: 0.0001,
            },
            // Position candlesticks in the upper 70% of the chart
            priceScaleId: 'right',
            scaleMargins: {
                top: 0.1,
                bottom: 0.3,
            },
        });

        // Add volume histogram series with a separate price scale
        this.volumeSeries = this.chart.addHistogramSeries({
            color: '#0066ff80',
            priceFormat: {
                type: 'volume',
                formatter: value => value.toFixed(2),
            },
            // Use a separate price scale for volume
            priceScaleId: 'volume',
            // Position volume in the bottom 20% of the chart
            scaleMargins: {
                top: 0.8, 
                bottom: 0.0,
            },
        });

        // Configure the price scale for the main pane
        this.chart.priceScale('right').applyOptions({
            borderVisible: true,
            borderColor: '#2a2a2a',
            textColor: '#d4d4d4',
            autoScale: true,
            mode: 0,
            alignLabels: true,
            entireTextOnly: true,
            ticksVisible: true,
            scaleMargins: {
                top: 0.1,
                bottom: 0.3, // Leave space for volume
            },
            priceFormat: {
                type: 'price',
                precision: 4,
                minMove: 0.0001,
            },
        });

        // Configure the volume price scale
        this.chart.priceScale('volume').applyOptions({
            visible: true,
            borderVisible: true,
            borderColor: '#2a2a2a',
            textColor: '#d4d4d4',
            autoScale: true,
            scaleMargins: {
                top: 0.8,
                bottom: 0.0,
            },
            entireTextOnly: true,
            position: 'left',
        });

        // Add a visual separator between price and volume areas
        const separator = document.createElement('div');
        separator.style.position = 'absolute';
        separator.style.left = '0';
        separator.style.right = '0';
        separator.style.height = '1px';
        separator.style.backgroundColor = '#2a2a2a';
        separator.style.top = '70%';
        separator.style.zIndex = '3';
        this.chartContainer.appendChild(separator);

        // Add a volume label
        const volumeLabel = document.createElement('div');
        volumeLabel.style.position = 'absolute';
        volumeLabel.style.left = '10px';
        volumeLabel.style.bottom = '25%';
        volumeLabel.style.color = '#d4d4d4';
        volumeLabel.style.fontSize = '12px';
        volumeLabel.style.fontFamily = "'Inter', 'Roboto', sans-serif";
        volumeLabel.style.zIndex = '3';
        volumeLabel.textContent = 'Volume';
        this.chartContainer.appendChild(volumeLabel);
    }

    async loadChartData() {
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        
        loading.style.display = 'block';
        error.style.display = 'none';
        
        // Clear trade history while loading
        const tableBody = document.getElementById('trade-history-body');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">Loading trades...</td></tr>';
        }
        
        try {
            console.log(`Loading chart data for pair ${this.currentPair.id}`);
            
            const chartData = await this.fetchSwapEvents();
            
            if (!chartData || !chartData.candles || chartData.candles.length === 0) {
                throw new Error('No data available for this pair');
            }
            
            console.log(`📈 Received ${chartData.candles.length} candles and ${chartData.volumes.length} volume bars`);
            
            // Make sure series exist
            if (!this.candlestickSeries || !this.volumeSeries) {
                console.log('Series not found, reinitializing...');
                this.initSeries();
            }
            
            // Set both candle and volume data
            this.candlestickSeries.setData(chartData.candles);
            this.volumeSeries.setData(chartData.volumes);
            
            // Update volume lookup map for tooltip
            this.volumeByTime = new Map();
            chartData.volumes.forEach(vol => {
                this.volumeByTime.set(vol.time, vol.value);
            });
            
            // Explicitly configure the visible time range to include current candle
            const visibleLogicalRange = {
                from: Math.max(0, chartData.candles.length - 50),
                to: chartData.candles.length + 5
            };
            
            console.log(`Setting visible range: ${JSON.stringify(visibleLogicalRange)}`);
            
            // First fit all content
            this.chart.timeScale().fitContent();
            
            // Then set the visible range
            this.chart.timeScale().setVisibleLogicalRange(visibleLogicalRange);
            
            loading.style.display = 'none';
        } catch (err) {
            loading.style.display = 'none';
            error.textContent = 'Error loading chart data: ' + err.message;
            error.style.display = 'block';
            console.error('Chart data loading error:', err);
        }
    }

    // Add back the missing calculatePrice method
    calculatePrice(dataIndexed, data) {
        try {
            const indexed = typeof dataIndexed === 'string' ? JSON.parse(dataIndexed) : dataIndexed;
            const swapData = typeof data === 'string' ? JSON.parse(data) : data;

            // Get raw amounts
            const amount0In = parseFloat(swapData.amount0In) || 0;
            const amount0Out = parseFloat(swapData.amount0Out) || 0;
            const amount1In = parseFloat(swapData.amount1In) || 0;
            const amount1Out = parseFloat(swapData.amount1Out) || 0;

            let price = null;
            
            // For token1/token0 price:
            if (amount0Out > 0 && amount1In > 0) {
                // Buying token0 with token1
                price = amount1In / amount0Out;
            } else if (amount0In > 0 && amount1Out > 0) {
                // Selling token0 for token1
                price = amount1Out / amount0In;
            }
            
            // If price calculation succeeded and we want the inverted pair
            if (price !== null && this.isInverted) {
                // Invert the price (tokenB/tokenA instead of tokenA/tokenB)
                return 1 / price;
            }
            
            return price;
        } catch (error) {
            console.error('Error calculating price:', error);
            return null;
        }
    }

    getQueryParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            pair: params.get('pair'),
            timeframe: params.get('tf'),
            inverted: params.get('inverted') === 'true'
        };
    }

    updateQueryParams() {
        const params = new URLSearchParams();
        if (this.currentPair) {
            params.set('pair', this.currentPair.id);
        }
        params.set('tf', this.currentTimeframe.minutes.toString());
        params.set('inverted', this.isInverted.toString());
        
        // Update URL without reloading the page
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.pushState({}, '', newUrl);
    }

    updateSelectorsFromState() {
        // Update pair selector
        if (this.currentPair && this.pairSelect) {
            this.pairSelect.value = this.currentPair.id;
        }
        
        // Update timeframe selector
        if (this.currentTimeframe && this.timeframeSelect) {
            this.timeframeSelect.value = this.currentTimeframe.minutes.toString();
        }
    }

    createVolumeTooltip() {
        // Create a tooltip element for volume
        this.volumeTooltip = document.createElement('div');
        this.volumeTooltip.style.position = 'absolute';
        this.volumeTooltip.style.display = 'none';
        this.volumeTooltip.style.padding = '8px 12px';
        this.volumeTooltip.style.backgroundColor = '#1E222B'; // Updated
        this.volumeTooltip.style.color = '#E0E0E0'; // Updated
        this.volumeTooltip.style.borderRadius = '4px';
        this.volumeTooltip.style.fontSize = '12px';
        this.volumeTooltip.style.fontFamily = "'Inter', 'Roboto', sans-serif";
        this.volumeTooltip.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.5)'; // Updated
        this.volumeTooltip.style.zIndex = '10';
        this.volumeTooltip.style.pointerEvents = 'none'; // Don't interfere with mouse events
        this.chartContainer.appendChild(this.volumeTooltip);
        
        // Map to store time -> volume data for quick lookup
        this.volumeByTime = new Map();
        
        // Subscribe to crosshair move to update tooltip
        this.chart.subscribeCrosshairMove(param => {
            if (
                param === undefined || 
                param.time === undefined || 
                param.point === undefined || 
                param.point.x === undefined || 
                param.point.y === undefined
            ) {
                this.volumeTooltip.style.display = 'none';
                return;
            }
            
            const time = param.time;
            const volume = this.volumeByTime.get(time);
            
            if (volume !== undefined) {
                // Format volume with thousands separators
                const formattedVolume = volume.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
                
                // Determine color based on candlestick
                const candle = this.candlestickSeries.dataByTime().get(time);
                // Color for text in tooltip will now automatically use new candle colors
                const color = candle && candle.close >= candle.open ? this.candlestickSeries.options().upColor : this.candlestickSeries.options().downColor;
                
                // Position the tooltip
                const x = param.point.x;
                const y = this.chartContainer.clientHeight * 0.8; // Position near volume area
                
                this.volumeTooltip.innerHTML = `<span style="color: ${color}">Volume: ${formattedVolume}</span>`;
                this.volumeTooltip.style.left = x + 15 + 'px';
                this.volumeTooltip.style.top = y + 'px';
                this.volumeTooltip.style.display = 'block';
            } else {
                this.volumeTooltip.style.display = 'none';
            }
        });
    }
}

// Initialize the chart when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChartController();
}); 
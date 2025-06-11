// Debounce helper function
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

class ChartController {
    constructor() {
        this.GRAPHQL_ENDPOINT = 'https://node.xian.org/graphql';
        this.isInverted = true; // Track whether the pair is inverted
        this.pairs = []; // Will store all pairs
        this.currentPair = null; // Currently selected pair
        this.tokens = new Map(); // Will store token metadata (symbol, logo)
        this.rawTrades = []; // Store raw trade data for the history pane
        
        // Live update properties
        this.lastUpdateTime = null; // Track when we last fetched trades
        this.lastUpdateTimeString = null; // Store original database timestamp string for precision
        this.liveUpdateTimer = null; // Timer for live updates
        this.isLiveUpdating = false; // Flag to prevent overlapping updates
        
        // Add timeframe configuration
        this.timeframes = [
            { label: '5m', minutes: 5 },
            { label: '10m', minutes: 10 },
            { label: '15m', minutes: 15 },
            { label: '30m', minutes: 30 },
            { label: '1h', minutes: 60 },
            { label: '4h', minutes: 240 },
            { label: '1d', minutes: 1440 }
        ];
        this.currentTimeframe = this.timeframes.find(tf => tf.minutes === 60) || this.timeframes[0]; // Default to 1h
        this.activeThemeClassName = ''; // Initialize active theme class name
        this.themeSelect = null; // Initialize theme select element reference

        this.themes = [
            { name: "Dark Default", className: "theme-dark-default" },
            { name: "Light Mode", className: "theme-light" },
            { name: "Ocean Blue", className: "theme-ocean-blue" },
            { name: "Forest Green", className: "theme-forest-green" },
            { name: "Royal Purple", className: "theme-royal-purple" }
        ];
        
        const chartContainer = document.getElementById('chart-container');
        this.chartContainer = chartContainer;
        
        // Create containers for selectors
        this.createSelectors();
        
        // Initialize Modal, Theme Selector, and load saved theme
        this.initModalControls();
        this.populateThemeSelector();
        this.initThemeSelector();
        this.loadSavedTheme(); // This will call applyTheme with isInitialLoad = true
        
        // Chart initialization will happen after loading pairs
        this.loadPairsAndInitialize(); // This is now async

        // Get references to trades modal elements
        this.tradesFooter = document.getElementById('trades-footer');
        this.tradesModal = document.getElementById('trades-modal');
        this.modalCloseButton = document.getElementById('modal-close-button');
        this.modalTradesContent = document.getElementById('modal-trades-content');

        // Add event listeners for modal
        if (this.tradesFooter) {
            this.tradesFooter.addEventListener('click', () => this.openTradesModal());
        }
        if (this.modalCloseButton) {
            this.modalCloseButton.addEventListener('click', () => this.closeTradesModal());
        }
        if (this.tradesModal) {
           this.tradesModal.addEventListener('click', (event) => {
               if (event.target === this.tradesModal) { // Check if the click is on the backdrop itself
                   this.closeTradesModal();
               }
           });
        }

        // Handle page visibility change to pause/resume live updates
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseLiveUpdates();
            } else {
                this.resumeLiveUpdates();
            }
        });
    }

    openTradesModal() {
        if (!this.tradesModal) return;
        this.populateTradesModal(); // Populate content first
        this.tradesModal.classList.remove('hidden'); // Remove .hidden for slideDown if present
        this.tradesModal.style.display = 'block'; // Triggers slideUp animation
        document.body.style.overflow = 'hidden'; // Prevent body scrolling
    }

    closeTradesModal() {
        if (!this.tradesModal || this.tradesModal.style.display === 'none') return;

        const handleAnimationEnd = () => {
            // Only hide if the .hidden class is still present (i.e., not re-opened)
            if (this.tradesModal.classList.contains('hidden')) {
                this.tradesModal.style.display = 'none';
            }
            this.tradesModal.removeEventListener('animationend', handleAnimationEnd); // Clean up listener
        };

        this.tradesModal.addEventListener('animationend', handleAnimationEnd);
        this.tradesModal.classList.add('hidden'); // Trigger slideDown animation

        // Fallback: if animation doesn't fire for some reason
        setTimeout(() => {
             if (this.tradesModal.classList.contains('hidden')) {
                  this.tradesModal.style.display = 'none';
             }
             document.body.style.overflow = ''; // Ensure body scrolling is restored
        }, 300); // Duration of animation in ms, should match CSS

        document.body.style.overflow = ''; // Restore body scrolling
    }

    populateTradesModal() {
        if (!this.modalTradesContent || !this.currentPair) return;

        this.modalTradesContent.innerHTML = '';

        if (!this.rawTrades || this.rawTrades.length === 0) {
            this.modalTradesContent.innerHTML = '<p style="text-align: center; padding: 20px;">No trades found for this pair.</p>';
            return;
        }

        const sortedTrades = [...this.rawTrades].sort((a, b) => b.timestamp - a.timestamp);

        // Debug: Log the first trade's data structure
        if (sortedTrades.length > 0) {
            console.log('Trade data structure:', {
                indexed: sortedTrades[0].indexed,
                data: sortedTrades[0].data,
                timestamp: sortedTrades[0].timestamp,
                signer: sortedTrades[0].signer
            });
        }

        const token0 = this.tokens.get(this.currentPair.token0);
        const token1 = this.tokens.get(this.currentPair.token1);
        const symbol0 = token0?.symbol || this.currentPair.token0;
        const symbol1 = token1?.symbol || this.currentPair.token1;

        sortedTrades.forEach(trade => {
            const tradeDiv = document.createElement('div');
            tradeDiv.className = 'trade-entry';

            const time = trade.timestamp;
            const data = trade.data;

            const hours = time.getUTCHours();
            const minutes = time.getUTCMinutes();
            const seconds = time.getUTCSeconds();
            const day = time.getUTCDate();
            const month = time.getUTCMonth() + 1;
            const year = time.getUTCFullYear();

            const formattedTime = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year} ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} UTC`;

            const tradeType = this.determineTradeType(data);

            const amount0In = parseFloat(data.amount0In) || 0;
            const amount0Out = parseFloat(data.amount0Out) || 0;
            const amount1In = parseFloat(data.amount1In) || 0;
            const amount1Out = parseFloat(data.amount1Out) || 0;

            let price = 0;
            if (amount0Out > 0 && amount1In > 0) price = amount1In / amount0Out;
            else if (amount0In > 0 && amount1Out > 0) price = amount1Out / amount0In;
            if (this.isInverted && price > 0) price = 1 / price;

            let amount, value, amountSymbol, valueSymbol;
            if (tradeType === 'BUY') {
                amount = this.isInverted ? amount1Out : amount0Out;
                value = this.isInverted ? amount0In : amount1In;
                amountSymbol = this.isInverted ? symbol1 : symbol0;
                valueSymbol = this.isInverted ? symbol0 : symbol1;
            } else { // SELL
                amount = this.isInverted ? amount1In : amount0In;
                value = this.isInverted ? amount0Out : amount1Out;
                amountSymbol = this.isInverted ? symbol0 : symbol1;
                valueSymbol = this.isInverted ? symbol1 : symbol0;
            }

            const signer = trade.signer || 'N/A';
            const signerShort = signer.length > 12 ? `${signer.slice(0, 6)}...${signer.slice(-4)}` : signer;

            tradeDiv.innerHTML = `
                <div class="trade-details">
                    <span class="${tradeType.toLowerCase()}">${tradeType} ${amount.toFixed(4)} ${amountSymbol}</span>
                    <span>Price: ${price.toFixed(6)} ${this.isInverted ? symbol0 : symbol1}/${this.isInverted ? symbol1 : symbol0}</span>
                </div>
                <div class="trade-details">
                    <span>Value: ${value.toFixed(4)} ${valueSymbol}</span>
                    <span>Signer: ${signerShort}</span>
                </div>
                <div class="trade-meta">
                    <span>${formattedTime}</span>
                </div>
            `;

            // Add click handler to open transaction in explorer
            const txId = trade.indexed?.tx_id;
            if (txId) {
                tradeDiv.style.cursor = 'pointer';
                tradeDiv.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation(); // Prevent event bubbling
                    window.open(`https://explorer.xian.org/tx/${txId}`, '_blank', 'noopener,noreferrer');
                });
            }

            this.modalTradesContent.appendChild(tradeDiv);
        });
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
            
            // Initialize the chart (which includes an initial loadChartData)
            this.initializeChart(); // This calls loadChartData internally

            // After chart and initial data are loaded, apply the theme to chart elements
            // Note: initializeChart calls loadChartData, so this will run after the first data load.
            await this.applyCurrentThemeToChart();
            
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
        
        // Get current time and 24h ago in ISO format
        const now = new Date();
        const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
        const iso_string_24h_ago = twentyFourHoursAgo.toISOString();
        
        // First get all pairs and their latest swaps in a single query
        const query = `
            query GetPairsAndPrices {
                pairs: allEvents(
                    condition: {contract: "con_pairs", event: "PairCreated"}
                ) {
                    edges {
                        node {
                            dataIndexed
                            data
                        }
                    }
                }
                currentPrices: allEvents(
                    condition: {contract: "con_pairs", event: "Swap"}
                    orderBy: CREATED_DESC
                ) {
                    edges {
                        node {
                            dataIndexed
                            data
                            created
                        }
                    }
                }
                historicalPrices: allEvents(
                    condition: {contract: "con_pairs", event: "Swap"}
                    filter: {created: {greaterThan: "${iso_string_24h_ago}"}}
                    orderBy: CREATED_ASC
                ) {
                    edges {
                        node {
                            dataIndexed
                            data
                            created
                        }
                    }
                }
            }
        `;
        
        try {
            // Fetch all data in a single query
            const response = await fetch(this.GRAPHQL_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('API response:', data);
            
            if (!data.data?.pairs?.edges) {
                throw new Error('Unexpected API response structure: missing pairs data');
            }
            
            // Process pairs first
            this.pairs = data.data.pairs.edges.map(edge => {
                const dataIndexed = typeof edge.node.dataIndexed === 'string' 
                    ? JSON.parse(edge.node.dataIndexed) 
                    : edge.node.dataIndexed;
                    
                const pairData = typeof edge.node.data === 'string'
                    ? JSON.parse(edge.node.data)
                    : edge.node.data;
                
                return {
                    id: pairData.pair,
                    token0: dataIndexed.token0,
                    token1: dataIndexed.token1,
                    volume24h: 0,
                    currentPrice: null,
                    priceChange: null
                };
            });
            
            // Create maps for quick lookup
            const pairsMap = new Map(this.pairs.map(pair => [pair.id, pair]));
            
            // Process current prices
            if (data.data.currentPrices?.edges) {
                const currentPrices = new Map();
                
                for (const edge of data.data.currentPrices.edges) {
                    const dataIndexed = typeof edge.node.dataIndexed === 'string'
                        ? JSON.parse(edge.node.dataIndexed)
                        : edge.node.dataIndexed;
                    const swapData = typeof edge.node.data === 'string'
                        ? JSON.parse(edge.node.data)
                        : edge.node.data;
                    
                    const pairId = dataIndexed.pair;
                    if (!currentPrices.has(pairId)) {
                        const price = this.calculatePrice(dataIndexed, swapData);
                        if (price !== null) {
                            currentPrices.set(pairId, price);
                        }
                    }
                }
                
                // Update pairs with current prices
                for (const [pairId, price] of currentPrices) {
                    const pair = pairsMap.get(pairId);
                    if (pair) {
                        pair.currentPrice = price;
                    }
                }
            }
            
            // Process historical prices and calculate price changes
            if (data.data.historicalPrices?.edges) {
                const historicalPrices = new Map();
                
                for (const edge of data.data.historicalPrices.edges) {
                    const dataIndexed = typeof edge.node.dataIndexed === 'string'
                        ? JSON.parse(edge.node.dataIndexed)
                        : edge.node.dataIndexed;
                    const swapData = typeof edge.node.data === 'string'
                        ? JSON.parse(edge.node.data)
                        : edge.node.data;
                    
                    const pairId = dataIndexed.pair;
                    if (!historicalPrices.has(pairId)) {
                        const price = this.calculatePrice(dataIndexed, swapData);
                        if (price !== null && !isNaN(price) && price > 0) {
                            historicalPrices.set(pairId, price);
                        }
                    }
                }
                
                // Calculate price changes
                for (const pair of this.pairs) {
                    const currentPrice = pair.currentPrice;
                    const historicalPrice = historicalPrices.get(pair.id);
                    
                    if (currentPrice !== null && !isNaN(currentPrice) && 
                        historicalPrice !== null && !isNaN(historicalPrice) && 
                        historicalPrice > 0) {
                        pair.priceChange = ((currentPrice - historicalPrice) / historicalPrice) * 100;
                    } else {
                        pair.priceChange = 0;
                    }
                }
            }
            
            // Fetch 24h volume for each pair
            const volumePromises = this.pairs.map(async pair => {
                try {
                    // Make two requests, one for each token in the pair
                    const [volume0Res, volume1Res] = await Promise.all([
                        fetch(`https://xian-api.poc.workers.dev/pairs/${pair.id}/volume24h?token=0`, {
                            headers: { 'accept': 'application/json' }
                        }),
                        fetch(`https://xian-api.poc.workers.dev/pairs/${pair.id}/volume24h?token=1`, {
                            headers: { 'accept': 'application/json' }
                        })
                    ]);

                    if (!volume0Res.ok || !volume1Res.ok) {
                        console.error(`Failed to fetch volume for pair ${pair.id}`);
                        return;
                    }

                    const [volume0Data, volume1Data] = await Promise.all([
                        volume0Res.json(),
                        volume1Res.json()
                    ]);

                    // Use token1's volume (quote token) for display
                    if (volume1Data && typeof volume1Data.volume24h === 'number') {
                        pair.volume24h = volume1Data.volume24h;
                    }
                } catch (error) {
                    console.error(`Error fetching volume for pair ${pair.id}:`, error);
                }
            });

            // Wait for all volume requests to complete
            await Promise.all(volumePromises);
            
            console.log('Processed pairs with price changes:', this.pairs);
            
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
            
            // Update pairs panel
            this.updatePairsPanel();
            
        } catch (error) {
            console.error('Error fetching pairs:', error);
            throw error; // Re-throw to be handled by the caller
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
        selectorContainer.style.display = 'flex';
        selectorContainer.style.flexDirection = 'row';
        selectorContainer.style.alignItems = 'center';
        selectorContainer.style.justifyContent = 'space-between';
        selectorContainer.style.gap = '10px';
        selectorContainer.style.flexWrap = 'nowrap';
        selectorContainer.style.width = '100%';
        selectorContainer.style.backgroundColor = '#2a2a2a';
        selectorContainer.style.padding = '8px';
        selectorContainer.style.borderRadius = '4px';
        
        // Left side container for pair button, timeframe, and invert
        const leftGroup = document.createElement('div');
        leftGroup.style.display = 'flex';
        leftGroup.style.alignItems = 'center';
        leftGroup.style.gap = '10px';
        leftGroup.style.flexShrink = '0';
        
        // Create pair button instead of select
        const pairButton = document.createElement('button');
        pairButton.className = 'pair-button';
        pairButton.style.padding = '8px 12px';
        pairButton.style.borderRadius = '4px';
        pairButton.style.border = '1px solid var(--secondary-accent)';
        pairButton.style.backgroundColor = 'var(--input-background)';
        pairButton.style.color = 'var(--text-color)';
        pairButton.style.cursor = 'pointer';
        pairButton.style.minWidth = '120px';
        pairButton.style.textAlign = 'left';
        pairButton.style.display = 'flex';
        pairButton.style.alignItems = 'center';
        pairButton.style.justifyContent = 'space-between';
        pairButton.style.fontFamily = "'VCR MONO', monospace";
        pairButton.style.transition = 'all 0.2s ease';
        
        // Add chevron icon
        const chevron = document.createElement('span');
        chevron.innerHTML = '▼';
        chevron.style.marginLeft = '8px';
        chevron.style.fontSize = '12px';
        chevron.style.opacity = '0.7';
        pairButton.appendChild(chevron);
        
        // Store reference to button for updating text
        this.pairButton = pairButton;
        
        // Add click handler for mobile
        pairButton.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                this.togglePairsPanel();
            }
        });
        
        // Timeframe selector group
        const timeframeGroup = document.createElement('div');
        timeframeGroup.style.display = 'flex';
        timeframeGroup.style.alignItems = 'center';
        timeframeGroup.style.gap = '4px';
        timeframeGroup.style.flexShrink = '0';
        
        const timeframeLabel = document.createElement('label');
        timeframeLabel.textContent = 'TF:';
        timeframeLabel.style.fontWeight = '500';
        timeframeLabel.style.color = '#00ffff';
        timeframeLabel.style.whiteSpace = 'nowrap';
        
        this.timeframeSelect = document.createElement('select');
        this.timeframeSelect.className = 'timeframe-select';
        this.timeframeSelect.style.padding = '4px 8px';
        this.timeframeSelect.style.borderRadius = '4px';
        this.timeframeSelect.style.border = '1px solid #3a3a3a';
        this.timeframeSelect.style.width = '70px';

        // Create invert button
        const invertButton = document.createElement('button');
        invertButton.textContent = 'Invert';
        invertButton.className = 'toggle-button';
        invertButton.style.padding = '4px 12px';
        invertButton.style.backgroundColor = '#3a3a3a';
        invertButton.style.border = '1px solid var(--secondary-accent)';
        invertButton.style.borderRadius = '4px';
        invertButton.style.color = 'var(--text-color)';
        invertButton.style.cursor = 'pointer';
        invertButton.style.transition = 'all 0.2s ease';

        // Add hover effects
        pairButton.addEventListener('mouseover', () => {
            pairButton.style.borderColor = 'var(--primary-accent)';
            pairButton.style.backgroundColor = 'var(--secondary-accent)';
        });
        
        pairButton.addEventListener('mouseout', () => {
            pairButton.style.borderColor = 'var(--secondary-accent)';
            pairButton.style.backgroundColor = 'var(--input-background)';
        });

        invertButton.addEventListener('mouseover', () => {
            invertButton.style.backgroundColor = 'var(--secondary-accent)';
        });
        
        invertButton.addEventListener('mouseout', () => {
            invertButton.style.backgroundColor = '#3a3a3a';
        });

        // Add timeframe change handler
        this.timeframeSelect.addEventListener('change', () => {
            const minutes = parseInt(this.timeframeSelect.value);
            this.currentTimeframe = this.timeframes.find(tf => tf.minutes === minutes);
            console.log(`Timeframe changed to: ${this.currentTimeframe.label}`);
            this.updateQueryParams();
            this.loadChartData();
        });

        // Add invert button click handler
        invertButton.addEventListener('click', async () => {
            const visibleRange = this.chart.timeScale().getVisibleRange();
            this.isInverted = !this.isInverted;
            this.updateChartTitle();
            this.updateQueryParams();
            this.updateTradeHistory();
            
            if (this.candlestickSeries) {
                this.chart.priceScale('right').applyOptions({
                    autoScale: true,
                    scaleMargins: {
                        top: 0.1,
                        bottom: 0.3,
                    }
                });
            }
            
            await this.loadChartData();
            
            if (visibleRange) {
                this.chart.timeScale().setVisibleRange(visibleRange);
            }
        });
        
        // Add timeframe options
        this.timeframes.forEach(tf => {
            const option = document.createElement('option');
            option.value = tf.minutes;
            option.textContent = tf.label;
            this.timeframeSelect.appendChild(option);
        });
        
        // Set initial pair button text
        this.updatePairButtonText();
        
        timeframeGroup.appendChild(timeframeLabel);
        timeframeGroup.appendChild(this.timeframeSelect);
        
        // Add all elements to left group
        leftGroup.appendChild(pairButton);
        leftGroup.appendChild(timeframeGroup);
        leftGroup.appendChild(invertButton);
        
        // Add groups to container
        selectorContainer.appendChild(leftGroup);
        
        // Get header bar and set its styles
        const headerBar = document.getElementById('header-bar');
        headerBar.style.display = 'flex';
        headerBar.style.flexDirection = 'row-reverse';
        headerBar.style.alignItems = 'center';
        headerBar.style.justifyContent = 'flex-start';
        headerBar.style.gap = '10px';
        headerBar.style.padding = '4px';
        headerBar.style.width = '100%';
        headerBar.style.minHeight = '50px';
        headerBar.style.flexWrap = 'nowrap';
        
        headerBar.appendChild(selectorContainer);
        
        console.log('Selectors created');
    }

    // Add method to update pair button text
    updatePairButtonText() {
        if (!this.pairButton) return;
        
        if (!this.currentPair) {
            this.pairButton.textContent = 'Loading...';
            return;
        }
        
        const token0 = this.tokens.get(this.currentPair.token0);
        const token1 = this.tokens.get(this.currentPair.token1);
        const symbol0 = token0?.symbol || this.currentPair.token0;
        const symbol1 = token1?.symbol || this.currentPair.token1;
        
        const pairText = document.createTextNode(`${symbol0}/${symbol1}`);
        const chevron = document.createElement('span');
        chevron.innerHTML = '▼';
        chevron.style.marginLeft = '8px';
        chevron.style.fontSize = '12px';
        chevron.style.opacity = '0.7';
        
        this.pairButton.innerHTML = '';
        this.pairButton.appendChild(pairText);
        this.pairButton.appendChild(chevron);
    }
    
    updatePairSelector() {
        console.log('Updating pair selector with loaded pairs');
        
        if (!this.pairButton) return;
        
        if (this.pairs.length === 0) {
            this.updatePairButtonText(); // Will show "Loading..." text
            return;
        }
        
        // If we have a current pair, update the button text
        if (this.currentPair) {
            this.updatePairButtonText();
        } else {
            // If no current pair is set, set it to the first pair
            this.currentPair = this.pairs[0];
            this.updatePairButtonText();
        }
        
        console.log('Pair selector updated');
    }

    // Update the changePair method to update button text
    async changePair(pairId) {
        try {
            const selectedPair = this.pairs.find(p => p.id === pairId);
            if (!selectedPair) {
                console.error(`Pair with ID ${pairId} not found`);
                return;
            }
            
            // Stop live updates when changing pairs
            this.stopLiveUpdates();
            
            this.currentPair = selectedPair;
            console.log(`Switched to pair ${pairId}:`, this.currentPair);
            
            // Update button text
            this.updatePairButtonText();
            
            // Update chart title
            this.updateChartTitle();
            
            // Update URL parameters
            this.updateQueryParams();
            
            // Reset price scale and load new data
            if (this.candlestickSeries) {
                this.chart.priceScale('right').applyOptions({
                    autoScale: true,
                    scaleMargins: {
                        top: 0.1,
                        bottom: 0.3,
                    }
                });
            }
            
            // Reload chart data (this will restart live updates and set proper visible range)
            await this.loadChartData();
        } catch (err) {
            console.error('Pair change error:', err);
            const error = document.getElementById('error');
            error.textContent = 'Error changing pair: ' + err.message;
            error.style.display = 'block';
        }
    }
    
    async initializeChart() {
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
        
        // Get computed styles for consistent theming
        const computedStyles = getComputedStyle(document.body);
        const backgroundColor = computedStyles.getPropertyValue('--chart-background').trim() || '#1a1a1a';
        const textColor = computedStyles.getPropertyValue('--text-color').trim() || '#d4d4d4';
        const gridColor = computedStyles.getPropertyValue('--chart-grid-color').trim() || '#2a2a2a';
        const borderColor = computedStyles.getPropertyValue('--secondary-accent').trim();
        const accentColor = computedStyles.getPropertyValue('--primary-accent').trim();

        // Create the chart with themed colors
        this.chart = createChart(this.chartContainer, {
            width: this.chartContainer.clientWidth,
            height: this.chartContainer.clientHeight,
            layout: {
                background: { 
                    color: backgroundColor
                },
                textColor: textColor,
                fontSize: 12,
                fontFamily: "'Inter', 'Roboto', sans-serif",
                panes: {
                    separatorColor: borderColor,
                    separatorHoverColor: accentColor,
                    enableResize: true,
                },
            },
            grid: {
                vertLines: { color: gridColor },
                horzLines: { color: gridColor }
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: borderColor,
                textColor: textColor,
                fixRightEdge: true,
                fixLeftEdge: true,
            },
            crosshair: {
                mode: 1,
                vertLine: {
                    color: `${accentColor}40`,
                    width: 1,
                    style: 1,
                },
                horzLine: {
                    color: `${accentColor}40`,
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
        
        // Load data for the current pair (this is the first call to loadChartData)
        await this.loadChartData(); // Ensure this is awaited
        
        // Handle window resizing
        const debouncedResize = debounce(() => {
            if (this.chart) {
                this.chart.applyOptions({
                    width: this.chartContainer.clientWidth,
                    height: this.chartContainer.clientHeight
                });
            }
        }, 1000); // 250ms delay
        window.addEventListener('resize', debouncedResize);

        // After creating the chart, add the trade button
        const tradeButton = document.createElement('button');
        tradeButton.textContent = 'Trade Now';
        tradeButton.className = 'trade-button';
        tradeButton.style.position = 'absolute';
        tradeButton.style.top = '20px';
        tradeButton.style.left = '20px';
        tradeButton.style.zIndex = '3'; // Ensure it's above the chart
        tradeButton.style.padding = '8px 24px';
        tradeButton.style.backgroundColor = '#00C853';
        tradeButton.style.border = 'none';
        tradeButton.style.borderRadius = '4px';
        tradeButton.style.color = '#ffffff';
        tradeButton.style.cursor = 'pointer';
        tradeButton.style.transition = 'all 0.2s ease';
        tradeButton.style.fontSize = '14px';
        tradeButton.style.fontWeight = '600';
        tradeButton.style.textTransform = 'uppercase';
        tradeButton.style.letterSpacing = '0.5px';
        tradeButton.style.boxShadow = '0 2px 4px rgba(0, 200, 83, 0.2)';

        // Add hover effects
        tradeButton.addEventListener('mouseover', () => {
            tradeButton.style.backgroundColor = '#00E676';
            tradeButton.style.transform = 'translateY(-1px)';
            tradeButton.style.boxShadow = '0 4px 8px rgba(0, 200, 83, 0.3)';
        });

        tradeButton.addEventListener('mouseout', () => {
            tradeButton.style.backgroundColor = '#00C853';
            tradeButton.style.transform = 'translateY(0)';
            tradeButton.style.boxShadow = '0 2px 4px rgba(0, 200, 83, 0.2)';
        });

        // Add click handler
        tradeButton.addEventListener('click', () => {
            if (this.currentPair) {
                const token0 = this.currentPair.token1;
                const token1 = this.currentPair.token0;
                const dexUrl = `https://snakexchange.org/?token0=${token0}&token1=${token1}`;
                window.open(dexUrl, '_blank', 'noopener,noreferrer');
            }
        });

        // Make sure the chart container is position: relative
        this.chartContainer.style.position = 'relative';
        
        // Add the button to the chart container
        this.chartContainer.appendChild(tradeButton);
    }
    
    updateChartTitle() {
        if (!this.currentPair || !this.chart) return;
        
        const token0 = this.tokens.get(this.currentPair.token0);
        const token1 = this.tokens.get(this.currentPair.token1);
        
        const title = this.isInverted 
            ? `${token0?.symbol || this.currentPair.token0} / ${token1?.symbol || this.currentPair.token1}`
            : `${token1?.symbol || this.currentPair.token1} / ${token0?.symbol || this.currentPair.token0}`;
            
        console.log(`Setting chart title to: ${title}`);
        
        // Get computed styles for consistent theming
        const computedStyles = getComputedStyle(document.body);
        const primaryAccent = computedStyles.getPropertyValue('--primary-accent').trim() || '#00ffff';
        
        // Create watermark if it doesn't exist
        if (!this.watermark) {
            const { createTextWatermark } = LightweightCharts;
            this.watermark = createTextWatermark(this.chart.panes()[0], {
                horzAlign: 'center',
                vertAlign: 'center',
                lines: [
                    {
                        text: title,
                        color: `${primaryAccent}40`, // 25% opacity
                        fontSize: 48,
                        fontFamily: "'Inter', 'Roboto', sans-serif",
                        fontStyle: 'bold',
                    }
                ],
            });
        } else {
            // Update existing watermark options
            this.watermark.applyOptions({
                lines: [
                    {
                        text: title,
                        color: `${primaryAccent}40`, // 25% opacity
                        fontSize: 48,
                        fontFamily: "'Inter', 'Roboto', sans-serif",
                        fontStyle: 'bold',
                    }
                ],
            });
        }
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
                            txHash
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
            
            if (!data.data?.allEvents?.edges) {
                console.error('Unexpected API response structure:', data);
                return { candles: [], volumes: [] };
            }

            // Log the first trade's complete data structure
            if (data.data.allEvents.edges.length > 0) {
                const firstTrade = data.data.allEvents.edges[0].node;
                console.log('Raw trade data structure:', {
                    caller: firstTrade.caller,
                    signer: firstTrade.signer,
                    dataIndexed: typeof firstTrade.dataIndexed === 'string' ? 
                        JSON.parse(firstTrade.dataIndexed) : firstTrade.dataIndexed,
                    data: typeof firstTrade.data === 'string' ? 
                        JSON.parse(firstTrade.data) : firstTrade.data,
                    created: firstTrade.created,
                    txHash: firstTrade.txHash
                });
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
                
                const timestampStr = node.created;
                const timestamp = new Date(timestampStr + 'Z'); // Ensure treating as UTC
                
                return {
                    timestamp: timestamp,
                    timestampStr: timestampStr,
                    indexed: dataIndexed,
                    data: swapData,
                    caller: node.caller,
                    signer: node.signer,
                    txHash: node.txHash
                };
            });
            
            if (this.rawTrades.length === 0) {
                console.warn('No trades found for this pair');
                return { candles: [], volumes: [] };
            }
            
            // Sort for chart display (oldest first)
            const tradeEvents = [...this.rawTrades]
                .sort((a, b) => a.timestamp - b.timestamp);
            
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
                
                // Get maker address and transaction hash
                const maker = trade.signer || '';
                const makerShort = maker.length > 8 ? `${maker.slice(0, 4)}...${maker.slice(-4)}` : maker;
                
                // Add appropriate CSS class
                row.className = tradeType.toLowerCase() === 'buy' ? 'buy-row' : 'sell-row';
                
                // Format the row content with transaction icon and link
                row.innerHTML = `
                    <td class="trade-time" title="${time.toISOString()}">${formattedDate} ${formattedTime}</td>
                    <td class="trade-type">${tradeType}</td>
                    <td class="trade-price">${price.toFixed(6)}</td>
                    <td class="trade-amount">${amount.toFixed(4)} ${this.isInverted ? symbol1 : symbol0}</td>
                    <td class="trade-value">${value.toFixed(4)} ${this.isInverted ? symbol0 : symbol1}</td>
                    <td class="trade-maker">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>${makerShort}</span>
                            ${trade.txHash ? `
                                <a href="https://explorer.xian.org/tx/${trade.txHash}" 
                                   class="maker-link" 
                                   target="_blank" 
                                   rel="noopener noreferrer"
                                   title="View transaction">
                                    <svg class="tx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                                    </svg>
                                </a>
                            ` : ''}
                        </div>
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

        // Pre-sort trades by timestamp once
        tradeEvents.sort((a, b) => a.timestamp - b.timestamp);
        
        // Calculate interval in milliseconds
        const intervalMs = this.currentTimeframe.minutes * 60 * 1000;
        
        // Create a map for quick lookup of trades in each interval
        const tradesByInterval = new Map();
        
        // Group trades by interval - O(n) operation
        tradeEvents.forEach(trade => {
            const intervalTime = new Date(Math.floor(trade.timestamp.getTime() / intervalMs) * intervalMs);
            const key = intervalTime.getTime();
            
            if (!tradesByInterval.has(key)) {
                tradesByInterval.set(key, []);
            }
            tradesByInterval.get(key).push(trade);
        });
        
        // Get first trade timestamp and current time to create complete timeline
        const firstTradeTime = tradeEvents[0].timestamp.getTime();
        const currentTime = Date.now();
        
        // Create complete timeline from first trade to current time
        const firstInterval = Math.floor(firstTradeTime / intervalMs) * intervalMs;
        const currentInterval = Math.floor(currentTime / intervalMs) * intervalMs;
        
        const completeTimeline = [];
        for (let time = firstInterval; time <= currentInterval; time += intervalMs) {
            completeTimeline.push(time);
        }
        
        const candles = [];
        const volumes = [];
        let previousClose = null;
        
        // Get theme colors once
        const computedStyles = getComputedStyle(document.body);
        const buyColor = computedStyles.getPropertyValue('--buy-color').trim();
        const sellColor = computedStyles.getPropertyValue('--sell-color').trim();
        const volumeUpColor = buyColor ? `${buyColor}80` : '#0066ff80';
        const volumeDownColor = sellColor ? `${sellColor}80` : '#9933ff80';
        
        // Process complete timeline to maintain full history without gaps
        completeTimeline.forEach(time => {
            const trades = tradesByInterval.get(time) || [];
            const timestamp = Math.floor(time / 1000); // Convert to seconds for the chart
            
            if (trades.length > 0) {
                // Calculate candle data in a single pass
                let open = previousClose !== null ? previousClose : this.calculatePrice(trades[0].indexed, trades[0].data);
                let high = open;
                let low = open;
                let volume = 0;
                
                // Single pass through trades for this interval
                trades.forEach(trade => {
                    const price = this.calculatePrice(trade.indexed, trade.data);
                    if (price !== null) {
                        high = Math.max(high, price);
                        low = Math.min(low, price);
                        volume += parseFloat(trade.data.amount1In || 0) + parseFloat(trade.data.amount1Out || 0);
                    }
                });
                
                // DEBUG: Log volume calculation for recent intervals
                const timeDate = new Date(time);
                const isRecent = Date.now() - time < 300000; // Last 5 minutes
                if (isRecent && volume > 0) {
                    console.log(`💰 [DEBUG] Volume calc for ${timeDate.toISOString()}: ${trades.length} trades, volume=${volume.toFixed(4)}`);
                }
                
                const close = this.calculatePrice(trades[trades.length - 1].indexed, trades[trades.length - 1].data);
                
                candles.push({
                    time: timestamp,
                    open,
                    high,
                    low,
                    close,
                    tradeCount: trades.length
                });
                    
                    volumes.push({
                        time: timestamp,
                    value: volume,
                    color: close >= open ? volumeUpColor : volumeDownColor
                });
                
                previousClose = close;
            } else {
                // Empty interval - create candle with previous close price
                if (previousClose !== null) {
                candles.push({
                        time: timestamp,
                        open: previousClose,
                        high: previousClose,
                        low: previousClose,
                        close: previousClose,
                        tradeCount: 0
                });
                    
                    volumes.push({
                        time: timestamp,
                        value: 0,
                        color: '#80808040'
                    });
                } else {
                    // If this is the very first interval and we don't have a previous close,
                    // we need to look ahead to find the first valid price
                    let firstPrice = null;
                    for (let futureTime = time + intervalMs; futureTime <= currentInterval; futureTime += intervalMs) {
                        const futureTrades = tradesByInterval.get(futureTime);
                        if (futureTrades && futureTrades.length > 0) {
                            firstPrice = this.calculatePrice(futureTrades[0].indexed, futureTrades[0].data);
                            break;
                        }
                    }
                    
                    if (firstPrice !== null) {
                        candles.push({
                            time: timestamp,
                            open: firstPrice,
                            high: firstPrice,
                            low: firstPrice,
                            close: firstPrice,
                            tradeCount: 0
                        });
                        
                        volumes.push({
                            time: timestamp,
                            value: 0,
                            color: '#80808040'
                        });
                        
                        previousClose = firstPrice;
                    }
                }
            }
        });
        
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
        
        // Get computed styles for consistent theming
        const computedStyles = getComputedStyle(document.body);
        const textColor = computedStyles.getPropertyValue('--text-color').trim();
        const borderColor = computedStyles.getPropertyValue('--secondary-accent').trim();
        const backgroundColor = computedStyles.getPropertyValue('--chart-background').trim();

        // Update chart options with current theme colors
        this.chart.applyOptions({
            layout: {
                background: { 
                    color: backgroundColor
                },
                textColor: textColor,
                fontSize: 12,
                fontFamily: "'Inter', 'Roboto', sans-serif",
                panes: {
                    separatorColor: borderColor,
                    separatorHoverColor: `${borderColor}80`,
                    enableResize: true,
                },
            }
        });

        // Import the series constructors from LightweightCharts
        const { CandlestickSeries, HistogramSeries } = LightweightCharts;

        // Create candlestick series in the main pane
        this.candlestickSeries = this.chart.addSeries(CandlestickSeries, {
            upColor: 'var(--buy-color)',
            downColor: 'var(--sell-color)',
            borderVisible: true,
            wickUpColor: 'var(--buy-color)',
            wickDownColor: 'var(--sell-color)',
            borderUpColor: 'var(--buy-color)',
            borderDownColor: 'var(--sell-color)',
            priceFormat: {
                type: 'price',
                precision: 8,
                minMove: 0.00000001,
            },
            priceScaleId: 'right',
        });

        // Add volume histogram series to the second pane
        this.volumeSeries = this.chart.addSeries(HistogramSeries, {
            color: 'var(--primary-accent)',
            priceFormat: {
                type: 'volume',
                formatter: value => value.toFixed(2),
            },
            priceScaleId: 'right',
            base: 0,
            scaleMargins: {
                top: 0.3,
                bottom: 0.3,
            }
        }, 1);

        const secondPane = this.chart.panes()[1];
        secondPane.setHeight(100);

        // Configure the main price scale (right side)
        this.chart.priceScale('right').applyOptions({
            visible: true,
            borderVisible: true,
            borderColor: borderColor,
            textColor: textColor,
            autoScale: true,
            mode: 0,
            alignLabels: true,
            entireTextOnly: true,
            ticksVisible: true,
            scaleMargins: {
                top: 0.1,
                bottom: 0.1,
            },
        });

        // Configure the volume price scale
        this.chart.priceScale('volume').applyOptions({
            visible: true,
            borderVisible: true,
            borderColor: borderColor,
            textColor: textColor,
            autoScale: true,
            scaleMargins: {
                top: 0.1,
                bottom: 0.1,
            },
            position: 'right',
        });

        // Remove any old separators or labels that might exist
        const oldSeparator = this.chartContainer.querySelector('div[style*="position: absolute"]');
        const oldVolumeLabel = this.chartContainer.querySelector('div[style*="bottom: 25%"]');
        if (oldSeparator) oldSeparator.remove();
        if (oldVolumeLabel) oldVolumeLabel.remove();
    }

    async loadChartData() {
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        
        loading.style.display = 'block';
        error.style.display = 'none';
        
        // Stop live updates during data loading
        this.stopLiveUpdates();
        
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
            
            // Set visible range to last 50 bars
            if (chartData.candles.length > 0) {
                const timeScale = this.chart.timeScale();
                const lastIndex = chartData.candles.length - 1;
                const startIndex = Math.max(0, lastIndex - 49); // Show last 50 bars
                
                const visibleRange = {
                    from: chartData.candles[startIndex].time,
                    to: chartData.candles[lastIndex].time
                };
                
                timeScale.setVisibleRange(visibleRange);
            }
            
            // Ensure price scale is properly fitted
            this.chart.priceScale('right').applyOptions({
                autoScale: true
            });
            
            // Update trade history
            this.updateTradeHistory();
            
            loading.style.display = 'none';
            
            // Start live updates after successful data load
            this.startLiveUpdates();
            
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
        // Update pair button text
        if (this.currentPair && this.pairButton) {
            this.updatePairButtonText();
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
        this.volumeTooltip.style.backgroundColor = 'var(--modal-background)';
        this.volumeTooltip.style.color = 'var(--text-color)';
        this.volumeTooltip.style.borderRadius = '4px';
        this.volumeTooltip.style.fontSize = '12px';
        this.volumeTooltip.style.fontFamily = "'Inter', 'Roboto', sans-serif";
        this.volumeTooltip.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.3)';
        this.volumeTooltip.style.zIndex = '10';
        this.volumeTooltip.style.pointerEvents = 'none';
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
                const formattedVolume = volume.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
                
                // Get the corresponding candle data
                const candleData = param.seriesData.get(this.candlestickSeries);
                const color = candleData && candleData.close >= candleData.open ? 
                    'var(--buy-color)' : 'var(--sell-color)';
                
                const x = param.point.x;
                const y = param.point.y;
                
                this.volumeTooltip.innerHTML = `<span style="color: ${color}">Volume: ${formattedVolume}</span>`;
                this.volumeTooltip.style.left = x + 15 + 'px';
                this.volumeTooltip.style.top = y + 'px';
                this.volumeTooltip.style.display = 'block';
            } else {
                this.volumeTooltip.style.display = 'none';
            }
        });
    }

    populateThemeSelector() {
        this.themeSelect = document.getElementById('theme-select'); // Store reference
        if (!this.themeSelect) {
            console.error('Theme select element #theme-select not found.');
            return;
        }

        // Clear existing placeholder options
        this.themeSelect.innerHTML = '';

        // Populate with defined themes
        this.themes.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.className;
            option.textContent = theme.name;
            this.themeSelect.appendChild(option);
        });

        console.log('Theme selector populated.');
    }

    initThemeSelector() {
        if (!this.themeSelect) { // Use stored reference
            console.error('Theme select element #theme-select for event listener not found.');
            return;
        }
        this.themeSelect.addEventListener('change', (event) => {
            this.applyTheme(event.target.value, false); // Pass false for isInitialLoad
        });
        console.log('Theme selector initialized.');
    }

    applyTheme(themeClassName, isInitialLoad = false) {
        if (!themeClassName) return;

        // Always update body class, localStorage, and select element
        this.themes.forEach(theme => {
            document.body.classList.remove(theme.className);
        });
        document.body.classList.add(themeClassName);
        localStorage.setItem('selectedTheme', themeClassName);
        this.activeThemeClassName = themeClassName; // Store active theme class

        if (this.themeSelect) { // Check if themeSelect is initialized
            this.themeSelect.value = themeClassName;
        }
        console.log(`Theme ${themeClassName} applied. Initial load: ${isInitialLoad}`); 

        // Conditionally update chart style if not initial load and chart exists
        if (!isInitialLoad && this.chart) {
            const computedStyles = getComputedStyle(document.body);
            const chartBackgroundColor = computedStyles.getPropertyValue('--chart-background').trim();
            const chartTextColor = computedStyles.getPropertyValue('--chart-text-color').trim();
            const chartGridColor = computedStyles.getPropertyValue('--chart-grid-color').trim();
            const primaryAccentColor = computedStyles.getPropertyValue('--primary-accent').trim();
            // Ensure watermark has low alpha, e.g., '12' for ~7% opacity if hex
            const watermarkColor = primaryAccentColor.startsWith('#') ? `${primaryAccentColor}12` : primaryAccentColor;
            // Ensure crosshair has some transparency, e.g., '40' for ~25% opacity if hex
            const crosshairColor = primaryAccentColor.startsWith('#') ? `${primaryAccentColor}40` : primaryAccentColor;

            this.chart.applyOptions({
                layout: {
                    background: { color: chartBackgroundColor },
                    textColor: chartTextColor,
                },
                grid: {
                    vertLines: { color: chartGridColor },
                    horzLines: { color: chartGridColor },
                },
                watermark: {
                    color: watermarkColor,
                },
                crosshair: {
                    vertLine: { color: crosshairColor },
                    horzLine: { color: crosshairColor },
                }
            });

            if (this.candlestickSeries) {
                const buyColor = computedStyles.getPropertyValue('--buy-color').trim();
                const sellColor = computedStyles.getPropertyValue('--sell-color').trim();
                this.candlestickSeries.applyOptions({
                    upColor: buyColor,
                    downColor: sellColor,
                    wickUpColor: buyColor,
                    wickDownColor: sellColor,
                    borderUpColor: buyColor,
                    borderDownColor: sellColor,
                });
            }

            if (this.currentPair) { // Ensure a pair is selected before reloading data
                this.loadChartData();
            }
        }
    }

    loadSavedTheme() {
        let themeToLoad = localStorage.getItem('selectedTheme');
        // Default to ocean blue if no theme is saved
        if (!themeToLoad || !this.themes.find(t => t.className === themeToLoad)) {
            themeToLoad = 'theme-ocean-blue';
        }
        this.applyTheme(themeToLoad, true);
    }

    async applyCurrentThemeToChart() {
        // This method will apply the active theme's colors to chart elements.
        // It's called after the chart is initialized and initial data is loaded.
        if (!this.chart || !this.candlestickSeries || !this.activeThemeClassName) {
            console.warn("Chart, candlestickSeries, or activeThemeClassName not ready for applyCurrentThemeToChart. Active theme: ", this.activeThemeClassName);
            return;
        }
        console.log("applyCurrentThemeToChart: Applying styling for theme - ", this.activeThemeClassName);

        const computedStyles = getComputedStyle(document.body);
        const chartBackgroundColor = computedStyles.getPropertyValue('--chart-background').trim();
        const chartTextColor = computedStyles.getPropertyValue('--chart-text-color').trim();
        const chartGridColor = computedStyles.getPropertyValue('--chart-grid-color').trim();
        const primaryAccentColor = computedStyles.getPropertyValue('--primary-accent').trim();
        // Ensure watermark has low alpha, e.g., '12' for ~7% opacity if hex
        const watermarkColor = primaryAccentColor.startsWith('#') ? `${primaryAccentColor}12` : primaryAccentColor;
        // Ensure crosshair has some transparency, e.g., '40' for ~25% opacity if hex
        const crosshairColor = primaryAccentColor.startsWith('#') ? `${primaryAccentColor}40` : primaryAccentColor;

        this.chart.applyOptions({
            layout: {
                background: { color: chartBackgroundColor },
                textColor: chartTextColor,
            },
            grid: {
                vertLines: { color: chartGridColor },
                horzLines: { color: chartGridColor },
            },
            watermark: {
                color: watermarkColor,
            },
            crosshair: {
                vertLine: { color: crosshairColor },
                horzLine: { color: crosshairColor },
            }
        });

        // this.candlestickSeries is already checked by the guard clause
        const buyColor = computedStyles.getPropertyValue('--buy-color').trim();
        const sellColor = computedStyles.getPropertyValue('--sell-color').trim();
        this.candlestickSeries.applyOptions({
            upColor: buyColor,
            downColor: sellColor,
            wickUpColor: buyColor,
            wickDownColor: sellColor,
            borderUpColor: buyColor,
            borderDownColor: sellColor,
        });

        // Note: Volume bar colors are handled in processSwapEvents by reading computed styles directly.
        // No need to call loadChartData() here as this method is for styling existing chart structure.
        console.log("applyCurrentThemeToChart: Chart styles updated for theme - ", this.activeThemeClassName);
    }

    initModalControls() {
        // No longer need to initialize settings modal controls
        console.log('Modal controls initialized.');
    }

    updatePairsPanel() {
        const pairsList = document.getElementById('pairs-list');
        if (!pairsList) return;
        
        pairsList.innerHTML = '';
        
        // Sort pairs by volume
        const sortedPairs = [...this.pairs]
            .sort((a, b) => b.volume24h - a.volume24h);
        
        sortedPairs.forEach(pair => {
            const token0 = this.tokens.get(pair.token0);
            const token1 = this.tokens.get(pair.token1);
            const symbol0 = token0?.symbol || pair.token0;
            const symbol1 = token1?.symbol || pair.token1;
            
            const pairItem = document.createElement('div');
            pairItem.className = 'pair-item';
            
            // Add selected class if this is the current pair
            if (this.currentPair && pair.id === this.currentPair.id) {
                pairItem.classList.add('selected');
            }
            
            // Check if this is the USDC/XIAN pair
            const isUsdcXianPair = (
                (symbol0 === 'USDC' && symbol1 === 'XIAN') ||
                (symbol0 === 'XIAN' && symbol1 === 'USDC')
            );
            
            // For USDC/XIAN pair, show USDC/XIAN
            // For all other pairs, show inverted order
            const pairName = document.createElement('div');
            if (isUsdcXianPair) {
                pairName.textContent = 'USDC/XIAN';
            } else {
                pairName.textContent = `${symbol1}/${symbol0}`;
            }
            
            const volume = document.createElement('div');
            volume.textContent = pair.volume24h > 0 
                ? this.formatVolume(pair.volume24h)
                : '---';
            
            const priceChange = document.createElement('div');
            const changeValue = pair.priceChange;
            
            // Handle NaN, null, undefined values
            if (changeValue === null || changeValue === undefined || isNaN(changeValue)) {
                priceChange.textContent = '0%';
                priceChange.className = 'pair-change';
            } else {
                priceChange.className = `pair-change ${changeValue >= 0 ? 'positive' : 'negative'}`;
                priceChange.textContent = `${changeValue >= 0 ? '+' : ''}${changeValue.toFixed(2)}%`;
            }
            
            pairItem.appendChild(pairName);
            pairItem.appendChild(volume);
            pairItem.appendChild(priceChange);
            
            // Add click handler
            pairItem.addEventListener('click', () => {
                // Remove selected class from all pairs
                document.querySelectorAll('.pair-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                // Add selected class to clicked pair
                pairItem.classList.add('selected');
                
                this.changePair(pair.id);
                
                // On mobile, hide the pairs panel
                if (window.innerWidth <= 768) {
                    const pairsPanel = document.querySelector('.pairs-panel');
                    if (pairsPanel) {
                        pairsPanel.classList.remove('active');
                    }
                }
            });
            
            pairsList.appendChild(pairItem);
        });
    }

    formatVolume(volume) {
        if (volume >= 1000000) {
            return `${(volume / 1000000).toFixed(2)}M`;
        } else if (volume >= 1000) {
            return `${(volume / 1000).toFixed(2)}K`;
        } else {
            return volume.toFixed(2);
        }
    }

    // Add method to toggle pairs panel on mobile
    togglePairsPanel() {
        const pairsPanel = document.querySelector('.pairs-panel');
        if (pairsPanel) {
            pairsPanel.classList.toggle('active');
        }
    }

    // Handle page visibility change to pause/resume live updates
    pauseLiveUpdates() {
        if (this.liveUpdateTimer) {
            clearInterval(this.liveUpdateTimer);
            this.liveUpdateTimer = null;
            this.isLiveUpdating = false;
        }
    }

    resumeLiveUpdates() {
        if (!this.isLiveUpdating) {
            this.liveUpdateTimer = setInterval(() => {
                this.loadChartData();
            }, 5000); // 5 seconds
            this.isLiveUpdating = true;
        }
    }

    // Add methods for live updating
    async fetchNewTrades() {
        if (!this.currentPair || !this.lastUpdateTimeString) {
            console.log(`🔍 [DEBUG] fetchNewTrades: No currentPair or lastUpdateTimeString, fetching all trades`);
            // If no lastUpdateTimeString, fetch all trades (initial load)
            return await this.fetchSwapEvents();
        }

        // Use the stored database timestamp string directly for precision
        const sinceTime = this.lastUpdateTimeString;
        
        console.log(`🕒 [DEBUG] fetchNewTrades: Using stored database timestamp=${sinceTime}`);
        
        const query = `
            query GetNewSwapEvents {
                allEvents(
                    condition: {contract: "con_pairs", event: "Swap"}
                    filter: {
                        dataIndexed: {contains: {pair: "${this.currentPair.id}"}},
                        created: {greaterThan: "${sinceTime}"}
                    }
                    orderBy: CREATED_ASC
                ) {
                    edges {
                        node {
                            caller
                            signer
                            dataIndexed
                            data
                            created
                            txHash
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
            
            console.log(`📋 [DEBUG] fetchNewTrades: GraphQL returned ${data.data?.allEvents?.edges?.length || 0} edges`);
            
            if (!data.data?.allEvents?.edges) {
                return { newTrades: [], hasNewTrades: false };
            }

            // Process new trades
            const newTrades = data.data.allEvents.edges.map(edge => {
                const node = edge.node;
                const dataIndexed = typeof node.dataIndexed === 'string' 
                    ? JSON.parse(node.dataIndexed) 
                    : node.dataIndexed;
                const swapData = typeof node.data === 'string' 
                    ? JSON.parse(node.data) 
                    : node.data;
                
                const timestampStr = node.created;
                const timestamp = new Date(timestampStr + 'Z'); // Ensure treating as UTC
                
                return {
                    timestamp: timestamp,
                    timestampStr: timestampStr,
                    indexed: dataIndexed,
                    data: swapData,
                    caller: node.caller,
                    signer: node.signer,
                    txHash: node.txHash
                };
            });

            if (newTrades.length > 0) {
                console.log(`✅ [DEBUG] fetchNewTrades: Found ${newTrades.length} new trades, first: ${newTrades[0].timestampStr}, last: ${newTrades[newTrades.length - 1].timestampStr}`);
                return { newTrades, hasNewTrades: true };
            } else {
                console.log(`❌ [DEBUG] fetchNewTrades: No new trades found since ${sinceTime}`);
                return { newTrades: [], hasNewTrades: false };
            }

        } catch (error) {
            console.error('Error fetching new trades:', error);
            return { newTrades: [], hasNewTrades: false };
        }
    }

    updateChartWithNewTrades(newTrades) {
        if (!newTrades || newTrades.length === 0) {
            console.log(`⚠️ [DEBUG] updateChartWithNewTrades called with no trades`);
            return;
        }

        console.log(`🔄 [DEBUG] updateChartWithNewTrades: Adding ${newTrades.length} new trades to existing ${this.rawTrades.length} trades`);

        // Add new trades to raw trades array
        this.rawTrades = [...this.rawTrades, ...newTrades];
        
        // Sort by timestamp to maintain order
        this.rawTrades.sort((a, b) => a.timestamp - b.timestamp);

        console.log(`📊 [DEBUG] Total trades after update: ${this.rawTrades.length}`);

        // Reprocess all trades to update candles
        const allTrades = [...this.rawTrades].sort((a, b) => a.timestamp - b.timestamp);
        const chartData = this.processSwapEvents(allTrades);
        
        console.log(`📈 [DEBUG] Generated ${chartData.candles.length} candles and ${chartData.volumes.length} volume bars`);
        
        if (chartData.candles.length > 0) {
            // Update chart series with new data
            this.candlestickSeries.setData(chartData.candles);
            this.volumeSeries.setData(chartData.volumes);
            
            // Update volume lookup map for tooltip
            this.volumeByTime = new Map();
            chartData.volumes.forEach(vol => {
                this.volumeByTime.set(vol.time, vol.value);
            });
            
            // Update trade history
            this.updateTradeHistory();
            
            console.log(`✅ [DEBUG] Chart updated successfully`);
        }
    }

    startLiveUpdates() {
        if (this.liveUpdateTimer) {
            clearInterval(this.liveUpdateTimer);
        }

        // Set last update time to the timestamp of the most recent trade we have, not current time
        if (this.rawTrades && this.rawTrades.length > 0) {
            // Sort trades by timestamp and get the most recent one
            const sortedTrades = [...this.rawTrades].sort((a, b) => a.timestamp - b.timestamp);
            const mostRecentTrade = sortedTrades[sortedTrades.length - 1];
            this.lastUpdateTime = mostRecentTrade.timestamp.getTime();
            this.lastUpdateTimeString = mostRecentTrade.timestampStr; // Store original database timestamp
            console.log(`🕒 [DEBUG] Set lastUpdateTimeString to: ${this.lastUpdateTimeString}`);
        } else {
            // If no trades yet, use current time minus a small buffer
            this.lastUpdateTime = Date.now() - 30000; // 30 seconds ago
            const bufferDate = new Date(this.lastUpdateTime);
            this.lastUpdateTimeString = bufferDate.toISOString().replace('Z', '').padEnd(26, '0').substring(0, 26);
            console.log(`🕒 [DEBUG] No trades, set buffer lastUpdateTimeString to: ${this.lastUpdateTimeString}`);
        }
        
        this.liveUpdateTimer = setInterval(async () => {
            if (this.isLiveUpdating || !this.currentPair) {
                return;
            }
            
            console.log(`🔍 [DEBUG] Live update check starting - rawTrades count: ${this.rawTrades?.length || 0}`);
            
            this.isLiveUpdating = true;
            
            try {
                const { newTrades, hasNewTrades } = await this.fetchNewTrades();
                
                console.log(`📊 [DEBUG] fetchNewTrades result: hasNewTrades=${hasNewTrades}, newTrades count=${newTrades?.length || 0}`);
                
                if (hasNewTrades) {
                    console.log(`📈 [DEBUG] Processing ${newTrades.length} new trades`);
                    this.updateChartWithNewTrades(newTrades);
                    
                    // Update lastUpdateTime to the timestamp of the most recent new trade
                    const sortedNewTrades = [...newTrades].sort((a, b) => a.timestamp - b.timestamp);
                    const mostRecentNewTrade = sortedNewTrades[sortedNewTrades.length - 1];
                    this.lastUpdateTime = mostRecentNewTrade.timestamp.getTime();
                    this.lastUpdateTimeString = mostRecentNewTrade.timestampStr; // Store original database timestamp
                    console.log(`🕒 [DEBUG] Updated lastUpdateTimeString to: ${this.lastUpdateTimeString}`);
                } else {
                    console.log(`💤 [DEBUG] No new trades found - should NOT be updating chart`);
                }
                
            } catch (error) {
                console.error('Live update error:', error);
            } finally {
                this.isLiveUpdating = false;
            }
        }, 30000); // Update every 30 seconds
    }

    stopLiveUpdates() {
        if (this.liveUpdateTimer) {
            clearInterval(this.liveUpdateTimer);
            this.liveUpdateTimer = null;
            this.isLiveUpdating = false;
        }
    }

    pauseLiveUpdates() {
        if (this.liveUpdateTimer) {
            clearInterval(this.liveUpdateTimer);
            this.liveUpdateTimer = null;
            this.isLiveUpdating = false;
        }
    }

    resumeLiveUpdates() {
        if (!this.liveUpdateTimer && this.currentPair) {
            this.startLiveUpdates();
        }
    }
}

// Initialize the chart when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.chartController = new ChartController();
}); 
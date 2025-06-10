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
        selectorContainer.style.display = 'flex';
        selectorContainer.style.flexDirection = 'row';
        selectorContainer.style.alignItems = 'center';
        selectorContainer.style.justifyContent = 'space-between'; // Changed to space-between
        selectorContainer.style.gap = '10px';
        selectorContainer.style.flexWrap = 'nowrap';
        selectorContainer.style.width = '100%';
        selectorContainer.style.backgroundColor = '#2a2a2a';
        selectorContainer.style.padding = '8px';
        selectorContainer.style.borderRadius = '4px';
        
        // Left side container for pair, timeframe, and invert
        const leftGroup = document.createElement('div');
        leftGroup.style.display = 'flex';
        leftGroup.style.alignItems = 'center';
        leftGroup.style.gap = '10px';
        leftGroup.style.flexShrink = '0';
        
        // Pair selector group
        const pairGroup = document.createElement('div');
        pairGroup.style.display = 'flex';
        pairGroup.style.alignItems = 'center';
        pairGroup.style.gap = '4px';
        pairGroup.style.flexShrink = '0';
        
        const pairLabel = document.createElement('label');
        pairLabel.textContent = 'Pair:';
        pairLabel.style.fontWeight = '500';
        pairLabel.style.color = '#00ffff';
        pairLabel.style.whiteSpace = 'nowrap';
        
        this.pairSelect = document.createElement('select');
        this.pairSelect.className = 'pair-select';
        this.pairSelect.style.padding = '4px 8px';
        this.pairSelect.style.borderRadius = '4px';
        this.pairSelect.style.border = '1px solid #3a3a3a';
        this.pairSelect.style.minWidth = '120px';
        
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

        // Add hover effect
        invertButton.addEventListener('mouseover', () => {
            invertButton.style.backgroundColor = 'var(--secondary-accent)';
        });
        invertButton.addEventListener('mouseout', () => {
            invertButton.style.backgroundColor = '#3a3a3a';
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

        // Add invert button click handler
        invertButton.addEventListener('click', async () => {
            // Get current visible range before inverting
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
            
            // If we had a visible range, restore it
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
        
        // Add placeholder option for pair select
        const placeholderOption = document.createElement('option');
        placeholderOption.textContent = 'Loading...';
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        this.pairSelect.appendChild(placeholderOption);
        
        // Assemble the components
        pairGroup.appendChild(pairLabel);
        pairGroup.appendChild(this.pairSelect);
        
        timeframeGroup.appendChild(timeframeLabel);
        timeframeGroup.appendChild(this.timeframeSelect);
        
        // Add all elements to left group
        leftGroup.appendChild(pairGroup);
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

        // Remove the old toggle container since we've moved the invert button
        if (this.toggleContainer) {
            this.toggleContainer.remove();
            this.toggleContainer = null;
        }
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
            
            // Reload chart data and fit content
            await this.loadChartData();
            this.chart.timeScale().fitContent();
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
        
        // Get all interval timestamps and sort them
        const intervalTimestamps = Array.from(tradesByInterval.keys()).sort((a, b) => a - b);
        
        const candles = [];
        const volumes = [];
        let previousClose = null;
        
        // Get theme colors once
        const computedStyles = getComputedStyle(document.body);
        const buyColor = computedStyles.getPropertyValue('--buy-color').trim();
        const sellColor = computedStyles.getPropertyValue('--sell-color').trim();
        const volumeUpColor = buyColor ? `${buyColor}80` : '#0066ff80';
        const volumeDownColor = sellColor ? `${sellColor}80` : '#9933ff80';
        
        // Process all intervals to maintain full history
        intervalTimestamps.forEach(time => {
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
                // Empty interval with previous close
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
}

// Initialize the chart when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChartController();
}); 
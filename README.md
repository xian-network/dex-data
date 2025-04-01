# XIAN DEX Chart

A sleek, interactive charting application for the XIAN decentralized exchange that visualizes trading pairs with candlestick charts and volume indicators.


## Features

- **Interactive Candlestick Chart**: Visualize price movements with professional candlestick charts
- **Volume Indicator**: View trading volume in a separate pane below the price chart
- **Multiple Timeframes**: Switch between 30-minute, 1-hour, 4-hour, and 1-day candles
- **Pair Selection**: Choose from available trading pairs on the XIAN DEX
- **Pair Inversion**: Toggle between standard and inverted price views (e.g., A/B or B/A)
- **Trade History**: View recent trades in the selected pair in the bottom panel
- **Tooltips**: Hover over candlesticks to see detailed price and volume information
- **URL Parameters**: Share specific chart configurations via URL
- **Dark Theme**: Sleek dark interface with blue/purple color scheme for optimal viewing

## How It Works

The XIAN DEX Chart fetches real swap event data from the XIAN blockchain through GraphQL queries. It processes this data to create candlestick charts and volume indicators that help traders visualize market movements and identify potential trading opportunities.

### Data Flow

1. The application loads trading pairs from the XIAN blockchain
2. It fetches swap events for the selected pair
3. Swap events are processed to create candlestick data points
4. The chart is rendered using the Lightweight Charts library
5. Trade history is displayed in a table below the chart

### Chart Components

- **Main Price Chart**: Shows price action with customizable candlesticks
- **Volume Histogram**: Displays trading volume in a separate pane below the price chart
- **Time Scale**: Shows time progression along the bottom axis
- **Price Scale**: Shows price levels along the right axis
- **Volume Scale**: Shows volume levels along the left axis of the volume pane

## Technical Implementation

The application is built with:

- **Vanilla JavaScript**: Core application logic
- **Lightweight Charts**: Professional charting library from TradingView
- **GraphQL**: For fetching data from the XIAN blockchain
- **CSS**: Custom styling for the dark theme interface

The architecture follows a clean object-oriented approach with a main ChartController class handling all chart functionality and data management.

## URL Parameters

The chart supports the following URL parameters for sharing specific views:

- `pair`: Trading pair ID (e.g., `con_pair1`)
- `tf`: Timeframe in minutes (30, 60, 240, or 1440)
- `inverted`: Whether the pair view is inverted (`true` or `false`)

Example URL: `https://chart.xian.org/?pair=con_pair1&tf=60&inverted=true`

## Getting Started

1. Clone the repository
2. Open `index.html` in a web browser
3. If running locally, ensure you have access to the XIAN GraphQL endpoint

No build process is required as the application uses vanilla JavaScript.

## Browser Compatibility

Works on all modern browsers including:
- Chrome
- Firefox
- Safari
- Edge

## Future Enhancements

- Technical indicators (Moving Averages, RSI, MACD)
- Drawing tools
- Custom timeframes
- Depth charts
- Price alerts
- Mobile responsiveness improvements

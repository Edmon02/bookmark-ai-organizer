const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  
  return {
    mode: argv.mode || 'development',
    entry: {
      'background/service-worker': './src/background/service-worker.ts',
      'popup/popup': './src/popup/popup.ts'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.js', '.json'],
      fallback: {
        // Exclude Node.js polyfills that OpenAI library might try to use
        "stream": false,
        "zlib": false,
        "https": false,
        "http": false,
        "url": false,
        "buffer": false,
        "util": false
      }
    },
    optimization: {
      minimize: false, // Keep readable for Chrome extension review and debugging
      splitChunks: false // Don't split service worker into chunks
    },
    target: ['web', 'es2020'],
    // CSP-compliant source maps - no eval allowed in Chrome extensions
    devtool: isProduction ? 'source-map' : 'cheap-module-source-map',
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'src/popup/popup.html',
            to: 'popup/popup.html'
          },
          {
            from: 'src/popup/popup.css',
            to: 'popup/popup.css'
          },
          {
            from: 'src/icons',
            to: 'assets'
          },
          {
            from: 'manifest.json',
            to: 'manifest.json',
            transform(content) {
              // Transform manifest to point to dist files
              const manifest = JSON.parse(content.toString());
              manifest.background.service_worker = 'background/service-worker.js';
              manifest.action.default_popup = 'popup/popup.html';
              manifest.icons = {
                "16": "assets/icon-16.png",
                "32": "assets/icon-32.png", 
                "48": "assets/icon-48.png",
                "128": "assets/icon-128.png"
              };
              return JSON.stringify(manifest, null, 2);
            }
          }
        ]
      })
    ],
    stats: {
      errorDetails: true
    }
  };
};

# WhatsApp AI Bot

A Node.js application that integrates WhatsApp with AI models through OpenRouter API, providing automated AI responses to WhatsApp messages.

## Features

- 🤖 AI-powered responses using OpenRouter API
- 📱 WhatsApp integration via WAHA (WhatsApp HTTP API)
- 🌐 Web dashboard for configuration and monitoring
- 💾 JSON-based conversation storage
- 🔒 Rate limiting and security features
- 📊 Real-time status monitoring
- 🎯 QR code display for WhatsApp connection

## Prerequisites

- Node.js 18+ installed
- WAHA (WhatsApp HTTP API) server running
- OpenRouter API key (optional, for AI functionality)

## Installation

1. **Clone or download the project**
   ```bash
   cd "WhatsApp Agent"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Copy the `.env` file and update the values:
   ```bash
   # Server Configuration
   PORT=3001
   NODE_ENV=development
   
   # WAHA Configuration
   WAHA_URL=http://localhost:3000
   WAHA_SESSION_NAME=default
   
   # OpenRouter API Configuration
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   OPENROUTER_MODEL=openai/gpt-4o-mini
   ```

4. **Start the application**
   ```bash
   npm start
   ```

## Setup Guide

### 1. WAHA Setup

1. **Install WAHA using Docker:**
   ```bash
   docker run -it --rm -p 3000:3000/tcp devlikeapro/waha
   ```

2. **Or install WAHA locally:**
   ```bash
   npm install -g @waha/cli
   waha --port 3000
   ```

3. **Verify WAHA is running:**
   - Open http://localhost:3000 in your browser
   - You should see the WAHA API documentation

### 2. OpenRouter Setup

1. **Get an API key:**
   - Visit https://openrouter.ai/
   - Sign up for an account
   - Generate an API key

2. **Update your `.env` file:**
   ```bash
   OPENROUTER_API_KEY=sk-or-v1-your-actual-api-key-here
   ```

### 3. WhatsApp Connection

1. **Start the bot:**
   ```bash
   npm start
   ```

2. **Open the dashboard:**
   - Navigate to http://localhost:3001
   - Click "Get QR Code" to display the WhatsApp QR code

3. **Scan QR code:**
   - Open WhatsApp on your phone
   - Go to Settings > Linked Devices
   - Scan the QR code displayed on the dashboard

## Usage

### Web Dashboard

Access the dashboard at `http://localhost:3001` to:

- **View QR Code**: Display QR code for WhatsApp connection
- **Configure AI Settings**: Set OpenRouter API key, model, and system prompt
- **Monitor Status**: Check WAHA connection, OpenRouter configuration, and message statistics
- **View Conversations**: Browse recent WhatsApp conversations
- **Test API**: Verify OpenRouter API connectivity

### API Endpoints

- `GET /` - Web dashboard
- `GET /qr` - Get WhatsApp QR code
- `GET /status` - System status
- `GET /config` - Current configuration
- `POST /config` - Update configuration
- `GET /conversations` - Conversation history
- `DELETE /conversations` - Clear conversation history
- `POST /test-openrouter` - Test OpenRouter API
- `POST /webhook` - Webhook for WhatsApp messages
- `GET /health` - Health check endpoint

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | 3001 | Yes |
| `NODE_ENV` | Environment | development | No |
| `WAHA_URL` | WAHA server URL | http://localhost:3000 | Yes |
| `WAHA_SESSION_NAME` | WhatsApp session name | default | Yes |
| `WAHA_EVENTS_WEBHOOK_URL` | Full public URL WAHA should call for events (overrides below) | - | No |
| `PUBLIC_BASE_URL` | Base URL for this server, used to derive events webhook (`${PUBLIC_BASE_URL}/waha-events`) | - | No |
| `OPENROUTER_API_KEY` | OpenRouter API key | - | No* |
| `OPENROUTER_MODEL` | AI model to use | openai/gpt-4o-mini | No |
| `SYSTEM_PROMPT` | AI system prompt | Default helpful assistant | No |
| `WEBHOOK_PATH` | Webhook endpoint path | /webhook | No |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | 60000 | No |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | 100 | No |
| `LOG_LEVEL` | Logging level | info | No |
| `CORS_ORIGIN` | CORS origin | * | No |
| `HELMET_ENABLED` | Enable Helmet security | true | No |

*Required for AI functionality

Notes:
- If `WAHA_EVENTS_WEBHOOK_URL` is set, it will be used as-is for the WAHA events webhook.
- If not set, and `PUBLIC_BASE_URL` is provided, the webhook is `${PUBLIC_BASE_URL}/waha-events`.
- Otherwise, the webhook defaults to `http://localhost:${PORT}/waha-events`.

## File Structure

```
WhatsApp Agent/
├── api/                    # API route handlers
├── data/                   # JSON data storage
│   ├── conversations.json  # Chat history
│   ├── config.json        # App configuration
│   └── status.json        # System status
├── public/                 # Web dashboard files
│   ├── index.html         # Dashboard HTML
│   ├── styles.css         # Dashboard styles
│   └── script.js          # Dashboard JavaScript
├── services/               # Core services
│   ├── wahaService.js     # WAHA API integration
│   ├── openrouterService.js # OpenRouter API integration
│   ├── memoryService.js   # JSON file management
│   └── messageProcessor.js # Message processing logic
├── utils/                  # Utility modules
│   ├── errorHandler.js    # Error handling and logging
│   └── configValidator.js # Configuration validation
├── .env                    # Environment variables
├── package.json           # Dependencies and scripts
├── server.js              # Main server file
└── README.md              # This file
```

## Troubleshooting

### Common Issues

1. **"WAHA connection failed"**
   - Ensure WAHA is running on the correct port
   - Check the `WAHA_URL` in your `.env` file
   - Verify WAHA is accessible at http://localhost:3000

2. **"OpenRouter API error"**
   - Verify your API key is correct
   - Check your OpenRouter account has sufficient credits
   - Ensure the model name is valid

3. **"QR code not displaying"**
   - Check WAHA connection status
   - Ensure WhatsApp session is properly configured
   - Try restarting both WAHA and the bot

4. **"Messages not being processed"**
   - Check webhook configuration in WAHA
   - Verify the webhook URL is accessible
   - Check server logs for errors

### Logs and Debugging

1. **Enable debug logging:**
   ```bash
   LOG_LEVEL=debug npm start
   ```

2. **Check system health:**
   ```bash
   curl http://localhost:3001/health
   ```

3. **View error logs:**
   - Errors are logged to the console
   - Check the `data/status.json` file for error history

### Performance Tips

1. **Rate Limiting**: Adjust `RATE_LIMIT_MAX_REQUESTS` based on your needs
2. **Memory Usage**: Conversations are limited to the last 50 messages per chat
3. **Response Time**: Use faster models like `openai/gpt-3.5-turbo` for quicker responses

## Development

### Running in Development Mode

```bash
# Install nodemon for auto-restart
npm install -g nodemon

# Start with auto-restart
nodemon server.js
```

### Testing

```bash
# Test OpenRouter API
curl -X POST http://localhost:3001/test-openrouter \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, test message"}'

# Check system status
curl http://localhost:3001/status

# Health check
curl http://localhost:3001/health
```

## Security Considerations

- Keep your OpenRouter API key secure
- Use environment variables for sensitive configuration
- Enable rate limiting in production
- Consider using HTTPS in production
- Regularly update dependencies

## License

This project is open source and available under the MIT License.

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review the server logs for error messages
3. Ensure all prerequisites are properly installed
4. Verify environment configuration

## Contributing

Contributions are welcome! Please ensure:
- Code follows the existing style
- All features are properly tested
- Documentation is updated accordingly

## Persistent Memory

- Every incoming and outgoing message is appended to an append-only JSON Lines file at `data/messages.jsonl` (configurable via `MEMORY_LOG_FILE_PATH`).
- The AI uses this permanent log to reconstruct conversation history for each user on every reply; the prompt includes only the most recent messages based on an internal history limit to control latency and token usage.
- The dashboard’s Clear Conversations button (`DELETE /conversations`) resets only the UI’s `data/conversations.json` preview. It does not delete the permanent log. To fully reset memory, stop the server and delete `data/messages.jsonl` manually.

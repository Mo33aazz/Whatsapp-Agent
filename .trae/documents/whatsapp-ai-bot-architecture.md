# WhatsApp AI Bot - Technical Architecture Document

## 1. Architecture Design

```mermaid
graph TD
    A[User Browser] --> B[Express.js Backend]
    C[WhatsApp Users] --> D[WAHA API Docker Container]
    D --> E[Webhook Endpoint]
    E --> B
    B --> F[OpenRouter API]
    B --> G[In-Memory Storage]
    B --> H[File System Storage]

    subgraph "Frontend Layer"
        A
    end

    subgraph "Backend Layer"
        B
        E
        G
        H
    end

    subgraph "External Services"
        D
        F
    end

    subgraph "WhatsApp Layer"
        C
    end
```

## 2. Technology Description

* Frontend: HTML5 + CSS3 + Vanilla JavaScript

* Backend: Node.js + Express.js + Axios

* Storage: JSON file system + In-memory cache

* External APIs: WAHA API (Docker), OpenRouter API

## 3. Route Definitions

| Route              | Purpose                                       |
| ------------------ | --------------------------------------------- |
| GET /              | Home dashboard with QR code and configuration |
| GET /qr            | Display QR code for WhatsApp authentication   |
| POST /config       | Configure OpenRouter API key and settings     |
| POST /webhook      | Receive incoming WhatsApp messages from WAHA  |
| GET /status        | Get connection and system status              |
| GET /conversations | View conversation history                     |

## 4. API Definitions

### 4.1 Core API

**Configuration Management**

```
POST /config
```

Request:

| Param Name       | Param Type | isRequired | Description                                 |
| ---------------- | ---------- | ---------- | ------------------------------------------- |
| openrouterApiKey | string     | true       | OpenRouter API key for AI model access      |
| aiModel          | string     | false      | AI model name (default: openai/gpt-4o-mini) |
| systemPrompt     | string     | false      | Custom system prompt for AI responses       |

Response:

| Param Name | Param Type | Description                 |
| ---------- | ---------- | --------------------------- |
| success    | boolean    | Configuration update status |
| message    | string     | Status message              |

Example:

```json
{
  "openrouterApiKey": "sk-or-v1-...",
  "aiModel": "openai/gpt-4o-mini",
  "systemPrompt": "You are a helpful WhatsApp assistant."
}
```

**Webhook Handler**

```
POST /webhook
```

Request:

| Param Name | Param Type | isRequired | Description                          |
| ---------- | ---------- | ---------- | ------------------------------------ |
| event      | string     | true       | Event type (message, session.status) |
| session    | string     | true       | WhatsApp session identifier          |
| payload    | object     | true       | Message data from WAHA               |

Response:

| Param Name | Param Type | Description                   |
| ---------- | ---------- | ----------------------------- |
| status     | string     | Processing status             |
| processed  | boolean    | Whether message was processed |

**Status Check**

```
GET /status
```

Response:

| Param Name           | Param Type | Description                         |
| -------------------- | ---------- | ----------------------------------- |
| wahaConnected        | boolean    | WAHA API connection status          |
| openrouterConfigured | boolean    | OpenRouter API configuration status |
| messagesProcessed    | number     | Total messages processed            |
| uptime               | string     | Server uptime                       |

## 5. Server Architecture Diagram

```mermaid
graph TD
    A[Express Server] --> B[Route Handler Layer]
    B --> C[Service Layer]
    C --> D[External API Layer]
    C --> E[Storage Layer]
    
    subgraph "Route Handlers"
        B1[QR Code Handler]
        B2[Config Handler]
        B3[Webhook Handler]
        B4[Status Handler]
    end
    
    subgraph "Services"
        C1[WAHA Service]
        C2[OpenRouter Service]
        C3[Memory Service]
        C4[Message Processor]
    end
    
    subgraph "External APIs"
        D1[WAHA API]
        D2[OpenRouter API]
    end
    
    subgraph "Storage"
        E1[JSON Files]
        E2[In-Memory Cache]
    end
    
    B --> B1
    B --> B2
    B --> B3
    B --> B4
    
    C --> C1
    C --> C2
    C --> C3
    C --> C4
    
    D --> D1
    D --> D2
    
    E --> E1
    E --> E2
```

## 6. Data Model

### 6.1 Data Model Definition

```mermaid
erDiagram
    CONVERSATION ||--o{ MESSAGE : contains
    CONVERSATION {
        string userId PK
        string sessionId
        datetime createdAt
        datetime updatedAt
        json metadata
    }
    MESSAGE {
        string id PK
        string conversationId FK
        string content
        string type
        string sender
        datetime timestamp
        json rawData
    }
    CONFIG {
        string key PK
        string value
        datetime updatedAt
    }
```

### 6.2 Data Definition Language

**Configuration Storage (config.json)**

```json
{
  "openrouterApiKey": "",
  "aiModel": "openai/gpt-4o-mini",
  "systemPrompt": "You are a helpful WhatsApp assistant.",
  "wahaBaseUrl": "http://localhost:3000",
  "webhookUrl": "http://localhost:5000/webhook"
}
```

**Conversation Memory (conversations.json)**

```json
{
  "userId@c.us": {
    "sessionId": "default",
    "messages": [
      {
        "id": "msg_001",
        "content": "Hello",
        "type": "text",
        "sender": "user",
        "timestamp": "2024-01-01T10:00:00Z",
        "rawData": {}
      },
      {
        "id": "msg_002",
        "content": "Hi! How can I help you?",
        "type": "text",
        "sender": "ai",
        "timestamp": "2024-01-01T10:00:05Z",
        "rawData": {}
      }
    ],
    "createdAt": "2024-01-01T10:00:00Z",
    "updatedAt": "2024-01-01T10:00:05Z"
  }
}
```

**Session Status (status.json)**

```json
{
  "wahaConnected": true,
  "openrouterConfigured": true,
  "messagesProcessed": 42,
  "lastMessageAt": "2024-01-01T10:00:00Z",
  "uptime": "2h 30m",
  "errors": []
}
```


# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SockbowlNg is an Angular 16 frontend client for the Sockbowl quizbowl platform. It enables real-time multiplayer quiz bowl gameplay by connecting to backend services via WebSockets (STOMP protocol) and REST APIs.

## Development Commands

### Running the Application
- `npm start` or `ng serve` - Start development server
- `npm run watch` - Build with watch mode for development

### Building
- `npm run build` - Development build (output to `dist/`)
- `npm run buildprod` - Production build with optimizations

### Testing
- `npm test` or `ng test` - Run unit tests with Karma

## Architecture

### Service Layer Architecture

The application uses a three-layer service architecture for managing game state and communication:

1. **GameWebSocketService** (`src/app/game/services/game-web-socket.service.ts`)
   - Low-level WebSocket management using STOMP.js over WebSocket
   - Connects to backend at `environment.wsUrl`
   - Subscribes to two queues: `/queue/event/{gameSessionId}/{playerSessionId}` and `/queue/event/{gameSessionId}`
   - Publishes messages to `/app/game/*` destinations with headers (gameSessionId, playerSecret, playerSessionId)
   - Exposes `messageObservable$` for raw message stream

2. **GameMessageService** (`src/app/game/services/game-message.service.ts`)
   - Message routing and type discrimination layer
   - Consumes raw messages from GameWebSocketService
   - Provides typed observables via `gameEventObservables` dictionary keyed by message type (e.g., "GameSessionUpdate", "PlayerRosterUpdate")
   - Wraps `sendMessage()` for outbound communication

3. **GameStateService** (`src/app/game/services/game-state.service.ts`)
   - High-level state management
   - Maintains `GameSession` state in a BehaviorSubject
   - Subscribes to typed message observables from GameMessageService and updates state
   - Exposes `gameSession$` observable for components
   - Provides convenience methods for state queries (e.g., `isSelfProctor()`, `isCurrentPlayerGameOwner()`)
   - Provides action methods that construct message objects and send via GameMessageService

### Component Organization

Components are organized under `src/app/game/components/`:
- **game-session** - Session lobby for joining games and configuring player settings
- **game-canvas** - Main game view container (renders during active match)
- **game-config** - Match configuration UI (packet selection, team assignment)
- **game-proctor** - Proctor controls for managing rounds and judging answers
- **game-buzzer** - Player buzzer interface
- **team-list** - Display of teams and their rosters
- **match-summary** - Post-match score summary and round history
- **packet-search** - UI for searching question packets via GraphQL

### External Service Integration

- **Sockbowl Game API**: REST endpoint at `environment.sockbowlGameApiUrl` for session management
- **Sockbowl Questions API**: GraphQL endpoint at `environment.sockbowlQuestionsApiUrl` for packet search (see `SockbowlQuestionsService`)
- **WebSocket**: Real-time game events at `environment.wsUrl`

### Data Models

All backend data models are defined in `src/app/game/models/sockbowl/sockbowl-interfaces.ts`. This file is auto-generated from backend Java types (see header comment). Key types include:
- `GameSession` - Top-level session state
- `Player`, `Team` - Player and team entities
- `Round`, `Buzz` - Game progression state
- Message types for WebSocket communication (e.g., `GameSessionUpdate`, `PlayerBuzzed`, `AnswerOutcome`)

### Environment Configuration

Backend URLs are configured in `src/environments/environment.ts`:
- `sockbowlGameApiUrl` - Game session REST API
- `sockbowlQuestionsApiUrl` - Questions GraphQL API
- `wsUrl` - WebSocket endpoint

Production overrides in `src/environments/environment.prod.ts`.

### Routing

Two main routes (see `app-routing.module.ts`):
- `/game-session` - Lobby/session join (default route)
- `/game` - Active game canvas

## Key Patterns

### WebSocket Message Flow
1. Component calls action method on GameStateService (e.g., `sendAnswerCorrect()`)
2. GameStateService constructs typed message object and calls `gameMessageService.sendMessage(path, message)`
3. GameMessageService forwards to `gameWebSocketService.sendMessage()`
4. Backend processes and broadcasts response messages
5. GameWebSocketService receives message, emits on `messageObservable$`
6. GameMessageService routes to typed observable based on message type
7. GameStateService subscription updates `gameSessionState` and emits on `gameSession$`
8. Components reactively update via subscription to `gameSession$`

### State Subscription Pattern
Components should:
- Inject `GameStateService`
- Subscribe to `gameSession$` observable
- Use convenience methods for state queries rather than accessing raw state
- Call action methods to trigger state changes

## Material Design

The app uses Angular Material (v16) extensively. All Material modules are imported in `app.module.ts`. Components use Material form controls, dialogs, snackbars, and layout components.

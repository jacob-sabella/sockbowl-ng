# SockbowlNg

SockbowlNg is the frontend client for the Sockbowl platform, built with Angular. It provides a modern, responsive interface for players to join and play quizbowl games in real-time, integrating tightly with backend services via WebSockets and REST APIs.

## Features

- **Real-Time Game Play:** Connects to Sockbowl Game backend via WebSockets for live game state updates.
- **Team & Player Management:** View and manage teams and player rosters.
- **Match Progression:** Visualizes rounds, scores, and answer outcomes.
- **Question Integration:** Retrieves quiz packets from Sockbowl Questions API.
- **Responsive UI:** Built with Angular, SCSS, and Material Design.

## Development

- Angular CLI: `ng serve` for local development.
- Build: `ng build` (output in `dist/`).
- Unit tests: `ng test`
- E2E tests: `ng e2e`
- See [Angular CLI Docs](https://angular.io/cli) for more commands.

## Deployment

A sample Dockerfile is included for production deployment with Nginx. See `Dockerfile` for details on serving the built frontend.

## Environment

- API URLs and WebSocket endpoints configurable via `src/environments/environment.ts`

## License

MIT License. See `LICENSE` for details.

---

*Created by Jacob Sabella*

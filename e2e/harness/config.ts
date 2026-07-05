// Target endpoints. Default to the live deployment; override via env to point
// the harness at a local docker-compose stack.
export const HTTP_BASE = process.env.SOCKBOWL_API ?? 'https://api.sockbowl.com';
export const WS_URL = process.env.SOCKBOWL_WS ?? 'wss://api.sockbowl.com/sockbowl-game';
export const QUESTIONS_BASE = process.env.SOCKBOWL_QUESTIONS ?? 'https://questions.sockbowl.com';
export const APP_URL = process.env.SOCKBOWL_APP ?? 'https://sockbowl.com';

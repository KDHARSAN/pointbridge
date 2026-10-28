// Registry of applications allowed to call the Loyalty Service.
// shortcut: dev keys live in code and env vars; a real deployment would keep them in a secrets store.
export const CLIENTS = {
  cafe: process.env.CAFE_API_KEY ?? 'cafe-dev-key',
  cinema: process.env.CINEMA_API_KEY ?? 'cinema-dev-key',
};

Setup

1) Create a .env file at the project root with:

OPENAI_API_KEY=sk-...

2) Run the app:

npm install
npm run dev

Notes

- Chat, mood check-in, and task breakdown are available via window.ai in the renderer.
- IPC channels: ai:chat, ai:mood, ai:breakdown.


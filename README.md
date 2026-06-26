# Chatpool — Type Jam Room MVP v6

A real-time multiplayer chat prototype where everyone’s typing becomes a looping room mix.

This version is **chat-first**: the chat feed takes priority, layers are just lightweight identity labels, and system events are visually quiet. The room can also record the local room mix and export a browser-generated clip.

## What it does

- Create or join a private jam room with a link like `/r/jam-96`.
- First 5 people become active layers: drums, bass, chords, melody, texture.
- Extra people join as audience and are promoted automatically when a player leaves.
- Every key gives an immediate sound preview.
- Sending a message replaces your current loop with the rhythm you just typed.
- When you start typing, your old loop steps aside so you can hear your current input.
- If someone leaves, their loop disappears immediately.
- System messages are small and quiet so the chat stays central.
- Record the **room mix** you hear locally and download it as a `.webm`/`.ogg` clip, depending on browser support.

## Run locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Or test a room path:

```text
http://localhost:3000/r/jam-96
```

## Deploy

This project needs a Node server because it uses WebSocket rooms.

On Render:

```text
Service type: Web Service
Environment: Node
Build Command: npm install
Start Command: npm start
Root Directory: leave empty if package.json is at repo root
```

GitHub Pages alone will not work for the realtime version because it cannot run the Node WebSocket server.

## Notes

Recording captures the Web Audio output generated in your browser. It does not record microphones or voices.

# chatjam MVP v7

**chat together, jam together**

A real-time multiplayer chat prototype where everyone’s typing becomes a shared room mix.

This version is **chat-first**: the chat feed takes priority, layers are lightweight identity labels, and the music system stays mostly invisible. The room can record the local room mix and export a browser-generated clip.

## What it does

- Create or join a private jam room with a link like `/r/chatjam-42`.
- Click the jam title to rename the room display name.
- First 5 people become active layers: drums, bass, chords, melody, texture.
- Extra people join as audience and are promoted automatically when a player leaves.
- Every key gives an immediate sound preview.
- Sending a message replaces your current loop with the rhythm you just typed.
- The yellow capture bar shows the window that will be saved into your loop.
- After the capture bar fills, typing still makes immediate sound, but no longer adds new events to the saved loop.
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
http://localhost:3000/r/chatjam-42
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

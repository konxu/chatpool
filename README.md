# Chatpool — Type Jam Room MVP v5

A real-time multiplayer prototype for a chatroom where everyone’s typing becomes a looping band.

This version uses a tiny Node server with a built-in WebSocket room layer, so it can be deployed to Render/Railway/Fly and shared with friends as a room link.

## What changed in v5

- Keystrokes make sound immediately while typing.
- When you start typing a new phrase, your previous loop mutes/steps aside.
- Press Enter or **Send** to commit the new phrase as your current loop.
- Phrase rhythm now uses real typing timestamps inside a 1/2/4-bar loop container, with only a tiny soft-grid nudge.
- Mobile virtual keyboards are supported through `beforeinput`/`input` events.
- The old **Pause loop** control has been removed.
- When a player leaves, their loop disappears immediately.
- If the room is full and someone in the audience is waiting, the first audience member is promoted into the open instrument slot.

## What it does

- Create or join a private room with a nickname.
- First five online people become the band: drums, bass, chords, melody, texture.
- Additional people join as audience.
- Each player owns one active layer.
- Every new message rewrites that player’s current loop.
- Host can reset the room and adjust tempo.
- No account system and no permanent history.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Room links look like:

```text
http://localhost:3000/r/jam
```

## Deploy

This needs a Node web service because it uses WebSockets. GitHub Pages is not enough.

Render settings:

```text
Environment: Node
Build Command: npm install
Start Command: npm start
Root Directory: leave blank if package.json is at the repo root
```


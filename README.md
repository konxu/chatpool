# Chatpool / Looproom — Type Jam MVP v4

A real-time multiplayer prototype for a chatroom where everyone’s typing becomes a looping band.

This version includes a tiny Node server with a built-in WebSocket room layer, so you can deploy it and invite friends with a room link.

## What changed in v4

- Invite links now work correctly on deployed URLs like `/r/jam-name`.
  - CSS/JS paths are absolute (`/style.css`, `/app.js`) so the page does not lose styling inside room routes.
- Keystrokes now make immediate preview sounds while typing.
  - Press Enter to commit the phrase into your looping layer.
- UI is simplified for friend testing.
  - No visible network pill.
  - No demo layer button.
  - No room-name field or role picker in the main flow.
  - Invite/join controls are combined into one card.
- Default room language changed from `toastie` to `jam` / `pool` style names.

## What it does

- Create or join a private room with a nickname.
- First five people become active players:
  - drums
  - bass
  - chords
  - melody
  - texture
- Any extra people join as audience.
- Every player has one active loop.
- Every new message replaces that player's loop.
- Every keystroke gives an immediate sound preview while typing.
- Freshly updated loops get a short volume boost.
- Each layer can be muted or locally volume-mixed.
- The host can reset the room and control tempo.

## Local run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Or directly open a room:

```text
http://localhost:3000/r/jam
```

## Deploy on Render

Use **Web Service**, not Static Site.

Settings:

```text
Environment: Node
Build Command: npm install
Start Command: npm start
Root Directory: leave blank if package.json is in the repo root
```

After deploy, open the Render URL and create/join a room. Copy the invite link and send it to friends.

## Notes

This is still a prototype. Rooms are temporary and in-memory only. If the server restarts, room state disappears. That is intentional for the MVP: it is a live jam room, not a chat archive.

# Looproom — Type Instrument Chat MVP v3

A real-time multiplayer prototype for a chatroom where everyone’s typing becomes a looping band.

This version is no longer just a same-browser multi-tab demo. It includes a tiny Node server with a built-in WebSocket room layer, so you can deploy it and invite friends with a room link.

## What it does

- Create or join a private room with a nickname.
- Share an invite link like `/r/blue-toast-27`.
- Up to **5 active players** become the band:
  1. drums
  2. bass
  3. chords
  4. melody
  5. texture
- Extra people join as **audience**. They can chat, but they do not take over a main music layer.
- Each player has **one current loop**. Pressing Enter with a new message rewrites your own layer instead of stacking old phrases forever.
- Fresh phrases get a short volume boost so the newest speaker pops out of the mix.
- Every layer has local mute and volume controls.
- The host can change tempo, reset the room, and add demo layers.
- Rooms are live-session-first: no accounts, no message archive, no long-term persistence.

## Local run

Requires Node 18+.

```bash
cd type_instrument_looproom
npm start
```

Then open:

```text
http://localhost:3000
```

Create a room, copy the invite link, and open it in another browser/tab to test.

## Testing with friends

GitHub Pages alone will **not** work for the realtime version because it only hosts static files and cannot run the Node/WebSocket server.

Recommended path:

1. Create a GitHub repo.
2. Put these files in the repo root.
3. Deploy the repo to any Node-compatible web service.
4. Set the start command to:

```bash
npm start
```

The server uses `process.env.PORT`, so platforms that inject a port automatically should work.

## Optional Render-style config

A `render.yaml` is included as a starting point for Render-like deployments. You can also configure the service manually as a Node web service.

## Interaction model

Looproom uses a “current voice” rule:

- You do not edit old messages.
- You say something new.
- Your latest typing rhythm replaces your previous loop.
- The room’s song is the sum of everyone’s current voice.

That makes the room feel more like a live jam than a chat archive.

## Current limitations

- No authentication.
- No moderation tools beyond host reset.
- No persistent storage; rooms live in server memory.
- If the server restarts, all rooms reset.
- Audio sync is approximate and good enough for a friend demo, not a professional remote music session.

## Files

- `index.html` — UI structure
- `style.css` — interface styling
- `app.js` — Web Audio + client WebSocket logic
- `server.js` — static file server + lightweight WebSocket room server
- `package.json` — Node start script
- `render.yaml` — optional deployment starting point

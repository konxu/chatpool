# chatjam — chat together, jam together

A real-time chatroom where everyone's typing becomes a shared jam.

## What this version does

- Chat-first interface: messages stay central on desktop and mobile.
- Editable jam title: click the title to rename the room.
- Invite links: `/r/room-name` opens the same jam.
- Up to 5 active player layers: drums, bass, chords, melody, texture.
- Extra people join as audience and get promoted when a player leaves.
- Each new message rewrites your current layer.
- Starting a new phrase fades your old loop so your live typing is clearer.
- The capture line is now a timed loop window: after it fills, typing still makes live sound but no longer adds more events to the loop.
- Room recording captures the local room mix and shows Download clip only after a recording is finished.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Invite room example:

```text
http://localhost:3000/r/chatjam-42
```

## Deploy

Use Render as a Node Web Service.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

GitHub Pages alone will not work for this version because the app needs a Node WebSocket server.


## v9 update

Joined rooms now collapse into a compact chat header instead of returning to the large hero layout. The participant strip only appears when there is more than one person in the room.

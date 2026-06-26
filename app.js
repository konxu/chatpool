(() => {
  const STEPS = 16;
  const ROLES = ['drums', 'bass', 'chords', 'melody', 'texture'];
  const ROLE_LABEL = {
    drums: '🥁 drums',
    bass: '〰 bass',
    chords: '▰ chords',
    melody: '✦ melody',
    texture: '░ texture',
    audience: '👂 audience'
  };
  const ROLE_ACCENT = {
    drums: '#f5c95d',
    bass: '#8ed1ff',
    chords: '#c2a5ff',
    melody: '#92f2b8',
    texture: '#ff9eb4',
    audience: '#b8ad96'
  };
  const DEFAULT_VOLUME = 0.78;
  const FRESH_BOOST_SECONDS = 8;
  const CAPTURE_WINDOW_MS = 8000;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    audioStatus: $('#audioStatus'),
    modeStatus: $('#modeStatus'),
    startAudioBtn: $('#startAudioBtn'),
    tempo: $('#tempo'),
    tempoLabel: $('#tempoLabel'),
    tempoHint: $('#tempoHint'),
    clearMineBtn: $('#clearMineBtn'),
    resetRoomBtn: $('#resetRoomBtn'),
    roomCard: $('#roomCard'),
    roomKicker: $('#roomKicker'),
    roomTitle: $('#inviteTitle'),
    nameInput: $('#nameInput'),
    roomInput: $('#roomInput'),
    roleSelect: $('#roleSelect'),
    createRoomBtn: $('#createRoomBtn'),
    joinBtn: $('#joinBtn'),
    inviteTitle: $('#inviteTitle'),
    inviteCopy: $('#inviteCopy'),
    inviteLink: $('#inviteLink'),
    copyInviteBtn: $('#copyInviteBtn'),
    composer: $('#composer'),
    commitBtn: $('#commitBtn'),
    composerHelp: $('#composerHelp'),
    chatLog: $('#chatLog'),
    tracks: $('#tracks'),
    participants: $('#participants'),
    capacityBar: $('#capacityBar'),
    timeline: $('#timeline'),
    stepReadout: $('#stepReadout'),
    meter: $('#recordingMeter span'),
    recordRoomBtn: $('#recordRoomBtn'),
    downloadClipLink: $('#downloadClipLink'),
    recordStatus: $('#recordStatus'),
    messageTemplate: $('#messageTemplate'),
    trackTemplate: $('#trackTemplate')
  };

  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let wantsConnection = false;

  let audio = null;
  let master = null;
  let recordDest = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStartedAt = 0;
  let recordingTimer = null;
  let lastClipUrl = '';
  let noiseBuffer = null;
  let schedulerTimer = null;
  let isPlaying = true;
  let currentStep = 0;
  let nextStepToSchedule = 0;
  let nextStepAt = 0;

  let joined = false;
  let clientId = getOrMakeClientId();
  let name = localStorage.getItem('chatjam.name') || randomName();
  let roomId = getInitialRoomId();
  let roomTitle = titleFromRoomId(roomId);
  let selectedRole = 'auto';
  let your = null;
  let bpm = 96;
  let roomStartedAt = Date.now();
  let clockOffset = 0;
  let participants = [];
  let tracks = new Map();
  let messages = [];
  let hostId = null;
  let maxPlayers = 5;
  let muted = new Set();
  let localVolumes = new Map();
  let volumePublishTimer = null;
  let typedEvents = [];
  let captureStart = 0;
  let isTypingNewPhrase = false;
  let lastPhysicalKeyAt = 0;
  let typingStateTimer = null;
  let scheduledPhraseKeys = new Set();
  let meterTimer = null;

  clearOldPersistedRoomState();
  els.nameInput.value = name;
  els.roomInput.value = roomId;
  els.roomTitle.textContent = roomTitle;
  buildTimeline();
  renderAll();

  els.startAudioBtn.addEventListener('click', async () => {
    await ensureAudio();
    syncTransport();
    startScheduler();
  });

  els.tempo.addEventListener('input', () => {
    const next = Number(els.tempo.value);
    els.tempoLabel.textContent = String(next);
    if (your?.isHost) send({ type: 'tempo', bpm: next });
  });

  els.createRoomBtn.addEventListener('click', async () => {
    const next = makeRoomSlug();
    roomTitle = titleFromRoomId(next);
    els.roomTitle.textContent = roomTitle;
    els.roomInput.value = next;
    await joinRoom(next);
  });

  els.joinBtn.addEventListener('click', async () => {
    await joinRoom(els.roomInput.value);
  });

  els.roomTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      els.roomTitle.blur();
    }
  });

  els.roomTitle.addEventListener('blur', () => commitRoomTitle());

  els.copyInviteBtn.addEventListener('click', async () => {
    const link = els.inviteLink.value || makeInviteLink(roomId);
    try {
      await navigator.clipboard.writeText(link);
      els.copyInviteBtn.textContent = 'Link copied';
      window.setTimeout(() => (els.copyInviteBtn.textContent = 'Invite friends'), 1200);
    } catch {
      els.inviteLink.focus();
      els.inviteLink.select();
    }
  });

  els.clearMineBtn.addEventListener('click', () => {
    sendTypingState(false, true);
    send({ type: 'clear_mine' });
  });
  els.resetRoomBtn.addEventListener('click', () => send({ type: 'reset_room' }));
  els.commitBtn.addEventListener('click', async () => {
    await ensureAudio();
    commitPhrase();
  });
  els.recordRoomBtn?.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') stopRoomRecording();
    else await startRoomRecording();
  });
  els.composer.addEventListener('keydown', async (e) => {
    if (!joined) return;
    await ensureAudio();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPhrase();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || isSilentControlKey(e.key)) return;
    lastPhysicalKeyAt = performance.now();
    captureKeyEvent(normaliseKey(e.key));
  });

  // Mobile virtual keyboards often do not emit reliable keydown events.
  // beforeinput gives us per-character timing for phones without double-counting desktop keydown.
  els.composer.addEventListener('beforeinput', async (e) => {
    if (!joined) return;
    const now = performance.now();
    if (now - lastPhysicalKeyAt < 80) return;
    await ensureAudio();
    if (e.inputType === 'insertText' || e.inputType === 'insertCompositionText') {
      const chars = e.data ? Array.from(e.data) : ['.'];
      chars.forEach((char) => captureKeyEvent(char === ' ' ? 'Space' : char));
    } else if (e.inputType === 'deleteContentBackward') {
      captureKeyEvent('Backspace');
    } else if (e.inputType === 'insertLineBreak') {
      commitPhrase();
    }
  });

  els.composer.addEventListener('input', () => {
    updateMeter();
    if (!els.composer.value && !typedEvents.length) sendTypingState(false);
  });

  window.addEventListener('beforeunload', () => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, 'leaving');
  });

  if (new URL(location.href).pathname.startsWith('/r/')) {
    els.inviteLink.value = makeInviteLink(roomId);
    els.roomKicker.textContent = 'You were invited to join';
    els.inviteCopy.textContent = 'chat together, jam together';
    els.joinBtn.textContent = 'Join this jam';
  }

  function getInitialRoomId() {
    const url = new URL(location.href);
    const pathMatch = url.pathname.match(/^\/r\/([a-z0-9-_]+)/i);
    const fromPath = pathMatch?.[1];
    const fromQuery = url.searchParams.get('room');
    return safeSlug(fromPath || fromQuery || 'chatjam');
  }

  function titleFromRoomId(id) {
    return String(id || 'chatjam').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 48) || 'chatjam';
  }

  function getOrMakeClientId() {
    const key = 'chatjam.clientId';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  }

  function uid(prefix = 'm') {
    return crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function randomName() {
    const options = ['jam', 'pool', 'snare', 'little ghost', 'room tone', 'bass crumb', 'soft noise'];
    return `${options[Math.floor(Math.random() * options.length)]}-${Math.floor(Math.random() * 90 + 10)}`;
  }

  function safeText(value, max = 260) {
    return String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
  }

  function safeSlug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'chatjam';
  }

  function makeRoomSlug() {
    const words = ['chatjam', 'tea-room', 'soft-noise', 'little-jam', 'after-hours', 'typing-pool', 'echo-room', 'spark-room'];
    return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 90 + 10)}`;
  }

  function makeInviteLink(id) {
    return `${location.origin}/r/${safeSlug(id)}`;
  }

  function clearOldPersistedRoomState() {
    Object.keys(localStorage).forEach((key) => {
      if (/^(looproom|chatjam)\..*\.(state|roleCursor|tracks|messages)$/.test(key)) localStorage.removeItem(key);
    });
  }

  async function joinRoom(nextRoom) {
    roomId = safeSlug(nextRoom || 'chatjam');
    commitRoomTitle(false);
    name = safeText(els.nameInput.value, 28) || randomName();
    selectedRole = els.roleSelect.value || 'auto';
    localStorage.setItem('chatjam.name', name);
    els.roomInput.value = roomId;
    els.inviteLink.value = makeInviteLink(roomId);
    history.replaceState(null, '', `/r/${roomId}`);

    joined = true;
    wantsConnection = true;
    els.joinBtn.textContent = 'Joining…';
    els.composer.disabled = false;
    els.composer.focus();
    await ensureAudio();
    connectSocket(true);
  }

  function connectSocket(forceNew = false) {
    if (forceNew && socket) socket.close(1000, 'rejoin');
    if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${proto}//${location.host}/ws`);
    setNetwork('connecting', false);

    socket.addEventListener('open', () => {
      reconnectAttempts = 0;
      setNetwork('network live', true);
      send({ type: 'join', roomId, clientId, name, requestedRole: selectedRole, roomTitle });
    });

    socket.addEventListener('message', (event) => {
      let payload;
      try { payload = JSON.parse(event.data); }
      catch { return; }
      if (payload.type === 'snapshot') applySnapshot(payload);
    });

    socket.addEventListener('close', () => {
      setNetwork('network offline', false);
      if (wantsConnection && joined) {
        clearTimeout(reconnectTimer);
        const wait = Math.min(4000, 450 + reconnectAttempts * 650);
        reconnectAttempts += 1;
        reconnectTimer = window.setTimeout(() => connectSocket(false), wait);
      }
    });

    socket.addEventListener('error', () => setNetwork('network error', false));
  }

  function setNetwork(label, live) {
    // Network status is kept internal for now; the public UI stays calmer for testing.
    document.body.dataset.network = live ? 'live' : 'offline';
  }

  function send(payload) {
    const body = { ...payload, roomId, clientId, name };
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(body));
    }
  }

  function applySnapshot(snapshot) {
    clockOffset = Number(snapshot.serverNow || Date.now()) - Date.now();
    roomId = safeSlug(snapshot.roomId || roomId);
    roomTitle = safeText(snapshot.roomTitle || roomTitle || titleFromRoomId(roomId), 48);
    bpm = Number(snapshot.bpm || bpm);
    roomStartedAt = Number(snapshot.roomStartedAt || roomStartedAt);
    hostId = snapshot.hostId || null;
    maxPlayers = snapshot.maxPlayers || 5;
    your = snapshot.your || null;
    participants = Array.isArray(snapshot.participants) ? snapshot.participants : [];
    messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    tracks = new Map((snapshot.tracks || []).map(track => [track.clientId, track]));

    if (audio) syncTransport();
    renderAll();
  }

  async function ensureAudio() {
    if (!audio) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      master = audio.createGain();
      master.gain.value = 0.68;
      master.connect(audio.destination);
      if (audio.createMediaStreamDestination) {
        recordDest = audio.createMediaStreamDestination();
        master.connect(recordDest);
      }
      noiseBuffer = createNoiseBuffer(audio);
    }
    if (audio.state !== 'running') await audio.resume();
    if (els.audioStatus) els.audioStatus.textContent = 'audio live';
    if (!schedulerTimer) startScheduler();
  }

  function syncTransport() {
    if (!audio) return;
    const stepMs = getStepSeconds() * 1000;
    const cycleMs = stepMs * STEPS;
    const now = Date.now() + clockOffset;
    const elapsed = positiveModulo(now - roomStartedAt, cycleMs);
    currentStep = Math.floor(elapsed / stepMs) % STEPS;
    const msUntilNext = Math.max(18, stepMs - (elapsed % stepMs));
    nextStepToSchedule = (currentStep + 1) % STEPS;
    nextStepAt = audio.currentTime + msUntilNext / 1000;
  }

  function startScheduler() {
    if (schedulerTimer) return;
    if (!nextStepAt && audio) syncTransport();
    schedulerTimer = window.setInterval(tickScheduler, 25);
  }

  function tickScheduler() {
    if (!audio) return;
    if (!nextStepAt || nextStepAt < audio.currentTime - 0.1) syncTransport();
    const lookahead = 0.16;
    schedulePhraseEvents(audio.currentTime, audio.currentTime + lookahead);
    while (nextStepAt < audio.currentTime + lookahead) {
      scheduleStep(nextStepToSchedule, nextStepAt);
      currentStep = nextStepToSchedule;
      nextStepToSchedule = (nextStepToSchedule + 1) % STEPS;
      nextStepAt += getStepSeconds();
    }
    renderTimeline();
  }

  function getBeatSeconds() {
    return 60 / Math.max(40, bpm);
  }

  function getStepSeconds() {
    return getBeatSeconds() / 4;
  }

  function positiveModulo(n, m) {
    return ((n % m) + m) % m;
  }

  function scheduleStep(step, time) {
    for (const track of tracks.values()) {
      const currentlyTyping = track.isTyping || (track.clientId === clientId && isTypingNewPhrase);
      if (muted.has(track.clientId) || currentlyTyping) continue;
      if (Array.isArray(track.events) && track.events.length) continue;
      const notes = Array.isArray(track.loop?.[step]) ? track.loop[step] : [];
      if (!notes.length) continue;
      const volume = getTrackVolume(track) * getFreshBoost(track);
      notes.slice(0, 5).forEach((note, index) => {
        playNote(track.role, note, time + index * 0.012, volume);
      });
    }
  }

  function schedulePhraseEvents(windowStart, windowEnd) {
    if (!audio) return;
    const serverNow = Date.now() + clockOffset;
    const windowStartServer = serverNow + (windowStart - audio.currentTime) * 1000;
    const windowEndServer = serverNow + (windowEnd - audio.currentTime) * 1000;
    const beatMs = getBeatSeconds() * 1000;

    if (scheduledPhraseKeys.size > 2500) scheduledPhraseKeys = new Set(Array.from(scheduledPhraseKeys).slice(-800));

    for (const track of tracks.values()) {
      const currentlyTyping = track.isTyping || (track.clientId === clientId && isTypingNewPhrase);
      if (muted.has(track.clientId) || currentlyTyping) continue;
      const events = Array.isArray(track.events) ? track.events : [];
      if (!events.length) continue;
      const bars = [1, 2, 4].includes(Number(track.bars)) ? Number(track.bars) : 1;
      const cycleMs = bars * 4 * beatMs;
      const phraseId = track.phraseId || `${track.clientId}-${track.updatedAt || 0}`;
      const startIndex = Math.floor((windowStartServer - roomStartedAt) / cycleMs) - 1;
      const endIndex = Math.floor((windowEndServer - roomStartedAt) / cycleMs) + 1;
      const volume = getTrackVolume(track) * getFreshBoost(track);

      for (let cycle = startIndex; cycle <= endIndex; cycle++) {
        if (cycle < 0) continue;
        const cycleStart = roomStartedAt + cycle * cycleMs;
        events.forEach((event, index) => {
          const eventServer = cycleStart + Number(event.tBeats || 0) * beatMs;
          if (eventServer < windowStartServer || eventServer > windowEndServer) return;
          const key = `${phraseId}:${cycle}:${index}`;
          if (scheduledPhraseKeys.has(key)) return;
          scheduledPhraseKeys.add(key);
          const when = audio.currentTime + (eventServer - serverNow) / 1000;
          playNote(track.role, event.note || event, Math.max(audio.currentTime + 0.002, when), volume);
        });
      }
    }
  }

  function getTrackVolume(track) {
    if (localVolumes.has(track.clientId)) return Number(localVolumes.get(track.clientId));
    return Number.isFinite(track.volume) ? track.volume : DEFAULT_VOLUME;
  }

  function getFreshBoost(track) {
    const now = Date.now() + clockOffset;
    const age = Math.max(0, (now - Number(track.updatedAt || 0)) / 1000);
    if (age > FRESH_BOOST_SECONDS) return 1;
    return 1 + 0.24 * (1 - age / FRESH_BOOST_SECONDS);
  }

  function playNote(role, note, time, volume) {
    if (!audio || !master) return;
    const vel = Math.max(0.05, Math.min(1, Number(note.velocity || 0.6))) * volume;
    if (role === 'drums') return playDrum(note, time, vel);
    if (role === 'bass') return playBass(note, time, vel);
    if (role === 'chords') return playChord(note, time, vel);
    if (role === 'melody') return playMelody(note, time, vel);
    return playTexture(note, time, vel);
  }

  function envGain(time, attack, decay, peak = 1) {
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    gain.connect(master);
    return gain;
  }

  function playDrum(note, time, volume) {
    const drum = note.drum || 'hat';
    if (drum === 'kick') {
      const osc = audio.createOscillator();
      const gain = envGain(time, 0.006, 0.22, volume * 0.92);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(118, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.18);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.25);
      return;
    }
    if (drum === 'snare') {
      playNoise(time, volume * 0.55, 0.12, 'bandpass', 1600, 1.2);
      const osc = audio.createOscillator();
      const gain = envGain(time, 0.004, 0.08, volume * 0.22);
      osc.type = 'triangle';
      osc.frequency.value = 190;
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.11);
      return;
    }
    playNoise(time, volume * 0.26, 0.055, 'highpass', 6200, 0.5);
  }

  function playBass(note, time, volume) {
    const degree = Number(note.degree || 0);
    const freq = scaleFreq(43.65, degree, 1);
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = envGain(time, 0.014, 0.28, volume * 0.5);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, time);
    filter.Q.value = 0.9;
    osc.connect(filter).connect(gain);
    osc.start(time);
    osc.stop(time + 0.36);
  }

  function playChord(note, time, volume) {
    const degree = Number(note.degree || 0);
    const quality = Number(note.quality || 0);
    const root = scaleFreq(130.81, degree, 0);
    const intervals = quality % 3 === 0 ? [0, 3, 7] : quality % 3 === 1 ? [0, 5, 9] : [0, 4, 7];
    intervals.forEach((semitone, i) => {
      const osc = audio.createOscillator();
      const gain = envGain(time + i * 0.004, 0.04, 0.65, volume * 0.18);
      osc.type = 'triangle';
      osc.frequency.value = root * Math.pow(2, semitone / 12);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.78);
    });
  }

  function playMelody(note, time, volume) {
    const degree = Number(note.degree || 0);
    const octave = Number(note.octave || 4);
    const base = 261.63 * Math.pow(2, octave - 4);
    const osc = audio.createOscillator();
    const delay = audio.createDelay();
    const feedback = audio.createGain();
    const wet = audio.createGain();
    const gain = envGain(time, 0.018, 0.32, volume * 0.3);
    osc.type = 'sine';
    osc.frequency.value = scaleFreq(base, degree, 0);
    delay.delayTime.value = getStepSeconds() * 1.5;
    feedback.gain.value = 0.18;
    wet.gain.value = 0.16;
    osc.connect(gain);
    gain.connect(delay).connect(feedback).connect(delay);
    delay.connect(wet).connect(master);
    osc.start(time);
    osc.stop(time + 0.45);
  }

  function playTexture(note, time, volume) {
    const texture = note.texture || 'grain';
    if (texture === 'click') {
      const osc = audio.createOscillator();
      const gain = envGain(time, 0.001, 0.035, volume * 0.18);
      osc.type = 'square';
      osc.frequency.value = 900 + (Number(note.degree || 0) % 7) * 140;
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.045);
      return;
    }
    playNoise(time, volume * 0.12, 0.18, 'bandpass', 2600 + (Number(note.degree || 0) % 7) * 200, 2.2);
  }

  function scaleFreq(base, degree, octaveShift = 0) {
    const scale = [0, 2, 3, 5, 7, 10, 12, 14, 15, 17, 19, 22];
    const semi = scale[Math.abs(degree) % scale.length] + octaveShift * 12;
    return base * Math.pow(2, semi / 12);
  }

  function createNoiseBuffer(ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playNoise(time, volume, duration, filterType, frequency, q) {
    if (!noiseBuffer) return;
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = envGain(time, 0.002, duration, volume);
    source.buffer = noiseBuffer;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    source.connect(filter).connect(gain);
    source.start(time);
    source.stop(time + duration + 0.03);
  }


  async function startRoomRecording() {
    await ensureAudio();
    if (!recordDest || typeof MediaRecorder === 'undefined') {
      setRecordStatus('recording not supported');
      return;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    if (lastClipUrl) {
      URL.revokeObjectURL(lastClipUrl);
      lastClipUrl = '';
    }
    recordedChunks = [];
    const options = pickRecorderOptions();
    try {
      mediaRecorder = new MediaRecorder(recordDest.stream, options);
    } catch {
      mediaRecorder = new MediaRecorder(recordDest.stream);
    }
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      const type = mediaRecorder?.mimeType || 'audio/webm';
      const blob = new Blob(recordedChunks, { type });
      const ext = type.includes('ogg') ? 'ogg' : 'webm';
      lastClipUrl = URL.createObjectURL(blob);
      els.downloadClipLink.href = lastClipUrl;
      els.downloadClipLink.download = `chatjam-${roomId}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
      els.downloadClipLink.hidden = false;
      setRecordStatus('clip ready');
      updateRecordButton(false);
      window.setTimeout(() => setRecordStatus(''), 4000);
    };
    mediaRecorder.start(250);
    recordingStartedAt = performance.now();
    els.downloadClipLink.hidden = true;
    updateRecordButton(true);
    setRecordStatus('00:00');
    clearInterval(recordingTimer);
    recordingTimer = window.setInterval(() => {
      const seconds = Math.floor((performance.now() - recordingStartedAt) / 1000);
      setRecordStatus(formatTime(seconds));
    }, 250);
  }

  function stopRoomRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    mediaRecorder.stop();
    clearInterval(recordingTimer);
    recordingTimer = null;
  }

  function updateRecordButton(recording) {
    if (!els.recordRoomBtn) return;
    els.recordRoomBtn.textContent = recording ? '■ Stop' : '● Rec';
    els.recordRoomBtn.classList.toggle('recording', recording);
  }

  function setRecordStatus(text) {
    if (els.recordStatus) els.recordStatus.textContent = text || '';
  }

  function formatTime(total) {
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function pickRecorderOptions() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    const type = types.find(t => MediaRecorder.isTypeSupported?.(t));
    return type ? { mimeType: type } : {};
  }

  function isSilentControlKey(key) {
    return ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key);
  }

  function normaliseKey(key) {
    if (key === ' ') return 'Space';
    if (key === 'Backspace') return 'Backspace';
    if (key === 'Tab') return 'Tab';
    if (key.length === 1) return key;
    return key.slice(0, 18);
  }

  function captureKeyEvent(key) {
    if (!joined) return;
    const now = performance.now();
    if (!captureStart) {
      captureStart = now;
      startMeterTimer();
    }
    sendTypingState(true);
    const elapsed = now - captureStart;
    const shouldCapture = elapsed <= CAPTURE_WINDOW_MS || typedEvents.length === 0;
    const previewIndex = shouldCapture ? typedEvents.length : Math.max(0, typedEvents.length - 1);
    if (shouldCapture) typedEvents.push({ key, t: elapsed });
    playTypingPreview(key, previewIndex);
    updateMeter();
  }

  function sendTypingState(active, immediate = false) {
    if (!joined || your?.mode !== 'player') return;
    const next = Boolean(active);
    if (isTypingNewPhrase === next && !immediate) return;
    isTypingNewPhrase = next;
    clearTimeout(typingStateTimer);
    const publish = () => send({ type: 'typing_state', active: next });
    if (immediate) publish();
    else typingStateTimer = window.setTimeout(publish, next ? 20 : 80);
  }

  function commitPhrase() {
    const text = safeText(els.composer.value, 260);
    if (!text && !typedEvents.length) return;

    if (your?.mode === 'audience') {
      send({ type: 'chat', id: uid('chat'), text: text || '(listening)' });
      resetComposer();
      return;
    }

    const role = your?.role || 'drums';
    const phrase = eventsToPhrasePayload(typedEvents, text, role);
    sendTypingState(false, true);
    send({
      type: 'phrase',
      id: uid('phrase'),
      text: text || '(silent typing)',
      loop: phrase.loop,
      events: phrase.events,
      bars: phrase.bars,
      rawCount: typedEvents.length,
      volume: getMyServerVolume()
    });
    resetComposer();
  }

  function resetComposer() {
    els.composer.value = '';
    typedEvents = [];
    captureStart = 0;
    isTypingNewPhrase = false;
    stopMeterTimer();
    updateMeter();
  }

  function startMeterTimer() {
    if (meterTimer) return;
    meterTimer = window.setInterval(updateMeter, 60);
  }

  function stopMeterTimer() {
    clearInterval(meterTimer);
    meterTimer = null;
    els.meter?.parentElement?.classList.remove('is-complete');
  }

  function updateMeter() {
    const progress = captureStart ? Math.min(1, Math.max(0, (performance.now() - captureStart) / CAPTURE_WINDOW_MS)) : 0;
    if (els.meter) els.meter.style.width = `${progress * 100}%`;
    els.meter?.parentElement?.classList.toggle('is-complete', progress >= 1);
  }

  function getMyServerVolume() {
    const myTrack = tracks.get(clientId);
    if (localVolumes.has(clientId)) return Number(localVolumes.get(clientId));
    return Number.isFinite(myTrack?.volume) ? myTrack.volume : DEFAULT_VOLUME;
  }

  function emptyLoop() {
    return Array.from({ length: STEPS }, () => []);
  }
  function noteFromKey(key, index, role, sourceLength = 8, gap = 180) {
    const code = key === 'Space' ? 32 : key.codePointAt(0) || index + 1;
    const velocity = Math.max(0.32, Math.min(1, 0.92 - gap / 900 + (code % 5) * 0.035));
    const note = {
      key,
      velocity,
      accent: key === key.toUpperCase() && key.length === 1 && /[A-Z]/.test(key),
      density: Math.min(12, Math.max(1, Math.round(sourceLength / 4))),
      degree: code % 11
    };
    if (role === 'drums') {
      note.drum = key === 'Space' ? 'kick' : index % 5 === 0 ? 'snare' : index % 3 === 0 ? 'kick' : 'hat';
    } else if (role === 'bass') {
      note.degree = (code + index) % 6;
    } else if (role === 'chords') {
      note.degree = (code + index) % 7;
      note.quality = (code + sourceLength) % 3;
    } else if (role === 'melody') {
      note.degree = (code + index * 2) % 12;
      note.octave = 4 + (code % 2);
    } else {
      note.texture = index % 4 === 0 || key === 'Backspace' ? 'click' : 'grain';
      note.degree = (code + index) % 9;
    }
    return note;
  }

  function playTypingPreview(key, index) {
    if (!audio || !master) return;
    const role = your?.mode === 'player' ? your.role : 'texture';
    const note = noteFromKey(key, index, role, Math.max(1, typedEvents.length), 120);
    playNote(role, note, audio.currentTime + 0.004, Math.min(0.72, getMyServerVolume()) * 0.62);
  }

  function eventsToPhrasePayload(events, text, role) {
    const cleanText = text || events.map(e => e.key === 'Space' ? ' ' : e.key[0] || '').join('') || '...';
    const source = events.length
      ? events
      : cleanText.split('').map((char, i) => ({ key: char === ' ' ? 'Space' : char, t: i * 110 }));

    const beatMs = getBeatSeconds() * 1000;
    const barMs = beatMs * 4;
    const lastTime = Math.max(280, source[source.length - 1]?.t || 280);
    const rawPhraseMs = Math.max(500, lastTime + 260);
    const bars = rawPhraseMs <= barMs * 1.05 ? 1 : rawPhraseMs <= barMs * 2.05 ? 2 : 4;
    const containerMs = bars * barMs;
    const scale = rawPhraseMs > containerMs - 120 ? (containerMs - 120) / rawPhraseMs : 1;
    const softGridMs = beatMs / 4;

    const phraseEvents = source.slice(0, 180).map((event, i) => {
      const key = event.key || cleanText[i % cleanText.length] || '.';
      const prev = source[i - 1];
      const gap = prev ? Math.max(20, event.t - prev.t) : 180;
      const naturalMs = Math.max(0, event.t * scale);
      const nearestGrid = Math.round(naturalMs / softGridMs) * softGridMs;
      const distance = Math.abs(nearestGrid - naturalMs);
      // Very light magnetic pull: enough to sit in the same room, not enough to erase hand rhythm.
      const nudgedMs = distance < 90 ? naturalMs * 0.88 + nearestGrid * 0.12 : naturalMs;
      return {
        tBeats: Math.max(0, Math.min(bars * 4 - 0.05, nudgedMs / beatMs)),
        note: noteFromKey(key, i, role, source.length, gap)
      };
    });

    const loop = phraseEventsToGrid(phraseEvents, bars);
    if (source.length < 4 && role === 'drums') {
      [0, 4, 8, 12].forEach((step, i) => loop[step].push({ key: 'pulse', velocity: 0.26, drum: i % 2 ? 'hat' : 'kick', degree: 0 }));
    }
    return { bars, events: phraseEvents, loop: loop.map(step => step.slice(0, 7)) };
  }

  function phraseEventsToGrid(events, bars) {
    const loop = emptyLoop();
    const totalBeats = bars * 4;
    events.forEach((event) => {
      const step = Math.max(0, Math.min(STEPS - 1, Math.floor((Number(event.tBeats || 0) / totalBeats) * STEPS)));
      loop[step].push(event.note || event);
    });
    return loop;
  }


  function commitRoomTitle(announce = true) {
    const title = safeText(els.roomTitle.textContent, 48) || 'chatjam';
    roomTitle = title;
    if (document.activeElement !== els.roomTitle) els.roomTitle.textContent = roomTitle;
    if (!joined) {
      roomId = safeSlug(title);
      els.roomInput.value = roomId;
      els.inviteLink.value = makeInviteLink(roomId);
      history.replaceState(null, '', location.pathname.startsWith('/r/') ? `/r/${roomId}` : location.pathname);
      return;
    }
    if (announce) send({ type: 'rename_room', title: roomTitle });
  }

  function renderAll() {
    els.tempo.value = String(bpm);
    els.tempoLabel.textContent = String(bpm);
    els.inviteLink.value = makeInviteLink(roomId);

    const isHost = Boolean(your?.isHost);
    const playerCount = participants.filter(p => p.online && p.mode === 'player').length;
    const audienceCount = participants.filter(p => p.online && p.mode === 'audience').length;

    els.joinBtn.textContent = joined ? 'Joined' : 'Join this jam';
    if (els.modeStatus) els.modeStatus.textContent = your ? `${your.mode}${your.isHost ? ' / host' : ''}` : 'not joined';
    els.clearMineBtn.disabled = !your || your.mode !== 'player';
    els.resetRoomBtn.disabled = !isHost;
    els.tempo.disabled = !isHost;
    els.tempoHint.textContent = isHost ? 'you control this' : 'host controls this';
    els.composer.disabled = !joined;
    els.commitBtn.disabled = !joined;
    els.copyInviteBtn.disabled = !joined;
    if (els.recordRoomBtn) els.recordRoomBtn.disabled = !joined || !window.MediaRecorder;
    els.composer.placeholder = your?.mode === 'audience'
      ? 'Band is full — chat here while you wait…'
      : your?.role
        ? `Type as ${ROLE_LABEL[your.role]}…`
        : 'Join, then type here…';
    els.composerHelp.textContent = your?.mode === 'audience'
      ? 'Audience. Your messages join the chat; you will get a layer when a spot opens.'
      : your?.role
        ? `${ROLE_LABEL[your.role]} · each message rewrites your layer`
        : 'Type to play. Press Send to loop it.';

    document.querySelector('.top-copy')?.classList.toggle('joined', joined);
    document.body.dataset.joined = joined ? 'true' : 'false';

    if (document.activeElement !== els.roomTitle) {
      els.roomTitle.textContent = roomTitle || titleFromRoomId(roomId);
    }
    els.inviteCopy.textContent = 'chat together, jam together';
    els.roomKicker.textContent = joined
      ? `${playerCount}/${maxPlayers} players live${audienceCount ? ` · ${audienceCount} audience` : ''}`
      : (new URL(location.href).pathname.startsWith('/r/') ? 'You were invited to join' : 'Create a room, send the link, and chat.');

    renderMessages();
    renderParticipants();
    renderTracks();
    renderTimeline();
  }

  function renderMessages() {
    const shouldStick = els.chatLog.scrollTop + els.chatLog.clientHeight >= els.chatLog.scrollHeight - 40;
    els.chatLog.innerHTML = '';
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No one has typed yet. Join, type anything, and press Send to make the first loop.';
      els.chatLog.appendChild(empty);
      return;
    }
    messages.slice(-80).forEach((message) => {
      const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
      const role = message.role || 'system';
      node.style.setProperty('--track-accent', ROLE_ACCENT[role] || ROLE_ACCENT.audience);
      node.classList.toggle('system-message', role === 'system');
      node.querySelector('.message-meta').textContent = role === 'system'
        ? 'room'
        : `${message.name || 'someone'} · ${ROLE_LABEL[role] || role}`;
      node.querySelector('p').textContent = message.text || '';
      els.chatLog.appendChild(node);
    });
    if (shouldStick) els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function renderParticipants() {
    const online = participants.filter(p => p.online);
    const players = online.filter(p => p.mode === 'player');
    const audience = online.filter(p => p.mode === 'audience');

    els.capacityBar.innerHTML = '';
    players
      .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role))
      .forEach((p) => {
        const pill = document.createElement('span');
        pill.className = 'capacity-pill';
        pill.style.setProperty('--track-accent', ROLE_ACCENT[p.role] || ROLE_ACCENT.audience);
        pill.textContent = `${ROLE_LABEL[p.role]} ${p.name}${p.clientId === clientId ? ' / you' : ''}`;
        els.capacityBar.appendChild(pill);
      });
    if (audience.length) {
      const pill = document.createElement('span');
      pill.className = 'capacity-pill';
      pill.style.setProperty('--track-accent', ROLE_ACCENT.audience);
      pill.textContent = `👂 ${audience.length} audience`;
      els.capacityBar.appendChild(pill);
    }

    els.participants.innerHTML = '';
    if (!online.length) {
      const pill = document.createElement('span');
      pill.className = 'participant-pill empty';
      pill.textContent = 'No one here yet';
      els.participants.appendChild(pill);
      return;
    }
    const me = online.find(p => p.clientId === clientId);
    const ordered = me ? [me, ...online.filter(p => p.clientId !== clientId)] : online;
    ordered.slice(0, 7).forEach((p) => {
      const pill = document.createElement('span');
      pill.className = 'participant-pill';
      pill.classList.toggle('is-me', p.clientId === clientId);
      pill.style.setProperty('--track-accent', ROLE_ACCENT[p.role] || ROLE_ACCENT.audience);
      pill.textContent = p.mode === 'player'
        ? `${ROLE_LABEL[p.role]} ${p.clientId === clientId ? 'you' : p.name}`
        : `👂 ${p.clientId === clientId ? 'you' : p.name}`;
      els.participants.appendChild(pill);
    });
    if (online.length > 7) {
      const more = document.createElement('span');
      more.className = 'participant-pill';
      more.textContent = `+${online.length - 7}`;
      els.participants.appendChild(more);
    }
  }

  function renderTracks() {
    els.tracks.innerHTML = '';
    const sorted = Array.from(tracks.values()).sort((a, b) => {
      const ai = ROLES.indexOf(a.role);
      const bi = ROLES.indexOf(b.role);
      const meDelta = (b.clientId === clientId ? 1 : 0) - (a.clientId === clientId ? 1 : 0);
      return meDelta || (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || String(a.name).localeCompare(String(b.name));
    });

    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No layers yet. The first people to join become the band.';
      els.tracks.appendChild(empty);
      return;
    }

    sorted.forEach((track) => {
      const node = els.trackTemplate.content.firstElementChild.cloneNode(true);
      const accent = ROLE_ACCENT[track.role] || ROLE_ACCENT.audience;
      const isFresh = (Date.now() + clockOffset - Number(track.updatedAt || 0)) / 1000 < FRESH_BOOST_SECONDS;
      const isMine = track.clientId === clientId;
      const isTyping = Boolean(track.isTyping || (isMine && isTypingNewPhrase));
      node.style.setProperty('--track-accent', accent);
      node.classList.toggle('fresh', isFresh || isMine);
      node.classList.toggle('muted', muted.has(track.clientId));
      node.classList.toggle('typing', isTyping);
      node.querySelector('.track-name').textContent = `${isMine ? 'You' : track.name || 'someone'}${track.isTyping ? ' / typing' : ''}`;
      node.querySelector('.track-role').textContent = ROLE_LABEL[track.role] || track.role;
      node.querySelector('.track-caption').textContent = isTyping
        ? 'typing now…'
        : track.text ? `“${track.text}”` : 'waiting for first message';

      const muteBtn = node.querySelector('.mute-btn');
      muteBtn.textContent = muted.has(track.clientId) ? 'unmute' : 'mute';
      muteBtn.addEventListener('click', () => {
        if (muted.has(track.clientId)) muted.delete(track.clientId);
        else muted.add(track.clientId);
        renderTracks();
      });

      const slider = node.querySelector('.volume-slider');
      const value = node.querySelector('.volume-value');
      const currentVol = getTrackVolume(track);
      slider.value = String(currentVol);
      value.textContent = `${Math.round(currentVol * 100)}%`;
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        localVolumes.set(track.clientId, v);
        value.textContent = `${Math.round(v * 100)}%`;
        if (track.clientId === clientId) publishMyVolume(v);
      });

      const grid = node.querySelector('.step-grid');
      for (let i = 0; i < STEPS; i++) {
        const step = document.createElement('div');
        const notes = Array.isArray(track.loop?.[i]) ? track.loop[i] : [];
        step.className = 'step';
        step.classList.toggle('has-note', notes.length > 0);
        step.classList.toggle('playing', i === currentStep);
        step.style.setProperty('--dot', `${Math.min(92, 26 + notes.length * 18)}%`);
        grid.appendChild(step);
      }
      els.tracks.appendChild(node);
    });
  }

  function publishMyVolume(v) {
    clearTimeout(volumePublishTimer);
    volumePublishTimer = window.setTimeout(() => {
      send({ type: 'volume', volume: v });
    }, 140);
  }

  function buildTimeline() {
    els.timeline.innerHTML = '';
    for (let i = 0; i < STEPS; i++) {
      const cell = document.createElement('div');
      if (i % 4 === 0) cell.classList.add('beat');
      els.timeline.appendChild(cell);
    }
  }

  function renderTimeline() {
    Array.from(els.timeline.children).forEach((cell, index) => {
      cell.classList.toggle('now', index === currentStep);
    });
    els.stepReadout.textContent = `step ${currentStep + 1} / ${STEPS}`;
    // Update track playheads without rebuilding all controls every tick.
    document.querySelectorAll('.step-grid').forEach((grid) => {
      Array.from(grid.children).forEach((cell, index) => cell.classList.toggle('playing', index === currentStep));
    });
  }
})();

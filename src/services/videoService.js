/**
 * VideoService — ViralCut AI
 * Core video rendering engine using HTML5 Canvas + MediaRecorder API.
 *
 * Responsibilities:
 *  - Renders each scene: background (video/gradient) + text overlay + subtitles
 *  - Synchronizes Web Speech API TTS with subtitle display
 *  - Captures canvas stream to MP4/WebM via MediaRecorder
 *  - Returns a Blob for download or upload
 */

window.VideoService = (function () {
  'use strict';

  /* ----------------------------------------
     CONSTANTS
  ---------------------------------------- */
  const CANVAS_W = 1080;
  const CANVAS_H = 1920;
  const FPS      = 30;

  // Typography
  const FONT_TITLE  = `700 72px 'Space Grotesk', sans-serif`;
  const FONT_BODY   = `500 52px 'Space Grotesk', sans-serif`;
  const FONT_SCENE  = `400 36px 'Space Mono', monospace`;
  const FONT_SUB    = `600 56px 'Space Grotesk', sans-serif`;

  // Colors
  const COLOR_WHITE  = '#ffffff';
  const COLOR_SHADOW = 'rgba(0,0,0,0.8)';
  const COLOR_CYAN   = '#00d4ff';
  const COLOR_VIOLET = '#8b5cf6';

  /* ----------------------------------------
     STATE
  ---------------------------------------- */
  let _canvas        = null;
  let _ctx           = null;
  let _recorder      = null;
  let _chunks        = [];
  let _isRendering   = false;
  let _previewBlob   = null;
  let _currentScript = null;
  let _animFrame     = null;

  /* ----------------------------------------
     INIT
  ---------------------------------------- */

  function init() {
    _canvas = document.getElementById('video-canvas');
    if (!_canvas) throw new Error('video-canvas element not found');
    _ctx = _canvas.getContext('2d', { willReadFrequently: false });
    Logger.ok('VideoService initialized');
  }

  /* ----------------------------------------
     DRAW HELPERS
  ---------------------------------------- */

  /** Draw a gradient background */
  function _drawGradientBg(colors) {
    const grad = _ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, colors[0] || '#080c14');
    grad.addColorStop(1, colors[1] || '#0e1f3d');
    _ctx.fillStyle = grad;
    _ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  /** Draw a video frame stretched to canvas */
  function _drawVideoFrame(videoEl) {
    if (!videoEl || videoEl.readyState < 2) return;
    const vr = videoEl.videoWidth / videoEl.videoHeight;
    const cr = CANVAS_W / CANVAS_H;
    let sw, sh, sx, sy;
    if (vr > cr) {
      sh = videoEl.videoHeight;
      sw = sh * cr;
      sx = (videoEl.videoWidth - sw) / 2;
      sy = 0;
    } else {
      sw = videoEl.videoWidth;
      sh = sw / cr;
      sx = 0;
      sy = (videoEl.videoHeight - sh) / 2;
    }
    _ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, CANVAS_W, CANVAS_H);

    // Dark overlay for readability
    _ctx.fillStyle = 'rgba(0,0,0,0.45)';
    _ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  /** Draw grid overlay (brand element) */
  function _drawGridOverlay() {
    _ctx.save();
    _ctx.strokeStyle = 'rgba(0, 212, 255, 0.04)';
    _ctx.lineWidth = 1;
    const spacing = 80;
    for (let x = 0; x < CANVAS_W; x += spacing) {
      _ctx.beginPath();
      _ctx.moveTo(x, 0); _ctx.lineTo(x, CANVAS_H);
      _ctx.stroke();
    }
    for (let y = 0; y < CANVAS_H; y += spacing) {
      _ctx.beginPath();
      _ctx.moveTo(0, y); _ctx.lineTo(CANVAS_W, y);
      _ctx.stroke();
    }
    _ctx.restore();
  }

  /** Draw logo watermark */
  function _drawWatermark() {
    _ctx.save();
    _ctx.font = `500 32px 'Space Mono', monospace`;
    _ctx.fillStyle = 'rgba(255,255,255,0.25)';
    _ctx.textAlign = 'right';
    _ctx.fillText('▶ ViralCut AI', CANVAS_W - 50, CANVAS_H - 50);
    _ctx.restore();
  }

  /** Draw a colored progress bar at the bottom */
  function _drawProgressBar(progress) {
    const barH = 6;
    _ctx.fillStyle = 'rgba(255,255,255,0.15)';
    _ctx.fillRect(0, CANVAS_H - barH, CANVAS_W, barH);

    const grad = _ctx.createLinearGradient(0, 0, CANVAS_W * progress, 0);
    grad.addColorStop(0, COLOR_CYAN);
    grad.addColorStop(1, COLOR_VIOLET);
    _ctx.fillStyle = grad;
    _ctx.fillRect(0, CANVAS_H - barH, CANVAS_W * progress, barH);
  }

  /** Draw multi-line text with shadow */
  function _drawText(text, x, y, font, color, maxWidth, lineHeight, align = 'center') {
    _ctx.save();
    _ctx.font = font;
    _ctx.textAlign = align;
    _ctx.textBaseline = 'top';

    const lines = Helpers.wrapText(_ctx, text, maxWidth);

    lines.forEach((line, i) => {
      const yPos = y + i * lineHeight;
      // Shadow
      _ctx.shadowColor = COLOR_SHADOW;
      _ctx.shadowBlur  = 20;
      _ctx.shadowOffsetX = 2;
      _ctx.shadowOffsetY = 2;
      _ctx.fillStyle = color;
      _ctx.fillText(line, x, yPos);
    });

    _ctx.restore();
    return lines.length * lineHeight;
  }

  /** Draw scene label (top left badge) */
  function _drawSceneBadge(sceneType, index, total) {
    _ctx.save();
    const label = `SCENE ${index}/${total}`;
    const bx = 60, by = 100, bw = 240, bh = 56, br = 28;

    Helpers.roundRect(_ctx, bx, by, bw, bh, br);
    _ctx.fillStyle = 'rgba(0,0,0,0.5)';
    _ctx.fill();
    _ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
    _ctx.lineWidth = 1.5;
    _ctx.stroke();

    _ctx.font = `500 30px 'Space Mono', monospace`;
    _ctx.fillStyle = COLOR_CYAN;
    _ctx.textAlign = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillText(label, bx + bw / 2, by + bh / 2);
    _ctx.restore();
  }

  /** Draw animated subtitle at bottom */
  function _drawSubtitle(text, highlightWord = null) {
    if (!text) return;

    const boxPad  = 40;
    const boxW    = CANVAS_W - 120;
    const boxX    = 60;
    const boxY    = CANVAS_H - 280;

    _ctx.save();
    _ctx.font = FONT_SUB;
    _ctx.textAlign = 'center';

    const words = text.split(' ');
    const lines = Helpers.wrapText(_ctx, text, boxW - boxPad * 2);
    const lineH = 78;
    const totalH = lines.length * lineH + boxPad * 2;

    // Background pill
    Helpers.roundRect(_ctx, boxX, boxY - boxPad, boxW, totalH, 24);
    _ctx.fillStyle = 'rgba(0,0,0,0.75)';
    _ctx.fill();
    _ctx.strokeStyle = 'rgba(0, 212, 255, 0.2)';
    _ctx.lineWidth = 1.5;
    _ctx.stroke();

    // Draw each word, highlighting the active one
    lines.forEach((line, lineIdx) => {
      const lineWords = line.split(' ');
      const lineY = boxY + lineIdx * lineH;
      const totalW = _ctx.measureText(line).width;
      let drawX = CANVAS_W / 2 - totalW / 2;

      lineWords.forEach(word => {
        const cleanWord = word.trim();
        const isHighlight = highlightWord && 
          cleanWord.toLowerCase().replace(/[^a-z]/g, '') === 
          highlightWord.toLowerCase().replace(/[^a-z]/g, '');

        const wordW = _ctx.measureText(word + ' ').width;

        _ctx.save();
        if (isHighlight) {
          _ctx.fillStyle = COLOR_CYAN;
          _ctx.shadowColor = COLOR_CYAN;
          _ctx.shadowBlur  = 20;
        } else {
          _ctx.fillStyle = COLOR_WHITE;
          _ctx.shadowColor = 'rgba(0,0,0,0.9)';
          _ctx.shadowBlur  = 8;
        }
        _ctx.textAlign = 'left';
        _ctx.textBaseline = 'top';
        _ctx.fillText(word, drawX, lineY);
        _ctx.restore();

        drawX += wordW;
      });
    });

    _ctx.restore();
  }

  /* ----------------------------------------
     SCENE TITLE CARD
  ---------------------------------------- */

  function _drawSceneTitle(scene) {
    const cw = CANVAS_W / 2;
    const cy = CANVAS_H * 0.42;

    // Accent line above text
    const lineW = 120;
    const grad = _ctx.createLinearGradient(cw - lineW / 2, 0, cw + lineW / 2, 0);
    grad.addColorStop(0, COLOR_CYAN);
    grad.addColorStop(1, COLOR_VIOLET);
    _ctx.fillStyle = grad;
    _ctx.fillRect(cw - lineW / 2, cy - 60, lineW, 4);

    // Scene type label
    _ctx.save();
    _ctx.font = `500 38px 'Space Mono', monospace`;
    _ctx.fillStyle = COLOR_CYAN;
    _ctx.textAlign = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.globalAlpha = 0.85;
    _ctx.fillText(scene.type.toUpperCase(), cw, cy - 20);
    _ctx.restore();
  }

  /* ----------------------------------------
     RENDER STATIC PREVIEW FRAME
  ---------------------------------------- */

  /**
   * Render a static preview of a single scene to the canvas.
   */
  function renderScenePreview(scene, footage, progress = 0.5) {
    if (!_canvas || !_ctx) init();

    // Background
    if (footage?.type === 'gradient') {
      _drawGradientBg(footage.gradient);
    } else {
      _drawGradientBg(scene.color ? [scene.color.bg, '#1a2a4a'] : ['#080c14', '#0e1f3d']);
    }

    _drawGridOverlay();
    _drawSceneBadge(scene.type, scene.index, 6);
    _drawSceneTitle(scene);

    const bodyY = CANVAS_H * 0.48;
    _drawText(
      scene.text,
      CANVAS_W / 2,
      bodyY,
      FONT_BODY,
      COLOR_WHITE,
      CANVAS_W - 160,
      72,
    );

    _drawSubtitle(scene.text, null);
    _drawProgressBar(progress);
    _drawWatermark();
  }

  /* ----------------------------------------
     ANIMATED RENDER LOOP (for live preview)
  ---------------------------------------- */

  let _playbackState = {
    active:        false,
    sceneIndex:    0,
    sceneProgress: 0,
    currentText:   '',
    highlightWord: '',
    footage:       [],
    script:        null,
    videoEls:      {},
    startTime:     null,
    totalDuration: 60,
  };

  function _renderFrame(ts) {
    if (!_playbackState.active) return;

    const elapsed = (ts - (_playbackState.startTime || ts)) / 1000;
    _playbackState.startTime = _playbackState.startTime || ts;

    // Determine current scene
    let cumDur = 0;
    let sceneIdx = 0;
    const scenes = _playbackState.script?.scenes || [];
    for (let i = 0; i < scenes.length; i++) {
      if (elapsed < cumDur + scenes[i].duration) {
        sceneIdx = i;
        _playbackState.sceneProgress = (elapsed - cumDur) / scenes[i].duration;
        break;
      }
      cumDur += scenes[i].duration;
      sceneIdx = scenes.length - 1;
    }

    const scene   = scenes[sceneIdx];
    const footage = _playbackState.footage[sceneIdx];

    if (!scene) {
      _playbackState.active = false;
      return;
    }

    // Background
    if (footage?.type === 'video' && _playbackState.videoEls[sceneIdx]) {
      _drawVideoFrame(_playbackState.videoEls[sceneIdx]);
    } else {
      _drawGradientBg(footage?.gradient || ['#080c14', '#0e1f3d']);
    }

    _drawGridOverlay();
    _drawSceneBadge(scene.type, scene.index, scenes.length);

    // Scene change animation
    const sceneP = _playbackState.sceneProgress;
    const alpha = sceneP < 0.1
      ? sceneP / 0.1
      : sceneP > 0.9
        ? (1 - sceneP) / 0.1
        : 1;

    _ctx.save();
    _ctx.globalAlpha = alpha;
    _drawSceneTitle(scene);
    _ctx.restore();

    _ctx.save();
    _ctx.globalAlpha = alpha;
    _drawText(
      scene.text,
      CANVAS_W / 2,
      CANVAS_H * 0.48,
      FONT_BODY,
      COLOR_WHITE,
      CANVAS_W - 160,
      72,
    );
    _ctx.restore();

    _drawSubtitle(_playbackState.currentText, _playbackState.highlightWord);
    _drawProgressBar(elapsed / _playbackState.totalDuration);
    _drawWatermark();

    if (elapsed < _playbackState.totalDuration) {
      _animFrame = requestAnimationFrame(_renderFrame);
    } else {
      _playbackState.active = false;
      Logger.ok('Playback preview complete');
    }
  }

  /* ----------------------------------------
     RECORD VIDEO
  ---------------------------------------- */

  /**
   * Record the canvas as a video Blob.
   * Plays through all scenes, speaks TTS, captures stream.
   *
   * @param {Object} script   — from ScriptService
   * @param {Array}  footage  — from PexelsService
   * @param {Function} onProgress — (0-1) progress callback
   * @returns {Promise<Blob>}
   */
  async function record(script, footage, onProgress) {
    if (!_canvas || !_ctx) init();
    if (_isRendering) throw new Error('Render already in progress');
    _isRendering = true;
    _chunks = [];

    Logger.group('VideoService.record');
    Logger.info(`Recording ${script.scenes.length} scenes…`);

    // Pre-load video elements
    const videoEls = {};
    for (let i = 0; i < footage.length; i++) {
      if (footage[i]?.type === 'video' && footage[i].url) {
        try {
          videoEls[i] = await Helpers.loadVideo(footage[i].url);
          Logger.ok(`Scene ${i + 1} video loaded`);
        } catch (err) {
          Logger.warn(`Scene ${i + 1} video failed to load, using gradient`);
          footage[i].type = 'gradient';
        }
      }
    }

    // Setup MediaRecorder
    const stream  = _canvas.captureStream(FPS);
    const mimeType = _getSupportedMimeType();
    Logger.info(`Recording with mime: ${mimeType}`);

    _recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });

    _recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) {
        _chunks.push(e.data);
      }
    };

    const recordingDone = new Promise((resolve, reject) => {
      _recorder.onstop = resolve;
      _recorder.onerror = e => reject(new Error(`MediaRecorder error: ${e.error}`));
    });

    _recorder.start(100); // collect chunks every 100ms

    // Render each scene
    let totalElapsed = 0;

    for (let i = 0; i < script.scenes.length; i++) {
      const scene   = script.scenes[i];
      const fot     = footage[i];
      const videoEl = videoEls[i];
      const sceneStart = Date.now();

      Logger.info(`Rendering scene ${i + 1}/${script.scenes.length}: ${scene.type}`);
      onProgress?.((i / script.scenes.length) * 0.9);

      // Get TTS timings (speak the text)
      let wordTimings = [];
      let ttsDone = false;

      // Start speaking
      const ttsPromise = TTSService.speak(scene.text, { rate: 0.92, pitch: 1.05 })
        .then(result => {
          wordTimings = result.wordTimings;
          ttsDone = true;
        })
        .catch(err => {
          Logger.warn(`TTS scene ${i + 1} failed: ${err.message}`);
          const est = TTSService.estimateTimings(scene.text);
          wordTimings = est.wordTimings;
          ttsDone = true;
        });

      // Start video playback
      if (videoEl) {
        videoEl.currentTime = 0;
        videoEl.play().catch(() => {});
      }

      // Render loop for this scene
      const sceneDuration = scene.duration * 1000; // ms
      let sceneElapsed = 0;

      while (sceneElapsed < sceneDuration) {
        const now = Date.now() - sceneStart;
        const p   = now / sceneDuration;
        const nowSec = now / 1000;

        // Find current word
        let currentWord = '';
        let subtitleText = scene.text;
        if (wordTimings.length) {
          const active = wordTimings.filter(wt => wt.start <= nowSec);
          currentWord = active[active.length - 1]?.word || '';
        }

        // Draw frame
        if (fot?.type === 'video' && videoEl) {
          _drawVideoFrame(videoEl);
        } else {
          _drawGradientBg(fot?.gradient || ['#080c14', '#0e1f3d']);
        }

        _drawGridOverlay();
        _drawSceneBadge(scene.type, scene.index, script.scenes.length);

        const alpha = p < 0.1 ? p / 0.1 : p > 0.9 ? (1 - p) / 0.1 : 1;
        _ctx.save();
        _ctx.globalAlpha = alpha;
        _drawSceneTitle(scene);
        _drawText(scene.text, CANVAS_W / 2, CANVAS_H * 0.48, FONT_BODY, COLOR_WHITE, CANVAS_W - 160, 72);
        _ctx.restore();

        _drawSubtitle(subtitleText, currentWord);
        _drawProgressBar((totalElapsed + now) / (script.totalDuration * 1000));
        _drawWatermark();

        await Helpers.sleep(1000 / FPS); // throttle to FPS
        sceneElapsed = Date.now() - sceneStart;
      }

      // Wait for TTS to finish if still speaking
      if (!ttsDone) {
        await Promise.race([ttsPromise, Helpers.sleep(5000)]);
      }

      TTSService.stop();

      if (videoEl) {
        videoEl.pause();
        videoEl.currentTime = 0;
      }

      totalElapsed += sceneDuration;
      Logger.ok(`Scene ${i + 1} rendered`);
    }

    // Stop recording
    _recorder.stop();
    await recordingDone;
    _isRendering = false;

    onProgress?.(1);

    const blob = new Blob(_chunks, { type: mimeType });
    _previewBlob = blob;
    _chunks = [];

    Logger.ok(`Recording complete. Blob size: ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
    Logger.groupEnd();

    return blob;
  }

  /* ----------------------------------------
     MIME TYPE DETECTION
  ---------------------------------------- */

  function _getSupportedMimeType() {
    const types = [
      'video/mp4;codecs=avc1',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'video/webm';
  }

  /* ----------------------------------------
     QUICK PREVIEW (no recording)
  ---------------------------------------- */

  /**
   * Render a static preview of the first scene to show the user
   * what the video will look like before full render.
   */
  function quickPreview(script, footage) {
    if (!_canvas || !_ctx) init();

    const scene = script.scenes[0];
    const fot   = footage[0];

    if (fot?.type === 'gradient') {
      _drawGradientBg(fot.gradient);
    } else {
      _drawGradientBg(scene.color ? [scene.color.bg, '#1a2a4a'] : ['#080c14', '#0e1f3d']);
    }

    _drawGridOverlay();
    _drawSceneBadge(scene.type, scene.index, script.scenes.length);
    _drawSceneTitle(scene);
    _drawText(scene.text, CANVAS_W / 2, CANVAS_H * 0.48, FONT_BODY, COLOR_WHITE, CANVAS_W - 160, 72);
    _drawSubtitle(scene.text, null);
    _drawProgressBar(0);
    _drawWatermark();

    const canvas = document.getElementById('video-canvas');
    const placeholder = document.getElementById('video-placeholder');
    if (canvas)      canvas.classList.add('is-visible');
    if (placeholder) placeholder.style.display = 'none';
  }

  /**
   * Play through all scenes as a live preview (no recording, with TTS)
   */
  async function playPreview(script, footage) {
    if (!_canvas || !_ctx) init();

    TTSService.stop();
    if (_animFrame) cancelAnimationFrame(_animFrame);

    _playbackState = {
      active:        true,
      script,
      footage,
      videoEls:      {},
      startTime:     null,
      currentText:   '',
      highlightWord: '',
      totalDuration: script.totalDuration,
    };

    // Load videos
    for (let i = 0; i < footage.length; i++) {
      if (footage[i]?.type === 'video' && footage[i].url) {
        try {
          _playbackState.videoEls[i] = await Helpers.loadVideo(footage[i].url);
          _playbackState.videoEls[i].play().catch(() => {});
        } catch (_) { /* fallback */ }
      }
    }

    _animFrame = requestAnimationFrame(_renderFrame);

    // Speak all scenes sequentially
    for (const scene of script.scenes) {
      _playbackState.currentText = scene.text;
      try {
        const { wordTimings } = await TTSService.speak(scene.text, { rate: 0.92 });
        // Highlight words as they're spoken
        for (const wt of wordTimings) {
          _playbackState.highlightWord = wt.word;
          await Helpers.sleep((wt.end - wt.start) * 1000);
        }
      } catch (_) {
        await Helpers.sleep(scene.duration * 1000);
      }
      _playbackState.currentText = '';
    }
  }

  /** Stop any active rendering/preview */
  function stop() {
    _playbackState.active = false;
    TTSService.stop();
    if (_animFrame) cancelAnimationFrame(_animFrame);
    if (_recorder && _recorder.state !== 'inactive') {
      _recorder.stop();
    }
    _isRendering = false;
  }

  /** Get last recorded blob */
  function getLastBlob() { return _previewBlob; }

  return {
    init,
    record,
    quickPreview,
    playPreview,
    renderScenePreview,
    stop,
    getLastBlob,
    get isRendering() { return _isRendering; },
  };
}());

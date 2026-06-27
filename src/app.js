/**
 * App — ViralCut AI
 * Main orchestrator. Wires all services + UI together.
 * Entry point: runs after all service scripts have loaded.
 *
 * State machine:
 *   IDLE → GENERATING → READY → (PLAYING | DOWNLOADING | UPLOADING)
 */

(function () {
  'use strict';

  /* ----------------------------------------
     APP STATE
  ---------------------------------------- */

  const AppState = {
    IDLE:       'idle',
    GENERATING: 'generating',
    READY:      'ready',
    PLAYING:    'playing',
    DOWNLOADING:'downloading',
    UPLOADING:  'uploading',
  };

  let _state          = AppState.IDLE;
  let _currentScript  = null;
  let _currentFootage = [];
  let _videoBlob      = null;
  let _pageInfo       = null;

  /* ----------------------------------------
     TRANSITIONS
  ---------------------------------------- */

  function _setState(newState) {
    Logger.info(`State: ${_state} → ${newState}`);
    _state = newState;
  }

  /* ----------------------------------------
     GENERATE VIDEO
  ---------------------------------------- */

  async function generate() {
    if (_state === AppState.GENERATING) {
      UI.toast('Already generating a video — please wait.', 'info');
      return;
    }

    const cfg = UI.getFormValues();

    if (!cfg.topic) {
      UI.toast('Please enter a topic first.', 'error');
      document.getElementById('topic-input')?.focus();
      return;
    }

    if (cfg.topic.length < 3) {
      UI.toast('Topic is too short. Try something like "money habits".', 'error');
      return;
    }

    _setState(AppState.GENERATING);
    UI.setGenerating(true);
    UI.resetProgress();
    UI.hideCanvas();
    Logger.clear();

    Logger.info(`Starting generation for topic: "${cfg.topic}"`);
    Logger.info(`Style: ${cfg.style}, Scenes: ${cfg.sceneCount}`);

    try {
      // --- STEP 1: SCRIPT ---
      UI.setProgress('script', 'active', 'Writing your script…', 5);

      _currentScript = await ScriptService.generate(
        cfg.topic,
        cfg.style,
        cfg.sceneCount,
        cfg.openAIKey || null,
      );

      UI.setProgress('script', 'done', 'Script ready ✓', 25);
      UI.renderSceneList(_currentScript.scenes);

      Logger.group('Generated Script');
      Logger.info(`Title: ${_currentScript.title}`);
      _currentScript.scenes.forEach((sc, i) =>
        Logger.info(`Scene ${i + 1} [${sc.type}]: "${Helpers.truncateWords(sc.text, 8)}"`)
      );
      Logger.groupEnd();

      // --- STEP 2: FOOTAGE ---
      UI.setProgress('footage', 'active', 'Fetching stock footage…', 30);

      _currentFootage = await PexelsService.fetchSceneFootage(
        _currentScript.scenes,
        cfg.pexelsKey || null,
      );

      UI.setProgress('footage', 'done', 'Footage ready ✓', 50);

      // Show a quick static preview
      VideoService.quickPreview(_currentScript, _currentFootage);
      UI.showCanvas();

      // --- STEP 3: VOICE ---
      UI.setProgress('voice', 'active', 'Preparing voice synthesis…', 55);

      if (!TTSService.isSupported()) {
        UI.toast('Web Speech API not supported in this browser. Chrome is recommended.', 'error');
        Logger.warn('TTS not supported, continuing without audio');
      }

      if (cfg.voiceIndex >= 0) {
        TTSService.setVoice(cfg.voiceIndex);
      }

      UI.setProgress('voice', 'done', 'Voice ready ✓', 65);

      // --- STEP 4: RENDER ---
      UI.setProgress('render', 'active', 'Recording video — this takes ~60s…', 70);
      UI.toast('Recording video. TTS will speak each scene aloud during recording.', 'info', 5000);

      _videoBlob = await VideoService.record(
        _currentScript,
        _currentFootage,
        (p) => {
          const pct = 70 + Math.round(p * 28);
          UI.setProgress('render', 'active', `Rendering… ${Math.round(p * 100)}%`, pct);
        },
      );

      UI.setProgress('render', 'done', 'Video ready! 🎉', 100);

      // --- DONE ---
      _setState(AppState.READY);
      UI.showOutputActions(true);
      UI.showCanvas();

      // Pre-populate Facebook caption
      const caption = ScriptService.generateCaption(_currentScript);
      UI.setFBCaption(caption);

      UI.toast(`Video generated! (${(_videoBlob.size / 1024 / 1024).toFixed(1)} MB)`, 'success', 6000);
      Logger.ok('Generation complete');

      // Scroll to preview
      document.getElementById('preview-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    } catch (err) {
      Logger.error(`Generation failed: ${err.message}`);
      UI.toast(`Generation failed: ${err.message}`, 'error', 8000);
      UI.setProgress(null, null, `Error: ${err.message}`, 0);
      _setState(AppState.IDLE);
    } finally {
      UI.setGenerating(false);
    }
  }

  /* ----------------------------------------
     PLAY PREVIEW
  ---------------------------------------- */

  async function playPreview() {
    if (!_currentScript || !_currentFootage.length) {
      UI.toast('Generate a video first.', 'info');
      return;
    }

    if (_state === AppState.PLAYING) {
      VideoService.stop();
      TTSService.stop();
      _setState(AppState.READY);
      document.getElementById('preview-btn').querySelector('.btn__text').textContent = 'Play Preview';
      return;
    }

    _setState(AppState.PLAYING);
    const btn = document.getElementById('preview-btn');
    if (btn) btn.querySelector('.btn__text').textContent = 'Stop Preview';

    UI.toast('Playing preview with voice narration…', 'info', 3000);
    Logger.info('Starting live preview playback');

    try {
      await VideoService.playPreview(_currentScript, _currentFootage);
    } catch (err) {
      Logger.warn(`Preview error: ${err.message}`);
    } finally {
      _setState(AppState.READY);
      if (btn) btn.querySelector('.btn__text').textContent = 'Play Preview';
    }
  }

  /* ----------------------------------------
     DOWNLOAD VIDEO
  ---------------------------------------- */

  async function downloadVideo() {
    if (!_videoBlob) {
      UI.toast('No video to download. Generate one first.', 'info');
      return;
    }

    _setState(AppState.DOWNLOADING);
    const topic    = _currentScript?.topic || 'video';
    const slug     = Helpers.slugify(topic);
    const ext      = _videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const filename = `viralcut_${slug}_${Date.now()}.${ext}`;

    Helpers.downloadBlob(_videoBlob, filename);
    UI.toast(`Downloading: ${filename}`, 'success');
    Logger.ok(`Download triggered: ${filename}`);

    _setState(AppState.READY);
  }

  /* ----------------------------------------
     PREPARE FOR FACEBOOK
  ---------------------------------------- */

  async function prepareFacebook() {
    if (!_videoBlob) {
      UI.toast('Generate a video before connecting to Facebook.', 'info');
      return;
    }

    UI.showFacebookControls(true);
    document.getElementById('fb-controls')?.scrollIntoView({ behavior: 'smooth' });
    UI.toast('Fill in your Page ID and Access Token, then click "Prepare".', 'info', 5000);

    // Enable upload button when fields are filled
    const checkFields = () => {
      const { fbPageId, fbToken } = UI.getFormValues();
      UI.setFBUploadEnabled(!!fbPageId && !!fbToken, 'Prepare for Facebook Upload');
    };

    document.getElementById('fb-page-id')?.addEventListener('input', checkFields);
    document.getElementById('fb-token')?.addEventListener('input', checkFields);
  }

  /* ----------------------------------------
     FACEBOOK UPLOAD
  ---------------------------------------- */

  async function facebookUpload() {
    if (_state === AppState.UPLOADING) return;

    const cfg = UI.getFormValues();

    if (!cfg.fbPageId || !cfg.fbToken) {
      UI.toast('Enter your Facebook Page ID and Access Token.', 'error');
      return;
    }

    if (!_videoBlob) {
      UI.toast('No video to upload. Generate one first.', 'error');
      return;
    }

    _setState(AppState.UPLOADING);
    UI.setFBUploadEnabled(false, 'Validating…');
    UI.setFBStatus('loading', 'Connecting to Facebook…');

    Logger.group('Facebook Upload');

    try {
      // Validate token first
      _pageInfo = await FacebookService.prepare(cfg.fbToken, cfg.fbPageId);
      UI.setFBStatus('ok', `Connected: ${_pageInfo.name}`);
      UI.toast(`Connected to "${_pageInfo.name}". Starting upload…`, 'success', 4000);
      UI.setFBUploadEnabled(false, 'Uploading…');

      Logger.info(`Uploading to page: ${_pageInfo.name} (${_pageInfo.id})`);

      const result = await FacebookService.uploadVideo(
        _videoBlob,
        cfg.fbPageId,
        cfg.fbToken,
        {
          title:       _currentScript?.title || 'ViralCut AI Video',
          description: cfg.fbCaption || '',
        },
        (p) => {
          const pct = Math.round(p * 100);
          UI.setFBUploadEnabled(false, `Uploading ${pct}%…`);
          Logger.info(`Upload progress: ${pct}%`);
        },
      );

      UI.setFBStatus('ok', 'Published!');
      UI.setFBUploadEnabled(false, 'Published ✓');
      UI.toast(`Video published! View at: ${result.shareUrl}`, 'success', 10000);
      Logger.ok(`Published. Video ID: ${result.videoId}`);
      Logger.ok(`Share URL: ${result.shareUrl}`);

    } catch (err) {
      Logger.error(`Facebook upload failed: ${err.message}`);
      UI.setFBStatus('error', 'Upload failed');
      UI.setFBUploadEnabled(true, 'Retry Upload');
      UI.toast(`Facebook error: ${err.message}`, 'error', 8000);
    } finally {
      _setState(AppState.READY);
      Logger.groupEnd();
    }
  }

  /* ----------------------------------------
     KEYBOARD SHORTCUTS
  ---------------------------------------- */

  function _initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      // Cmd/Ctrl + Enter — Generate
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        generate();
        return;
      }

      // Escape — stop preview
      if (e.key === 'Escape' && _state === AppState.PLAYING) {
        VideoService.stop();
        TTSService.stop();
        _setState(AppState.READY);
      }
    });
  }

  /* ----------------------------------------
     BIND EVENTS
  ---------------------------------------- */

  function _bindEvents() {
    // Generate button
    document.getElementById('generate-btn')
      ?.addEventListener('click', generate);

    // Topic input — Enter key triggers generate
    document.getElementById('topic-input')
      ?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          generate();
        }
      });

    // Preview / Play button
    document.getElementById('preview-btn')
      ?.addEventListener('click', playPreview);

    // Download button
    document.getElementById('download-btn')
      ?.addEventListener('click', downloadVideo);

    // "Prepare for Facebook" in output actions
    document.getElementById('fb-prepare-btn')
      ?.addEventListener('click', prepareFacebook);

    // Facebook Upload button
    document.getElementById('fb-upload-btn')
      ?.addEventListener('click', facebookUpload);

    // Voice select
    document.getElementById('voice-select')
      ?.addEventListener('change', e => {
        TTSService.setVoice(parseInt(e.target.value, 10));
      });

    Logger.info('Event listeners bound');
  }

  /* ----------------------------------------
     INIT APP
  ---------------------------------------- */

  async function init() {
    Logger.info('ViralCut AI initializing…');

    try {
      // Initialize UI components
      UI.init();

      // Initialize video service
      VideoService.init();

      // Load TTS voices
      if (TTSService.isSupported()) {
        await TTSService.loadVoices();
      } else {
        Logger.warn('Web Speech API not available — TTS disabled');
        const select = document.getElementById('voice-select');
        if (select) {
          select.innerHTML = '<option>Not supported in this browser</option>';
          select.disabled = true;
        }
      }

      // Bind all event listeners
      _bindEvents();
      _initKeyboardShortcuts();

      Logger.ok('ViralCut AI ready ✓');
      Logger.info('Press Cmd+Enter or click "Generate Video" to start');

    } catch (err) {
      Logger.error(`Init failed: ${err.message}`);
      UI.toast(`App failed to initialize: ${err.message}`, 'error', 10000);
    }
  }

  /* ----------------------------------------
     BOOT
  ---------------------------------------- */

  // Run after DOM is fully parsed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());

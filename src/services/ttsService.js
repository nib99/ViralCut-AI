/**
 * TTSService — ViralCut AI
 * Text-to-Speech using the browser's Web Speech API.
 * Provides word-level timing data for subtitle sync.
 */

window.TTSService = (function () {
  'use strict';

  let _voices      = [];
  let _selectedIdx = 0;
  let _currentUtterance = null;
  let _isSpeaking  = false;

  /* ----------------------------------------
     VOICE LOADING
  ---------------------------------------- */

  /**
   * Load available voices and populate the select element.
   * Resolves when voices are available (may need a tiny delay on Chrome).
   */
  function loadVoices() {
    return new Promise(resolve => {
      function populate() {
        _voices = window.speechSynthesis.getVoices();
        if (!_voices.length) return; // retry

        // Prefer English voices
        const english = _voices.filter(v => v.lang.startsWith('en'));
        const sorted  = [
          ...english.filter(v => v.name.includes('Google') || v.name.includes('Neural')),
          ...english.filter(v => !v.name.includes('Google') && !v.name.includes('Neural')),
          ..._voices.filter(v => !v.lang.startsWith('en')),
        ];
        _voices = sorted;

        const select = document.getElementById('voice-select');
        if (select) {
          select.innerHTML = '';
          _voices.forEach((v, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${v.name} (${v.lang})`;
            select.appendChild(opt);
          });
          // Default to second voice if available (often better than first)
          if (_voices.length > 1) { select.selectedIndex = 1; _selectedIdx = 1; }
          select.addEventListener('change', e => { _selectedIdx = parseInt(e.target.value, 10); });
        }

        Logger.ok(`TTS: ${_voices.length} voices loaded`);
        resolve(_voices);
      }

      // Chrome loads voices async
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = populate;
      }
      // Attempt immediately (Firefox / Safari)
      populate();
      // Fallback after 500ms
      setTimeout(populate, 500);
    });
  }

  /* ----------------------------------------
     SPEAK WITH WORD TIMING
  ---------------------------------------- */

  /**
   * Speak text and return an array of word timing events.
   * Because Web Speech API boundary events are unreliable cross-browser,
   * we estimate word timings from the speech rate and character position.
   *
   * @param {string} text
   * @param {Object} opts - { rate, pitch, volume }
   * @returns {Promise<{ wordTimings: Array, duration: number }>}
   */
  function speak(text, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('Speech synthesis not supported in this browser'));
        return;
      }

      stop(); // cancel any current speech

      const rate   = opts.rate   ?? 0.95;
      const pitch  = opts.pitch  ?? 1.1;
      const volume = opts.volume ?? 1.0;

      const utterance = new SpeechSynthesisUtterance(text);
      _currentUtterance = utterance;

      if (_voices[_selectedIdx]) {
        utterance.voice = _voices[_selectedIdx];
        utterance.lang  = _voices[_selectedIdx].lang;
      } else {
        utterance.lang = 'en-US';
      }

      utterance.rate   = rate;
      utterance.pitch  = pitch;
      utterance.volume = volume;

      // Build estimated word timings
      const words = text.trim().split(/\s+/);
      const charCount = text.length;
      // Approx: average spoken word is 0.35s at rate 1.0; adjust for rate
      const avgWordDur = 0.35 / rate;
      const wordTimings = words.map((word, i) => ({
        word,
        index: i,
        start: i * avgWordDur,
        end:   (i + 1) * avgWordDur,
      }));

      const estimatedDuration = words.length * avgWordDur;

      let startTime = null;
      const boundaryTimings = [];

      utterance.onboundary = e => {
        if (e.name !== 'word') return;
        if (!startTime) startTime = Date.now();
        const charIdx = e.charIndex;
        // Find which word this boundary corresponds to
        let cumulative = 0;
        for (let i = 0; i < words.length; i++) {
          if (charIdx <= cumulative + words[i].length) {
            boundaryTimings.push({ wordIndex: i, time: (Date.now() - startTime) / 1000 });
            break;
          }
          cumulative += words[i].length + 1; // +1 for space
        }
      };

      utterance.onstart = () => {
        startTime = Date.now();
        _isSpeaking = true;
        Logger.info(`TTS speaking: "${Helpers.truncateWords(text, 8)}"`);
      };

      utterance.onend = () => {
        _isSpeaking = false;
        const actualDuration = startTime ? (Date.now() - startTime) / 1000 : estimatedDuration;

        // Refine timings from boundary events if we got them
        let finalTimings = wordTimings;
        if (boundaryTimings.length > words.length * 0.3) {
          // We got reasonable boundary data — interpolate
          finalTimings = words.map((word, i) => {
            const bound = boundaryTimings.find(b => b.wordIndex === i);
            const start = bound?.time ?? i * (actualDuration / words.length);
            return {
              word,
              index:   i,
              start:   start,
              end:     start + (actualDuration / words.length),
            };
          });
        } else {
          // Scale estimated timings to actual duration
          const scale = actualDuration / estimatedDuration;
          finalTimings = wordTimings.map(wt => ({
            ...wt,
            start: wt.start * scale,
            end:   wt.end * scale,
          }));
        }

        Logger.ok(`TTS done. Duration: ${actualDuration.toFixed(1)}s`);
        resolve({ wordTimings: finalTimings, duration: actualDuration });
      };

      utterance.onerror = e => {
        _isSpeaking = false;
        Logger.error(`TTS error: ${e.error}`);
        reject(new Error(`TTS error: ${e.error}`));
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Speak silently (without actually speaking) to get timing estimates.
   * Useful for preview generation without audio output.
   */
  function estimateTimings(text, rate = 0.95) {
    const words = text.trim().split(/\s+/);
    const avgWordDur = 0.35 / rate;
    return {
      wordTimings: words.map((word, i) => ({
        word,
        index: i,
        start: i * avgWordDur,
        end:   (i + 1) * avgWordDur,
      })),
      duration: words.length * avgWordDur,
    };
  }

  /**
   * Stop any current speech
   */
  function stop() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    _isSpeaking = false;
    _currentUtterance = null;
  }

  /**
   * Check if synthesis is supported
   */
  function isSupported() {
    return 'speechSynthesis' in window;
  }

  /**
   * Get all loaded voices
   */
  function getVoices() { return _voices; }

  /**
   * Set the active voice by index
   */
  function setVoice(index) {
    _selectedIdx = Helpers.clamp(index, 0, _voices.length - 1);
  }

  return {
    loadVoices,
    speak,
    estimateTimings,
    stop,
    isSupported,
    getVoices,
    setVoice,
    get isSpeaking() { return _isSpeaking; },
  };
}());

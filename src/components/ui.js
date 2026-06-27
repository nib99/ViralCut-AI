/**
 * UI — ViralCut AI
 * UI components: toast system, progress pipeline, scene list, mobile nav
 */

window.UI = (function () {
  'use strict';

  /* ----------------------------------------
     TOAST SYSTEM
  ---------------------------------------- */

  const _toastQueue = [];
  let _toastActive  = false;

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'info'} type
   * @param {number} duration  — ms (default 4000)
   */
  function toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const toast  = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <span class="toast__icon">${icons[type] || icons.info}</span>
      <span class="toast__msg">${Helpers.sanitizeText(message)}</span>
    `;

    container.appendChild(toast);

    const remove = () => {
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 400); // fallback
    };

    setTimeout(remove, duration);
  }

  /* ----------------------------------------
     PROGRESS PIPELINE
  ---------------------------------------- */

  const _steps = ['script', 'footage', 'voice', 'render'];

  /**
   * Update the generation progress UI.
   * @param {string} step    — 'script' | 'footage' | 'voice' | 'render'
   * @param {'active'|'done'|'error'} state
   * @param {string} message — status message
   * @param {number} percent — 0-100
   */
  function setProgress(step, state, message, percent) {
    // Update step dots
    if (step) {
      _steps.forEach(s => {
        const el = document.querySelector(`[data-step="${s}"]`);
        if (!el) return;
        el.classList.remove('is-active', 'is-done', 'is-error');

        const stepIndex = _steps.indexOf(s);
        const targetIndex = _steps.indexOf(step);

        if (s === step) {
          el.classList.add(`is-${state}`);
        } else if (stepIndex < targetIndex) {
          el.classList.add('is-done');
        }
      });
    }

    // Update message
    if (message !== undefined) {
      const msgEl = document.getElementById('progress-msg');
      if (msgEl) msgEl.textContent = message;
    }

    // Update bar
    if (percent !== undefined) {
      const fill = document.getElementById('progress-fill');
      const track = document.querySelector('.progress-bar-track');
      if (fill) fill.style.width = `${Helpers.clamp(percent, 0, 100)}%`;
      if (track) track.setAttribute('aria-valuenow', percent);
    }
  }

  /**
   * Reset progress to initial state
   */
  function resetProgress() {
    _steps.forEach(s => {
      const el = document.querySelector(`[data-step="${s}"]`);
      if (el) el.classList.remove('is-active', 'is-done', 'is-error');
    });
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = '0%';
    const msg = document.getElementById('progress-msg');
    if (msg) msg.textContent = 'Enter a topic and click Generate to start.';
  }

  /* ----------------------------------------
     SCENE LIST
  ---------------------------------------- */

  /**
   * Render the scene breakdown list.
   * @param {Array} scenes — script.scenes
   */
  function renderSceneList(scenes) {
    const panel = document.getElementById('scenes-panel');
    const list  = document.getElementById('scenes-list');
    if (!panel || !list) return;

    const typeIcons = {
      hook:        '🎣',
      problem:     '⚠️',
      insight:     '💡',
      action:      '⚡',
      proof:       '📊',
      cta:         '📣',
      context:     '🌐',
      fact1:       '1️⃣',
      fact2:       '2️⃣',
      fact3:       '3️⃣',
      item1:       '🔑',
      item2:       '🔑',
      item3:       '🔑',
      item4:       '🔑',
      setup:       '🏗️',
      struggle:    '😤',
      turning:     '🔄',
      result:      '🏆',
      storytelling:'✨',
    };

    list.innerHTML = scenes.map((scene, i) => `
      <div class="scene-item" role="listitem" data-scene="${i}" tabindex="0"
           aria-label="Scene ${scene.index}: ${scene.type}">
        <span class="scene-item__num">${String(scene.index).padStart(2, '0')}</span>
        <span class="scene-item__icon">${typeIcons[scene.type] || '🎬'}</span>
        <span class="scene-item__text">${Helpers.sanitizeText(Helpers.truncateWords(scene.text, 10))}</span>
        <span class="scene-item__dur">${Helpers.formatDuration(scene.duration)}</span>
      </div>
    `).join('');

    panel.style.display = 'block';
  }

  /**
   * Highlight a scene item as active (during playback)
   */
  function highlightScene(index) {
    document.querySelectorAll('.scene-item').forEach(el => {
      el.classList.toggle('is-playing', parseInt(el.dataset.scene, 10) === index);
    });
  }

  /* ----------------------------------------
     BUTTON STATES
  ---------------------------------------- */

  /**
   * Set the generate button to loading state
   */
  function setGenerating(isGenerating) {
    const btn = document.getElementById('generate-btn');
    if (!btn) return;
    btn.disabled = isGenerating;
    btn.classList.toggle('is-loading', isGenerating);
    btn.querySelector('.btn__text').textContent = isGenerating ? 'Generating' : 'Generate Video';
  }

  /**
   * Show or hide the output action buttons
   */
  function showOutputActions(show) {
    const el = document.getElementById('output-actions');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  /**
   * Show or hide Facebook controls section
   */
  function showFacebookControls(show) {
    const el = document.getElementById('fb-controls');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  /**
   * Update Facebook connection status badge
   */
  function setFBStatus(state, text) {
    const dot = document.querySelector('.status-dot');
    const msg = document.getElementById('fb-status-text');

    if (dot) {
      dot.className = 'status-dot';
      dot.classList.add(`status-dot--${state}`);
    }
    if (msg) msg.textContent = text;
  }

  /**
   * Enable/disable the Facebook upload button
   */
  function setFBUploadEnabled(enabled, text = null) {
    const btn = document.getElementById('fb-upload-btn');
    if (!btn) return;
    btn.disabled = !enabled;
    if (text) btn.querySelector('.btn__text').textContent = text;
  }

  /* ----------------------------------------
     VIDEO CANVAS VISIBILITY
  ---------------------------------------- */

  function showCanvas() {
    const canvas = document.getElementById('video-canvas');
    const ph     = document.getElementById('video-placeholder');
    if (canvas) canvas.classList.add('is-visible');
    if (ph)     ph.style.display = 'none';
  }

  function hideCanvas() {
    const canvas = document.getElementById('video-canvas');
    const ph     = document.getElementById('video-placeholder');
    if (canvas) canvas.classList.remove('is-visible');
    if (ph)     ph.style.display = 'flex';
  }

  /* ----------------------------------------
     MOBILE NAVIGATION
  ---------------------------------------- */

  function initMobileNav() {
    const toggle = document.querySelector('.nav__mobile-toggle');
    const links  = document.querySelector('.nav__links');
    if (!toggle || !links) return;

    toggle.addEventListener('click', () => {
      const isOpen = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen);
    });

    // Close on link click
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        links.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (!toggle.contains(e.target) && !links.contains(e.target)) {
        links.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ----------------------------------------
     STYLE CHIPS
  ---------------------------------------- */

  function initStyleChips() {
    const chips = document.querySelectorAll('.chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('chip--active'));
        chip.classList.add('chip--active');
      });
    });
  }

  /**
   * Get the active style chip value
   */
  function getActiveStyle() {
    const active = document.querySelector('.chip--active');
    return active?.dataset.style || 'motivational';
  }

  /* ----------------------------------------
     SCENE COUNT DISPLAY
  ---------------------------------------- */

  function initSceneCountRange() {
    const range   = document.getElementById('scene-count');
    const display = document.getElementById('scene-count-display');
    if (!range || !display) return;

    range.addEventListener('input', () => {
      display.textContent = range.value;
    });
  }

  /**
   * Get the current scene count value
   */
  function getSceneCount() {
    const range = document.getElementById('scene-count');
    return range ? parseInt(range.value, 10) : 4;
  }

  /* ----------------------------------------
     UTILS
  ---------------------------------------- */

  /**
   * Get all input values as a config object
   */
  function getFormValues() {
    return {
      topic:       document.getElementById('topic-input')?.value?.trim() || '',
      pexelsKey:   document.getElementById('pexels-key')?.value?.trim()  || '',
      openAIKey:   document.getElementById('openai-key')?.value?.trim()  || '',
      fbPageId:    document.getElementById('fb-page-id')?.value?.trim()  || '',
      fbToken:     document.getElementById('fb-token')?.value?.trim()    || '',
      fbCaption:   document.getElementById('fb-caption')?.value?.trim()  || '',
      style:       getActiveStyle(),
      sceneCount:  getSceneCount(),
      voiceIndex:  parseInt(document.getElementById('voice-select')?.value || '0', 10),
    };
  }

  /**
   * Set the Facebook caption textarea value
   */
  function setFBCaption(text) {
    const el = document.getElementById('fb-caption');
    if (el) el.value = text;
  }

  /**
   * Initialize all UI components
   */
  function init() {
    initMobileNav();
    initStyleChips();
    initSceneCountRange();
    Logger.ok('UI initialized');
  }

  return {
    toast,
    setProgress,
    resetProgress,
    renderSceneList,
    highlightScene,
    setGenerating,
    showOutputActions,
    showFacebookControls,
    setFBStatus,
    setFBUploadEnabled,
    showCanvas,
    hideCanvas,
    getFormValues,
    setFBCaption,
    init,
  };
}());

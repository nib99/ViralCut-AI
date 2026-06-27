/**
 * Logger — ViralCut AI
 * Structured log system: console + on-screen log panel
 * Levels: info | ok | warn | error
 */

window.Logger = (function () {
  'use strict';

  const LEVELS = { info: 'info', ok: 'ok', warn: 'warn', error: 'error' };

  function _timestamp() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function _consoleMethod(level) {
    switch (level) {
      case 'warn':  return console.warn;
      case 'error': return console.error;
      default:      return console.log;
    }
  }

  function _uiIcon(level) {
    switch (level) {
      case 'ok':    return '✓';
      case 'warn':  return '⚠';
      case 'error': return '✕';
      default:      return '→';
    }
  }

  function _writeToUI(level, message) {
    const container = document.getElementById('log-output');
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = `log-entry log-entry--${level}`;
    entry.innerHTML = `
      <span class="log-entry__time">${_timestamp()}</span>
      <span class="log-entry__msg">${_uiIcon(level)} ${_sanitize(message)}</span>
    `;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  function _sanitize(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _log(level, message, data) {
    const prefix = `[ViralCut:${level.toUpperCase()}]`;
    const fn = _consoleMethod(level);
    if (data !== undefined) {
      fn(`${prefix} ${message}`, data);
    } else {
      fn(`${prefix} ${message}`);
    }
    _writeToUI(level, message);
  }

  return {
    info  : (msg, data) => _log(LEVELS.info,  msg, data),
    ok    : (msg, data) => _log(LEVELS.ok,    msg, data),
    warn  : (msg, data) => _log(LEVELS.warn,  msg, data),
    error : (msg, data) => _log(LEVELS.error, msg, data),
    group : (label)     => console.groupCollapsed(`[ViralCut] ${label}`),
    groupEnd: ()        => console.groupEnd(),
    clear : () => {
      const el = document.getElementById('log-output');
      if (el) el.innerHTML = '';
    },
  };
}());

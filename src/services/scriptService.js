/**
 * ScriptService — ViralCut AI
 * Generates viral video scripts from a topic.
 * Primary: template engine (free, offline)
 * Fallback: OpenAI GPT-4 (if API key provided)
 */

window.ScriptService = (function () {
  'use strict';

  /* ----------------------------------------
     VIRAL HOOKS (opening lines per style)
  ---------------------------------------- */
  const HOOKS = {
    motivational: [
      'Most people never figure this out about {topic}.',
      'This changed everything I knew about {topic}.',
      'Nobody talks about the real truth of {topic}.',
      'I wish someone told me this about {topic} years ago.',
      'Stop ignoring these facts about {topic}.',
    ],
    educational: [
      'Here are {n} things about {topic} that will blow your mind.',
      'The science behind {topic} is actually fascinating.',
      'Everything you thought you knew about {topic} is wrong.',
      'Here is the complete beginner's guide to {topic}.',
      '{topic} explained in 60 seconds.',
    ],
    listicle: [
      '{n} facts about {topic} no one is talking about.',
      'The top {n} rules of {topic} that change everything.',
      '{n} {topic} secrets the pros don\'t share.',
      '{n} {topic} habits that separate winners from losers.',
      'Watch this if you want to master {topic}.',
    ],
    storytelling: [
      'Last year, {topic} completely changed my life.',
      'I tried {topic} for 30 days. Here\'s what happened.',
      'A single lesson about {topic} made everything click.',
      'The moment I understood {topic}, everything shifted.',
      'Let me tell you a short story about {topic}.',
    ],
  };

  /* ----------------------------------------
     SCENE TEMPLATES per style
  ---------------------------------------- */
  const SCENE_TEMPLATES = {
    motivational: [
      { type: 'hook',      text: '{hook}' },
      { type: 'problem',   text: 'The problem is, most people approach {topic} completely wrong. They focus on {wrongThing} instead of what actually matters.' },
      { type: 'insight',   text: 'Here\'s the truth: {keyInsight} That\'s the mindset shift that changes everything with {topic}.' },
      { type: 'action',    text: 'Starting today, try this: {actionStep} Do it consistently and {topic} will start working for you.' },
      { type: 'proof',     text: 'People who apply this to {topic} report {benefit} within just {timeframe}. The results speak for themselves.' },
      { type: 'cta',       text: 'If this opened your eyes about {topic}, share it with someone who needs to hear it. Save it for later too.' },
    ],
    educational: [
      { type: 'hook',      text: '{hook}' },
      { type: 'context',   text: '{topic} is something millions of people deal with every day, yet most don\'t understand the basics. Let\'s fix that.' },
      { type: 'fact1',     text: 'First: {fact1}. This alone can change how you think about {topic} forever.' },
      { type: 'fact2',     text: 'Second: {fact2}. Researchers have found this to be one of the most critical aspects of {topic}.' },
      { type: 'fact3',     text: 'Third, and most importantly: {fact3}. This is the part most people skip entirely.' },
      { type: 'cta',       text: 'Now you know the core truth about {topic}. Follow for more facts delivered fast.' },
    ],
    listicle: [
      { type: 'hook',      text: '{hook}' },
      { type: 'item1',     text: 'Number one — {item1}. This alone is worth writing down.' },
      { type: 'item2',     text: 'Number two — {item2}. Most people skip this completely.' },
      { type: 'item3',     text: 'Number three — {item3}. Once you see this, you can\'t unsee it.' },
      { type: 'item4',     text: 'Number four — {item4}. This is the one that makes the biggest difference.' },
      { type: 'cta',       text: 'Which one surprised you most? Comment below and follow for daily {topic} breakdowns.' },
    ],
    storytelling: [
      { type: 'hook',      text: '{hook}' },
      { type: 'setup',     text: 'I used to think {topic} was complicated. Turns out, I was just missing one key piece of the puzzle.' },
      { type: 'struggle',  text: 'For months I kept getting {topic} wrong. I tried everything — {wrongThing} — nothing worked.' },
      { type: 'turning',   text: 'Then I discovered {keyInsight}. That one insight about {topic} changed my entire approach.' },
      { type: 'result',    text: 'Within {timeframe}, I noticed {benefit}. All because I finally understood {topic} the right way.' },
      { type: 'cta',       text: 'If my story about {topic} resonates, save this video. You\'ll want to watch it again.' },
    ],
  };

  /* ----------------------------------------
     FILLER CONTENT per topic category
  ---------------------------------------- */
  const TOPIC_DATA = {
    default: {
      wrongThing:  ['shortcuts', 'quick fixes', 'surface-level tactics', 'the wrong metrics'],
      keyInsight:  [
        'consistency beats intensity every single time.',
        'the small daily actions compound into massive results.',
        'most obstacles are just information in disguise.',
        'the mindset you bring matters more than the method.',
      ],
      actionStep:  [
        'spend 10 minutes a day deliberately focused on this.',
        'track your progress every single week without exception.',
        'find one person already succeeding and study their approach.',
        'remove one friction point that has been slowing you down.',
      ],
      benefit:     ['measurable improvements', 'real breakthroughs', 'consistent results', 'lasting change'],
      timeframe:   ['two weeks', '30 days', 'just one month', 'a few weeks'],
      fact1:       ['the fundamentals matter far more than advanced tactics'],
      fact2:       ['your environment shapes your outcomes more than your willpower'],
      fact3:       ['starting imperfectly beats waiting for perfect conditions every time'],
      item1:       ['the foundation most people skip entirely'],
      item2:       ['the one habit that separates experts from beginners'],
      item3:       ['the single biggest mistake people make'],
      item4:       ['the shortcut that actually works long term'],
    },
  };

  /* ----------------------------------------
     BACKGROUND COLORS for fallback scenes
  ---------------------------------------- */
  const SCENE_COLORS = [
    { bg: '#0a0f1e', accent: '#00d4ff' },
    { bg: '#0f0a1e', accent: '#8b5cf6' },
    { bg: '#0a1a0f', accent: '#10b981' },
    { bg: '#1a0a0a', accent: '#f59e0b' },
    { bg: '#0a1520', accent: '#00d4ff' },
    { bg: '#150a20', accent: '#8b5cf6' },
  ];

  /* ----------------------------------------
     PRIVATE HELPERS
  ---------------------------------------- */

  function _getTopicData() {
    return TOPIC_DATA.default;
  }

  function _fill(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const val = vars[key];
      if (Array.isArray(val)) return Helpers.randomFrom(val);
      return val !== undefined ? val : `[${key}]`;
    });
  }

  function _buildVars(topic, style, sceneCount) {
    const data = _getTopicData();
    const hookTemplate = Helpers.randomFrom(HOOKS[style] || HOOKS.motivational);
    const n = sceneCount - 1; // subtract hook

    return {
      topic,
      hook:       _fill(hookTemplate, { topic, n }),
      n,
      wrongThing: Helpers.randomFrom(data.wrongThing),
      keyInsight: Helpers.randomFrom(data.keyInsight),
      actionStep: Helpers.randomFrom(data.actionStep),
      benefit:    Helpers.randomFrom(data.benefit),
      timeframe:  Helpers.randomFrom(data.timeframe),
      fact1:      Helpers.randomFrom(data.fact1),
      fact2:      Helpers.randomFrom(data.fact2),
      fact3:      Helpers.randomFrom(data.fact3),
      item1:      Helpers.randomFrom(data.item1),
      item2:      Helpers.randomFrom(data.item2),
      item3:      Helpers.randomFrom(data.item3),
      item4:      Helpers.randomFrom(data.item4),
    };
  }

  function _templateScript(topic, style, sceneCount) {
    const vars   = _buildVars(topic, style, sceneCount);
    const tpls   = SCENE_TEMPLATES[style] || SCENE_TEMPLATES.motivational;
    const picked = tpls.slice(0, sceneCount);

    const scenes = picked.map((tpl, i) => ({
      index:      i + 1,
      type:       tpl.type,
      text:       _fill(tpl.text, vars),
      duration:   i === 0 ? 8 : Math.floor(60 / sceneCount),  // hook is shorter
      keyword:    topic + ' ' + tpl.type,
      color:      SCENE_COLORS[i % SCENE_COLORS.length],
    }));

    // Normalize durations to sum to ~60s
    const totalDur = scenes.reduce((s, sc) => s + sc.duration, 0);
    const scale    = 60 / totalDur;
    scenes.forEach(sc => { sc.duration = Math.round(sc.duration * scale); });

    return {
      title:    `${Helpers.sanitizeText(topic)} — Viral Video`,
      topic:    topic,
      style:    style,
      scenes:   scenes,
      totalDuration: 60,
      generatedAt: new Date().toISOString(),
    };
  }

  /* ----------------------------------------
     OPENAI SCRIPT GENERATION (if key present)
  ---------------------------------------- */
  async function _openAIScript(topic, style, sceneCount, apiKey) {
    Logger.info('Using OpenAI for script generation…');

    const systemPrompt = `You are a viral short-form video scriptwriter.
Generate a ${sceneCount}-scene script for a 60-second video about "${topic}" in a ${style} style.
Respond ONLY with valid JSON — no markdown, no explanation.
Format:
{
  "title": "...",
  "topic": "${topic}",
  "style": "${style}",
  "scenes": [
    {
      "index": 1,
      "type": "hook",
      "text": "...",
      "duration": 10,
      "keyword": "${topic}"
    }
  ],
  "totalDuration": 60
}
Rules:
- Each scene's "text" should be 1-2 punchy sentences (max 25 words each)
- Durations must sum to exactly 60
- First scene must be a viral hook
- Last scene must be a strong call to action
- "keyword" is a 1-3 word phrase for finding stock footage`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Create the script now for topic: "${topic}"` }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Anthropic API error: ${err.error?.message || response.status}`);
    }

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '';

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);

    // Inject color data for rendering
    parsed.scenes.forEach((sc, i) => {
      sc.color = SCENE_COLORS[i % SCENE_COLORS.length];
    });
    parsed.generatedAt = new Date().toISOString();

    return parsed;
  }

  /* ----------------------------------------
     PUBLIC API
  ---------------------------------------- */

  /**
   * Generate a video script
   * @param {string} topic   — User-provided topic
   * @param {string} style   — 'motivational' | 'educational' | 'listicle' | 'storytelling'
   * @param {number} sceneCount — 3 to 6
   * @param {string|null} openAIKey — Optional Anthropic/OpenAI API key
   * @returns {Promise<Object>} script object
   */
  async function generate(topic, style = 'motivational', sceneCount = 4, openAIKey = null) {
    if (!topic || !topic.trim()) {
      throw new Error('Topic is required');
    }

    const safeTopic = Helpers.sanitizeText(topic.trim());
    const safeCount = Helpers.clamp(sceneCount, 3, 6);

    Logger.group('ScriptService.generate');
    Logger.info(`Topic: "${safeTopic}", Style: ${style}, Scenes: ${safeCount}`);

    let script;
    if (openAIKey && openAIKey.startsWith('sk-') || (openAIKey && openAIKey.length > 30)) {
      try {
        script = await _openAIScript(safeTopic, style, safeCount, openAIKey);
        Logger.ok('OpenAI script generated');
      } catch (err) {
        Logger.warn(`OpenAI failed (${err.message}), falling back to template engine`);
        script = _templateScript(safeTopic, style, safeCount);
      }
    } else {
      await Helpers.sleep(600); // simulate processing
      script = _templateScript(safeTopic, style, safeCount);
      Logger.ok('Template script generated');
    }

    Logger.groupEnd();
    return script;
  }

  /**
   * Generate a suggested Facebook caption from the script
   */
  function generateCaption(script) {
    const { topic, style, scenes } = script;
    const hook = scenes?.[0]?.text || '';
    const cta  = scenes?.[scenes.length - 1]?.text || '';

    const emojis = { motivational: '🔥', educational: '🧠', listicle: '📋', storytelling: '✨' };
    const emoji = emojis[style] || '🎬';

    return `${emoji} ${hook}\n\n${cta}\n\n#${Helpers.slugify(topic).replace(/-/g, '')} #viral #shorts #reels`;
  }

  return { generate, generateCaption };
}());

/**
 * Cast Receiver JavaScript
 *
 * Handles Presentation API receiver connection and updates the UI
 * based on game state messages from the controlling page.
 */

(function() {
  'use strict';

  // Readable names for the GameMode enum values the server sends
  // (sockbowl-interfaces.ts GameMode) - the TV shows the room, not the wire
  // format (M5 S2-17).
  const GAME_MODE_LABELS = {
    QUIZ_BOWL_CLASSIC: 'Classic',
    SINGLE_PLAYER: 'Single player',
    AUTO_PROCTOR: 'Auto proctor',
    FREE_FOR_ALL: 'Free for all',
  };

  // M5 S2-28: how long the board shows "Question loading…" before admitting
  // the question never arrived and switching to a neutral waiting state,
  // rather than reading "loading" forever.
  const QUESTION_WAIT_TIMEOUT_MS = 8000;
  let questionWaitTimer = null;
  let questionWaitRoundNumber = null;
  let questionNeverArrived = false;

  // M5 FF5 (fix 1 + regressions 1/2): the `cqh`-based CSS coefficients in
  // cast-receiver.css get the question/answer text *close* to filling their
  // row, but "close" isn't good enough on a frame that can't scroll — any
  // fixed coefficient that's tuned to fill one state (a lone question) either
  // under-fills another (short base text) or clips a third (the last line at
  // 1080p, or either card once the answer appears and splits the row in
  // half). Four rounds of re-tuning the coefficients (FF1-FF4) chased that
  // without ever closing it. This is the fit-to-row step the FF4 verdict
  // names as the alternative: after every render, shrink each visible
  // card's text from the CSS tier's own size only as far as it has to, so
  // `#question-text`/`#answer-text` always fits inside its own container
  // (`scrollHeight` within `clientHeight`) no matter how tall that
  // container's actual share of the row turns out to be.
  //
  // Never below this floor: a last-resort backstop for a pathological case
  // (an extremely long answer in a very short row), not a size we expect to
  // hit for real reading text at 10 feet.
  const CONTENT_TEXT_MIN_FONT_PX = 18;
  // A small buffer below the exact measured wrap boundary, so the fitted
  // size doesn't land flush with the card's inner edge — the same margin the
  // FF4 verdict asks for either way (fit-to-row step, or a margin below each
  // measured boundary).
  const CONTENT_TEXT_FIT_MARGIN_PX = 3;

  // Cache DOM elements
  const elements = {
    app: document.getElementById('app'),
    status: document.getElementById('status'),
    statusIcon: document.querySelector('.status-icon'),
    statusText: document.querySelector('.status-text'),
    // Config view elements
    configView: document.getElementById('config-view'),
    configJoinCode: document.getElementById('config-join-code'),
    configProctor: document.getElementById('config-proctor'),
    configGameMode: document.getElementById('config-game-mode'),
    configPacket: document.getElementById('config-packet'),
    configTeams: document.getElementById('config-teams'),
    // Match view elements
    matchView: document.getElementById('match-view'),
    roundInfo: document.getElementById('round-info'),
    categoryInfo: document.getElementById('category-info'),
    questionContainer: document.getElementById('question-container'),
    questionText: document.getElementById('question-text'),
    buzzStatus: document.getElementById('buzz-status'),
    answerContainer: document.getElementById('answer-container'),
    answerText: document.getElementById('answer-text'),
    scoreboard: document.getElementById('scoreboard')
  };

  /**
   * Initializes the Presentation API receiver connection.
   */
  function initializeReceiver() {
    showConnecting();

    if (!navigator.presentation || !navigator.presentation.receiver) {
      console.error('Presentation API receiver not supported');
      showError('This page must be opened via Chrome Presentation API');
      return;
    }

    navigator.presentation.receiver.connectionList
      .then(list => {
        console.log('Receiver connection list available');

        // Setup existing connections
        list.connections.forEach(connection => {
          setupConnection(connection);
        });

        // Listen for new connections
        list.addEventListener('connectionavailable', event => {
          console.log('New presentation connection available');
          setupConnection(event.connection);
        });
      })
      .catch(error => {
        console.error('Failed to get connection list:', error);
        showError('Failed to establish receiver connection');
      });
  }

  /**
   * Sets up event handlers for a presentation connection.
   * @param {PresentationConnection} connection The connection to setup
   */
  function setupConnection(connection) {
    console.log('Setting up connection:', connection.id);

    // Handle incoming messages
    connection.addEventListener('message', event => {
      try {
        const state = JSON.parse(event.data);
        updateUI(state);
      } catch (error) {
        console.error('Failed to parse message:', error, event.data);
      }
    });

    // Handle connection close
    connection.addEventListener('close', () => {
      console.log('Connection closed');
      showDisconnected();
    });

    // Handle connection termination
    connection.addEventListener('terminate', () => {
      console.log('Connection terminated');
      showDisconnected();
    });

    // Show connected status
    showConnected();
  }

  /**
   * Updates the UI based on the received game state.
   * @param {Object} state The CastGameState object
   */
  function updateUI(state) {
    if (state.messageType !== 'GAME_STATE_UPDATE') {
      console.warn('Unknown message type:', state.messageType);
      return;
    }

    // M5 S2-08: a rendered frame is live data on the board, so it always
    // clears whatever status toast (connecting/disconnected) was showing —
    // including the very first frame, which is how the capture harness's
    // __castRender ever gets past the initial "Connecting…" toast.
    showConnected();

    // Mirror the viewer's selected skin (body.theme-<name> drives the tokens).
    if (state.theme) {
      document.body.className = 'theme-' + state.theme;
    }

    // Switch between config view and match view
    if (state.isConfigStage) {
      showConfigView(state);
    } else {
      showMatchView(state);
    }
  }

  /**
   * Shows the config view with join code and team rosters.
   * @param {Object} state The CastGameState object
   */
  function showConfigView(state) {
    // Hide match view, show config view
    elements.matchView.classList.add('hidden');
    elements.configView.classList.remove('hidden');
    clearQuestionWaitTimer();

    // Update join code
    elements.configJoinCode.textContent = state.joinCode || '----';

    // Update proctor
    elements.configProctor.textContent = state.proctorName || 'No proctor yet';

    // Update game mode
    elements.configGameMode.textContent = (state.gameMode && GAME_MODE_LABELS[state.gameMode]) || state.gameMode || 'Standard';

    // Update packet
    elements.configPacket.textContent = state.packetName || 'No packet selected';

    // Update teams
    updateConfigTeams(state.teamRosters);
  }

  /**
   * Shows the match view with round info, question, answer, etc.
   * @param {Object} state The CastGameState object
   */
  function showMatchView(state) {
    // Hide config view, show match view
    elements.configView.classList.add('hidden');
    elements.matchView.classList.remove('hidden');

    // Update round info. M5 S2-32: the same words as the proctor's own
    // header ("Tossup N of M"), not the anonymous "Round N" - falls back to
    // "Tossup N" when the total isn't known yet.
    elements.roundInfo.textContent = state.totalTossups
      ? `Tossup ${state.roundNumber} of ${state.totalTossups}`
      : `Tossup ${state.roundNumber}`;

    // Update category info
    if (state.category && state.subcategory) {
      elements.categoryInfo.textContent = `${state.category} · ${state.subcategory}`;
    } else if (state.category) {
      elements.categoryInfo.textContent = state.category;
    } else {
      elements.categoryInfo.textContent = 'Quiz Bowl';
    }

    // Show/hide question. M5 S2-28: a missing questionText no longer reads
    // "Question loading…" forever — a bounded wait, restarted whenever the
    // round changes, admits the question never arrived.
    if (state.questionVisible) {
      elements.questionContainer.classList.remove('hidden');
      if (state.questionText) {
        clearQuestionWaitTimer();
        elements.questionText.innerHTML = state.questionText;
        applyContentLengthClass(elements.questionText, state.questionText);
      } else {
        if (questionWaitRoundNumber !== state.roundNumber) {
          clearQuestionWaitTimer();
          questionWaitRoundNumber = state.roundNumber;
        }
        elements.questionText.textContent = questionNeverArrived
          ? 'Waiting for the proctor…'
          : 'Question loading…';
        applyContentLengthClass(elements.questionText, '');
        scheduleQuestionWaitTimeout();
      }
    } else {
      elements.questionContainer.classList.add('hidden');
      clearQuestionWaitTimer();
    }

    // Update buzz status
    updateBuzzStatus(state.currentBuzz);

    // Show/hide answer
    if (state.answerVisible) {
      elements.answerContainer.classList.remove('hidden');
      const answerText = state.answerText || 'Answer loading…';
      elements.answerText.innerHTML = answerText;
      applyContentLengthClass(elements.answerText, answerText);
    } else {
      elements.answerContainer.classList.add('hidden');
    }

    // Update scoreboard
    updateScoreboard(state.teamScores);

    // M5 FF5: whichever of question/answer are now visible must actually
    // fit the row they just got — including a row that's half the height it
    // was a moment ago, because the other card just appeared alongside it.
    fitVisibleContentText();
  }

  /**
   * Updates the config view teams grid.
   * @param {Array} teamRosters Array of team roster objects
   */
  function updateConfigTeams(teamRosters) {
    if (!teamRosters || teamRosters.length === 0) {
      elements.configTeams.innerHTML = '<div class="no-teams">No teams yet</div>';
      return;
    }

    elements.configTeams.innerHTML = teamRosters.map(team => `
      <div class="config-team">
        <div class="config-team-name">
          ${escapeHtml(team.teamName)}
          <span class="player-count-badge">${team.playerNames.length}</span>
        </div>
        <div class="config-team-players">
          ${team.playerNames.length > 0
            ? team.playerNames.map(playerName => `
                <div class="config-player">${escapeHtml(playerName)}</div>
              `).join('')
            : '<div class="config-player">No players yet</div>'
          }
        </div>
      </div>
    `).join('');
  }

  /**
   * Updates the buzz status indicator.
   * @param {Object|null} buzzInfo The current buzz information
   */
  function updateBuzzStatus(buzzInfo) {
    if (!buzzInfo) {
      elements.buzzStatus.innerHTML = '';
      return;
    }

    // Determine status class
    let statusClass = 'pending';
    if (buzzInfo.correct === true) {
      statusClass = 'correct';
    } else if (buzzInfo.correct === false) {
      statusClass = 'incorrect';
    }

    // Determine status text
    let statusText = 'buzzed';
    if (buzzInfo.correct === true) {
      statusText = 'answered correctly';
    } else if (buzzInfo.correct === false) {
      statusText = 'answered incorrectly';
    }

    // M5 S2-01: names are player-chosen text, not markup — escape them like
    // every other name on the board (config teams, scoreboard). Collapse any
    // internal whitespace runs too, so a name typed with extra spaces (or
    // one containing a stray newline) doesn't read as a double gap next to
    // the indicator's own flex gap.
    // M5 S2-34: a 100+ character name is single-lined with an ellipsis (CSS)
    // instead of wrapping the pill tall enough to overflow the frame; the
    // full name survives in `title`.
    const playerName = collapseWhitespace(buzzInfo.playerName);
    const teamName = collapseWhitespace(buzzInfo.teamName);
    elements.buzzStatus.innerHTML = `
      <div class="buzz-indicator ${statusClass}">
        <strong class="buzz-player-name" title="${escapeAttr(playerName)}">${escapeHtml(playerName)}</strong>
        <span>(<span class="buzz-team-name" title="${escapeAttr(teamName)}">${escapeHtml(teamName)}</span>)</span>
        <span>${statusText}</span>
      </div>
    `;
  }

  /**
   * Updates the team scoreboard.
   * @param {Array} teamScores Array of team score objects
   */
  function updateScoreboard(teamScores) {
    if (!teamScores || teamScores.length === 0) {
      elements.scoreboard.innerHTML = '<div class="no-teams">No teams yet</div>';
      return;
    }

    // Sort teams by score (highest first)
    const sortedTeams = [...teamScores].sort((a, b) => b.score - a.score);

    // M5 S2-34: an extreme-length team name is clamped with an ellipsis
    // (CSS) rather than pushing the score column out of the card; the full
    // name survives in `title`.
    elements.scoreboard.innerHTML = sortedTeams.map(team => {
      const teamName = collapseWhitespace(team.teamName);
      return `
      <div class="team-score">
        <span class="team-name" title="${escapeAttr(teamName)}">${escapeHtml(teamName)}</span>
        <span class="team-points">${team.score}</span>
      </div>
    `;
    }).join('');
  }

  /**
   * Sets the status toast's state, icon and text in one place, so every
   * caller agrees on what class drives the CSS (M5 S2-08).
   * @param {'connecting'|'connected'|'disconnected'|'error'} state
   * @param {string} icon
   * @param {string} text
   */
  function setStatus(state, icon, text) {
    elements.status.className = state;
    elements.statusIcon.textContent = icon;
    elements.statusText.textContent = text;
  }

  /**
   * Shows the "waiting to connect" status, before the receiver has ever
   * gotten a frame.
   */
  function showConnecting() {
    setStatus('connecting', '⏳', 'Connecting…');
  }

  /**
   * Hides the status toast: the board itself is the truth once data is
   * flowing (`#status.connected` is `display: none`, see cast-receiver.css).
   */
  function showConnected() {
    setStatus('connected', '', '');
  }

  /**
   * Shows the disconnected status as an edge toast, honest about what's
   * happening without dimming the board into uselessness — the room can
   * keep reading the last question and scoreboard while it waits (M5 S2-08).
   * M5 FF1: no emoji glyph (floor glyph ban) — an empty icon leaves the
   * `.status-icon` element for `#status.disconnected` to draw as a plain
   * CSS dot (cast-receiver.css).
   */
  function showDisconnected() {
    setStatus('disconnected', '', 'Waiting for the proctor to reconnect');
  }

  /**
   * Shows an error message (e.g. the Presentation API itself is missing).
   * @param {string} message The error message to display
   */
  function showError(message) {
    setStatus('error', '❌', message);
  }

  /**
   * Starts the bounded wait for a question that never arrives (M5 S2-28),
   * if one isn't already running. Idempotent per round: repeated renders of
   * the same still-missing question don't restart the clock.
   */
  function scheduleQuestionWaitTimeout() {
    if (questionWaitTimer || questionNeverArrived) {
      return;
    }
    questionWaitTimer = setTimeout(() => {
      questionNeverArrived = true;
      questionWaitTimer = null;
      elements.questionText.textContent = 'Waiting for the proctor…';
      // Clears whatever fit-to-row shrink the previous (possibly long)
      // question left behind — this copy is short and fits at the tier's
      // own size, but only `fitTextToContainer` resets the inline override.
      fitTextToContainer(elements.questionContainer, elements.questionText);
    }, QUESTION_WAIT_TIMEOUT_MS);
  }

  /**
   * Clears the S2-28 bounded-wait state: called once real question text
   * arrives, the question is hidden, or the round moves on.
   */
  function clearQuestionWaitTimer() {
    if (questionWaitTimer) {
      clearTimeout(questionWaitTimer);
      questionWaitTimer = null;
    }
    questionNeverArrived = false;
    questionWaitRoundNumber = null;
  }

  // M5 S2-23: the match view is a fixed 100vh grid with `overflow: hidden`,
  // so a long question or answer has to step its own type down instead of
  // growing the board past the frame. Thresholds are plain-text length
  // (HTML markup such as an answer's <b> tag doesn't count toward it): a
  // typical tossup (~190 chars) reads at the default reading size, and only
  // packets on the long tail step down.
  const CONTENT_LENGTH_MEDIUM = 220;
  const CONTENT_LENGTH_LONG = 380;
  const CONTENT_LENGTH_CLASSES = ['q-len-medium', 'q-len-long'];

  /**
   * Sizes `.content-text` (question or answer) to the length of the text it
   * holds, so a long tossup steps down in size rather than pushing the
   * fixed-height TV frame taller than it is (M5 S2-23).
   * @param {HTMLElement} el The `.content-text` element being rendered
   * @param {string} html The HTML just assigned to it (markup allowed)
   */
  function applyContentLengthClass(el, html) {
    el.classList.remove(...CONTENT_LENGTH_CLASSES);
    const plain = (html || '').replace(/<[^>]*>/g, '');
    if (plain.length > CONTENT_LENGTH_LONG) {
      el.classList.add('q-len-long');
    } else if (plain.length > CONTENT_LENGTH_MEDIUM) {
      el.classList.add('q-len-medium');
    }
  }

  /**
   * Shrinks `textEl`'s font-size, starting from whatever the CSS length-tier
   * clamp (`.content-text`/`.q-len-medium`/`.q-len-long`) already resolved
   * to, only as far as it takes for `textEl` to actually fit inside
   * `container` (M5 FF5, fix 1 + regressions 1/2). A `cqh`/`vh` coefficient
   * can only ever guess at the row's real height — it's tuned to one state
   * (a lone question filling the whole row) and either under-fills a
   * shorter one or overflows a taller one, and there's no single coefficient
   * that's simultaneously right for a lone question, an 8-team board, and a
   * question sharing its row with the answer card. Measuring the actual
   * rendered box and shrinking only when it doesn't fit is the fix that
   * generalizes across all of them instead of chasing one more state.
   *
   * This measures `textEl` itself, not `container`: `container` (the card)
   * never reports overflow via `scrollHeight` here, no matter how much
   * `textEl` clips, because `textEl` isn't rigid — it's a flex item with no
   * `flex-shrink: 0` and its own `overflow: hidden`, which per the flexbox
   * spec gives it an *automatic minimum size of 0*. So when the card doesn't
   * have room, the flexbox algorithm shrinks `textEl`'s own box down to
   * whatever fits (absorbing 100% of the "overflow" itself) instead of
   * growing the card's scrollable region — the clipping happens *inside*
   * `textEl`, invisible to a check on `container`. `textEl.scrollHeight`
   * (the height its content actually needs) vs `textEl.clientHeight` (the
   * height the flex algorithm actually gave it) is what exposes that.
   * @param {HTMLElement} container The card (`#question-container` /
   *   `#answer-container`) whose fixed, flex-allotted height text must fit;
   *   only consulted here to skip a hidden card.
   * @param {HTMLElement} textEl The `.content-text` element inside it.
   */
  function fitTextToContainer(container, textEl) {
    if (!container || !textEl || container.classList.contains('hidden')) {
      return;
    }
    if (!textEl.textContent) {
      return;
    }

    // Clear any earlier fit's inline override first, so this measures fresh
    // against the tier's own CSS value (which already tracks the container's
    // current real size via `cqh` — see cast-receiver.css) rather than
    // ratcheting down from whatever the last, possibly smaller, row left
    // behind.
    textEl.style.fontSize = '';
    const cssFontPx = parseFloat(getComputedStyle(textEl).fontSize);
    if (!(cssFontPx > 0)) {
      return;
    }

    // The exact no-clipping check: does `textEl`'s own rendered box
    // (`clientHeight`) actually hold all of its content (`scrollHeight`)? A
    // box that isn't clipping always has `scrollHeight === clientHeight`
    // exactly (never less) — there's no such thing as "negative overflow" —
    // so a margin can't be baked into *this* comparison without making even
    // a comfortably-fitting size read as "doesn't fit". The margin is
    // applied afterward instead, as a small backoff from whatever exact
    // boundary the search below finds.
    const fitsAt = (px) => {
      textEl.style.fontSize = px + 'px';
      return textEl.scrollHeight <= textEl.clientHeight;
    };

    if (fitsAt(cssFontPx)) {
      // Already fits at the tier's own size — leave no inline override, so
      // a later resize keeps tracking the CSS clamp live instead of being
      // frozen at today's pixel value.
      textEl.style.fontSize = '';
      return;
    }

    // Binary search the largest whole pixel size in
    // [CONTENT_TEXT_MIN_FONT_PX, cssFontPx) that fits exactly. The floor is
    // a last-resort backstop, not a size this is expected to reach for real
    // reading text — if even the floor still overflows (a pathological
    // amount of text in a tiny row), it's the smallest, least-clipped
    // option available and is what's left in place.
    let low = CONTENT_TEXT_MIN_FONT_PX;
    let high = Math.floor(cssFontPx);
    let best = low;
    fitsAt(low);
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (fitsAt(mid)) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    // Back off a couple more pixels below the exact measured boundary the
    // search just found — headless capture and a real display can round
    // sub-pixel font/line-height metrics a hair differently, so a size that
    // "just barely" fits in one render could clip by a hair in another.
    const finalPx = Math.max(CONTENT_TEXT_MIN_FONT_PX, best - CONTENT_TEXT_FIT_MARGIN_PX);
    textEl.style.fontSize = finalPx + 'px';
  }

  /**
   * Runs the fit-to-row step (above) for whichever of question/answer are
   * currently visible. Called after every render (`showMatchView`), and on
   * resize / font-load below, so it re-checks whenever the row's real
   * height could have changed — including the answer card appearing
   * alongside the question and splitting the row in half.
   */
  function fitVisibleContentText() {
    fitTextToContainer(elements.questionContainer, elements.questionText);
    fitTextToContainer(elements.answerContainer, elements.answerText);
  }

  // A resize can change every row's real height (the `cqh` container, the
  // header/buzz/scoreboard rows around it, or the 720p/1080p breakpoint
  // itself), so the fit has to re-run — throttled to one pass per animation
  // frame rather than once per resize event.
  let resizeFitScheduled = false;
  window.addEventListener('resize', () => {
    if (resizeFitScheduled) {
      return;
    }
    resizeFitScheduled = true;
    requestAnimationFrame(() => {
      resizeFitScheduled = false;
      fitVisibleContentText();
    });
  });

  // The reading faces (Newsreader for question/answer text) load from Google
  // Fonts; a fit computed against the fallback font's metrics before they've
  // finished loading can be wrong once the real face swaps in (a serif face
  // commonly wraps differently than its fallback). Re-fit once every face is
  // ready. `document.fonts` doesn't exist in every test environment, so this
  // is best-effort.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitVisibleContentText).catch(() => {});
  }

  /**
   * Escapes HTML special characters to prevent XSS.
   * @param {string} text The text to escape
   * @returns {string} The escaped text
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Escapes a value for use inside a double-quoted HTML attribute (M5
   * S2-34's `title` attrs). `escapeHtml`'s innerHTML round-trip only
   * escapes `&`/`<`/`>` (correct for text nodes), but leaves `"` alone
   * since it's harmless there; inside `title="…"` an unescaped `"` in a
   * player-chosen name would close the attribute early.
   * @param {string} text
   * @returns {string}
   */
  function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
  }

  /**
   * Collapses runs of whitespace (including newlines) in a name to a
   * single space and trims the ends, so an oddly-typed name never reads as
   * a double gap next to a flex container's own `gap` (M5 S2-01).
   * @param {string} text
   * @returns {string}
   */
  function collapseWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  // Integration-test hook: drive the receiver UI directly with a CastGameState,
  // bypassing the live Presentation/Cast transport. Lets us verify rendering
  // (the "connects but shows nothing" bug class) without a physical device.
  window.__castRender = updateUI;

  // Integration-test hook: drive the connection-status toast directly,
  // bypassing the real Presentation connection lifecycle, so the
  // connecting/disconnected states can be captured and tested without a
  // device (M5 S2-08).
  window.__castSetConnectionStatus = function (state) {
    if (state === 'connecting') return showConnecting();
    if (state === 'connected') return showConnected();
    if (state === 'disconnected') return showDisconnected();
    console.warn('Unknown __castSetConnectionStatus state:', state);
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeReceiver);
  } else {
    initializeReceiver();
  }
})();

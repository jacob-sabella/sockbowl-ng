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

    // Update round info
    elements.roundInfo.textContent = `Round ${state.roundNumber}`;

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
      } else {
        if (questionWaitRoundNumber !== state.roundNumber) {
          clearQuestionWaitTimer();
          questionWaitRoundNumber = state.roundNumber;
        }
        elements.questionText.textContent = questionNeverArrived
          ? 'Waiting for the proctor…'
          : 'Question loading…';
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
      elements.answerText.innerHTML = state.answerText || 'Answer loading…';
    } else {
      elements.answerContainer.classList.add('hidden');
    }

    // Update scoreboard
    updateScoreboard(state.teamScores);
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
    elements.buzzStatus.innerHTML = `
      <div class="buzz-indicator ${statusClass}">
        <strong>${escapeHtml(collapseWhitespace(buzzInfo.playerName))}</strong>
        <span>(${escapeHtml(collapseWhitespace(buzzInfo.teamName))})</span>
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

    elements.scoreboard.innerHTML = sortedTeams.map(team => `
      <div class="team-score">
        <span class="team-name">${escapeHtml(team.teamName)}</span>
        <span class="team-points">${team.score}</span>
      </div>
    `).join('');
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
   */
  function showDisconnected() {
    setStatus('disconnected', '⚠️', 'Waiting for the proctor to reconnect');
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

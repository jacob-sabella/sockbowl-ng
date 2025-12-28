/**
 * Cast Receiver JavaScript
 *
 * Handles Presentation API receiver connection and updates the UI
 * based on game state messages from the controlling page.
 */

(function() {
  'use strict';

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

    // Update join code
    elements.configJoinCode.textContent = state.joinCode || '----';

    // Update proctor
    elements.configProctor.textContent = state.proctorName || 'No proctor yet';

    // Update game mode
    elements.configGameMode.textContent = state.gameMode || 'Standard';

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
      elements.categoryInfo.textContent = `${state.category} - ${state.subcategory}`;
    } else if (state.category) {
      elements.categoryInfo.textContent = state.category;
    } else {
      elements.categoryInfo.textContent = 'Quiz Bowl';
    }

    // Show/hide question
    if (state.questionVisible) {
      elements.questionContainer.classList.remove('hidden');
      elements.questionText.innerHTML = state.questionText || 'Question loading...';
    } else {
      elements.questionContainer.classList.add('hidden');
    }

    // Update buzz status
    updateBuzzStatus(state.currentBuzz);

    // Show/hide answer
    if (state.answerVisible) {
      elements.answerContainer.classList.remove('hidden');
      elements.answerText.innerHTML = state.answerText || 'Answer loading...';
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

    elements.buzzStatus.innerHTML = `
      <div class="buzz-indicator ${statusClass}">
        <strong>${buzzInfo.playerName}</strong>
        <span>(${buzzInfo.teamName})</span>
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
   * Shows the connected status.
   */
  function showConnected() {
    elements.status.classList.add('connected');
    elements.app.style.opacity = '1';
  }

  /**
   * Shows the disconnected status.
   */
  function showDisconnected() {
    elements.status.classList.remove('connected');
    elements.statusIcon.textContent = '⚠️';
    elements.statusText.textContent = 'Connection lost';
    elements.app.style.opacity = '0.5';
  }

  /**
   * Shows an error message.
   * @param {string} message The error message to display
   */
  function showError(message) {
    elements.status.classList.remove('connected');
    elements.statusIcon.textContent = '❌';
    elements.statusText.textContent = message;
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

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeReceiver);
  } else {
    initializeReceiver();
  }
})();

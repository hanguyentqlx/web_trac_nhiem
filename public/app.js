(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const views = $$('.view');
  const roomAPI = new RoomAPI();

  const state = {
    datasets: [],
    practiceMode: 'single',
    timeMode: 'elapsed',
    practiceMinutes: 15,
    roomMinutes: 15,
    quizType: null,
    sessionId: null,
    quiz: [],
    answers: [],
    index: 0,
    selected: null,
    checked: false,
    score: 0,
    startedAt: 0,
    timer: null,
    config: null,
    review: [],
    room: null,
    roomSubmitted: false,
    playerId: localStorage.getItem('quizlab_player_id') || crypto.randomUUID(),
  };
  localStorage.setItem('quizlab_player_id', state.playerId);

  function show(name) {
    views.forEach(v => v.classList.toggle('active', v.id === name + 'View'));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2300);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Có lỗi kết nối server.');
    return data;
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  function setBtnLoading(btn, yes, text) {
    if (!btn) return;
    if (yes) {
      btn.dataset.old = btn.textContent;
      btn.disabled = true;
      btn.textContent = text || 'Đang xử lý…';
    } else {
      btn.disabled = false;
      if (btn.dataset.old) btn.textContent = btn.dataset.old;
    }
  }

  function currentDataset(selectId) {
    const id = $(selectId)?.value;
    return state.datasets.find(d => d.id === id) || state.datasets[0];
  }

  async function loadDatasets() {
    const data = await api('/api/datasets');
    state.datasets = data.datasets || [];
    $('#statSets').textContent = state.datasets.length;
    $('#statQuestions').textContent = data.totalQuestions || 0;

    const options = state.datasets.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} — ${d.questionCount} câu</option>`).join('');
    $('#practiceDataset').innerHTML = options;
    $('#roomDataset').innerHTML = options;

    $('#datasetGrid').innerHTML = state.datasets.map(d => `
      <article class="dataset-card">
        <span class="eyebrow">${d.builtin ? 'MẶC ĐỊNH' : 'SERVER'}</span>
        <h3>${escapeHtml(d.name)}</h3>
        <p>${d.questionCount} câu hỏi · Random mỗi lượt</p>
      </article>
    `).join('');

    updatePracticeAmount();
    updateRoomAmount();
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function updatePracticeAmount() {
    const mode = state.practiceMode;
    let max = 1;
    if (mode === 'single') max = currentDataset('#practiceDataset')?.questionCount || 1;
    if (mode === 'one-per-set') max = Math.max(1, state.datasets.length);
    if (mode === 'all-random') max = Math.max(1, state.datasets.reduce((s, d) => s + d.questionCount, 0));
    $('#practiceAmount').max = max;
    if (mode === 'one-per-set') $('#practiceAmount').value = max;
    else if (+$('#practiceAmount').value > max) $('#practiceAmount').value = max;
    $('#practiceAmountOut').textContent = $('#practiceAmount').value;
    $('#practiceMax').textContent = max + ' câu';
    $('#practiceDatasetField').classList.toggle('hidden', mode !== 'single');
    $('#practiceAmount').disabled = mode === 'one-per-set';
  }

  function updateRoomAmount() {
    const max = currentDataset('#roomDataset')?.questionCount || 1;
    $('#roomAmount').max = max;
    if (+$('#roomAmount').value > max) $('#roomAmount').value = max;
    $('#roomAmountOut').textContent = $('#roomAmount').value;
    $('#roomMax').textContent = max + ' câu';
  }

  function practiceConfig() {
    return {
      mode: state.practiceMode,
      datasetId: $('#practiceDataset').value,
      amount: +$('#practiceAmount').value,
      timeMode: state.timeMode,
      minutes: state.practiceMinutes,
      shuffleAnswers: $('#practiceShuffle').checked,
    };
  }

  function roomConfig() {
    return {
      mode: 'single',
      datasetId: $('#roomDataset').value,
      amount: +$('#roomAmount').value,
      timeMode: 'countdown',
      minutes: state.roomMinutes,
      shuffleAnswers: true,
      instantFeedback: $('#roomFeedback').checked,
    };
  }

  async function startPractice() {
    const btn = $('#startPractice');
    setBtnLoading(btn, true);
    try {
      const data = await api('/api/practice/start', {
        method: 'POST',
        body: JSON.stringify(practiceConfig()),
      });
      state.quizType = 'practice';
      state.sessionId = data.sessionId;
      state.config = data.config;
      beginQuiz(data.quiz, data.startedAt);
    } catch (e) { toast(e.message); }
    finally { setBtnLoading(btn, false); }
  }

  function beginQuiz(quiz, startedAt = Date.now()) {
    state.quiz = quiz || [];
    state.answers = Array(state.quiz.length).fill(null);
    state.index = 0;
    state.selected = null;
    state.checked = false;
    state.score = 0;
    state.review = [];
    state.startedAt = startedAt || Date.now();
    stopTimer();
    show('quiz');
    $('#liveRankingWrap')?.classList.toggle('hidden', state.quizType !== 'room');
    renderQuestion();
    state.timer = setInterval(updateTimer, 500);
    updateTimer();
  }

  function renderQuestion() {
    const q = state.quiz[state.index];
    if (!q) return finishQuiz();
    state.selected = state.answers[state.index];
    state.checked = false;

    $('#questionSet').textContent = q.setName || 'Bộ đề';
    $('#questionNumber').textContent = String(state.index + 1).padStart(2, '0');
    $('#questionText').textContent = q.question;
    $('#feedback').className = 'feedback hidden';
    $('#feedback').textContent = '';

    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    $('#answers').innerHTML = q.options.map((opt, i) => `
      <button class="answer ${state.selected === opt ? 'selected' : ''}" data-answer="${i}">
        <span class="letter">${letters[i] || i + 1}</span>
        <span>${escapeHtml(opt)}</span>
      </button>
    `).join('');

    $$('.answer').forEach(btn => btn.addEventListener('click', () => selectAnswer(+btn.dataset.answer)));

    const pct = Math.round(((state.index + 1) / state.quiz.length) * 100);
    $('#progressText').textContent = `Câu ${state.index + 1}/${state.quiz.length}`;
    $('#progressPercent').textContent = pct + '%';
    $('#progressBar').style.width = pct + '%';
    $('#quizScore').textContent = state.score;
    renderLiveRanking();

    const noFeedbackRoom = state.quizType === 'room' && !state.config.instantFeedback;
    $('#quizAction').textContent = noFeedbackRoom
      ? (state.index === state.quiz.length - 1 ? 'Nộp bài' : 'Câu tiếp theo →')
      : 'Kiểm tra đáp án';
    $('#quizAction').disabled = !state.selected;
  }

  function selectAnswer(i) {
    if (state.checked) return;
    const q = state.quiz[state.index];
    state.selected = q.options[i];
    state.answers[state.index] = state.selected;
    $$('.answer').forEach((b, n) => b.classList.toggle('selected', n === i));
    $('#quizAction').disabled = false;
  }

  async function quizAction() {
    if (!state.selected) return;
    const noFeedbackRoom = state.quizType === 'room' && !state.config.instantFeedback;

    if (noFeedbackRoom) {
      const btn = $('#quizAction');
      btn.disabled = true;
      try {
        const res = await roomAPI.answer({
          code: state.room.code,
          index: state.index,
          selected: state.selected,
        });
        state.score = res.score ?? state.score;
        $('#quizScore').textContent = state.score;
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
        return;
      }
      if (state.index === state.quiz.length - 1) return finishQuiz();
      state.index++;
      renderQuestion();
      return scrollQuizTop();
    }

    if (!state.checked) {
      await checkCurrent();
      return;
    }

    if (state.index === state.quiz.length - 1) return finishQuiz();
    state.index++;
    renderQuestion();
    scrollQuizTop();
  }

  async function checkCurrent() {
    const btn = $('#quizAction');
    btn.disabled = true;
    try {
      let result;
      if (state.quizType === 'practice') {
        result = await api('/api/practice/check', {
          method: 'POST',
          body: JSON.stringify({ sessionId: state.sessionId, index: state.index, selected: state.selected }),
        });
      } else {
        result = await roomAPI.check({
          code: state.room.code,
          index: state.index,
          selected: state.selected,
        });
      }

      state.checked = true;
      if (state.quizType === 'room') state.score = result.score ?? state.score;
      else if (result.correct) state.score++;
      $('#quizScore').textContent = state.score;

      const q = state.quiz[state.index];
      $$('.answer').forEach((el, i) => {
        const opt = q.options[i];
        if (opt === result.correctAnswer) el.classList.add('correct');
        else if (opt === state.selected && !result.correct) el.classList.add('wrong');
        el.disabled = true;
      });

      const box = $('#feedback');
      box.className = 'feedback ' + (result.correct ? 'ok' : 'bad');
      box.innerHTML = result.correct
        ? '<b>✓ Chính xác!</b>'
        : `<b>✕ Chưa đúng.</b> Đáp án đúng: ${escapeHtml(result.correctAnswer)}`;

      btn.textContent = state.index === state.quiz.length - 1 ? 'Xem kết quả →' : 'Câu tiếp theo →';
      btn.disabled = false;
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
    }
  }

  async function skipQuestion() {
    if (state.checked) return;
    state.answers[state.index] = null;

    if (state.quizType === 'room') {
      const btn = $('#skipQuestion');
      btn.disabled = true;
      try {
        const res = await roomAPI.answer({
          code: state.room.code,
          index: state.index,
          selected: null,
        });
        state.score = res.score ?? state.score;
        $('#quizScore').textContent = state.score;
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
        return;
      }
      btn.disabled = false;
    }

    if (state.index === state.quiz.length - 1) finishQuiz();
    else { state.index++; renderQuestion(); scrollQuizTop(); }
  }

  function scrollQuizTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function elapsedSeconds() {
    return Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
  }

  function updateTimer() {
    let sec = elapsedSeconds();
    if (state.config?.timeMode === 'countdown') {
      sec = Math.max(0, state.config.minutes * 60 - sec);
      if (sec <= 0) {
        stopTimer();
        finishQuiz();
      }
    }
    if (state.config?.timeMode === 'none') $('#quizTime').textContent = '—';
    else $('#quizTime').textContent = formatTime(sec);
  }

  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  async function finishQuiz() {
    if (!state.quiz.length) return;
    stopTimer();
    const totalElapsed = elapsedSeconds();
    try {
      let result;
      if (state.quizType === 'practice') {
        result = await api('/api/practice/finish', {
          method: 'POST',
          body: JSON.stringify({ sessionId: state.sessionId, answers: state.answers }),
        });
      } else {
        const res = await roomAPI.submit({ code: state.room.code, answers: state.answers });
        state.room = res.room;
        state.roomSubmitted = true;
        result = res.result;
      }
      showResult(result, totalElapsed);
    } catch (e) {
      toast(e.message);
      state.timer = setInterval(updateTimer, 500);
    }
  }

  function showResult(result, fallbackElapsed = 0) {
    state.review = result.review || [];
    const elapsed = result.elapsedSeconds ?? fallbackElapsed;
    const score = result.score || 0, total = result.total || state.quiz.length;
    $('#resultScore').textContent = score + '/' + total;
    $('#resultCorrect').textContent = score;
    $('#resultAccuracy').textContent = total ? Math.round(score * 100 / total) + '%' : '0%';
    $('#resultTime').textContent = formatTime(elapsed);
    $('#resultSubtitle').textContent = state.quizType === 'room' ? 'Bạn đã nộp bài trong phòng thi.' : 'Kết quả luyện tập của bạn.';
    renderReview();
    renderRanking();
    show('result');
  }

  function renderReview() {
    $('#reviewList').classList.add('hidden');
    $('#reviewList').innerHTML = state.review.map((r, i) => `
      <article class="review">
        <h4>Câu ${i + 1}: ${escapeHtml(r.question)}</h4>
        <p class="${r.isCorrect ? 'good' : 'bad'}">${r.isCorrect ? '✓ Đúng' : '✕ Sai'} · Bạn chọn: ${escapeHtml(r.selected || 'Bỏ qua')}</p>
        <p>Đáp án đúng: <b>${escapeHtml(r.correct)}</b></p>
      </article>
    `).join('');
  }

  function rankedParticipants() {
    if (!state.room?.participants) return [];
    return [...state.room.participants].sort((a, b) =>
      ((b.score || 0) - (a.score || 0)) ||
      ((b.answered || 0) - (a.answered || 0)) ||
      ((a.elapsedSeconds ?? Number.MAX_SAFE_INTEGER) - (b.elapsedSeconds ?? Number.MAX_SAFE_INTEGER)) ||
      String(a.name).localeCompare(String(b.name), 'vi')
    );
  }

  function renderLiveRanking() {
    const wrap = $('#liveRankingWrap');
    if (!wrap) return;
    if (state.quizType !== 'room' || !state.room) {
      wrap.classList.add('hidden');
      return;
    }

    wrap.classList.remove('hidden');
    const list = rankedParticipants();
    const myIndex = list.findIndex(p => p.id === state.playerId);
    $('#myLiveRank').textContent = myIndex >= 0 ? `Hạng #${myIndex + 1}` : '—';

    $('#liveRanking').innerHTML = list.map((p, i) => {
      const total = p.total || state.quiz.length || 0;
      const answered = p.answered || 0;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      return `
        <div class="live-rank-card ${p.id === state.playerId ? 'me' : ''}">
          <span class="live-rank-place">${medal}</span>
          <span class="live-rank-name">${escapeHtml(p.name)}${p.id === state.playerId ? '<small>Bạn</small>' : ''}</span>
          <strong>${p.score || 0}<small>điểm</small></strong>
          <span class="live-rank-progress">${answered}/${total} câu</span>
        </div>
      `;
    }).join('');
  }

  function finalRankLabel(index) {
    return [
      'Khôn hơn thằng top 2',
      'Hơi ngu',
      'Ngu',
      'Siêu ngu',
    ][index] || '';
  }

  function renderRanking() {
    const wrap = $('#rankingWrap');
    const resultCard = document.querySelector('#resultView .result');
    if (state.quizType !== 'room' || !state.room) {
      wrap.classList.add('hidden');
      resultCard?.classList.remove('champion-result');
      return;
    }

    wrap.classList.remove('hidden');
    const list = rankedParticipants();
    const myRank = list.findIndex(p => p.id === state.playerId);
    resultCard?.classList.toggle('champion-result', myRank === 0);

    $('#ranking').innerHTML = list.length ? list.map((p, i) => {
      const status = p.status === 'finished'
        ? `✓ Đã nộp · ${formatTime(p.elapsedSeconds)}`
        : `Đang làm · ${p.answered || 0}/${p.total || state.quiz.length} câu`;
      const label = finalRankLabel(i);
      const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : i === 3 ? '😵' : `#${i + 1}`;

      return `
        <div class="rank-row final-rank ${i === 0 ? 'winner' : ''} ${p.id === state.playerId ? 'me' : ''}">
          <b class="final-rank-place">${medal}</b>
          <span class="final-rank-person">
            <strong>${escapeHtml(p.name)}${p.id === state.playerId ? ' · Bạn' : ''}</strong>
            ${label ? `<em class="rank-roast rank-roast-${i + 1}">${escapeHtml(label)}</em>` : ''}
            <small>${status}</small>
          </span>
          <b>${p.score || 0}/${p.total || state.quiz.length}</b>
        </div>
      `;
    }).join('') : '<p class="muted">Chưa có dữ liệu xếp hạng.</p>';
  }

  function setRoomTab(tab) {
    $$('#roomTabs button').forEach(b => b.classList.toggle('active', b.dataset.roomTab === tab));
    $('#createRoomPanel').classList.toggle('hidden', tab !== 'create');
    $('#joinRoomPanel').classList.toggle('hidden', tab !== 'join');
  }

  async function createRoom() {
    const name = $('#playerName').value.trim();
    if (!name) return toast('Hãy nhập tên của bạn.');
    localStorage.setItem('quizlab_name', name);
    const btn = $('#createRoom');
    setBtnLoading(btn, true);
    try {
      const res = await roomAPI.create({ playerId: state.playerId, name, config: roomConfig() });
      state.room = res.room;
      state.roomSubmitted = false;
      renderLobby();
      show('lobby');
    } catch (e) { toast(e.message); }
    finally { setBtnLoading(btn, false); }
  }

  async function joinRoom() {
    const name = $('#playerName').value.trim();
    const code = $('#roomCodeInput').value.trim().toUpperCase();
    if (!name) return toast('Hãy nhập tên của bạn.');
    if (code.length !== 6) return toast('Mã phòng gồm 6 ký tự.');
    localStorage.setItem('quizlab_name', name);
    const btn = $('#joinRoom');
    setBtnLoading(btn, true);
    try {
      const res = await roomAPI.join({ playerId: state.playerId, name, code });
      state.room = res.room;
      state.roomSubmitted = false;
      renderLobby();
      show('lobby');
    } catch (e) { toast(e.message); }
    finally { setBtnLoading(btn, false); }
  }

  function renderLobby() {
    if (!state.room) return;
    const r = state.room;
    $('#roomCodeDisplay').textContent = r.code;
    $('#lobbyMeta').innerHTML = `
      <span>${r.config.amount} câu</span>
      <span>${r.config.minutes} phút</span>
      <span>${r.config.instantFeedback ? 'Có báo đúng/sai' : 'Thi kín đáp án'}</span>
    `;
    $('#participantList').innerHTML = r.participants.map(p => `
      <div class="person">
        <span><b>${escapeHtml(p.name)}</b><small>${p.id === r.hostId ? ' · Chủ phòng' : ''}</small></span>
        <span>${p.status === 'finished' ? '✓ Đã nộp' : p.status === 'doing' ? 'Đang làm' : 'Sẵn sàng'}</span>
      </div>
    `).join('');
    const isHost = r.hostId === state.playerId;
    $('#startRoom').classList.toggle('hidden', !isHost || r.status !== 'waiting');
    $('#waitingText').classList.toggle('hidden', isHost || r.status !== 'waiting');
  }

  async function startRoom() {
    const btn = $('#startRoom');
    setBtnLoading(btn, true);
    try {
      const res = await roomAPI.start({ code: state.room.code });
      state.room = res.room;
      if (state.room.status === 'started') launchRoomQuiz();
    } catch (e) { toast(e.message); }
    finally { setBtnLoading(btn, false); }
  }

  function launchRoomQuiz() {
    if (!state.room?.quiz || state.roomSubmitted) return;
    state.quizType = 'room';
    state.config = state.room.config;
    beginQuiz(state.room.quiz, state.room.startedAt);
  }

  async function leaveRoom() {
    if (!state.room) return show('home');
    try { await roomAPI.leave({ code: state.room.code }); } catch {}
    state.room = null;
    state.roomSubmitted = false;
    show('home');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (c === '"') {
        if (quote && n === '"') { field += '"'; i++; } else quote = !quote;
      } else if (c === ',' && !quote) { row.push(field); field = ''; }
      else if ((c === '\n' || c === '\r') && !quote) {
        if (c === '\r' && n === '\n') i++;
        row.push(field); field = '';
        if (row.some(x => x.trim())) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  async function importCsv(file) {
    if (!file) return;
    try {
      const rows = parseCsv(await file.text());
      const questions = rows.slice(1).map(r => ({
        question: r[1], correct: r[2], wrong: r.slice(3).filter(Boolean),
      })).filter(q => q.question && q.correct && q.wrong.length);
      if (!questions.length) throw new Error('CSV không có câu hỏi hợp lệ.');
      const name = file.name.replace(/\.csv$/i, '');
      await api('/api/datasets/import', { method: 'POST', body: JSON.stringify({ name, questions }) });
      toast('Đã lưu bộ đề lên server.');
      await loadDatasets();
    } catch (e) { toast(e.message); }
    finally { $('#csvInput').value = ''; }
  }

  roomAPI.on(event => {
    if (event.type === 'closed') {
      state.room = null;
      state.roomSubmitted = false;
      toast('Phòng đã đóng.');
      show('home');
      return;
    }
    if (event.type !== 'update') return;
    state.room = event.room;
    if (state.quizType === 'room') {
      const me = state.room.participants?.find(p => p.id === state.playerId);
      if (me) {
        state.score = me.score || 0;
        $('#quizScore').textContent = state.score;
      }
      renderLiveRanking();
      if (state.roomSubmitted) renderRanking();
    }
    if (state.room.status === 'waiting' && $('#lobbyView').classList.contains('active')) renderLobby();
    if (state.room.status === 'started' && !state.roomSubmitted &&
        !$('#quizView').classList.contains('active') && !$('#resultView').classList.contains('active')) {
      launchRoomQuiz();
    }
  });

  $$('[data-go]').forEach(b => b.addEventListener('click', () => {
    stopTimer();
    if (b.dataset.go === 'home') {
      state.quiz = [];
      state.quizType = null;
    }
    show(b.dataset.go);
  }));

  $('#openPractice').addEventListener('click', () => show('practiceSetup'));
  $('#openRoom').addEventListener('click', () => show('roomSetup'));
  $$('#practiceMode .choice').forEach(b => b.addEventListener('click', () => {
    state.practiceMode = b.dataset.mode;
    $$('#practiceMode .choice').forEach(x => x.classList.toggle('active', x === b));
    updatePracticeAmount();
  }));
  $('#practiceDataset').addEventListener('change', updatePracticeAmount);
  $('#practiceAmount').addEventListener('input', () => $('#practiceAmountOut').textContent = $('#practiceAmount').value);
  $('#roomDataset').addEventListener('change', updateRoomAmount);
  $('#roomAmount').addEventListener('input', () => $('#roomAmountOut').textContent = $('#roomAmount').value);

  $$('#timeMode button').forEach(b => b.addEventListener('click', () => {
    state.timeMode = b.dataset.time;
    $$('#timeMode button').forEach(x => x.classList.toggle('active', x === b));
    $('#practiceMinutesField').classList.toggle('hidden', state.timeMode !== 'countdown');
  }));

  $('#practiceMinus').addEventListener('click', () => {
    state.practiceMinutes = Math.max(1, state.practiceMinutes - 1);
    $('#practiceMinutesText').textContent = state.practiceMinutes;
  });
  $('#practicePlus').addEventListener('click', () => {
    state.practiceMinutes = Math.min(180, state.practiceMinutes + 1);
    $('#practiceMinutesText').textContent = state.practiceMinutes;
  });
  $('#roomMinus').addEventListener('click', () => {
    state.roomMinutes = Math.max(1, state.roomMinutes - 1);
    $('#roomMinutesText').textContent = state.roomMinutes;
  });
  $('#roomPlus').addEventListener('click', () => {
    state.roomMinutes = Math.min(180, state.roomMinutes + 1);
    $('#roomMinutesText').textContent = state.roomMinutes;
  });

  $$('#roomTabs button').forEach(b => b.addEventListener('click', () => setRoomTab(b.dataset.roomTab)));
  $('#roomCodeInput').addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
  $('#startPractice').addEventListener('click', startPractice);
  $('#createRoom').addEventListener('click', createRoom);
  $('#joinRoom').addEventListener('click', joinRoom);
  $('#startRoom').addEventListener('click', startRoom);
  $('#leaveLobby').addEventListener('click', leaveRoom);
  $('#roomCodeDisplay').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.room.code); toast('Đã sao chép mã phòng.'); } catch { toast(state.room.code); }
  });

  $('#quizAction').addEventListener('click', quizAction);
  $('#skipQuestion').addEventListener('click', skipQuestion);
  $('#exitQuiz').addEventListener('click', async () => {
    stopTimer();
    if (state.quizType === 'room') await leaveRoom();
    else show('home');
  });
  $('#toggleReview').addEventListener('click', () => $('#reviewList').classList.toggle('hidden'));
  $('#csvInput').addEventListener('change', e => importCsv(e.target.files?.[0]));

  const dark = localStorage.getItem('quizlab_dark') === '1';
  document.body.classList.toggle('dark', dark);
  $('#themeBtn').textContent = dark ? '☀' : '☾';
  $('#themeBtn').addEventListener('click', () => {
    const on = document.body.classList.toggle('dark');
    localStorage.setItem('quizlab_dark', on ? '1' : '0');
    $('#themeBtn').textContent = on ? '☀' : '☾';
  });

  $('#playerName').value = localStorage.getItem('quizlab_name') || '';
  loadDatasets().catch(e => toast(e.message));

  const params = new URLSearchParams(location.search);
  if (params.get('room')) {
    $('#roomCodeInput').value = params.get('room').toUpperCase().slice(0, 6);
    setRoomTab('join');
    show('roomSetup');
  }
})();

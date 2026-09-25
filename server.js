'use strict';

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const SOURCE_DIR = path.join(DATA_DIR, 'source');
const EXTRA_FILE = path.join(DATA_DIR, 'questions.json');

fs.mkdirSync(SOURCE_DIR, { recursive: true });
if (!fs.existsSync(EXTRA_FILE)) {
  fs.writeFileSync(EXTRA_FILE, JSON.stringify({ version: 1, datasets: [] }, null, 2));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(express.static(PUBLIC_DIR));

const sessions = new Map();
const rooms = new Map();

const clone = v => JSON.parse(JSON.stringify(v));
const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.floor(Number(v) || min)));
const safe = (v, n = 1000) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === '"') {
      if (quoted && next === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => String(x).trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadBuiltIn() {
  const files = fs.existsSync(SOURCE_DIR)
    ? fs.readdirSync(SOURCE_DIR).filter(x => x.endsWith('.csv')).sort()
    : [];
  const questions = [];
  let id = 1;
  for (const file of files) {
    const rows = parseCsv(fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8'));
    for (const cols of rows.slice(1)) {
      if (cols.length < 5) continue;
      const question = safe(cols[1], 4000);
      const correct = safe(cols[2], 2000);
      const wrong = cols.slice(3).map(x => safe(x, 2000)).filter(Boolean);
      if (question && correct && wrong.length) questions.push({ id: id++, question, correct, wrong });
    }
  }
  return {
    id: 'cnxhkh-iv',
    name: 'Chủ nghĩa xã hội khoa học IV',
    builtin: true,
    questions,
  };
}

function loadExtras() {
  try {
    const data = JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf8'));
    return Array.isArray(data.datasets) ? data.datasets : [];
  } catch {
    return [];
  }
}

let datasets = [loadBuiltIn(), ...loadExtras()];

function saveExtras() {
  const extra = datasets.filter(x => !x.builtin);
  const tmp = EXTRA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, datasets: extra }, null, 2));
  fs.renameSync(tmp, EXTRA_FILE);
}

function meta(ds) {
  return { id: ds.id, name: ds.name, questionCount: ds.questions.length, builtin: !!ds.builtin };
}

function getDataset(id) {
  return datasets.find(x => x.id === id) || datasets[0];
}

function normalizeConfig(raw = {}, room = false) {
  const mode = ['single', 'one-per-set', 'all-random'].includes(raw.mode) ? raw.mode : 'single';
  const ds = getDataset(raw.datasetId);
  let max = ds?.questions?.length || 1;
  if (mode === 'one-per-set') max = Math.max(1, datasets.filter(x => x.questions.length).length);
  if (mode === 'all-random') max = Math.max(1, datasets.reduce((s, x) => s + x.questions.length, 0));
  return {
    mode,
    datasetId: ds?.id,
    amount: mode === 'one-per-set' ? max : clamp(raw.amount || Math.min(20, max), 1, max),
    minutes: clamp(raw.minutes || 15, 1, 180),
    timeMode: room ? 'countdown' : (['elapsed', 'countdown', 'none'].includes(raw.timeMode) ? raw.timeMode : 'elapsed'),
    shuffleAnswers: raw.shuffleAnswers !== false,
    instantFeedback: room ? !!raw.instantFeedback : true,
  };
}

function buildQuiz(raw, room = false) {
  const cfg = normalizeConfig(raw, room);
  let picked = [];
  if (cfg.mode === 'single') {
    const ds = getDataset(cfg.datasetId);
    picked = shuffle(ds.questions).slice(0, cfg.amount).map(q => ({ ...clone(q), setName: ds.name, setId: ds.id }));
  } else if (cfg.mode === 'one-per-set') {
    picked = shuffle(datasets.filter(d => d.questions.length).map(d => ({ ...clone(shuffle(d.questions)[0]), setName: d.name, setId: d.id })));
  } else {
    const pool = datasets.flatMap(d => d.questions.map(q => ({ ...clone(q), setName: d.name, setId: d.id })));
    picked = shuffle(pool).slice(0, cfg.amount);
  }
  return picked.map((q, i) => {
    const options = [q.correct, ...q.wrong];
    return {
      id: q.setId + ':' + q.id + ':' + i,
      question: q.question,
      correct: q.correct,
      options: cfg.shuffleAnswers ? shuffle(options) : options,
      setName: q.setName,
      setId: q.setId,
    };
  });
}

const publicQuestion = q => ({ id: q.id, question: q.question, options: q.options, setName: q.setName, setId: q.setId });

function scoreQuiz(quiz, answers) {
  const arr = Array.isArray(answers) ? answers : [];
  let score = 0;
  const review = quiz.map((q, i) => {
    const selected = typeof arr[i] === 'string' ? arr[i] : null;
    const isCorrect = selected === q.correct;
    if (isCorrect) score++;
    return { question: q.question, selected, correct: q.correct, isCorrect, setName: q.setName };
  });
  return { score, total: quiz.length, review };
}

function canMutate(req) {
  return !process.env.ADMIN_KEY || req.get('x-admin-key') === process.env.ADMIN_KEY;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    datasets: datasets.length,
    questions: datasets.reduce((s, d) => s + d.questions.length, 0),
    rooms: rooms.size,
  });
});

app.get('/api/datasets', (req, res) => {
  res.json({
    datasets: datasets.map(meta),
    totalQuestions: datasets.reduce((s, d) => s + d.questions.length, 0),
    uploadsEnabled: process.env.ALLOW_DATASET_UPLOAD !== 'false',
  });
});

app.post('/api/datasets/import', (req, res) => {
  if (process.env.ALLOW_DATASET_UPLOAD === 'false') return res.status(403).json({ error: 'Server đã tắt thêm bộ đề.' });
  if (!canMutate(req)) return res.status(401).json({ error: 'Cần ADMIN_KEY.' });

  const name = safe(req.body?.name || 'Bộ đề mới', 100);
  const raw = Array.isArray(req.body?.questions) ? req.body.questions : [];
  const questions = raw.slice(0, 2000).map((q, i) => {
    const question = safe(q?.question, 4000);
    const correct = safe(q?.correct, 2000);
    const wrong = Array.isArray(q?.wrong) ? q.wrong.map(x => safe(x, 2000)).filter(Boolean).slice(0, 8) : [];
    return question && correct && wrong.length ? { id: i + 1, question, correct, wrong } : null;
  }).filter(Boolean);

  if (!questions.length) return res.status(400).json({ error: 'Không có câu hỏi hợp lệ.' });
  const id = 'set-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex');
  const ds = { id, name, builtin: false, questions };
  datasets.push(ds);
  saveExtras();
  res.status(201).json({ dataset: meta(ds) });
});

app.delete('/api/datasets/:id', (req, res) => {
  if (process.env.ALLOW_DATASET_UPLOAD === 'false') return res.status(403).json({ error: 'Server đã tắt sửa dữ liệu.' });
  if (!canMutate(req)) return res.status(401).json({ error: 'Cần ADMIN_KEY.' });
  const ds = datasets.find(x => x.id === req.params.id);
  if (!ds) return res.status(404).json({ error: 'Không tìm thấy bộ đề.' });
  if (ds.builtin) return res.status(400).json({ error: 'Không thể xóa bộ đề mặc định.' });
  datasets = datasets.filter(x => x.id !== ds.id);
  saveExtras();
  res.json({ ok: true });
});

app.post('/api/practice/start', (req, res) => {
  const config = normalizeConfig(req.body || {});
  const quiz = buildQuiz(config);
  if (!quiz.length) return res.status(400).json({ error: 'Không có câu hỏi.' });
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { quiz, config, createdAt: Date.now() });
  res.json({ sessionId, config, startedAt: Date.now(), quiz: quiz.map(publicQuestion) });
});

app.post('/api/practice/check', (req, res) => {
  const s = sessions.get(String(req.body?.sessionId || ''));
  if (!s) return res.status(404).json({ error: 'Phiên đã hết hạn.' });
  const index = clamp(req.body?.index, 0, s.quiz.length - 1);
  const q = s.quiz[index];
  const selected = String(req.body?.selected || '');
  if (!q.options.includes(selected)) return res.status(400).json({ error: 'Đáp án không hợp lệ.' });
  res.json({ correct: selected === q.correct, correctAnswer: q.correct });
});

app.post('/api/practice/finish', (req, res) => {
  const id = String(req.body?.sessionId || '');
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: 'Phiên đã hết hạn.' });
  const result = scoreQuiz(s.quiz, req.body?.answers);
  sessions.delete(id);
  res.json(result);
});

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let n = 0; n < 100; n++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Không tạo được mã phòng.');
}

const normalizeCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

function roomPublic(r) {
  return {
    code: r.code,
    status: r.status,
    hostId: r.hostId,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    config: clone(r.config),
    quiz: r.quiz ? r.quiz.map(publicQuestion) : null,
    participants: r.participants.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.id === r.hostId,
      status: p.status,
      score: Number.isFinite(p.score) ? p.score : 0,
      total: Number.isFinite(p.total) ? p.total : (r.quiz?.length || null),
      answered: Number.isFinite(p.answered) ? p.answered : 0,
      progress: p.total ? Math.round(((p.answered || 0) / p.total) * 100) : 0,
      elapsedSeconds: p.elapsedSeconds,
    })),
  };
}

function emitRoom(r) {
  r.updatedAt = Date.now();
  io.to(r.code).emit('room:update', roomPublic(r));
}

function ackOk(ack, data = {}) { if (typeof ack === 'function') ack({ ok: true, ...data }); }
function ackFail(ack, error) { if (typeof ack === 'function') ack({ ok: false, error: error?.message || 'Có lỗi xảy ra.' }); }

function player(socket, room) {
  const p = room.participants.find(x => x.id === socket.data.playerId);
  if (!p) throw new Error('Bạn không còn trong phòng.');
  return p;
}

function prepareParticipantForQuiz(p, total) {
  p.status = 'doing';
  p.score = 0;
  p.total = total;
  p.answered = 0;
  p.answers = Array(total).fill(null);
  p.submittedAnswers = Array(total).fill(false);
  p.answerCorrect = Array(total).fill(false);
  p.elapsedSeconds = null;
  p.review = null;
}

function recordRoomAnswer(room, p, rawIndex, rawSelected) {
  if (!room?.quiz?.length) throw new Error('Phòng chưa bắt đầu.');
  const index = clamp(rawIndex, 0, room.quiz.length - 1);
  const q = room.quiz[index];

  if (!Array.isArray(p.answers) || p.answers.length !== room.quiz.length) {
    prepareParticipantForQuiz(p, room.quiz.length);
  }

  if (p.submittedAnswers[index]) {
    return {
      index,
      correct: !!p.answerCorrect[index],
      correctAnswer: q.correct,
      score: p.score,
      answered: p.answered,
      total: p.total,
      alreadyRecorded: true,
    };
  }

  const selected = rawSelected == null || rawSelected === '' ? null : String(rawSelected);
  if (selected !== null && !q.options.includes(selected)) {
    throw new Error('Đáp án không hợp lệ.');
  }

  const correct = selected === q.correct;
  p.answers[index] = selected;
  p.submittedAnswers[index] = true;
  p.answerCorrect[index] = correct;
  p.answered += 1;
  if (correct) p.score += 1;

  return {
    index,
    correct,
    correctAnswer: q.correct,
    score: p.score,
    answered: p.answered,
    total: p.total,
    alreadyRecorded: false,
  };
}

io.on('connection', socket => {
  socket.on('room:create', (payload = {}, ack) => {
    try {
      const id = safe(payload.playerId, 100), name = safe(payload.name, 40);
      if (!id || !name) throw new Error('Hãy nhập tên.');
      const code = roomCode();
      const now = Date.now();
      const r = {
        code, status: 'waiting', hostId: id, createdAt: now, updatedAt: now, startedAt: null,
        config: normalizeConfig(payload.config || {}, true), quiz: null,
        participants: [{ id, name, status: 'waiting', score: 0, total: null, answered: 0, elapsedSeconds: null }],
      };
      rooms.set(code, r);
      socket.data.playerId = id; socket.data.roomCode = code; socket.join(code);
      ackOk(ack, { room: roomPublic(r) }); emitRoom(r);
    } catch (e) { ackFail(ack, e); }
  });

  socket.on('room:join', (payload = {}, ack) => {
    try {
      const code = normalizeCode(payload.code), id = safe(payload.playerId, 100), name = safe(payload.name, 40);
      const r = rooms.get(code);
      if (!r) throw new Error('Không tìm thấy phòng.');
      if (r.status !== 'waiting') throw new Error('Phòng đã bắt đầu.');
      if (!id || !name) throw new Error('Hãy nhập tên.');
      let p = r.participants.find(x => x.id === id);
      if (p) { p.name = name; p.status = 'waiting'; }
      else r.participants.push({ id, name, status: 'waiting', score: 0, total: null, answered: 0, elapsedSeconds: null });
      socket.data.playerId = id; socket.data.roomCode = code; socket.join(code);
      ackOk(ack, { room: roomPublic(r) }); emitRoom(r);
    } catch (e) { ackFail(ack, e); }
  });

  socket.on('room:get', (payload = {}, ack) => {
    try {
      const r = rooms.get(normalizeCode(payload.code));
      if (!r) throw new Error('Không tìm thấy phòng.');
      const id = safe(payload.playerId, 100);
      if (id && r.participants.some(x => x.id === id)) {
        socket.data.playerId = id; socket.data.roomCode = r.code; socket.join(r.code);
      }
      ackOk(ack, { room: roomPublic(r) });
    } catch (e) { ackFail(ack, e); }
  });

  socket.on('room:start', (payload = {}, ack) => {
    try {
      const r = rooms.get(normalizeCode(payload.code));
      if (!r) throw new Error('Phòng không tồn tại.');
      const p = player(socket, r);
      if (p.id !== r.hostId) throw new Error('Chỉ chủ phòng được bắt đầu.');
      if (r.status !== 'waiting') return ackOk(ack, { room: roomPublic(r) });
      r.quiz = buildQuiz(r.config, true);
      r.status = 'started'; r.startedAt = Date.now();
      r.participants.forEach(x => prepareParticipantForQuiz(x, r.quiz.length));
      ackOk(ack, { room: roomPublic(r) }); emitRoom(r);
    } catch (e) { ackFail(ack, e); }
  });

  socket.on('room:check', (payload = {}, ack) => {
    try {
      const r = rooms.get(normalizeCode(payload.code));
      if (!r?.quiz) throw new Error('Phòng chưa bắt đầu.');
      const p = player(socket, r);
      if (!r.config.instantFeedback) throw new Error('Phòng này không bật xem đúng/sai ngay.');
      const result = recordRoomAnswer(r, p, payload.index, payload.selected);
      ackOk(ack, {
        correct: result.correct,
        correctAnswer: result.correctAnswer,
        score: result.score,
        answered: result.answered,
        total: result.total,
      });
      emitRoom(r);
    } catch (e) { ackFail(ack, e); }
  });

  socket.on('room:answer', (payload = {}, ack) => {
    try {
      const r = rooms.get(normalizeCode(payload.code));
      if (!r?.quiz) throw new Error('Phòng chưa bắt đầu.');
      const p = player(socket, r);
      const result = recordRoomAnswer(r, p, payload.index, payload.selected);
      ackOk(ack, {
        recorded: true,
        score: result.score,
        answered: result.answered,
        total: result.total,
        ...(r.config.instantFeedback
          ? { correct: result.correct, correctAnswer: result.correctAnswer }
          : {}),
      });
      emitRoom(r);
    } catch (e) { ackFail(ack, e); }
  });

  socket.on('room:submit', (payload = {}, ack) => {
    try {
      const r = rooms.get(normalizeCode(payload.code));
      if (!r?.quiz || !r.startedAt) throw new Error('Phòng chưa bắt đầu.');
      const p = player(socket, r);
      if (p.status === 'finished' && p.review) {
        return ackOk(ack, { room: roomPublic(r), result: { score: p.score, total: p.total, elapsedSeconds: p.elapsedSeconds, review: p.review } });
      }
      const submitted = Array.isArray(payload.answers) ? payload.answers : [];
      for (let i = 0; i < r.quiz.length; i++) {
        if (!p.submittedAnswers?.[i]) {
          const selected = typeof submitted[i] === 'string' ? submitted[i] : null;
          recordRoomAnswer(r, p, i, selected);
        }
      }
      const result = scoreQuiz(r.quiz, p.answers);
      p.status = 'finished'; p.score = result.score; p.total = result.total; p.answered = result.total; p.review = result.review;
      p.elapsedSeconds = Math.max(0, Math.min(r.config.minutes * 60, Math.floor((Date.now() - r.startedAt) / 1000)));
      if (r.participants.every(x => x.status === 'finished')) r.status = 'finished';
      ackOk(ack, { room: roomPublic(r), result: { ...result, elapsedSeconds: p.elapsedSeconds } });
      emitRoom(r);
    } catch (e) { ackFail(ack, e); }
  });

  socket.on('room:leave', (payload = {}, ack) => {
    try {
      const r = rooms.get(normalizeCode(payload.code || socket.data.roomCode));
      if (!r) return ackOk(ack, { room: null });
      const p = player(socket, r);
      if (p.id === r.hostId) {
        io.to(r.code).emit('room:closed', { code: r.code });
        rooms.delete(r.code);
        return ackOk(ack, { room: null });
      }
      r.participants = r.participants.filter(x => x.id !== p.id);
      socket.leave(r.code); ackOk(ack, { room: roomPublic(r) }); emitRoom(r);
    } catch (e) { ackFail(ack, e); }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.createdAt > 6 * 60 * 60 * 1000) sessions.delete(id);
  for (const [code, r] of rooms) if (now - r.updatedAt > 12 * 60 * 60 * 1000) rooms.delete(code);
}, 10 * 60 * 1000).unref();

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, HOST, () => {
  console.log(`QuizLab: http://${HOST}:${PORT}`);
  console.log(`Loaded ${datasets.length} datasets / ${datasets.reduce((s,d)=>s+d.questions.length,0)} questions`);
});

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ── Servir el frontend ──────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── MongoDB ─────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/centrobet')
  .then(() => console.log('✅  MongoDB conectado'))
  .catch(err => { console.error('❌  MongoDB error:', err); process.exit(1); });

// ── Schemas ─────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  pass:        { type: String, required: true },
  role:        { type: String, enum: ['user','vip','admin'], default: 'user' },
  balance:     { type: Number, default: 500 },
  isRoot:      { type: Boolean, default: false },
  defaultPass: { type: Boolean, default: false },
  joined:      { type: String, default: () => new Date().toLocaleDateString('es') }
});

const winSchema = new mongoose.Schema({
  username: String,
  amount:   Number,
  game:     String,
  won:      Boolean,
  ts:       { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  code:      { type: String, unique: true },
  state:     { type: Object, default: {} },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Win  = mongoose.model('Win',  winSchema);
const Room = mongoose.model('Room', roomSchema);

// ── Seed admin por defecto ───────────────────────────────────────────────────
async function seedAdmin() {
  const exists = await User.findOne({ username: 'admin' });
  if (!exists) {
    await User.create({
      username: 'admin', email: 'admin@centrobet.hn',
      pass: 'admin123', role: 'admin', balance: 99999,
      isRoot: true, defaultPass: true
    });
    await User.create({ username: 'user1', email: 'user1@centrobet.hn', pass: 'pass123', balance: 1000 });
    await User.create({ username: 'user2', email: 'user2@centrobet.hn', pass: 'pass123', balance: 500  });
    await User.create({ username: 'vip1',  email: 'vip1@centrobet.hn',  pass: 'vip123',  role: 'vip', balance: 5000 });
    console.log('🌱  Usuarios semilla creados');
  }
}
seedAdmin();

// ── Helpers ──────────────────────────────────────────────────────────────────
const userOut = (u) => ({
  username: u.username, email: u.email, role: u.role,
  balance: u.balance, isRoot: u.isRoot, defaultPass: u.defaultPass, joined: u.joined
});

// ═══════════════════════════════════════════════════════════════════════════
//  RUTAS — AUTH
// ═══════════════════════════════════════════════════════════════════════════

// Login
app.post('/api/login', async (req, res) => {
  const { ident, pass } = req.body;
  if (!ident || !pass) return res.status(400).json({ error: 'Campos requeridos' });

  const user = await User.findOne({
    $or: [{ username: ident.toLowerCase() }, { email: ident.toLowerCase() }]
  });
  if (!user || user.pass !== pass)
    return res.status(401).json({ error: 'Usuario/email o contraseña incorrectos.' });

  res.json({ ok: true, user: userOut(user) });
});

// Restaurar sesión por username (sin contraseña, solo para reload)
app.get('/api/login/session', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username requerido' });
  const user = await User.findOne({ username: username.toLowerCase() });
  if (!user) return res.status(404).json({ error: 'Sesión no válida' });
  res.json({ ok: true, user: userOut(user) });
});

// Registro
app.post('/api/register', async (req, res) => {
  const { username, email, pass, role } = req.body;
  if (!username || !email || !pass) return res.status(400).json({ error: 'Campos requeridos' });
  if (!/^[a-z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Usuario: 3-20 chars, solo letras/números/_' });
  if (pass.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });

  try {
    const balance = role === 'vip' ? 2500 : 500;
    const u = await User.create({ username, email, pass, role: role || 'user', balance });
    res.json({ ok: true, user: userOut(u) });
  } catch (e) {
    const msg = e.code === 11000
      ? (e.keyPattern?.username ? 'Usuario ya en uso.' : 'Email ya registrado.')
      : 'Error al registrar.';
    res.status(400).json({ error: msg });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  RUTAS — USUARIOS
// ═══════════════════════════════════════════════════════════════════════════

// Obtener todos los usuarios (admin)
app.get('/api/users', async (req, res) => {
  const users = await User.find({}, '-__v');
  res.json(users.map(userOut));
});

// Actualizar balance
app.patch('/api/users/:username/balance', async (req, res) => {
  const { amount } = req.body;
  const u = await User.findOneAndUpdate(
    { username: req.params.username },
    { $inc: { balance: amount } },
    { new: true }
  );
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true, user: userOut(u) });
});

// Actualizar balance exacto (set)
app.put('/api/users/:username/balance', async (req, res) => {
  const { balance } = req.body;
  const u = await User.findOneAndUpdate(
    { username: req.params.username },
    { balance },
    { new: true }
  );
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true, user: userOut(u) });
});

// Cambiar rol
app.patch('/api/users/:username/role', async (req, res) => {
  const { role } = req.body;
  const u = await User.findOne({ username: req.params.username });
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (u.isRoot && role !== 'admin')
    return res.status(403).json({ error: 'No puedes cambiar el rol del root admin' });
  u.role = role;
  await u.save();
  res.json({ ok: true, user: userOut(u) });
});

// Resetear / cambiar contraseña
app.patch('/api/users/:username/password', async (req, res) => {
  const { currentPass, newPass, force } = req.body;
  const u = await User.findOne({ username: req.params.username });
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!force && u.pass !== currentPass)
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  if (!newPass || newPass.length < 6)
    return res.status(400).json({ error: 'Contraseña muy corta' });
  u.pass = newPass;
  u.defaultPass = false;
  await u.save();
  res.json({ ok: true });
});

// Eliminar usuario
app.delete('/api/users/:username', async (req, res) => {
  const u = await User.findOne({ username: req.params.username });
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (u.isRoot) return res.status(403).json({ error: 'No puedes eliminar la cuenta root' });
  await User.deleteOne({ username: req.params.username });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
//  RUTAS — GANADORES / HISTORIAL
// ═══════════════════════════════════════════════════════════════════════════

// Registrar ganada/jugada
app.post('/api/wins', async (req, res) => {
  const { username, amount, game, won } = req.body;
  await Win.create({ username, amount, game, won });
  res.json({ ok: true });
});

// Recientes (últimas 50 victorias)
app.get('/api/wins/recent', async (req, res) => {
  const wins = await Win.find({ won: true }).sort({ ts: -1 }).limit(50);
  res.json(wins);
});

// Leaderboard (top 10 por total ganado)
app.get('/api/wins/leaderboard', async (req, res) => {
  const lb = await Win.aggregate([
    { $match: { won: true } },
    { $group: { _id: '$username', total: { $sum: '$amount' }, wins: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 10 }
  ]);
  res.json(lb);
});

// ═══════════════════════════════════════════════════════════════════════════
//  RUTAS — SALAS ONLINE
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/rooms', async (req, res) => {
  const { code, state } = req.body;
  await Room.findOneAndUpdate({ code }, { state, updatedAt: new Date() }, { upsert: true, new: true });
  res.json({ ok: true });
});

app.get('/api/rooms/:code', async (req, res) => {
  const room = await Room.findOne({ code: req.params.code });
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  res.json(room);
});

app.delete('/api/rooms/:code', async (req, res) => {
  await Room.deleteOne({ code: req.params.code });
  res.json({ ok: true });
});

// ── Catch-all → index.html (SPA) ────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Iniciar servidor ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀  CentroBet corriendo en http://localhost:${PORT}`));

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const talentRoutes = require('./routes/talents');

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});
redisClient.on('error', (err) => console.error('❌ Redis 連線錯誤:', err));
redisClient.connect()
  .then(() => console.log('✅ Redis 已成功連線'))
  .catch(console.error);

app.set('trust proxy', 1);
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(session({
  name: 'tp.sid',
  store: new RedisStore({ client: redisClient, prefix: 'tp:sess:' }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/talents', talentRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 後端伺服器已啟動，監聽位址：http://127.0.0.1:${PORT}`);
});
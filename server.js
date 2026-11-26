require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const { requireAuth, requireRole } = require('./middleware/auth');

// 引入你原本寫好的資料庫連線函式（請依你實際檔案路徑與名稱調整）
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. 連接 MongoDB 資料庫
connectDB();

// 2. 初始化本機 Redis 連線
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});
redisClient.on('error', (err) => console.error('❌ Redis 連線錯誤:', err));
redisClient.connect()
  .then(() => console.log('✅ Redis 已成功連線'))
  .catch(console.error);

// 3. 基礎安全與請求解析設定
app.set('trust proxy', 1); // 信任 Nginx 反向代理標頭
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173', // 允許前端跨域帶上 Cookie
  credentials: true
}));

// 4. 掛載 Redis Session Middleware（必須在所有業務路由之前）
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
    maxAge: 1000 * 60 * 60 * 12 // 12 小時有效期
  }
}));

// 5. 掛載路由
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/auth', authRoutes);

// 6. 啟動伺服器
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 後端伺服器已啟動，監聽位址：http://127.0.0.1:${PORT}`);
});

// ✅ 公開路由：登入、登出與檢查狀態（不加 requireAuth）
app.use('/api/auth', require('./routes/auth'));

// ✅ 管理員專用路由：開通教師帳號（在 routes/users.js 內已設定限 admin）
app.use('/api/users', require('./routes/users'));

// 🔒 以下為你原本寫在 server.js 的業務路由，加上 requireAuth 守門員：

// 1. 一般老師與管理員「登入後」皆可讀取、新增、修改
app.get('/api/talents', requireAuth, async (req, res) => {
  // ... 保留你原本的查詢程式碼 ...
});

app.post('/api/talents', requireAuth, async (req, res) => {
  // ... 保留你原本的新增程式碼 ...
});

app.put('/api/talents/:id', requireAuth, async (req, res) => {
  // ... 保留你原本的修改程式碼 ...
});

// 2. 敏感操作（例如刪除）再加上 requireRole('admin')，一般老師會被擋下並收到 403
app.delete('/api/talents/:id', requireAuth, requireRole('admin'), async (req, res) => {
  // ... 保留你原本的刪除程式碼 ...
});
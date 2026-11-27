const express = require('express');
const rateLimit = require('express-rate-limit');
const Teacher = require('../models/Teacher');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 防暴力破解：同一個 IP 在 15 分鐘內最多嘗試登入 5 次
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { success: false, message: '登入嘗試次數過多，請 15 分鐘後再試' },
  standardHeaders: true,
  legacyHeaders: false
});

// 1. 老師登入：POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: '請輸入電郵與密碼' });
    }

    // 明確選取平時隱藏的 password 欄位
    const teacher = await Teacher.findOne({ email: email.toLowerCase() }).select('+password');
    if (!teacher || !teacher.is_active) {
      return res.status(401).json({ success: false, message: '電郵或密碼錯誤，或帳號已停用' });
    }

    const isMatch = await teacher.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '電郵或密碼錯誤' });
    }

    // 更新最後登入時間
    await Teacher.updateOne({ _id: teacher._id }, { $set: { last_login: new Date() } });

    // 重新生成 Session ID 防止 Session Fixation 攻擊
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ success: false, message: '建立連線階段失敗' });
      }
      req.session.teacherId = teacher._id.toString();
      req.session.role = teacher.role;
      req.session.name = teacher.name;

      res.json({
        success: true,
        teacher: {
          id: teacher._id,
          name: teacher.name,
          email: teacher.email,
          department: teacher.department,
          role: teacher.role
        }
      });
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: '伺服器內部錯誤' });
  }
});

// 2. 老師登出：POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: '登出失敗' });
    }
    res.clearCookie('tp.sid');
    res.json({ success: true, message: '已成功登出' });
  });
});

// 3. 取得目前登入狀態：GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.session.teacherId);
    if (!teacher || !teacher.is_active) {
      return res.status(401).json({ success: false, message: '帳號無效或已停用' });
    }
    res.json({
      success: true,
      teacher: {
        id: teacher._id,
        name: teacher.name,
        email: teacher.email,
        department: teacher.department,
        role: teacher.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '伺服器內部錯誤' });
  }
});


module.exports = router;
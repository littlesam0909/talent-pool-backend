const express = require('express');
const router = express.Router();
const Teacher = require('../models/Teacher');
const { requireAuth, requireRole } = require('../middleware/auth');

// 整份帳號管理路由限定「已登入且角色為 admin」才能存取
router.use(requireAuth, requireRole('admin'));

// 1. 取得所有教師帳號列表（排除密碼欄位）
router.get('/', async (req, res) => {
  try {
    const teachers = await Teacher.find()
      .select('-password')
      .sort({ createdAt: -1 });
    res.json({ count: teachers.length, users: teachers });
  } catch (error) {
    res.status(500).json({ message: '取得教師列表失敗', error: error.message });
  }
});

// 2. 管理員建立新教師帳號
router.post('/', async (req, res) => {
  try {
    const { email, password, name, department, role } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: '請完整填寫電郵、密碼與姓名' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: '密碼長度至少需要 8 個字元' });
    }

    const existing = await Teacher.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ message: '此電郵帳號已存在' });
    }

    const newTeacher = await Teacher.create({
      email,
      password,
      name,
      department: department || '未分配部門',
      role: role === 'admin' ? 'admin' : 'teacher'
    });

    res.status(201).json({
      message: '教師帳號建立成功',
      user: {
        id: newTeacher._id,
        email: newTeacher.email,
        name: newTeacher.name,
        department: newTeacher.department,
        role: newTeacher.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: '建立教師帳號失敗', error: error.message });
  }
});

module.exports = router;
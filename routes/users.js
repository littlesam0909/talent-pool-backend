const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Teacher = require('../models/Teacher');
const { requireAuth, requireRole } = require('../middleware/auth');

// 整份路由限定「已登入且角色為 admin」才能存取
router.use(requireAuth, requireRole('admin'));

// 輔助函式：從 Redis Session Store 強制清除指定教師的所有登入連線
const destroyUserSessions = (req, targetTeacherId) => {
  return new Promise((resolve) => {
    const store = req.sessionStore;
    if (!store || typeof store.all !== 'function') {
      return resolve(0);
    }

    store.all((err, sessions) => {
      if (err || !Array.isArray(sessions)) {
        return resolve(0);
      }

      const targetSessions = sessions.filter(
        (sess) => sess && String(sess.teacherId) === String(targetTeacherId)
      );

      if (targetSessions.length === 0) {
        return resolve(0);
      }

      let destroyedCount = 0;
      let pending = targetSessions.length;

      targetSessions.forEach((sess) => {
        const sid = sess.id || sess.sid;
        if (!sid) {
          pending -= 1;
          if (pending === 0) resolve(destroyedCount);
          return;
        }
        store.destroy(sid, (destroyErr) => {
          if (!destroyErr) destroyedCount += 1;
          pending -= 1;
          if (pending === 0) resolve(destroyedCount);
        });
      });
    });
  });
};

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

// 3. 修改教師資料或角色權限（姓名、部門、role）
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: '無效的教師 ID 格式' });
    }

    const { name, department, role } = req.body;

    // 防止管理員將自己降級為一般老師
    if (String(id) === String(req.session.teacherId) && role && role !== 'admin') {
      return res.status(400).json({ message: '無法將目前登入的管理員帳號降級' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (department !== undefined) updates.department = department.trim();
    if (role !== undefined) {
      if (!['admin', 'teacher'].includes(role)) {
        return res.status(400).json({ message: '角色只能設定為 admin 或 teacher' });
      }
      updates.role = role;
    }

    const updatedTeacher = await Teacher.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedTeacher) {
      return res.status(404).json({ message: '找不到該教師帳號' });
    }

    // 若將某位老師降級，順便強制登出其舊 Session 以套用新權限
    if (role === 'teacher') {
      await destroyUserSessions(req, id);
    }

    res.json({
      message: '教師資料更新成功',
      user: updatedTeacher
    });
  } catch (error) {
    res.status(500).json({ message: '更新教師資料失敗', error: error.message });
  }
});

// 4. 管理員重設教師密碼（並強制登出該帳號的舊連線）
router.patch('/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: '無效的教師 ID 格式' });
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: '新密碼長度至少需要 8 個字元' });
    }

    const teacher = await Teacher.findById(id);
    if (!teacher) {
      return res.status(404).json({ message: '找不到該教師帳號' });
    }

    // 使用 .save() 確保觸發 Teacher 模型的 bcrypt 密碼雜湊鉤子
    teacher.password = newPassword;
    await teacher.save();

    // 清除該教師在 Redis 的現有 Session（若非管理員本人）
    let revokedSessions = 0;
    if (String(id) !== String(req.session.teacherId)) {
      revokedSessions = await destroyUserSessions(req, id);
    }

    res.json({
      message: '密碼已重設完成',
      revokedSessions
    });
  } catch (error) {
    res.status(500).json({ message: '重設密碼失敗', error: error.message });
  }
});

// 5. 刪除教師帳號並強制踢除線上 Session
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: '無效的教師 ID 格式' });
    }

    // 防止管理員誤刪自己
    if (String(id) === String(req.session.teacherId)) {
      return res.status(400).json({ message: '無法刪除目前登入的管理員帳號' });
    }

    const deletedTeacher = await Teacher.findByIdAndDelete(id);
    if (!deletedTeacher) {
      return res.status(404).json({ message: '找不到該教師帳號' });
    }

    const revokedSessions = await destroyUserSessions(req, id);

    res.json({
      message: `已刪除教師帳號（${deletedTeacher.name}）`,
      revokedSessions
    });
  } catch (error) {
    res.status(500).json({ message: '刪除教師帳號失敗', error: error.message });
  }
});

module.exports = router;
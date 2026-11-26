// 1. 驗證是否已登入
exports.requireAuth = (req, res, next) => {
  if (!req.session || !req.session.teacherId) {
    return res.status(401).json({ success: false, message: '請先登入系統' });
  }
  next();
};

// 2. 驗證管理員權限 (RBAC)
exports.requireAdmin = (req, res, next) => {
  if (!req.session || req.session.role !== 'admin') {
    return res.status(403).json({ success: false, message: '權限不足，僅限管理員操作' });
  }
  next();
};
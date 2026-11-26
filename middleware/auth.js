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

// middleware/auth.js
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.teacherId) {
    return res.status(401).json({ message: '請先登入系統' });
  }
  next();
};

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.role) {
      return res.status(401).json({ message: '請先登入系統' });
    }
    if (!allowedRoles.includes(req.session.role)) {
      return res.status(403).json({ message: '權限不足，僅限管理員執行此操作' });
    }
    next();
  };
};

module.exports = { requireAuth, requireRole };
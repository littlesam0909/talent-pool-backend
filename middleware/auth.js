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
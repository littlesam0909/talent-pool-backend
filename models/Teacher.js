const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const teacherSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, '請輸入電郵地址'],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, '請輸入密碼'],
    minlength: 8,
    select: false // 預設查詢不回傳密碼欄位，防止意外洩漏
  },
  name: {
    type: String,
    required: [true, '請輸入老師姓名'],
    trim: true
  },
  department: {
    type: String,
    default: '未指定科組'
  },
  role: {
    type: String,
    enum: ['admin', 'teacher'],
    default: 'teacher'
  },
  is_active: {
    type: Boolean,
    default: true // 離職時可停用帳號，而不破壞歷史活動紀錄的關聯
  },
  last_login: {
    type: Date
  }
}, { timestamps: true });

// 儲存前自動使用 bcryptjs 加密密碼
teacherSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// 實例方法：驗證登入密碼
teacherSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Teacher', teacherSchema);
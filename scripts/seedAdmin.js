require('dotenv').config();
const mongoose = require('mongoose');
const Teacher = require('../models/Teacher');

async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  // 強制檢查：沒提供帳密就直接中止，絕不在程式碼裡留預設密碼
  if (!adminEmail || !adminPassword) {
    console.error('❌ 請先設定 ADMIN_EMAIL 與 ADMIN_PASSWORD 環境變數後再執行');
    process.exit(1);
  }

  try {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/talent_pool';
    await mongoose.connect(uri);

    const existing = await Teacher.findOne({ email: adminEmail.toLowerCase() });
    if (existing) {
      console.log('⚠️ 管理員帳號已存在：', adminEmail);
    } else {
      await Teacher.create({
        email: adminEmail,
        password: adminPassword,
        name: '系統管理員',
        department: '資訊科技組',
        role: 'admin'
      });
      console.log('✅ 第一位管理員帳號建立成功！電郵：', adminEmail);
    }
  } catch (error) {
    console.error('❌ 建立失敗：', error);
  } finally {
    await mongoose.disconnect();
  }
}

seedAdmin();
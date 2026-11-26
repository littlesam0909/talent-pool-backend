require('dotenv').config();
const mongoose = require('mongoose');
const Teacher = require('../models/Teacher');

async function seedAdmin() {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/talent_pool';
    await mongoose.connect(uri);

    const adminEmail = 'admin@school.edu.hk'; // 可改成你實際想用的管理員電郵
    const existing = await Teacher.findOne({ email: adminEmail });

    if (existing) {
      console.log('⚠️ 管理員帳號已存在：', adminEmail);
    } else {
      await Teacher.create({
        email: adminEmail,
        password: 'ChangeMe123!', // 至少 8 位元，之後可再修改
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
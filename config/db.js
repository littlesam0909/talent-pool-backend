const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/talent_pool';
    const conn = await mongoose.connect(uri);
    console.log(`✅ MongoDB 已成功連線：${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB 連線失敗：${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
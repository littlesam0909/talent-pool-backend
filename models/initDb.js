const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Student = require('../models/Student');
const ActivityRecord = require('../models/ActivityRecord');
const SystemConfig = require('../models/SystemConfig');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/talent_pool';

async function initDatabase() {
  try {
    console.log('正在連線至 MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB 連線成功！');

    console.log('正在建立與同步集合索引...');
    await Promise.all([
      User.syncIndexes(),
      Student.syncIndexes(),
      ActivityRecord.syncIndexes(),
      SystemConfig.syncIndexes()
    ]);
    console.log('✅ 集合與索引建立完成！');

    const existingRules = await SystemConfig.findOne({ config_key: 'scoring_rules' });
    if (!existingRules) {
      await SystemConfig.create({
        config_key: 'scoring_rules',
        scope_scores: { "國際性": 3, "全港性": 2, "地區性": 1, "校內": 1 },
        award_scores: { "第一名/冠": 3, "第二名/亞": 2, "第三名/季": 1, "其他": 0, "沒有": 0 },
        performance_scores: { "1": 1, "2": 2, "3": 3 }
      });
      console.log('✅ 初始化動態計分規則成功！');
    }

    console.log('🎉 資料庫模型與預設組態設定完成！');
    process.exit(0);
  } catch (error) {
    console.error('❌ 初始化失敗:', error);
    process.exit(1);
  }
}

initDatabase();
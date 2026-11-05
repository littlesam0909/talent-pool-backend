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

    // 自動建立或更新動態計分規則 (Upsert 機制)
    await SystemConfig.findOneAndUpdate(
      { config_key: 'scoring_rules' },
      {
        $set: {
          scope_scores: { "國際性": 3, "全港性": 2, "地區性": 1, "校內": 1 },
          award_scores: { 
            "第一名/冠軍/金獎": 3, 
            "第二名/亞軍/銀獎": 2, 
            "第三名/季軍/銅獎": 1, 
            "其他": 0, 
            "沒有": 0 
          },
          performance_scores: { "1": 1, "2": 2, "3": 3 }
        }
      },
      { upsert: true, new: true }
    );
    console.log('✅ 動態計分規則已同步更新至最新設定！');

    console.log('🎉 資料庫模型與預設組態設定完成！');
    process.exit(0);
  } catch (error) {
    console.error('❌ 初始化失敗:', error);
    process.exit(1);
  }
}

initDatabase();
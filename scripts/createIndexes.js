const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/talent_pool';

async function runPracticeIndexes() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    console.log('1. 建立 activityrecords 索引...');
    await db.collection('activityrecords').createIndexes([
      // 支援「全學年參賽人次」與「全學年比賽總數」
      { key: { academic_year: 1, event_name: 1 }, name: 'idx_year_event' },
      
      // 支援「按活動類型找高評價潛質學生」(ESR 原則)
      { key: { activity_type: 1, teacher_evaluation_score: -1 }, name: 'idx_type_score' },
      
      // 通配符索引：一次涵蓋 smart_tags 底下 8 個多元智能欄位
      { key: { 'smart_tags.$**': 1 }, name: 'idx_smart_tags_wildcard' }
    ]);

    console.log('2. 建立 students 索引...');
    await db.collection('students').createIndexes([
      // 支援「篩選在學學生並按總積分排名」
      { key: { status: 1, 'talent_summary.total_accumulated_score': -1 }, name: 'idx_active_rank' }
    ]);

    console.log('✅ 練習索引建立成功！');
    process.exit(0);
  } catch (err) {
    console.error('❌ 建立失敗:', err);
    process.exit(1);
  }
}

runPracticeIndexes();
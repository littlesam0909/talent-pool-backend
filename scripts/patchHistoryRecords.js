const XLSX = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const FILE_PATH = path.join(__dirname, '../data/人才庫總表.xlsx');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/talent_pool';
const IS_DRY_RUN = process.argv.includes('--dry-run');

function formatAcademicYear(rawYear) {
  if (!rawYear) return '2025-2026';
  const str = String(Math.floor(Number(rawYear)));
  if (str.length === 4) {
    return `20${str.substring(0, 2)}-20${str.substring(2, 4)}`;
  }
  return String(rawYear).trim();
}

function toBool(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val > 0;
  if (!val) return false;
  return ['true', 'yes', 'y', '1', '是', '有', '✓', '✔'].includes(String(val).trim().toLowerCase());
}

function parsePrizeItem(val) {
  if (val === false || val === null || val === undefined) return '';
  if (val === true) return '有';
  return String(val).trim();
}

async function patchHistoryRecords() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const recordsCol = db.collection('activityrecords');
  const studentsCol = db.collection('students');

  const workbook = XLSX.readFile(FILE_PATH);
  const sheet = workbook.Sheets['人才庫表格'] || workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const processedIds = new Set();
  let matchedCount = 0;
  let otherAwardCount = 0;
  const bulkOps = [];

  for (const row of rows) {
    const nameCh = String(row[' 得獎同學'] || row['得獎同學'] || '').trim();
    const rawYear = row['學年'];
    if (!nameCh || !rawYear) continue;

    const academicYear = formatAcademicYear(rawYear);
    const className = String(row['班別'] || '').trim().toUpperCase();
    const classNo = Number(row['學號']) || 0;
    const eventName = String(row['比賽項目/ 活動名稱'] || '').trim();

    const candidates = await recordsCol.find({
      import_source: '人才庫總表_歷史數據',
      academic_year: academicYear,
      class_no: classNo,
      student_name: nameCh,
      event_name: eventName
    }).toArray();

    const doc = candidates.find(
      (c) => !processedIds.has(c._id.toString()) && String(c.class_name || '').trim().toUpperCase() === className
    );

    if (!doc) continue;
    processedIds.add(doc._id.toString());
    matchedCount++;

    const otherAwardNote = String(row['其他獎項 請註明:'] || '').trim();
    const rawPart = String(row['隊際/個人'] || '').trim();
    const totalScore = Number(row['總分']) || Number(doc.teacher_evaluation_score) || 0;

    if (otherAwardNote) {
      otherAwardCount++;
      if (IS_DRY_RUN && otherAwardCount <= 10) {
        console.log(`[預覽其他獎項] ${academicYear} ${className} ${nameCh} | ${eventName} -> "${otherAwardNote}"`);
      }
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            record_type: 'award',
            class_name: className,
            other_award_note: otherAwardNote,
            participation_type: rawPart === '隊際' ? '隊際' : '個人',
            has_certificate: toBool(row['證書']),
            has_trophy_or_medal: toBool(row['獎盃']),
            prize_item: parsePrizeItem(row['獎品']),
            total_score: totalScore,
            recommended_merit: String(row['建議獎勵'] || '').trim(),
            merit_count: Number(row['獎勵數目']) || 0
          }
        }
      }
    });
  }

  console.log(`\n📊 比對統計：共匹配 ${matchedCount} 筆歷史紀錄，其中包含「其他獎項說明」共 ${otherAwardCount} 筆。`);

  if (IS_DRY_RUN) {
    console.log('✅ [Dry-Run] 預檢完成，尚未修改資料庫。確認無誤後請去掉 --dry-run 正式執行。');
    process.exit(0);
  }

  if (bulkOps.length > 0) {
    const res = await recordsCol.bulkWrite(bulkOps);
    console.log(`✅ 已更新 ${res.modifiedCount} 筆活動紀錄。`);
  }

  const scoreSummary = await recordsCol.aggregate([
    {
      $group: {
        _id: '$student_id',
        accumulated: {
          $sum: { $ifNull: ['$total_score', { $ifNull: ['$teacher_evaluation_score', 0] }] }
        }
      }
    }
  ]).toArray();

  if (scoreSummary.length > 0) {
    const studentOps = scoreSummary.map((item) => ({
      updateOne: {
        filter: { _id: item._id },
        update: {
          $set: {
            'talent_summary.total_accumulated_score': item.accumulated,
            'talent_summary.last_updated': new Date()
          }
        }
      }
    }));
    await studentsCol.bulkWrite(studentOps);
    console.log(`✅ 已同步更新 ${studentOps.length} 位學生的累積總分。`);
  }

  process.exit(0);
}

patchHistoryRecords().catch((err) => {
  console.error('❌ 執行失敗:', err);
  process.exit(1);
});
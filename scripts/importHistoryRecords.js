const XLSX = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const Student = require('../models/Student');
// 假設你有定義 ActivityRecord model，若尚未建立，腳本會直接寫入 activityrecords 集合
const FILE_PATH = path.join(__dirname, '../data/talent_pool_history.xlsx');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/talent_pool';
const IS_DRY_RUN = process.argv.includes('--dry-run');

// 學年格式轉化 (例: 2526 -> 2025-2026)
function formatAcademicYear(rawYear) {
  if (!rawYear) return '2025-2026';
  const str = String(Math.floor(Number(rawYear)));
  if (str.length === 4) {
    const start = '20' + str.substring(0, 2);
    const end = '20' + str.substring(2, 4);
    return `${start}-${end}`;
  }
  return String(rawYear);
}

// 解析班別中的年級數字 (例: "3B" -> 3)
function parseForm(className) {
  const match = String(className).match(/^(\d)/);
  return match ? parseInt(match[1], 10) : null;
}

async function importHistory() {
  try {
    console.log('正在連線至 MongoDB...');
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    const workbook = XLSX.readFile(FILE_PATH);
    const sheet = workbook.Sheets['人才庫表格'] || workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    console.log(`📊 讀取歷史紀錄共 ${rows.length} 列`);

    let matchedCount = 0;
    let createdLeftOrGradCount = 0;
    let activityOps = [];
    let studentBulkOps = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nameCh = String(row[' 得獎同學'] || row['得獎同學'] || '').trim();
      const rawYear = row['學年'];
      
      // 跳過無得獎者姓名的空白列
      if (!nameCh || !rawYear) continue;

      const academicYear = formatAcademicYear(rawYear);
      const className = String(row['班別'] || '').trim();
      const classNo = Number(row['學號']) || 0;

      // 1. 根據姓名搜尋現有 MongoDB 學生
      let student = await Student.findOne({ name_ch: nameCh });
      let studentId = '';

      if (student) {
        // A. 找到學生：取得 ID 並補全歷史班別軌跡
        studentId = student._id;
        matchedCount++;

        studentBulkOps.push({
          updateOne: {
            filter: { _id: studentId },
            update: {
              $addToSet: {
                academic_history: {
                  academic_year: academicYear,
                  class_name: className,
                  class_no: classNo
                }
              }
            }
          }
        });
      } else {
        // B. 找不到學生：自動建立離校/畢業學生檔案
        createdLeftOrGradCount++;
        const formNum = parseForm(className);
        const isGraduated = formNum === 6;
        const status = isGraduated ? 'graduated' : 'left';
        studentId = `HIST_${academicYear.replace('-', '')}_${className}_${classNo}_${nameCh}`;

        studentBulkOps.push({
          updateOne: {
            filter: { _id: studentId },
            update: {
              $setOnInsert: {
                _id: studentId,
                name_ch: nameCh,
                name_en: '',
                gender: '',
                status: status,
                status_details: {
                  left_form: isGraduated ? '中六畢業' : (formNum ? `中${formNum} (F.${formNum})` : '未知年級'),
                  last_academic_year: academicYear,
                  last_class_name: className,
                  last_class_no: classNo,
                  source_remark: '歷史人才庫總表匯入時自動歸檔'
                },
                academic_history: [{
                  academic_year: academicYear,
                  class_name: className,
                  class_no: classNo
                }],
                talent_summary: { total_accumulated_score: 0 }
              }
            },
            upsert: true
          }
        });
      }

      // 2. 構建得獎與活動紀錄 Document
      const activityDoc = {
        student_id: studentId,
        academic_year: academicYear,
        class_name: className,
        class_no: classNo,
        student_name: nameCh,
        teacher_in_charge: String(row['負責老師'] || '').trim(),
        category: String(row['校內/校外'] || '').trim(),
        organizer: String(row['主辦單位'] || '').trim(),
        event_name: String(row['比賽項目/ 活動名稱'] || '').trim(),
        award: String(row['獎項'] || '').trim(),
        activity_type: String(row['活動類型'] || '').trim(),
        group_name: String(row['活動團體'] || '').trim(),
        scale: String(row['活動規模'] || '').trim(),
        teacher_evaluation_score: Number(row['學生表現分數(老師評價)(1-3)']) || 0,
        smart_tags: {
          linguistic: Boolean(row['語言智能出眾']),
          logic_math: Boolean(row['邏輯數學智能出眾']),
          interpersonal: Boolean(row['人際關係智能出眾']),
          intrapersonal: Boolean(row['自省智能出眾']),
          musical: Boolean(row['音樂智能出眾']),
          spatial: Boolean(row['空間智能出眾']),
          bodily: Boolean(row['身體動覺智能出眾']),
          naturalist: Boolean(row['自然辨識智能出眾'])
        },
        import_source: '人才庫總表_歷史數據',
        created_at: new Date()
      };

      activityOps.push(activityDoc);
    }

    console.log(`\n📈 預檢統計結果：`);
    console.log(`  - 成功匹配現有學生：${matchedCount} 筆`);
    console.log(`  - 新建退學/畢業歷史檔案：${createdLeftOrGradCount} 筆`);
    console.log(`  - 預計寫入活動紀錄：${activityOps.length} 筆`);

    if (IS_DRY_RUN) {
      console.log('\n✅ [Dry-Run] 測試完成，未實施資料庫改動。');
      process.exit(0);
    }

    // 正式寫入 DB
    if (studentBulkOps.length > 0) {
      await Student.bulkWrite(studentBulkOps);
    }
    if (activityOps.length > 0) {
      await db.collection('activityrecords').insertMany(activityOps);
    }

    console.log('\n🎉 歷史數據成功灌入 MongoDB！');
    process.exit(0);

  } catch (error) {
    console.error('❌ 匯入過程失敗:', error);
    process.exit(1);
  }
}

importHistory();
const XLSX = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const Student = require('../models/Student');

// 設定預設學年 (可按需要修改，或透過 command line 傳入)
const CURRENT_ACADEMIC_YEAR = process.env.ACADEMIC_YEAR || '2026-2027';
const IS_DRY_RUN = process.argv.includes('--dry-run');
const FILE_PATH = path.join(__dirname, '../data/students.xlsx');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/talent_pool';

// 性別轉換函數 (支援 "男/女", "M/F", "m/f")
function normalizeGender(rawGender) {
  if (!rawGender) return '';
  const str = String(rawGender).trim().toUpperCase();
  if (str === 'M' || str === '男') return 'M';
  if (str === 'F' || str === '女') return 'F';
  return str;
}

async function importStudents() {
  try {
    console.log('正在連線至 MongoDB...');
    await mongoose.connect(MONGO_URI);

    // 1. 讀取 Excel 活頁簿
    const workbook = XLSX.readFile(FILE_PATH);
    const sheetNames = workbook.SheetNames; // 讀取所有 Sheet (F1, F2...等)

    console.log(`📊 找到 ${sheetNames.length} 個工作表：${sheetNames.join(', ')}`);

    const bulkOps = [];
    const errors = [];
    let totalRowsProcessed = 0;

    // 2. 逐個工作表 (F1~F6) 處理
    sheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet);

      rows.forEach((row, index) => {
        totalRowsProcessed++;
        const rowNum = index + 2; // Excel 標頭為第 1 列

        const studentId = String(row['學生編號'] || '').trim();
        const nameCh = String(row['中文姓名'] || '').trim();
        const nameEn = String(row['英文姓名'] || '').trim();
        const className = String(row['班別'] || '').trim();
        const classNo = Number(row['班號']);
        const gender = normalizeGender(row['性別']);

        // 基本欄位校驗
        if (!studentId || !nameCh) {
          errors.push(`[工作表 ${sheetName}] 第 ${rowNum} 列：缺少「學生編號」或「中文姓名」`);
          return;
        }

        if (!className || isNaN(classNo)) {
          errors.push(`[工作表 ${sheetName}] 第 ${rowNum} 列 (${nameCh})：缺少或無效的「班別」/「班號」`);
          return;
        }

        // 構建 Mongoose BulkUpsert 操作
        bulkOps.push({
          updateOne: {
            filter: { _id: studentId },
            update: {
              $set: {
                name_ch: nameCh,
                name_en: nameEn,
                gender: gender
              },
              $addToSet: {
                academic_history: {
                  academic_year: CURRENT_ACADEMIC_YEAR,
                  class_name: className,
                  class_no: classNo
                }
              }
            },
            upsert: true
          }
        });
      });
    });

    console.log(`🔍 總共掃描到 ${totalRowsProcessed} 筆學生資料`);

    // 3. 預檢錯處置 (有任何格式錯誤即中斷，確保資料完整性)
    if (errors.length > 0) {
      console.error('\n❌ 預檢失敗，未寫入任何資料庫紀錄。請修正以下錯誤：');
      errors.forEach(err => console.error(`  - ${err}`));
      process.exit(1);
    }

    // 4. Dry-Run 模式判斷
    if (IS_DRY_RUN) {
      console.log(`\n✅ [Dry-Run] 所有工作表資料預檢成功！預計更新/寫入 ${bulkOps.length} 筆學生紀錄。`);
      process.exit(0);
    }

    // 5. 正式寫入 MongoDB
    const result = await Student.bulkWrite(bulkOps);
    console.log(`\n🎉 成功寫入 MongoDB！新增學生：${result.upsertedCount} 筆，更新紀錄：${result.modifiedCount} 筆。`);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 匯入過程發生錯誤:', error);
    process.exit(1);
  }
}

importStudents();
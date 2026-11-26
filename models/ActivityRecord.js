const mongoose = require('mongoose');

const ActivityRecordSchema = new mongoose.Schema(
  {
    // 關聯 Student 永久學號（相容大小寫，如 S2511009 或 s1314017）
    student_id: {
      type: String,
      ref: 'Student',
      required: [true, '必須關聯學生永久學號'],
      index: true
    },

    // 紀錄類別：'award'（比賽及獎項）或 'volunteer'（義工服務）
    record_type: {
      type: String,
      enum: ['award', 'volunteer'],
      default: 'award',
      index: true
    },

    // 學年與當時班別學號（對齊已匯入歷史數據與 Student.academic_history）
    academic_year: {
      type: String,
      required: true,
      default: '2026-2027',
      index: true
    },
    class_name: {
      type: String,
      required: [true, '請填寫班別'],
      uppercase: true,
      trim: true
    },
    class_no: {
      type: Number,
      required: [true, '請填寫學號']
    },
    student_name: {
      type: String,
      required: [true, '請填寫學生姓名'],
      trim: true
    },

    // --- 共同活動基本資料（對齊資料庫現有 snake_case 欄位） ---
    category: {
      type: String,
      enum: ['校內', '校外'],
      default: '校外' // 對應 Excel「校內/校外」
    },
    participation_type: {
      type: String,
      enum: ['個人', '隊際'],
      default: '個人' // 對應 Excel「個人/隊際」
    },
    event_date: {
      type: Date,
      default: Date.now // 對應 Excel「日期」
    },
    teacher_in_charge: {
      type: String,
      required: [true, '請填寫負責老師'],
      trim: true
    },
    group_name: {
      type: String,
      default: '',
      trim: true // 對應 Excel「活動團體」（如：乒乓球隊、世史科、Smartteen）
    },
    organizer: {
      type: String,
      default: '',
      trim: true // 主辦單位
    },
    event_name: {
      type: String,
      required: [true, '請填寫比賽項目或義工服務名稱'],
      trim: true
    },
    scale: {
      type: String,
      default: '全港性',
      trim: true // 國際性、全港性、地區性、校內
    },

    // --- 「比賽及獎項」專用欄位 (record_type === 'award') ---
    activity_type: {
      type: String,
      default: '其他',
      trim: true // 對應 Excel「比賽/活動類型」（運動、音樂、表演藝術、制服團隊、學術、其他）
    },
    award: {
      type: String,
      default: '沒有',
      trim: true // 第一名/冠軍/金獎、第二名/亞軍/銀獎、第三名/季軍/銅獎、其他、沒有
    },
    other_award_note: {
      type: String,
      default: '',
      trim: true // 當 award 為「其他」時註明（如：最佳男主角）
    },
    has_certificate: {
      type: Boolean,
      default: false
    },
    has_trophy_or_medal: {
      type: Boolean,
      default: false
    },
    prize_item: {
      type: String,
      default: '',
      trim: true
    },
    student_cash_prize: {
      type: Number,
      default: 0,
      min: 0
    },
    teacher_cash_prize: {
      type: Number,
      default: 0,
      min: 0
    },
    recommended_merit: {
      type: String,
      default: '',
      trim: true // 好名、優點、小功、大功、沒有
    },
    merit_count: {
      type: Number,
      default: 0,
      min: 0
    },

    // --- 「義工服務」專用欄位 (record_type === 'volunteer') ---
    service_type: {
      type: String,
      default: '',
      trim: true // 兒童或青少年服務、長者服務、身體傷殘或弱智人士服務、環境保護或生態教育、綜合服務及其他
    },
    volunteer_role: {
      type: String,
      default: '參加者',
      trim: true // 參加者、統籌者
    },
    service_hours: {
      type: Number,
      default: 0,
      min: 0
    },

    // --- 教師評分、積分與系統追蹤 ---
    teacher_evaluation_score: {
      type: Number,
      enum: [1, 2, 3],
      default: 2 // 1: 未如理想/欠佳, 2: 正常/投入活動, 3: 突出/積極/實際貢獻
    },
    total_score: {
      type: Number,
      default: 2
    },
    smart_tags: {
      type: mongoose.Schema.Types.Mixed,
      default: {} // 相容歷史匯入的 smart_tags 物件
    },
    import_source: {
      type: mongoose.Schema.Types.Mixed,
      default: 'web_form' // 相容歷史匯入字串「人才庫總表_歷史數據」
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher'
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher'
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

ActivityRecordSchema.index({ academic_year: 1, class_name: 1, class_no: 1 });
ActivityRecordSchema.index({ student_id: 1, event_date: -1 });

module.exports = mongoose.model('ActivityRecord', ActivityRecordSchema, 'activityrecords');
const mongoose = require('mongoose');

const talentSchema = new mongoose.Schema(
  {
    // 關聯現有 Student 模型的永久學號（如 s1314017）
    studentId: {
      type: String,
      ref: 'Student',
      required: [true, '必須關聯學生永久學號'],
      index: true
    },

    // 紀錄類別：'award'（比賽及獎項）或 'volunteer'（義工服務）
    recordType: {
      type: String,
      enum: ['award', 'volunteer'],
      default: 'award',
      required: true
    },

    // 發生該紀錄時的學年、班別、學號與姓名快照（對齊 academic_history）
    academicYear: {
      type: String,
      required: true,
      default: '2026-27',
      trim: true
    },
    className: {
      type: String,
      required: [true, '請填寫班別（例如：1A）'],
      uppercase: true,
      trim: true
    },
    classNo: {
      type: Number,
      required: [true, '請填寫學號'],
      min: 1,
      max: 60
    },
    studentName: {
      type: String,
      required: [true, '請填寫學生姓名'],
      trim: true
    },

    // --- 共同活動基本資料 ---
    scope: {
      type: String,
      enum: ['校內', '校外'],
      default: '校外'
    },
    participationType: {
      type: String,
      enum: ['個人', '隊際'],
      default: '個人'
    },
    date: {
      type: Date,
      required: [true, '請填寫活動或比賽日期']
    },
    teacherInCharge: {
      type: String,
      required: [true, '請填寫負責老師'],
      trim: true
    },
    activityGroup: {
      type: String,
      default: '',
      trim: true // 活動團體（如：世史科、體育科、合唱團、Smartteen、高中OLE）
    },
    organizer: {
      type: String,
      default: '',
      trim: true // 主辦單位
    },
    eventName: {
      type: String,
      required: [true, '請填寫比賽項目或義工服務名稱'],
      trim: true
    },
    scale: {
      type: String,
      enum: ['國際性', '全港性', '地區性', '校內', ''],
      default: '全港性'
    },

    // --- 「比賽及獎項」專用欄位 (recordType === 'award') ---
    category: {
      type: String,
      default: '其他',
      trim: true // 音樂、表演藝術、制服團隊、運動、學術、其他
    },
    award: {
      type: String,
      default: '沒有',
      trim: true // 第一名/冠軍/金獎、第二名/亞軍/銀獎、第三名/季軍/銅獎、其他、沒有
    },
    otherAwardNote: {
      type: String,
      default: '',
      trim: true // 當 award 為「其他」時註明（如：最佳男主角）
    },
    hasCertificate: {
      type: Boolean,
      default: false
    },
    hasTrophyOrMedal: {
      type: Boolean,
      default: false
    },
    prizeItem: {
      type: String,
      default: '',
      trim: true
    },
    studentCashPrize: {
      type: Number,
      default: 0,
      min: 0
    },
    teacherCashPrize: {
      type: Number,
      default: 0,
      min: 0
    },
    recommendedMerit: {
      type: String,
      enum: ['好名', '優點', '小功', '大功', '沒有', ''],
      default: ''
    },
    meritCount: {
      type: Number,
      default: 0,
      min: 0
    },

    // --- 「義工服務」專用欄位 (recordType === 'volunteer') ---
    serviceType: {
      type: String,
      default: '',
      trim: true // 兒童或青少年服務、長者服務、身體傷殘或弱智人士服務、環境保護或生態教育、綜合服務及其他
    },
    volunteerRole: {
      type: String,
      default: '參加者',
      trim: true // 參加者、統籌者
    },
    serviceHours: {
      type: Number,
      default: 0,
      min: 0
    },

    // --- 教師評分與系統追蹤 ---
    performanceScore: {
      type: Number,
      enum: [1, 2, 3],
      default: 2 // 1: 未如理想/欠佳, 2: 正常/投入活動, 3: 突出/積極/實際貢獻
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher'
    }
  },
  { timestamps: true }
);

talentSchema.index({ academicYear: 1, recordType: 1, className: 1, classNo: 1 });
talentSchema.index({ studentId: 1, date: -1 });

module.exports = mongoose.model('Talent', talentSchema);
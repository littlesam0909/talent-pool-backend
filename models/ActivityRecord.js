const mongoose = require('mongoose');

const ActivityRecordSchema = new mongoose.Schema({
  student_id: { type: String, ref: 'Student', required: true, index: true },
  academic_year: { type: String, required: true, index: true },
  record_date: { type: Date, default: Date.now },
  
  class_at_event: { type: String, required: true },
  class_no_at_event: { type: Number },

  activity: {
    name: { type: String, required: true },
    category: { 
      type: String, 
      required: true, 
      enum: ['STEM/學術', '體育', '藝術', '服務/領袖', '語文', '其他'] 
    },
    competition_type: { 
      type: String, 
      required: true, 
      enum: ['internal', 'external'] 
    },
    organizer: String,
    scope: { 
      type: String, 
      enum: ['國際性', '全港性', '地區性', '校內', 'N/A'],
      default: '地區性'
    }
  },

  award: {
    participation_type: { type: String, enum: ['個人', '隊際'], default: '個人' },
    rank: { 
      type: String, 
      required: true, 
      enum: ['第一名/冠軍/金獎', '第二名/亞軍/銀獎', '第三名/季軍/銅獎', '其他', '沒有'],
      default: '沒有'
    },
    rank_other: { type: String, default: null },
    has_certificate: { type: Boolean, default: false },
    has_trophy: { type: Boolean, default: false },
    has_prize: { type: Boolean, default: false }
  },

  scoring: {
    scope_score: { type: Number, default: 0 },
    award_score: { type: Number, default: 0 },
    performance_score: { type: Number, enum: [1, 2, 3], default: 2 },
    total_score: { type: Number, default: 0 },
    is_custom_scored: { type: Boolean, default: false },
    scored_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },

  student_traits: [{
    trait_category: String,
    trait_name: String,
    rating: { type: Number, min: 1, max: 5 },
    evidence: String
  }],

  teacher_in_charge: String,
  submitted_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  record_status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending',
    index: true 
  },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  review_remarks: String,

  import_source: {
    file_name: String,
    excel_row_index: Number,
    imported_at: { type: Date, default: Date.now }
  }
}, { timestamps: true });

module.exports = mongoose.model('ActivityRecord', ActivityRecordSchema);
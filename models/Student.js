const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // s+7位數字永久學號 (如 s1314017)
  name_ch: { type: String, required: true, index: true },
  name_en: { type: String },
  gender: { type: String, enum: ['M', 'F'] },
  house: { type: String },
  status: { type: String, enum: ['active', 'withdrawn', 'graduated'], default: 'active' },
  
  academic_history: [{
    academic_year: { type: String, required: true },
    grade_level: String,
    class_name: { type: String, required: true },
    class_no: { type: Number, required: true }
  }],

  talent_summary: {
    total_accumulated_score: { type: Number, default: 0 },
    last_updated: { type: Date, default: Date.now }
  }
}, { timestamps: true });

StudentSchema.index({ 
  'academic_history.academic_year': 1, 
  'academic_history.class_name': 1, 
  'academic_history.class_no': 1 
});

module.exports = mongoose.model('Student', StudentSchema);
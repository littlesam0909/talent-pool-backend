const mongoose = require('mongoose');

const SystemConfigSchema = new mongoose.Schema({
  config_key: { type: String, required: true, unique: true },
  scope_scores: { type: Map, of: Number },
  award_scores: { type: Map, of: Number },
  performance_scores: { type: Map, of: Number },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('SystemConfig', SystemConfigSchema);
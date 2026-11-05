const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  name: { type: String, required: true },
  title: { type: String, default: '教職員' },
  role: { type: String, enum: ['admin', 'teacher'], default: 'teacher' }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
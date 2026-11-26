const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const ActivityRecord = require('../models/ActivityRecord');
const Student = require('../models/Student');
const SystemConfig = require('../models/SystemConfig');
const { requireAuth, requireRole } = require('../middleware/auth');

// 所有得獎與義工紀錄 API 皆需先通過登入驗證
router.use(requireAuth);

// 學校標準下拉選單字典（對齊 Excel dropdown_list）
const SCHOOL_OPTIONS = {
  categories: ['校外', '校內'],
  participation_types: ['個人', '隊際'],
  scales: ['國際性', '全港性', '地區性', '校內'],
  activity_types: ['運動', '音樂', '表演藝術', '制服團隊', '學術', '其他'],
  awards: ['第一名/冠軍/金獎', '第二名/亞軍/銀獎', '第三名/季軍/銅獎', '其他', '沒有'],
  merits: ['好名', '優點', '小功', '大功', '沒有'],
  service_types: [
    '兒童或青少年服務',
    '長者服務',
    '身體傷殘或弱智人士服務',
    '環境保護或生態教育',
    '綜合服務及其他'
  ],
  group_names: [
    '合唱團', '古箏班', '長笛班', '小提琴班', '木結他班(初階)', '木結他班(進階)',
    '夏威夷小結他', '流行樂爵士鼓班', '電結他班', '低音電結他班', '中文戲劇學會',
    'English Drama Club', '香港基督少年軍', '香港紅十字會', '童軍', '弦樂小組',
    '流行樂隊', '流行聲樂班', '籃球隊 (男子)', '手球隊 (女子)', '足球隊 (男子)',
    '羽毛球隊', '田徑隊', '劍擊隊', '乒乓球隊', '中文學會 (中華文化興趣小組)',
    '數學學會 - 資優數學培訓 (中三至中五)', '基本法大使', '科學學會',
    '人文學科學會', '歷史學會', '科技與生活學會', '中文科', '英文科', '數學科',
    '公經社科', '中史科', '中國文學科', '公民教育科', '化學科', '世史科',
    '生物科', '地理科', '物理科', '科學科', '音樂科', '家政科', '商科',
    '設計與科技科', '普通話科', '視藝科', '經濟科', '電腦科', '歷史與文化科',
    '體育科', '校園電視台', '攝影學會', 'Smartteen', '高中OLE', '其他'
  ]
};

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 自動把 '2026-27' 正規化為資料庫使用的 '2026-2027'
const normalizeAcademicYear = (rawYear) => {
  const y = String(rawYear || '2026-2027').trim();
  return /^(\d{4})-(\d{2})$/.test(y) ? y.replace(/^(\d{4})-(\d{2})$/, '$1-20$2') : y;
};

// 從 Student.academic_history 查找學生（相容 student_id 大小寫）
const resolveStudentFromHistory = async ({ student_id, academic_year, class_name, class_no }) => {
  const year = normalizeAcademicYear(academic_year);

  if (student_id) {
    const stu = await Student.findOne({
      _id: new RegExp(`^${escapeRegex(student_id.trim())}$`, 'i')
    });
    if (!stu) return null;
    const hist = stu.academic_history.find((h) => h.academic_year === year)
      || stu.academic_history[stu.academic_history.length - 1];
    return {
      student_id: stu._id,
      student_name: stu.name_ch,
      academic_year: year,
      class_name: hist ? hist.class_name : String(class_name || '').toUpperCase().trim(),
      class_no: hist ? hist.class_no : Number(class_no)
    };
  }

  if (!class_name || class_no === undefined || class_no === null) {
    return null;
  }

  const normalizedClass = String(class_name).toUpperCase().trim();
  const normalizedNo = Number(class_no);

  const stu = await Student.findOne({
    academic_history: {
      $elemMatch: {
        academic_year: year,
        class_name: normalizedClass,
        class_no: normalizedNo
      }
    }
  });

  if (!stu) return null;

  return {
    student_id: stu._id,
    student_name: stu.name_ch,
    academic_year: year,
    class_name: normalizedClass,
    class_no: normalizedNo
  };
};

// 計算單筆紀錄分數（若 SystemConfig 有設權重則套用，否則直接採用教師表現分數 1-3 分）
const computeRecordScore = async ({ scale, award, teacher_evaluation_score }) => {
  const perf = Number(teacher_evaluation_score) || 2;
  const cfg = await SystemConfig.findOne({ config_key: 'default' }).lean();
  if (!cfg) return perf;

  const scopePts = cfg.scope_scores?.[scale] || 0;
  const awardPts = cfg.award_scores?.[award] || 0;
  const perfPts = cfg.performance_scores?.[String(perf)] ?? perf;
  return scopePts + awardPts + perfPts;
};

// 同步更新 Student.talent_summary（同時加總歷史匯入紀錄與新紀錄）
const syncStudentTalentSummary = async (studentId) => {
  if (!studentId) return;
  const idRegex = new RegExp(`^${escapeRegex(studentId)}$`, 'i');

  const result = await ActivityRecord.aggregate([
    { $match: { student_id: idRegex } },
    {
      $group: {
        _id: null,
        accumulated: {
          $sum: {
            $ifNull: ['$total_score', { $ifNull: ['$teacher_evaluation_score', 0] }]
          }
        }
      }
    }
  ]);

  const totalScore = result.length > 0 ? result[0].accumulated : 0;

  await Student.findOneAndUpdate(
    { _id: idRegex },
    {
      $set: {
        'talent_summary.total_accumulated_score': totalScore,
        'talent_summary.last_updated': new Date()
      }
    }
  );
};

// 1. 取得前端表單所需的標準下拉選項
router.get('/options', (req, res) => {
  res.json(SCHOOL_OPTIONS);
});

// 2. 查詢得獎與義工紀錄列表（支援依 student_id、學年、班別、活動團體、類型或關鍵字篩選）
router.get('/', async (req, res) => {
  try {
    const {
      student_id, record_type, academic_year, class_name,
      activity_type, group_name, teacher_in_charge, q
    } = req.query;

    const filter = {};
    if (student_id) filter.student_id = new RegExp(`^${escapeRegex(student_id.trim())}$`, 'i');
    if (record_type) filter.record_type = record_type;
    if (academic_year) filter.academic_year = normalizeAcademicYear(academic_year);
    if (class_name) filter.class_name = class_name.toUpperCase().trim();
    if (activity_type) filter.activity_type = activity_type.trim();
    if (group_name) filter.group_name = group_name.trim();
    if (teacher_in_charge) filter.teacher_in_charge = teacher_in_charge.trim();

    if (q && q.trim()) {
      const regex = new RegExp(escapeRegex(q.trim()), 'i');
      filter.$or = [
        { student_id: regex },
        { student_name: regex },
        { class_name: regex },
        { event_name: regex },
        { organizer: regex },
        { group_name: regex },
        { teacher_in_charge: regex },
        { other_award_note: regex }
      ];
    }

    const records = await ActivityRecord.find(filter)
      .sort({ academic_year: -1, event_date: -1, created_at: -1, class_name: 1, class_no: 1 });

    res.json({ count: records.length, records });
  } catch (error) {
    res.status(500).json({ message: '查詢紀錄失敗', error: error.message });
  }
});

// 3. 新增單筆紀錄（自動透過 academic_history 綁定 Student._id 並更新 talent_summary）
router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const { student_id, academic_year, class_name, class_no, event_name, teacher_in_charge } = payload;

    if (!event_name || !teacher_in_charge) {
      return res.status(400).json({ message: '請完整填寫比賽/活動名稱及負責老師' });
    }

    const resolved = await resolveStudentFromHistory({ student_id, academic_year, class_name, class_no });
    if (!resolved) {
      return res.status(404).json({
        message: `在 ${normalizeAcademicYear(academic_year)} 學年名冊中找不到該學生（${class_name || ''} ${class_no || ''}）`
      });
    }

    const totalScore = await computeRecordScore({
      scale: payload.scale,
      award: payload.award,
      teacher_evaluation_score: payload.teacher_evaluation_score
    });

    const newRecord = await ActivityRecord.create({
      ...payload,
      student_id: resolved.student_id,
      student_name: resolved.student_name,
      academic_year: resolved.academic_year,
      class_name: resolved.class_name,
      class_no: resolved.class_no,
      total_score: totalScore,
      import_source: 'web_form',
      created_by: req.session.teacherId,
      updated_by: req.session.teacherId
    });

    await syncStudentTalentSummary(resolved.student_id);

    res.status(201).json({
      message: '紀錄建立成功',
      record: newRecord
    });
  } catch (error) {
    res.status(500).json({ message: '建立紀錄失敗', error: error.message });
  }
});

// 4. 批次建立隊際比賽／集體義工紀錄
router.post('/batch', async (req, res) => {
  try {
    const { common_data, students } = req.body || {};

    if (!common_data || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ message: '請提供共同活動資料（common_data）與至少一位學生（students）' });
    }

    const { event_name, teacher_in_charge, academic_year } = common_data;
    if (!event_name || !teacher_in_charge) {
      return res.status(400).json({ message: '共同活動資料需包含活動名稱與負責老師' });
    }

    const docsToInsert = [];
    const affectedStudentIds = new Set();

    for (const stu of students) {
      const resolved = await resolveStudentFromHistory({
        student_id: stu.student_id,
        academic_year: stu.academic_year || academic_year,
        class_name: stu.class_name,
        class_no: stu.class_no
      });

      if (!resolved) {
        return res.status(404).json({
          message: `在學年名冊中找不到學生：${stu.student_id || `${stu.class_name} ${stu.class_no}`}`
        });
      }

      const evalScore = stu.teacher_evaluation_score || common_data.teacher_evaluation_score || 2;
      const totalScore = await computeRecordScore({
        scale: common_data.scale,
        award: common_data.award,
        teacher_evaluation_score: evalScore
      });

      affectedStudentIds.add(resolved.student_id);
      docsToInsert.push({
        ...common_data,
        participation_type: common_data.participation_type || '隊際',
        student_id: resolved.student_id,
        student_name: resolved.student_name,
        academic_year: resolved.academic_year,
        class_name: resolved.class_name,
        class_no: resolved.class_no,
        teacher_evaluation_score: evalScore,
        total_score: totalScore,
        import_source: 'web_form_batch',
        created_by: req.session.teacherId,
        updated_by: req.session.teacherId
      });
    }

    const createdRecords = await ActivityRecord.insertMany(docsToInsert);

    for (const sid of affectedStudentIds) {
      await syncStudentTalentSummary(sid);
    }

    res.status(201).json({
      message: `成功為 ${createdRecords.length} 位同學建立隊際紀錄`,
      count: createdRecords.length,
      records: createdRecords
    });
  } catch (error) {
    res.status(500).json({ message: '批次建立紀錄失敗', error: error.message });
  }
});

// 5. 修改單筆紀錄（一般老師與管理員皆可操作，並自動重算學生總分）
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: '無效的紀錄 ID 格式' });
    }

    const existing = await ActivityRecord.findById(id);
    if (!existing) {
      return res.status(404).json({ message: '找不到該筆紀錄' });
    }

    const updates = { ...(req.body || {}), updated_by: req.session.teacherId };
    delete updates._id;
    delete updates.student_id;
    delete updates.created_by;

    updates.total_score = await computeRecordScore({
      scale: updates.scale ?? existing.scale,
      award: updates.award ?? existing.award,
      teacher_evaluation_score: updates.teacher_evaluation_score ?? existing.teacher_evaluation_score
    });

    const updatedRecord = await ActivityRecord.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    await syncStudentTalentSummary(existing.student_id);

    res.json({
      message: '紀錄更新成功',
      record: updatedRecord
    });
  } catch (error) {
    res.status(500).json({ message: '更新紀錄失敗', error: error.message });
  }
});

// 6. 刪除紀錄（嚴格限定僅限管理員 admin 可執行，刪除後自動重算學生總分）
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: '無效的紀錄 ID 格式' });
    }

    const deletedRecord = await ActivityRecord.findByIdAndDelete(id);
    if (!deletedRecord) {
      return res.status(404).json({ message: '找不到該筆紀錄' });
    }

    await syncStudentTalentSummary(deletedRecord.student_id);

    res.json({
      message: `已刪除紀錄（${deletedRecord.class_name} ${deletedRecord.student_name} - ${deletedRecord.event_name}）`
    });
  } catch (error) {
    res.status(500).json({ message: '刪除紀錄失敗', error: error.message });
  }
});

module.exports = router;
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Talent = require('../models/Talent');
const Student = require('../models/Student');
const { requireAuth, requireRole } = require('../middleware/auth');

// 所有人才與得獎紀錄 API 皆需先通過登入驗證
router.use(requireAuth);

// 學校標準下拉選單字典（對齊 Excel dropdown_list）
const SCHOOL_OPTIONS = {
  scopes: ['校外', '校內'],
  participationTypes: ['個人', '隊際'],
  scales: ['國際性', '全港性', '地區性', '校內'],
  categories: ['音樂', '表演藝術', '制服團隊', '運動', '學術', '其他'],
  awards: ['第一名/冠軍/金獎', '第二名/亞軍/銀獎', '第三名/季軍/銅獎', '其他', '沒有'],
  merits: ['好名', '優點', '小功', '大功', '沒有'],
  serviceTypes: [
    '兒童或青少年服務',
    '長者服務',
    '身體傷殘或弱智人士服務',
    '環境保護或生態教育',
    '綜合服務及其他'
  ],
  activityGroups: [
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

// 輔助函式 1：透過永久學號（studentId）或「學年 + 班別 + 學號（classNo）」從 Student.academic_history 查找學生
const resolveStudentFromHistory = async ({ studentId, academicYear, className, classNo }) => {
  const year = (academicYear || '2026-2027').trim();

  if (studentId) {
    const stu = await Student.findById(studentId.trim());
    if (!stu) return null;
    const hist = stu.academic_history.find((h) => h.academic_year === year)
      || stu.academic_history[stu.academic_history.length - 1];
    return {
      studentId: stu._id,
      studentName: stu.name_ch,
      academicYear: year,
      className: hist ? hist.class_name : (className || '').toUpperCase().trim(),
      classNo: hist ? hist.class_no : Number(classNo)
    };
  }

  if (!className || classNo === undefined || classNo === null) {
    return null;
  }

  const normalizedClass = String(className).toUpperCase().trim();
  const normalizedNo = Number(classNo);

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
    studentId: stu._id,
    studentName: stu.name_ch,
    academicYear: year,
    className: normalizedClass,
    classNo: normalizedNo
  };
};

// 輔助函式 2：重新計算並同步更新 Student.talent_summary
const syncStudentTalentSummary = async (studentId) => {
  if (!studentId) return;
  const result = await Talent.aggregate([
    { $match: { studentId } },
    { $group: { _id: '$studentId', totalScore: { $sum: '$performanceScore' } } }
  ]);
  const totalScore = result.length > 0 ? result[0].totalScore : 0;

  await Student.findByIdAndUpdate(studentId, {
    $set: {
      'talent_summary.total_accumulated_score': totalScore,
      'talent_summary.last_updated': new Date()
    }
  });
};

// 1. 取得前端表單所需的標準下拉選項
router.get('/options', (req, res) => {
  res.json(SCHOOL_OPTIONS);
});

// 2. 查詢得獎與義工紀錄列表（支援依 studentId、學年、班別、活動團體或關鍵字篩選）
router.get('/', async (req, res) => {
  try {
    const { studentId, recordType, academicYear, className, activityGroup, teacherInCharge, q } = req.query;
    const filter = {};

    if (studentId) filter.studentId = studentId.trim();
    if (recordType) filter.recordType = recordType;
    if (academicYear) filter.academicYear = academicYear.trim();
    if (className) filter.className = className.toUpperCase().trim();
    if (activityGroup) filter.activityGroup = activityGroup.trim();
    if (teacherInCharge) filter.teacherInCharge = teacherInCharge.trim();

    if (q && q.trim()) {
      const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { studentId: regex },
        { studentName: regex },
        { className: regex },
        { eventName: regex },
        { organizer: regex },
        { activityGroup: regex },
        { teacherInCharge: regex },
        { otherAwardNote: regex }
      ];
    }

    const records = await Talent.find(filter)
      .populate('createdBy', 'name email')
      .sort({ date: -1, className: 1, classNo: 1 });

    res.json({ count: records.length, records });
  } catch (error) {
    res.status(500).json({ message: '查詢紀錄失敗', error: error.message });
  }
});

// 3. 新增單筆紀錄（自動透過 academic_history 綁定 Student._id 並更新 talent_summary）
router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const { studentId, academicYear, className, classNo, date, eventName, teacherInCharge } = payload;

    if (!date || !eventName || !teacherInCharge) {
      return res.status(400).json({ message: '請完整填寫日期、比賽/活動名稱及負責老師' });
    }

    const resolved = await resolveStudentFromHistory({ studentId, academicYear, className, classNo });
    if (!resolved) {
      return res.status(404).json({
        message: `在 ${academicYear || '2026-2027'} 學年名冊中找不到該學生（${className || ''} ${classNo || ''}），請確認學生資料已匯入`
      });
    }

    const newRecord = await Talent.create({
      ...payload,
      studentId: resolved.studentId,
      studentName: resolved.studentName,
      academicYear: resolved.academicYear,
      className: resolved.className,
      classNo: resolved.classNo,
      createdBy: req.session.teacherId,
      updatedBy: req.session.teacherId
    });

    await syncStudentTalentSummary(resolved.studentId);

    res.status(201).json({
      message: '紀錄建立成功',
      record: newRecord
    });
  } catch (error) {
    res.status(500).json({ message: '建立紀錄失敗', error: error.message });
  }
});

// 4. 批次建立隊際比賽／集體義工紀錄（一次填寫活動資料，為多位隊員建檔並同步更新各自積分）
router.post('/batch', async (req, res) => {
  try {
    const { commonData, students } = req.body || {};

    if (!commonData || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ message: '請提供共同活動資料（commonData）與至少一位學生（students）' });
    }

    const { date, eventName, teacherInCharge, academicYear } = commonData;
    if (!date || !eventName || !teacherInCharge) {
      return res.status(400).json({ message: '共同活動資料需包含日期、活動名稱與負責老師' });
    }

    const docsToInsert = [];
    const affectedStudentIds = new Set();

    for (const stu of students) {
      const resolved = await resolveStudentFromHistory({
        studentId: stu.studentId,
        academicYear: stu.academicYear || academicYear,
        className: stu.className,
        classNo: stu.classNo
      });

      if (!resolved) {
        return res.status(404).json({
          message: `在學年名冊中找不到學生：${stu.studentId || `${stu.className} ${stu.classNo}`}`
        });
      }

      affectedStudentIds.add(resolved.studentId);
      docsToInsert.push({
        ...commonData,
        participationType: commonData.participationType || '隊際',
        studentId: resolved.studentId,
        studentName: resolved.studentName,
        academicYear: resolved.academicYear,
        className: resolved.className,
        classNo: resolved.classNo,
        performanceScore: stu.performanceScore || commonData.performanceScore || 2,
        createdBy: req.session.teacherId,
        updatedBy: req.session.teacherId
      });
    }

    const createdRecords = await Talent.insertMany(docsToInsert);

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

    const existing = await Talent.findById(id);
    if (!existing) {
      return res.status(404).json({ message: '找不到該筆紀錄' });
    }

    const updates = { ...(req.body || {}), updatedBy: req.session.teacherId };
    delete updates._id;
    delete updates.studentId; // 防止隨意竄改關聯的永久學號
    delete updates.createdBy;

    const updatedRecord = await Talent.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    await syncStudentTalentSummary(existing.studentId);

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

    const deletedRecord = await Talent.findByIdAndDelete(id);
    if (!deletedRecord) {
      return res.status(404).json({ message: '找不到該筆紀錄' });
    }

    await syncStudentTalentSummary(deletedRecord.studentId);

    res.json({
      message: `已刪除紀錄（${deletedRecord.className} ${deletedRecord.studentName} - ${deletedRecord.eventName}）`
    });
  } catch (error) {
    res.status(500).json({ message: '刪除紀錄失敗', error: error.message });
  }
});

module.exports = router;
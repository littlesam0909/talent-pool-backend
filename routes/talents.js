const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const ExcelJS = require('exceljs');
const router = express.Router();

const ActivityRecord = require('../models/ActivityRecord');
const Student = require('../models/Student');
const SystemConfig = require('../models/SystemConfig');
const { requireAuth, requireRole } = require('../middleware/auth');

// 設定記憶體暫存上傳（限制 5MB，僅允許 .xlsx 檔案）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.originalname.toLowerCase().endsWith('.xlsx') ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      cb(null, true);
    } else {
      cb(new Error('僅支援上傳 .xlsx 格式的 Excel 檔案'));
    }
  }
});

// 所有端點皆需先通過登入驗證
router.use(requireAuth);

// 學校標準下拉選單字典
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

const TEMPLATE_SAMPLE_NAMES = new Set(['陳大文', '陳小文', '張小文', '王小文', '黃小文']);

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeAcademicYear = (rawYear) => {
  const y = String(rawYear || '2026-2027').trim();
  return /^(\d{4})-(\d{2})$/.test(y) ? y.replace(/^(\d{4})-(\d{2})$/, '$1-20$2') : y;
};

// Excel 儲存格取值輔助函式（自動解開 HLOOKUP 等公式儲存格與富文本）
const getCellValue = (cell) => {
  if (!cell || cell.value === null || cell.value === undefined) return null;
  const val = cell.value;
  if (typeof val === 'object') {
    if (val instanceof Date) return val;
    if (val.result !== undefined) return val.result;
    if (val.richText) return val.richText.map((t) => t.text).join('');
    if (val.text) return val.text;
  }
  return val;
};

const getCleanString = (cell) => {
  const val = getCellValue(cell);
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  return str === '#N/A' ? '' : str;
};

// 解析日期（優先支援香港 DD/MM/YYYY 格式、Excel Date 物件與序列值）
const parseExcelDate = (raw) => {
  if (!raw) return new Date();
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number') {
    return new Date(Math.round((raw - 25569) * 86400 * 1000));
  }
  const str = String(raw).trim();
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

const parseExcelBool = (raw) => {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (!raw) return false;
  return ['true', 'yes', 'y', '1', '是', '有', '✓', '✔'].includes(String(raw).trim().toLowerCase());
};

const parseScore = (raw) => {
  const n = Number(raw);
  return [1, 2, 3].includes(n) ? n : 2;
};

// 從 Student.academic_history 查找學生
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

  if (!class_name || class_no === undefined || class_no === null || class_no === '') {
    return null;
  }

  const normalizedClass = String(class_name).toUpperCase().trim();
  const normalizedNo = Number(class_no);
  if (isNaN(normalizedNo)) return null;

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

// 計算單筆紀錄分數
const computeRecordScore = async ({ scale, award, teacher_evaluation_score }, cachedConfig = undefined) => {
  const perf = Number(teacher_evaluation_score) || 2;
  const cfg = cachedConfig !== undefined
    ? cachedConfig
    : await SystemConfig.findOne({ config_key: 'default' }).lean();

  if (!cfg) return perf;

  const scopePts = cfg.scope_scores?.[scale] || 0;
  const awardPts = cfg.award_scores?.[award] || 0;
  const perfPts = cfg.performance_scores?.[String(perf)] ?? perf;
  return scopePts + awardPts + perfPts;
};

// 同步更新 Student.talent_summary
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

// 共用查詢條件建構器（供列表查詢與 Excel 匯出共用）
const buildQueryFilter = (query) => {
  const {
    student_id, record_type, academic_year, class_name,
    activity_type, group_name, teacher_in_charge, q
  } = query;

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
  return filter;
};

// =========================================================================
// 1. 取得前端標準下拉選項
// =========================================================================
router.get('/options', (req, res) => {
  res.json(SCHOOL_OPTIONS);
});

// =========================================================================
// 2. 匯出學校標準雙工作表 Excel 報表（獎項 + 義工服務）
// =========================================================================
router.get('/export', async (req, res) => {
  try {
    const filter = buildQueryFilter(req.query);
    const records = await ActivityRecord.find(filter)
      .sort({ academic_year: -1, event_date: 1, class_name: 1, class_no: 1 })
      .lean();

    const awardRecords = records.filter((r) => r.record_type !== 'volunteer');
    const volunteerRecords = records.filter((r) => r.record_type === 'volunteer');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NLSIPESS Talent Pool System';
    workbook.created = new Date();

    const yearLabel = req.query.academic_year ? normalizeAcademicYear(req.query.academic_year) : '全部學年';

    // --- 工作表 1：獎項 ---
    const wsAward = workbook.addWorksheet('獎項');
    wsAward.addRow([`校內外比賽參與及得獎資料（${yearLabel}）`]);
    wsAward.getRow(1).font = { bold: true, size: 14 };

    const awardHeaders = [
      '校內/校外', '個人/隊際', '日期', '班別', '學號', '得獎同學', '負責老師',
      '活動團體\n(學生的所屬團體)', '主辦單位', '比賽項目/ 活動名稱', '比賽/活動類型',
      '比賽/活動規模', '獎項', '其他獎項，請註明', '學生表現分數(1-3分) [由老師評分]',
      '證書', '獎盃/獎牌', '獎品', '獎金\n(學生)', '獎金\n(老師)', '建議獎勵', '獎勵數目'
    ];
    const awardHeaderRow = wsAward.addRow(awardHeaders);
    awardHeaderRow.height = 32;
    awardHeaderRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    awardRecords.forEach((rec) => {
      const dateStr = rec.event_date ? new Date(rec.event_date).toISOString().slice(0, 10) : '';
      wsAward.addRow([
        rec.category || '校外',
        rec.participation_type || '個人',
        dateStr,
        rec.class_name || '',
        rec.class_no || '',
        rec.student_name || '',
        rec.teacher_in_charge || '',
        rec.group_name || '',
        rec.organizer || '',
        rec.event_name || '',
        rec.activity_type || '',
        rec.scale || '',
        rec.award || '沒有',
        rec.other_award_note || '',
        rec.teacher_evaluation_score || 2,
        Boolean(rec.has_certificate),
        Boolean(rec.has_trophy_or_medal),
        rec.prize_item || '',
        Number(rec.student_cash_prize) || 0,
        Number(rec.teacher_cash_prize) || 0,
        rec.recommended_merit || '',
        Number(rec.merit_count) || 0
      ]);
    });

    wsAward.columns = [
      { width: 11 }, { width: 11 }, { width: 13 }, { width: 8 }, { width: 8 },
      { width: 12 }, { width: 12 }, { width: 20 }, { width: 22 }, { width: 32 },
      { width: 14 }, { width: 13 }, { width: 18 }, { width: 18 }, { width: 16 },
      { width: 8 }, { width: 10 }, { width: 14 }, { width: 10 }, { width: 10 },
      { width: 11 }, { width: 10 }
    ];

    // --- 工作表 2：義工服務 ---
    const wsVol = workbook.addWorksheet('義工服務');
    wsVol.addRow([`學生義工服務參與紀錄（${yearLabel}）`]);
    wsVol.getRow(1).font = { bold: true, size: 14 };

    const volHeaders = [
      '日期', '班別', '學號', '得獎同學', '負責老師', '活動團體\n(學生的所屬團體)',
      '主辦單位', '義工服務項目/名稱', '服務類型', '服務規模', '學生參加角色',
      '時數(小時)', '學生表現分數(1-3分)\n[由老師評分]'
    ];
    const volHeaderRow = wsVol.addRow(volHeaders);
    volHeaderRow.height = 32;
    volHeaderRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    volunteerRecords.forEach((rec) => {
      const dateStr = rec.event_date ? new Date(rec.event_date).toISOString().slice(0, 10) : '';
      wsVol.addRow([
        dateStr,
        rec.class_name || '',
        rec.class_no || '',
        rec.student_name || '',
        rec.teacher_in_charge || '',
        rec.group_name || '',
        rec.organizer || '',
        rec.event_name || '',
        rec.service_type || '',
        rec.scale || '',
        rec.volunteer_role || '參加者',
        Number(rec.service_hours) || 0,
        rec.teacher_evaluation_score || 2
      ]);
    });

    wsVol.columns = [
      { width: 13 }, { width: 8 }, { width: 8 }, { width: 12 }, { width: 12 },
      { width: 20 }, { width: 22 }, { width: 32 }, { width: 22 }, { width: 13 },
      { width: 14 }, { width: 12 }, { width: 16 }
    ];

    const filename = encodeURIComponent(`校內外比賽及義工紀錄_${yearLabel}.xlsx`);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: '匯出 Excel 失敗', error: error.message });
  }
});

// =========================================================================
// 3. 匯入學校標準 Excel 檔案（支援「獎項」與「義工服務」雙工作表及 dry_run 預檢）
// =========================================================================
router.post('/import', (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ message: uploadErr.message || '檔案上傳失敗' });
    }
    if (!req.file) {
      return res.status(400).json({ message: '請選擇要上傳的 .xlsx 檔案（欄位名稱：file）' });
    }

    try {
      const targetYear = normalizeAcademicYear(req.body?.academic_year || req.query?.academic_year);
      const isDryRun = String(req.body?.dry_run || req.query?.dry_run).toLowerCase() === 'true';

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);

      const sysCfg = await SystemConfig.findOne({ config_key: 'default' }).lean();
      const docsToInsert = [];
      const errors = [];
      let skippedSampleRows = 0;

      // --- 解析「獎項」工作表 ---
      const wsAward = workbook.getWorksheet('獎項');
      if (wsAward) {
        for (let r = 3; r <= wsAward.rowCount; r++) {
          const row = wsAward.getRow(r);
          const className = getCleanString(row.getCell(4)).toUpperCase();
          const classNoRaw = getCellValue(row.getCell(5));
          const rawStudentName = getCleanString(row.getCell(6));
          const eventName = getCleanString(row.getCell(10));
          const noteCol = getCleanString(row.getCell(24));

          // 略過空白列
          if (!className && (classNoRaw === null || classNoRaw === '') && !eventName) {
            continue;
          }

          const parsedDate = parseExcelDate(getCellValue(row.getCell(3)));

          // 自動略過學校範本內建的 2022 範例紀錄
          if (
            noteCol.includes('例子記錄') ||
            (TEMPLATE_SAMPLE_NAMES.has(rawStudentName) && parsedDate.getFullYear() === 2022)
          ) {
            skippedSampleRows++;
            continue;
          }

          if (!className || classNoRaw === null || classNoRaw === '' || !eventName) {
            errors.push({
              sheet: '獎項',
              row: r,
              reason: '缺少必填欄位（班別、學號或比賽/活動名稱）'
            });
            continue;
          }

          const resolved = await resolveStudentFromHistory({
            academic_year: targetYear,
            class_name: className,
            class_no: classNoRaw
          });

          if (!resolved) {
            errors.push({
              sheet: '獎項',
              row: r,
              reason: `在 ${targetYear} 學年名冊中找不到 ${className} 班 ${classNoRaw} 號學生`
            });
            continue;
          }

          const scale = getCleanString(row.getCell(12)) || '全港性';
          const award = getCleanString(row.getCell(13)) || '沒有';
          const evalScore = parseScore(getCellValue(row.getCell(15)));
          const totalScore = await computeRecordScore(
            { scale, award, teacher_evaluation_score: evalScore },
            sysCfg
          );

          docsToInsert.push({
            student_id: resolved.student_id,
            student_name: resolved.student_name,
            academic_year: resolved.academic_year,
            class_name: resolved.class_name,
            class_no: resolved.class_no,
            record_type: 'award',
            category: getCleanString(row.getCell(1)) || '校外',
            participation_type: getCleanString(row.getCell(2)) || '個人',
            event_date: parsedDate,
            teacher_in_charge: getCleanString(row.getCell(7)) || '未註明',
            group_name: getCleanString(row.getCell(8)),
            organizer: getCleanString(row.getCell(9)),
            event_name: eventName,
            activity_type: getCleanString(row.getCell(11)) || '其他',
            scale,
            award,
            other_award_note: getCleanString(row.getCell(14)),
            teacher_evaluation_score: evalScore,
            total_score: totalScore,
            has_certificate: parseExcelBool(getCellValue(row.getCell(16))),
            has_trophy_or_medal: parseExcelBool(getCellValue(row.getCell(17))),
            prize_item: getCleanString(row.getCell(18)),
            student_cash_prize: Number(getCellValue(row.getCell(19))) || 0,
            teacher_cash_prize: Number(getCellValue(row.getCell(20))) || 0,
            recommended_merit: getCleanString(row.getCell(21)),
            merit_count: Number(getCellValue(row.getCell(22))) || 0,
            import_source: `excel_import:${req.file.originalname}`,
            created_by: req.session.teacherId,
            updated_by: req.session.teacherId
          });
        }
      }

      // --- 解析「義工服務」工作表 ---
      const wsVol = workbook.getWorksheet('義工服務');
      if (wsVol) {
        for (let r = 3; r <= wsVol.rowCount; r++) {
          const row = wsVol.getRow(r);
          const className = getCleanString(row.getCell(2)).toUpperCase();
          const classNoRaw = getCellValue(row.getCell(3));
          const rawStudentName = getCleanString(row.getCell(4));
          const eventName = getCleanString(row.getCell(8)) || getCleanString(row.getCell(9));

          if (!className && (classNoRaw === null || classNoRaw === '') && !eventName) {
            continue;
          }

          const parsedDate = parseExcelDate(getCellValue(row.getCell(1)));

          if (TEMPLATE_SAMPLE_NAMES.has(rawStudentName) && parsedDate.getFullYear() === 2022) {
            skippedSampleRows++;
            continue;
          }

          if (!className || classNoRaw === null || classNoRaw === '' || !eventName) {
            errors.push({
              sheet: '義工服務',
              row: r,
              reason: '缺少必填欄位（班別、學號或義工服務名稱/類型）'
            });
            continue;
          }

          const resolved = await resolveStudentFromHistory({
            academic_year: targetYear,
            class_name: className,
            class_no: classNoRaw
          });

          if (!resolved) {
            errors.push({
              sheet: '義工服務',
              row: r,
              reason: `在 ${targetYear} 學年名冊中找不到 ${className} 班 ${classNoRaw} 號學生`
            });
            continue;
          }

          const scale = getCleanString(row.getCell(10)) || '地區性';
          const evalScore = parseScore(getCellValue(row.getCell(13)));
          const totalScore = await computeRecordScore(
            { scale, award: '沒有', teacher_evaluation_score: evalScore },
            sysCfg
          );

          docsToInsert.push({
            student_id: resolved.student_id,
            student_name: resolved.student_name,
            academic_year: resolved.academic_year,
            class_name: resolved.class_name,
            class_no: resolved.class_no,
            record_type: 'volunteer',
            category: '校外',
            participation_type: '個人',
            event_date: parsedDate,
            teacher_in_charge: getCleanString(row.getCell(5)) || '未註明',
            group_name: getCleanString(row.getCell(6)),
            organizer: getCleanString(row.getCell(7)),
            event_name: eventName,
            activity_type: '服務/領袖',
            service_type: getCleanString(row.getCell(9)),
            scale,
            volunteer_role: getCleanString(row.getCell(11)) || '參加者',
            service_hours: Number(getCellValue(row.getCell(12))) || 0,
            teacher_evaluation_score: evalScore,
            total_score: totalScore,
            import_source: `excel_import:${req.file.originalname}`,
            created_by: req.session.teacherId,
            updated_by: req.session.teacherId
          });
        }
      }

      if (!wsAward && !wsVol) {
        return res.status(400).json({
          message: 'Excel 檔案中找不到「獎項」或「義工服務」工作表，請使用學校標準範本'
        });
      }

      // 若為預檢模式（dry_run=true），直接回傳解析結果而不寫入資料庫
      if (isDryRun) {
        return res.json({
          dry_run: true,
          academic_year: targetYear,
          valid_count: docsToInsert.length,
          skipped_sample_rows: skippedSampleRows,
          error_count: errors.length,
          errors,
          preview: docsToInsert.slice(0, 10)
        });
      }

      if (docsToInsert.length === 0) {
        return res.status(400).json({
          message: '沒有可匯入的有效紀錄（請確認是否只包含範本範例列或存在格式錯誤）',
          skipped_sample_rows: skippedSampleRows,
          errors
        });
      }

      const inserted = await ActivityRecord.insertMany(docsToInsert);

      // 同步重算所有受影響學生的 talent_summary
      const affectedStudentIds = [...new Set(inserted.map((d) => d.student_id))];
      for (const sid of affectedStudentIds) {
        await syncStudentTalentSummary(sid);
      }

      res.status(201).json({
        message: `成功匯入 ${inserted.length} 筆紀錄`,
        academic_year: targetYear,
        imported_count: inserted.length,
        affected_students: affectedStudentIds.length,
        skipped_sample_rows: skippedSampleRows,
        error_count: errors.length,
        errors
      });
    } catch (error) {
      res.status(500).json({ message: '解析或匯入 Excel 失敗', error: error.message });
    }
  });
});

// =========================================================================
// 4. 查詢得獎與義工紀錄列表
// =========================================================================
router.get('/', async (req, res) => {
  try {
    const filter = buildQueryFilter(req.query);
    const records = await ActivityRecord.find(filter)
      .sort({ academic_year: -1, event_date: -1, created_at: -1, class_name: 1, class_no: 1 });

    res.json({ count: records.length, records });
  } catch (error) {
    res.status(500).json({ message: '查詢紀錄失敗', error: error.message });
  }
});

// =========================================================================
// 5. 新增單筆紀錄
// =========================================================================
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

// =========================================================================
// 6. 批次建立隊際比賽／集體義工紀錄
// =========================================================================
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

// =========================================================================
// 7. 修改單筆紀錄
// =========================================================================
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

// =========================================================================
// 8. 刪除紀錄（嚴格限定僅限管理員 admin 可執行）
// =========================================================================
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
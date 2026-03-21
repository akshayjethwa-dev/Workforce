// src/services/wageService.ts
import { Worker, AttendanceRecord, DailyWageRecord, MonthlyPayroll, Advance, OrgSettings } from '../types/index';
import { attendanceLogic } from './attendanceLogic';

export const wageService = {

  calculateCurrentEarnings: (
    worker: Worker,
    monthStr: string,
    attendanceRecords: AttendanceRecord[],
    orgSettings: OrgSettings
  ) => {
    const monthAttendance = attendanceRecords.filter(
      a => a.workerId === worker.id && a.date.startsWith(monthStr)
    );
    let totalEarned = 0;
    monthAttendance.forEach(record => {
      const dw = wageService.calculateDailyWage(worker, record, orgSettings);
      totalEarned += dw.breakdown.total;
    });
    return totalEarned;
  },

  calculateDailyWage: (
    worker: Worker,
    record: AttendanceRecord,
    orgSettings: OrgSettings
  ): DailyWageRecord => {
    const netHours = record.hours?.net ?? record.calculatedHours?.netWorkingHours ?? 0;
    const otHours = record.hours?.overtime ?? record.calculatedHours?.overtimeHours ?? 0;

    const config = worker.wageConfig;

    let dailyRate = config.amount;
    if (config.type === 'MONTHLY') {
      const [yearStr, monthStr] = record.date.split('-');
      const daysInMonth = new Date(parseInt(yearStr), parseInt(monthStr), 0).getDate();
      dailyRate = config.amount / (config.workingDaysPerMonth || daysInMonth);
    }

    let baseWage = 0;
    if (
      record.status === 'PRESENT' ||
      record.status === 'WEEKLY_OFF' ||
      record.status === 'PUBLIC_HOLIDAY'
    ) {
      baseWage = dailyRate;
    } else if (record.status === 'HALF_DAY') {
      baseWage = dailyRate * 0.5;
    } else if (record.status === 'HOLIDAY_WORKED') {
      const multiplier = orgSettings?.holidayPayMultiplier ?? 2.0;
      baseWage = dailyRate * multiplier;
    } else if (record.status === 'ON_LEAVE') {
      baseWage = record.leaveInfo?.isPaid ? dailyRate : 0;
    } else if (record.status === 'ABSENT' || record.status === 'UNPAID_HOLIDAY') {
      baseWage = 0;
    }

    let overtimeWage = 0;
    if (config.overtimeEligible && otHours > 0) {
      const otRatePerHour = config.overtimeRatePerHour ?? (dailyRate / 8) * 2;
      overtimeWage = otHours * otRatePerHour;
    }

    let totalAllowances = 0;
    if (['PRESENT', 'HALF_DAY', 'HOLIDAY_WORKED'].includes(record.status)) {
      totalAllowances += config.allowances?.travel ?? 0;
      totalAllowances += config.allowances?.food ?? 0;

      if (record.timeline && record.timeline.length > 0) {
        const lastPunch = record.timeline[record.timeline.length - 1];
        if (lastPunch.type === 'OUT') {
          const outHour = new Date(lastPunch.timestamp).getHours();
          if (outHour >= 22 || outHour < 5) {
            totalAllowances += config.allowances?.nightShift ?? 0;
          }
        }
      }
    }

    const totalEarning = baseWage + overtimeWage + totalAllowances;

    // FIX 1: worker.id and record.id are string in types, but guard with fallback
    // in case Firestore returns them undefined at runtime (common with .data() spread)
    const safeWorkerId = worker.id ?? '';
    const safeRecordId = record.id ?? '';

    return {
      id: `wage_${safeRecordId}`,
      tenantId: worker.tenantId,
      workerId: safeWorkerId,
      date: record.date,
      attendanceId: safeRecordId,
      breakdown: {
        baseWage: parseFloat(baseWage.toFixed(2)),
        overtimeWage: parseFloat(overtimeWage.toFixed(2)),
        allowances: parseFloat(totalAllowances.toFixed(2)),
        total: parseFloat(totalEarning.toFixed(2))
      },
      meta: {
        rateUsed: parseFloat(dailyRate.toFixed(2)),
        hoursWorked: netHours,
        overtimeHours: otHours,
        isOvertimeLimitExceeded: otHours > 4
      }
    };
  },

  generateMonthlyPayroll: (
    worker: Worker,
    month: string,
    attendanceRecords: AttendanceRecord[],
    advances: Advance[],
    orgSettings: OrgSettings
  ): MonthlyPayroll => {
    const [yearStr, monthStr] = month.split('-');
    const daysInMonth = new Date(parseInt(yearStr), parseInt(monthStr), 0).getDate();
    const totalWorkingDays = worker.wageConfig.workingDaysPerMonth || daysInMonth;

    const dailyStatuses = new Map<number, string>();
    const dailyRecords = new Map<number, AttendanceRecord>();

    // Pass 1: Plot calendar
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${yearStr}-${monthStr}-${day.toString().padStart(2, '0')}`;
      const record = attendanceRecords.find(
        a => a.date === dateStr && a.workerId === worker.id
      );
      const isPubHol = orgSettings.holidays?.find(h => h.date === dateStr);
      const isWeekOff = attendanceLogic.isWeeklyOff(dateStr, worker, orgSettings);

      let status = 'ABSENT';
      if (record && record.timeline && record.timeline.length > 0) {
        status = isPubHol || isWeekOff ? 'HOLIDAY_WORKED' : record.status;
        dailyRecords.set(day, { ...record, status: status as AttendanceRecord['status'] });
      } else {
        if (record && record.status === 'ON_LEAVE') {
          status = 'ON_LEAVE';
          dailyRecords.set(day, record);
        } else if (isPubHol) {
          status = isPubHol.isPaid ? 'PUBLIC_HOLIDAY' : 'UNPAID_HOLIDAY';
        } else if (isWeekOff) {
          status = 'WEEKLY_OFF';
        }
      }
      dailyStatuses.set(day, status);
    }

    // Pass 2: Sandwich Rule
    if (orgSettings.enableSandwichRule) {
      for (let day = 1; day <= daysInMonth; day++) {
        const status = dailyStatuses.get(day);
        if (status === 'WEEKLY_OFF' || status === 'PUBLIC_HOLIDAY') {
          const prevDay = day > 1 ? dailyStatuses.get(day - 1) ?? null : null;
          const nextDay = day < daysInMonth ? dailyStatuses.get(day + 1) ?? null : null;

          const isUnpaidAbsence = (
            dStatus: string | null,
            dRecord: AttendanceRecord | undefined
          ) => {
            if (dStatus === 'ABSENT' || dStatus === 'UNPAID_HOLIDAY') return true;
            if (dStatus === 'ON_LEAVE' && dRecord?.leaveInfo?.isPaid === false) return true;
            return false;
          };

          const prevAbsent = isUnpaidAbsence(prevDay, dailyRecords.get(day - 1));
          const nextAbsent = isUnpaidAbsence(nextDay, dailyRecords.get(day + 1));

          if (prevAbsent && nextAbsent) {
            dailyStatuses.set(day, 'UNPAID_HOLIDAY');
          }
        }
      }
    }

    // Pass 3: Calculate Finances
    let presentDays = 0, halfDays = 0, absentDays = 0;
    let weeklyOffs = 0, publicHolidays = 0, holidayWorkedDays = 0;
    let paidLeaves = 0, unpaidLeaves = 0;
    let totalBasic = 0, totalOTPay = 0, totalAllowances = 0;
    let totalRegularHours = 0, totalOvertimeHours = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const status = dailyStatuses.get(day) ?? 'ABSENT';
      const dailyRate =
        worker.wageConfig.type === 'MONTHLY'
          ? worker.wageConfig.amount / totalWorkingDays
          : worker.wageConfig.amount;

      let dwBaseWage = 0, dwOTWage = 0, dwAllowances = 0;

      if (status === 'PRESENT') {
        presentDays++;
        dwBaseWage = dailyRate;
      } else if (status === 'HALF_DAY') {
        halfDays++;
        dwBaseWage = dailyRate * 0.5;
      } else if (status === 'ABSENT' || status === 'UNPAID_HOLIDAY') {
        absentDays++;
      } else if (status === 'WEEKLY_OFF') {
        weeklyOffs++;
        dwBaseWage = dailyRate;
      } else if (status === 'PUBLIC_HOLIDAY') {
        publicHolidays++;
        dwBaseWage = dailyRate;
      } else if (status === 'HOLIDAY_WORKED') {
        holidayWorkedDays++;
        dwBaseWage = dailyRate * (orgSettings.holidayPayMultiplier ?? 2.0);
      } else if (status === 'ON_LEAVE') {
        const lRec = dailyRecords.get(day);
        if (lRec?.leaveInfo?.isPaid) {
          paidLeaves++;
          dwBaseWage = dailyRate;
        } else {
          unpaidLeaves++;
          absentDays++;
          dwBaseWage = 0;
        }
      }

      const record = dailyRecords.get(day);
      if (record && record.timeline && record.timeline.length > 0) {
        const dw = wageService.calculateDailyWage(worker, record, orgSettings);
        dwBaseWage = dw.breakdown.baseWage;
        dwOTWage = dw.breakdown.overtimeWage;
        dwAllowances = dw.breakdown.allowances;
        totalRegularHours += dw.meta.hoursWorked - dw.meta.overtimeHours;
        totalOvertimeHours += dw.meta.overtimeHours;
      }

      totalBasic += dwBaseWage;
      totalOTPay += dwOTWage;
      totalAllowances += dwAllowances;
    }

    const gross = totalBasic + totalOTPay + totalAllowances;
    const payableDays =
      presentDays +
      halfDays * 0.5 +
      weeklyOffs +
      publicHolidays +
      holidayWorkedDays +
      paidLeaves;

    const monthAdvances = advances.filter(
      a =>
        a.workerId === worker.id &&
        a.date.startsWith(month) &&
        a.status === 'APPROVED'
    );
    let advanceTotal = 0;
    const deductionDetails: { description: string; amount: number }[] = [];
    monthAdvances.forEach(adv => {
      advanceTotal += adv.amount;
      deductionDetails.push({ description: `Advance (${adv.date})`, amount: adv.amount });
    });

    const totalDeductions = advanceTotal;
    const rawNetPayable = gross - totalDeductions;
    const carriedForwardAdvance = rawNetPayable < 0 ? Math.abs(rawNetPayable) : 0;
    const finalNetPayable = rawNetPayable < 0 ? 0 : rawNetPayable;

    // FIX 2: worker.id safely used — guard against undefined at runtime
    const safeWorkerId = worker.id ?? '';

    return {
      id: `payroll_${safeWorkerId}_${month}`,
      tenantId: worker.tenantId,
      workerId: safeWorkerId,
      workerName: worker.name,
      workerDesignation: worker.designation,
      workerDepartment: worker.department,
      month,
      attendanceSummary: {
        totalDays: totalWorkingDays,
        presentDays,
        absentDays,
        halfDays,
        weeklyOffs,
        publicHolidays,
        holidayWorkedDays,
        paidLeaves,
        unpaidLeaves,
        payableDays,
        totalRegularHours: parseFloat(totalRegularHours.toFixed(1)),
        totalOvertimeHours: parseFloat(totalOvertimeHours.toFixed(1))
      },
      earnings: {
        basic: parseFloat(totalBasic.toFixed(2)),
        overtime: parseFloat(totalOTPay.toFixed(2)),
        allowances: {
          travel: 0,
          food: 0,
          other: parseFloat(totalAllowances.toFixed(2))
        },
        gross: parseFloat(gross.toFixed(2))
      },
      deductions: {
        advances: advanceTotal,
        processingFee: 0,
        canteen: 0,
        total: totalDeductions,
        details: deductionDetails
      },
      netPayable: parseFloat(finalNetPayable.toFixed(2)),
      carriedForwardAdvance: parseFloat(carriedForwardAdvance.toFixed(2)),
      status: 'DRAFT'
    };
  }
};

// src/services/attendanceLogic.ts
import { AttendanceRecord, ShiftConfig, Punch, Worker, OrgSettings } from '../types/index';

export const attendanceLogic = {
  
  /**
   * Calculates total hours based on actual punched segments (IN to OUT)
   * This ensures gaps between check-outs and check-ins are NEVER counted as work time.
   */
  calculateHours: (timeline: Punch[], breakTrackingEnabled: boolean): number => {
    if (!timeline || timeline.length === 0) return 0;

    // Sort punches chronologically
    const sorted = [...timeline].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const now = new Date().getTime();

    // Work Time = Sum of all actual (OUT - IN) segments
    let totalMs = 0;
    let lastInTime: number | null = null;

    sorted.forEach(punch => {
      const time = new Date(punch.timestamp).getTime();
      
      if (punch.type === 'IN') {
        // Prevent accidental double-INs from resetting the timer
        if (lastInTime === null) {
          lastInTime = time;
        }
      } else if (punch.type === 'OUT' && lastInTime !== null) {
        // Add the segment time and reset
        totalMs += (time - lastInTime);
        lastInTime = null; 
      }
    });

    // If the worker is currently checked IN (no OUT punch yet), add the "Live" time up to right now
    if (lastInTime !== null) {
        totalMs += (now - lastInTime);
    }

    return Math.max(0, totalMs / (1000 * 60 * 60)); // Return exact hours
  },

  /**
   * Helper to evaluate if a specific date is a weekly off for a worker
   */
  isWeeklyOff: (dateStr: string, worker: Worker, settings: OrgSettings): boolean => {
    const d = new Date(dateStr);
    const dayOfWeek = d.getDay(); // 0 = Sunday, 6 = Saturday

    // 1. Check Worker Profile Override (e.g., Security Guard gets Tuesday off)
    if (worker.weeklyOffOverride && worker.weeklyOffOverride.length > 0) {
      return worker.weeklyOffOverride.includes(dayOfWeek);
    }

    // 2. Fallback to Factory Org Default
    const config = settings.weeklyOffs;
    if (!config || !config.defaultDays) return dayOfWeek === 0;

    if (config.defaultDays.includes(dayOfWeek)) {
      if (dayOfWeek === 6 && config.saturdayRule) {
        const occurrence = Math.ceil(d.getDate() / 7);
        switch (config.saturdayRule) {
          case 'NONE': return false;
          case 'ALL': return true;
          case 'ALTERNATE': return occurrence % 2 === 0; // 2nd & 4th
          case 'FIRST_THIRD': return occurrence === 1 || occurrence === 3;
          case 'SECOND_FOURTH': return occurrence === 2 || occurrence === 4;
          default: return true;
        }
      }
      return true;
    }
    return false;
  },

  /**
   * The Master Function: Decides Status based on Logic Rules
   */
  processDailyStatus: (
    record: AttendanceRecord, 
    shift: ShiftConfig, 
    lateCountThisMonth: number,
    breakTrackingEnabled: boolean,
    worker: Worker,          // NEW 
    orgSettings: OrgSettings // NEW
  ): AttendanceRecord => {
    
    const dateStr = record.date;
    const isPubHol = orgSettings.holidays?.find(h => h.date === dateStr);
    const isWeekOff = attendanceLogic.isWeeklyOff(dateStr, worker, orgSettings);

    // 1. Get First Punch
    const firstPunch = record.timeline?.find(p => p.type === 'IN');
    
    // FIX: If timeline is empty or no IN punch, fully reset the status considering holidays
    if (!firstPunch) {
        let finalStatus: any = 'ABSENT';
        
        if (isPubHol) {
            finalStatus = isPubHol.isPaid ? 'PUBLIC_HOLIDAY' : 'UNPAID_HOLIDAY';
        } else if (isWeekOff) {
            finalStatus = 'WEEKLY_OFF';
        }

        return {
            ...record,
            status: finalStatus,
            lateStatus: { isLate: false, lateByMins: 0, penaltyApplied: false },
            hours: { gross: 0, net: 0, overtime: 0 }
        };
    }

    // 2. Calculate Lateness
    const punchTime = new Date(firstPunch.timestamp);
    const [shiftHour, shiftMin] = shift.startTime.split(':').map(Number);
    const shiftStartTime = new Date(punchTime);
    shiftStartTime.setHours(shiftHour, shiftMin, 0, 0);

    const diffMs = punchTime.getTime() - shiftStartTime.getTime();
    const lateByMins = Math.max(0, Math.floor(diffMs / (1000 * 60)));

    let isLate = lateByMins > (shift.gracePeriodMins || 15);
    let penaltyApplied = false;

    // 3. Calculate exact Net Hours based on punches
    const netHours = attendanceLogic.calculateHours(record.timeline, breakTrackingEnabled);

    // 4. Determine Status (ADVANCED LOGIC)
    let status: any = 'ABSENT';

    if (netHours < 4) {
        status = 'ABSENT'; 
    } else if (netHours >= 4 && netHours < 6) {
        status = 'HALF_DAY';
    } else {
        status = 'PRESENT';
    }

    // Grace Period Penalty Override
    if (status === 'PRESENT' && isLate && lateCountThisMonth >= (shift.maxGraceAllowed || 3)) {
        status = 'HALF_DAY';
        penaltyApplied = true;
    }

    // --- NEW: BLUE COLLAR EDGE CASE (Worked on a Holiday/Sunday) ---
    if ((isPubHol || isWeekOff) && netHours >= (shift.minHalfDayHours || 4)) {
        status = 'HOLIDAY_WORKED';
        penaltyApplied = false; // Waive late penalties on holidays since they showed up extra
    }

    // 5. Calculate Exact Shift Duration safely
    const [endH, endM] = shift.endTime.split(':').map(Number);
    let shiftDurationMins = (endH * 60 + endM) - (shiftHour * 60 + shiftMin);
    if (shiftDurationMins < 0) shiftDurationMins += 24 * 60; // Handle overnight shifts safely
    const shiftDurationHours = shiftDurationMins / 60;

    // --- CALCULATE OVERTIME WITH THRESHOLD ---
    const extraHours = Math.max(0, netHours - shiftDurationHours);
    const minOtThresholdHours = (shift.minOvertimeMins || 0) / 60;
    
    let overtime = 0;
    if (extraHours >= minOtThresholdHours) {
        overtime = extraHours; 
    }

    return {
      ...record,
      status: status,
      lateStatus: {
        isLate,
        lateByMins,
        penaltyApplied
      },
      hours: {
        gross: netHours, 
        net: parseFloat(netHours.toFixed(2)),
        overtime: parseFloat(overtime.toFixed(2))
      }
    };
  }
}
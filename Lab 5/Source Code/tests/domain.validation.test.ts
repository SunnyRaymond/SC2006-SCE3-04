import { describe, expect, it } from 'vitest';
import { DEMO_INPUT, DEMO_PROFILE } from '../src/lib/domain/fixtures';
import { planInputSchema, profileSchema, reportSchema } from '../src/lib/domain/validation';

describe('domain validation schemas', () => {
  it('accepts valid profiles at the documented capacity and charging boundaries', () => {
    expect(profileSchema.parse({ ...DEMO_PROFILE, capacityKWh: 10, maxAcKw: 1, maxDcKw: 1, reserveSoc: 5 })).toMatchObject({ capacityKWh: 10 });
    expect(profileSchema.parse({ ...DEMO_PROFILE, capacityKWh: 250, maxAcKw: 50, maxDcKw: 400, reserveSoc: 40 })).toMatchObject({ capacityKWh: 250 });
    expect(profileSchema.safeParse({ ...DEMO_PROFILE, capacityKWh: 9.99 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...DEMO_PROFILE, consumptionKWhPer100Km: 50.01 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...DEMO_PROFILE, plugTypes: [] }).success).toBe(false);
  });

  it('accepts valid plan boundaries and rejects invalid SOC, duration, strategy, and dates', () => {
    expect(planInputSchema.parse({ ...DEMO_INPUT, currentSoc: 0, maxChargingMinutes: 5, maxDetourMinutes: 0, manualTargetSoc: 100 })).toMatchObject({ currentSoc: 0 });
    expect(planInputSchema.parse({ ...DEMO_INPUT, departureAt: '2026-10-15T20:00' })).toMatchObject({ departureAt: '2026-10-15T20:00' });
    expect(planInputSchema.safeParse({ ...DEMO_INPUT, currentSoc: 100.1 }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...DEMO_INPUT, maxChargingMinutes: 4 }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...DEMO_INPUT, maxDetourMinutes: 120.1 }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...DEMO_INPUT, departureAt: '2026-02-30T12:00' }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...DEMO_INPUT, strategy: 'UNKNOWN' }).success).toBe(false);
  });

  it('validates a report submission draft without requiring server-generated record fields', () => {
    const report = {
      stationId: 'station-1', stationName: 'Demo station', connectorId: null,
      category: 'SUSPECTED_FAULTY_CONNECTOR', note: 'Connector did not start.', imagePath: null,
    };
    expect(reportSchema.parse(report)).toMatchObject({ stationId: 'station-1', category: 'SUSPECTED_FAULTY_CONNECTOR' });
    expect(reportSchema.parse({ ...report, connectorId: undefined, imagePath: undefined })).toMatchObject({ stationId: 'station-1' });
    expect(reportSchema.safeParse({ ...report, category: 'OTHER' }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report, userId: 'must-be-derived-server-side' }).success).toBe(false);
  });
});

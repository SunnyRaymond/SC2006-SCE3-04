import { z } from 'zod';
import type { PlanInput, VehicleProfile } from '../types';

const finiteNumber = z.number().finite();

const placeSchema = z.object({
  label: z.string().trim().min(1).max(160),
  lat: finiteNumber.min(-90).max(90),
  lng: finiteNumber.min(-180).max(180),
  postal: z.string().trim().max(32).optional(),
}).strict();

export const profileSchema: z.ZodType<VehicleProfile> = z.object({
  name: z.string().trim().min(1).max(100),
  capacityKWh: finiteNumber.min(10).max(250),
  consumptionKWhPer100Km: finiteNumber.min(5).max(50),
  plugTypes: z.array(z.string().trim().min(1).max(40)).min(1),
  maxAcKw: finiteNumber.min(1).max(50),
  maxDcKw: finiteNumber.min(1).max(400),
  reserveSoc: finiteNumber.min(5).max(40),
  defaultDetourMinutes: finiteNumber.min(0).max(120),
  minChargerKw: finiteNumber.min(0).max(400),
  maxWalkingM: finiteNumber.min(0),
}).strict();

const strategySchema = z.enum(['BALANCED', 'FASTEST', 'CHEAPEST', 'AVAILABILITY', 'DETOUR']);

function isDateTime(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))?$/i);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second = '0', , offsetHour, offsetMinute] = match;
  const fields = [Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second)];
  const check = new Date(Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]));
  if (check.getUTCFullYear() !== fields[0] || check.getUTCMonth() + 1 !== fields[1] || check.getUTCDate() !== fields[2]
    || fields[3] > 23 || fields[4] > 59 || fields[5] > 59) return false;
  return offsetHour === undefined || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59);
}

export const planInputSchema: z.ZodType<PlanInput> = z.object({
  origin: placeSchema,
  destination: placeSchema,
  currentSoc: finiteNumber.min(0).max(100),
  departureAt: z.string().refine(isDateTime, 'Enter a valid date and time.'),
  maxChargingMinutes: finiteNumber.min(5).max(720),
  maxDetourMinutes: finiteNumber.min(0).max(120),
  strategy: strategySchema,
  manualTargetSoc: finiteNumber.min(0).max(100).nullable(),
}).strict();

const categories = ['BLOCKED_BAY', 'SUSPECTED_FAULTY_CONNECTOR', 'INCORRECT_LOCATION', 'ACCESS_PROBLEM'] as const;

export const reportSchema = z.object({
  stationId: z.string().trim().min(1).max(128),
  stationName: z.string().trim().min(1).max(160),
  connectorId: z.string().trim().min(1).max(128).nullable().optional(),
  category: z.enum(categories),
  note: z.string().max(2000),
  imagePath: z.string().max(1024).nullable().optional(),
}).strict();

import {
  LOYALTY_PROGRAM_CODES,
  LOYALTY_STATUSES,
  type HouseholdLoyaltyProgram,
  type LoyaltyProgramCode,
  type LoyaltyStatus,
} from '../domain/loyalty';
import type { Device } from '../domain/types';
import { badRequest } from '../errors';
import { HouseholdLoyaltyRepository } from '../repositories/household-loyalty-repository';
import type { JsonObject } from '../validation';

const exposedPrograms = ['LIDL_PLUS'] as const satisfies readonly LoyaltyProgramCode[];

export class HouseholdLoyaltyService {
  constructor(private readonly repository: HouseholdLoyaltyRepository) {}

  async list(device: Device): Promise<{ loyaltyPrograms: HouseholdLoyaltyProgram[] }> {
    const configured = new Map(
      (await this.repository.list(device.householdId)).map((setting) => [setting.program, setting]),
    );
    return {
      loyaltyPrograms: exposedPrograms.map(
        (program) => configured.get(program) ?? { program, status: 'UNKNOWN' },
      ),
    };
  }

  async set(
    device: Device,
    rawProgram: string,
    body: JsonObject,
  ): Promise<HouseholdLoyaltyProgram> {
    if (
      !LOYALTY_PROGRAM_CODES.includes(rawProgram as LoyaltyProgramCode) ||
      !exposedPrograms.includes(rawProgram as (typeof exposedPrograms)[number])
    ) {
      throw badRequest('INVALID_LOYALTY_PROGRAM', 'El programa de fidelización no es válido.');
    }
    const status = body['status'];
    if (typeof status !== 'string' || !LOYALTY_STATUSES.includes(status as LoyaltyStatus)) {
      throw badRequest('INVALID_LOYALTY_STATUS', 'El estado de fidelización no es válido.');
    }
    return this.repository.setStatus(
      device.householdId,
      rawProgram as LoyaltyProgramCode,
      status as LoyaltyStatus,
      new Date().toISOString(),
    );
  }
}

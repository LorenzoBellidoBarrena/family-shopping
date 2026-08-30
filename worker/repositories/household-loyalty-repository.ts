import type { HouseholdLoyaltyProgram, LoyaltyProgramCode, LoyaltyStatus } from '../domain/loyalty';

interface LoyaltyRow {
  program_code: LoyaltyProgramCode;
  status: LoyaltyStatus;
}

export class HouseholdLoyaltyRepository {
  constructor(private readonly db: D1Database) {}

  async getStatus(householdId: string, program: LoyaltyProgramCode): Promise<LoyaltyStatus> {
    const row = await this.db
      .prepare(
        `SELECT status FROM household_loyalty_programs
         WHERE household_id = ? AND program_code = ?`,
      )
      .bind(householdId, program)
      .first<{ status: LoyaltyStatus }>();
    return row?.status ?? 'UNKNOWN';
  }

  async list(householdId: string): Promise<HouseholdLoyaltyProgram[]> {
    const { results } = await this.db
      .prepare(
        `SELECT program_code, status FROM household_loyalty_programs
         WHERE household_id = ? ORDER BY program_code`,
      )
      .bind(householdId)
      .all<LoyaltyRow>();
    return results.map((row) => ({ program: row.program_code, status: row.status }));
  }

  async setStatus(
    householdId: string,
    program: LoyaltyProgramCode,
    status: LoyaltyStatus,
    now: string,
  ): Promise<HouseholdLoyaltyProgram> {
    await this.db
      .prepare(
        `INSERT INTO household_loyalty_programs
           (household_id, program_code, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(household_id, program_code) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .bind(householdId, program, status, now, now)
      .run();
    return { program, status };
  }
}

export type BetLeg = {
  eventId: string;
  selectionId: string;
  marketId: string;
  odds: number;
};

export type BetRequest = {
  externalUserId: string;
  betType?: "single" | "multiple" | "system";
  stake: number;
  currency: string;
  legs: BetLeg[];
  idempotencyKey: string;
};

export type BetReceipt = {
  id: string;
  sportsbook: string;
  userId?: string;
  betType?: "single" | "multiple" | "system";
  status: "ACCEPTED" | "REJECTED";
  stake: number;
  currency: string;
  acceptedOdds: number;
  potentialReturn: number;
  legs: BetLeg[];
  createdAt: string;
  reason?: string;
};

export interface SportsbookAdapter {
  readonly id: string;
  validateSelections(legs: BetLeg[]): Promise<{ valid: boolean; reason?: string }>;
  placeBet(request: BetRequest): Promise<BetReceipt>;
}


export const KubraiErrorCode = {
  Unauthorized: 6000,
  FeeTooHigh: 6001,
  BadSchedule: 6002,
  ZeroAmount: 6003,
  BelowMinBet: 6004,
  MarketNotOpen: 6005,
  BettingNotStarted: 6006,
  BettingClosed: 6007,
  Paused: 6008,
  TooEarlyToResolve: 6009,
  NotProposed: 6010,
  DisputeWindowOpen: 6011,
  AlreadyFinal: 6012,
  NotResolved: 6013,
  PositionsOutstanding: 6014
};

export type KubraiErrorName = keyof typeof KubraiErrorCode;

export type BetType = "single" | "multiple" | "system";

// Stake is the total stake, split evenly across singles or all doubles.
export const priceBet = (odds: number[], type: BetType = "multiple") => {
  if (!odds.length)
    throw Object.assign(new Error("Select at least one match"), {
      statusCode: 422,
    });
  if (type === "system") {
    if (odds.length < 3)
      throw Object.assign(
        new Error("System bets require at least three matches"),
        { statusCode: 422 },
      );
    let sum = 0;
    for (let i = 0; i < odds.length; i++)
      for (let j = i + 1; j < odds.length; j++) sum += odds[i] * odds[j];
    return sum / ((odds.length * (odds.length - 1)) / 2);
  }
  return type === "single"
    ? odds.reduce((a, b) => a + b, 0) / odds.length
    : odds.reduce((a, b) => a * b, 1);
};

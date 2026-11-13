/**
 * Answers to "Did this feel fair to you?", counted, plus the averages of star ratings given before
 * that question replaced them (null when there are none).
 */
export function summarizeFeedback(
  rows: Array<{ fairness: string | null; faithfulness: number | null; neutrality: number | null }>,
): {
  fairness: { yes: number; somewhat: number; no: number };
  avgFaithfulness: number | null;
  avgNeutrality: number | null;
} {
  const fairness = { yes: 0, somewhat: 0, no: 0 };
  for (const row of rows) {
    if (row.fairness === "yes" || row.fairness === "somewhat" || row.fairness === "no") fairness[row.fairness] += 1;
  }
  const average = (values: Array<number | null>) => {
    const numbers = values.filter((value): value is number => value !== null);
    return numbers.length > 0 ? Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100 : null;
  };
  return {
    fairness,
    avgFaithfulness: average(rows.map((row) => row.faithfulness)),
    avgNeutrality: average(rows.map((row) => row.neutrality)),
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "You agree on 3 points and differ on 2." Used on the results page and in link previews. */
export function summaryLine(shared: number, differences: number, who: "You" | "They"): string {
  if (shared === 0 && differences === 0) return `${who} found no common point and no clear difference this round.`;
  if (shared === 0) return `No common point held up this round. ${who} differ on ${plural(differences, "point", "points")}.`;
  if (differences === 0) return `${who} agree on ${plural(shared, "point", "points")} and no clear difference remains.`;
  return `${who} agree on ${plural(shared, "point", "points")} and differ on ${differences}.`;
}

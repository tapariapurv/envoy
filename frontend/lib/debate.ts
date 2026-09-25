/** Debate format presets: speech order and length, POI windows (unprotected time), cross-ex periods and prep time. */
export type Speech = { name: string; sec: number; poi?: [number, number]; cx?: boolean };
export type Format = { name: string; sides: string[]; prep: number; speeches: Speech[] };

const s = (name: string, min: number, poi?: [number, number], cx?: boolean): Speech => ({ name, sec: min * 60, poi, cx });
const bp = (name: string) => s(name, 7, [60, 360]);
const ap = (name: string) => s(name, 7, [60, 360]);
const ws = (name: string) => s(name, 8, [60, 420]);

// ponytail: times are the common circuit defaults; tournaments vary, so every timer stays click-to-edit.
export const FORMATS: Record<string, Format> = {
  bp: { name: "British Parliamentary", prep: 15 * 60, sides: ["Opening Government", "Opening Opposition", "Closing Government", "Closing Opposition"],
    speeches: ["Prime Minister", "Leader of Opposition", "Deputy PM", "Deputy LO", "Member of Government", "Member of Opposition", "Government Whip", "Opposition Whip"].map(bp) },
  wsdc: { name: "World Schools", prep: 60 * 60, sides: ["Proposition", "Opposition"],
    speeches: [...["1st Proposition", "1st Opposition", "2nd Proposition", "2nd Opposition", "3rd Proposition", "3rd Opposition"].map(ws), s("Opposition Reply", 4), s("Proposition Reply", 4)] },
  ap: { name: "Asian Parliamentary", prep: 30 * 60, sides: ["Government", "Opposition"],
    speeches: [...["Prime Minister", "Leader of Opposition", "Deputy PM", "Deputy LO", "Government Whip", "Opposition Whip"].map(ap), s("Opposition Reply", 4), s("Government Reply", 4)] },
  pf: { name: "Public Forum", prep: 3 * 60, sides: ["Pro", "Con"],
    speeches: [s("Constructive (A)", 4), s("Constructive (B)", 4), s("Crossfire", 3, undefined, true), s("Rebuttal (A)", 4), s("Rebuttal (B)", 4),
      s("Crossfire", 3, undefined, true), s("Summary (A)", 3), s("Summary (B)", 3), s("Grand Crossfire", 3, undefined, true), s("Final Focus (A)", 2), s("Final Focus (B)", 2)] },
  ld: { name: "Lincoln-Douglas", prep: 4 * 60, sides: ["Affirmative", "Negative"],
    speeches: [s("1AC", 6), s("CX", 3, undefined, true), s("1NC", 7), s("CX", 3, undefined, true), s("1AR", 4), s("NR", 6), s("2AR", 3)] },
  policy: { name: "Policy", prep: 8 * 60, sides: ["Affirmative", "Negative"],
    speeches: [s("1AC", 8), s("CX", 3, undefined, true), s("1NC", 8), s("CX", 3, undefined, true), s("2AC", 8), s("CX", 3, undefined, true),
      s("2NC", 8), s("CX", 3, undefined, true), s("1NR", 5), s("1AR", 5), s("2NR", 5), s("2AR", 5)] },
};
export const EVIDENCE_FORMATS = ["pf", "ld", "policy"];
export const fmt = (id: string) => FORMATS[id] ?? FORMATS.bp;
/** The opposing bench for sparring: in BP any other team; otherwise the other side. */
export const opponents = (id: string, side: string) => fmt(id).sides.filter((x) => x !== side);

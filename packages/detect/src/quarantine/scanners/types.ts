/** The shape every scanner in this directory implements — a pure function of a candidate's files (never executed, only read as text). */
import type { CandidateSource, ScanFinding } from "../types.js";

export interface Scanner {
  readonly name: string;
  scan(candidate: CandidateSource): ScanFinding[];
}

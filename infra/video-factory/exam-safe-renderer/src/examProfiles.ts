export interface ExamProfile {
  id: string;
  name: string;
  taskHeading: string;
  taskPrompt: string;
  timerSeconds: number;
  skills: [string, string][];
  scoreLabels: string[];
  vocabulary: [string, string];
}

export const IELTS_PROFILE: ExamProfile = {
  id: "ielts-academic",
  name: "IELTS Academic",
  taskHeading: "LISTENING · PART 1",
  taskPrompt: "Complete the form below. Write NO MORE THAN TWO WORDS for each answer.",
  timerSeconds: 1800,
  skills: [["Listening", "30"], ["Reading", "60"], ["Writing", "60"], ["Speaking", "11–14"]],
  scoreLabels: ["Listening", "Reading", "Writing", "Speaking"],
  vocabulary: ["to mitigate", "substantial"],
};

export const CAMBRIDGE_PROFILE: ExamProfile = {
  id: "cambridge-b2-first",
  name: "Cambridge B2 First",
  taskHeading: "READING & USE OF ENGLISH · PART 1",
  taskPrompt: "Read the text and choose the correct answer: A, B, C or D. Practice example.",
  timerSeconds: 4500,
  skills: [["Reading & Use of English", "75"], ["Writing", "80"], ["Listening", "≈40"], ["Speaking", "14 / pair"]],
  scoreLabels: ["Reading & Use of English", "Writing", "Listening", "Speaking"],
  vocabulary: ["to improve", "confident"],
};

export function resolveExamProfile(id: unknown, series: unknown): ExamProfile {
  if (series === "cambridge") {
    if (id !== CAMBRIDGE_PROFILE.id) throw new Error("cambridge_profile_required");
    return CAMBRIDGE_PROFILE;
  }
  if (series === "ielts" && (id === undefined || id === IELTS_PROFILE.id)) return IELTS_PROFILE;
  throw new Error("unsupported_exam_profile");
}
// Add a locale here and its profile below to extend project language support.
export const projectLanguageCodes = ["zh-CN", "en-US"] as const;
export type ProjectLanguage = (typeof projectLanguageCodes)[number];
export const DEFAULT_LANGUAGE: ProjectLanguage = "zh-CN";

const profiles = {
  "zh-CN": {
    label: "中文",
    name: "中文",
    locale: "zh-CN",
    unitsPerMinute: 220,
    unitLabel: "字",
    budgetUnit: "字",
    counting: "characters",
    personalPronoun: "我",
    teamPronoun: "我们",
    outputInstruction:
      "正文必须使用中文；外文资料需要用中文讲解，保留必要的专有名词。",
    answerInstruction:
      "introduction 和 answer 均使用中文，回答通常一两句，尽量控制在 60 个汉字以内。",
    questionLeads: [
      "刚才有位听众问，",
      "我们来看这个问题：",
      "这条提问是这样的：",
    ],
    questionMark: "？",
    thumbnailLength: "通常 4 至 12 字",
    thumbnailMaxUnits: 24,
    thumbnailMaxCharacters: 24,
  },
  "en-US": {
    label: "English",
    name: "英文",
    locale: "en-US",
    unitsPerMinute: 140,
    unitLabel: "词",
    budgetUnit: "个英文单词",
    counting: "words",
    personalPronoun: "I",
    teamPronoun: "we",
    outputInstruction:
      "Write the entire spoken script in English, even when the slides, notes or reference materials are in another language. Preserve proper names and technical terms where needed.",
    answerInstruction:
      "Write both introduction and answer in English regardless of the audience question's language. Keep the answer to one or two sentences, preferably within 45 English words.",
    questionLeads: [
      "Someone in the audience asks: ",
      "Let's take this question: ",
      "Here is the question: ",
    ],
    questionMark: "?",
    thumbnailLength: "通常 3 至 8 个英文单词",
    thumbnailMaxUnits: 12,
    thumbnailMaxCharacters: 100,
  },
} as const satisfies Record<
  ProjectLanguage,
  {
    label: string;
    name: string;
    locale: string;
    unitsPerMinute: number;
    unitLabel: string;
    budgetUnit: string;
    counting: "characters" | "words";
    personalPronoun: string;
    teamPronoun: string;
    outputInstruction: string;
    answerInstruction: string;
    questionLeads: readonly string[];
    questionMark: string;
    thumbnailLength: string;
    thumbnailMaxUnits: number;
    thumbnailMaxCharacters: number;
  }
>;

export const projectLanguages = projectLanguageCodes.map((value) => ({
  value,
  label: profiles[value].label,
}));

export function languageProfile(language: ProjectLanguage = DEFAULT_LANGUAGE) {
  return profiles[language];
}

const wordSegmenters = new Map<string, Intl.Segmenter>();
export function scriptUnitCount(
  text: string,
  language: ProjectLanguage = DEFAULT_LANGUAGE,
) {
  const profile = languageProfile(language);
  if (profile.counting === "characters")
    return Array.from(text.replace(/\s/g, "")).length;
  let segmenter = wordSegmenters.get(profile.locale);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(profile.locale, { granularity: "word" });
    wordSegmenters.set(profile.locale, segmenter);
  }
  let count = 0;
  for (const segment of segmenter.segment(text))
    if (segment.isWordLike) count++;
  return count;
}

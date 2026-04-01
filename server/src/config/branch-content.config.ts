import type { CanonicalBranchCode } from "./branch-prep.config.js";

export interface BranchPackDefinition {
  id: string;
  branch: CanonicalBranchCode;
  title: string;
  description: string;
  keywords: string[];
}

export const COMMON_PLACEMENT_KEYWORDS = [
  "aptitude",
  "reasoning",
  "quantitative",
  "verbal",
  "communication",
  "resume",
  "hr interview",
  "group discussion",
  "soft skills",
  "placement essentials",
];

export const INTERVIEW_PRACTICE_KEYWORDS = [
  "interview",
  "viva",
  "hr question",
  "technical question",
  "oral",
  "resume",
  "behavioral",
  "group discussion",
  "gd",
  "self introduction",
];

export const COMPANY_PREP_KEYWORDS = [
  "tcs",
  "infosys",
  "wipro",
  "capgemini",
  "accenture",
  "cognizant",
  "deloitte",
  "zoho",
  "amazon",
  "microsoft",
];

export const TARGET_ROLE_KEYWORDS: Record<string, string[]> = {
  software: ["software", "developer", "programming", "coding", "dsa", "dbms", "sql", "python", "java"],
  analyst: ["analyst", "aptitude", "sql", "excel", "reasoning", "case study"],
  graduate_engineer_trainee: ["graduate engineer trainee", "get", "core engineering", "technical interview", "manufacturing", "surveying", "machines", "circuits"],
};

export const BRANCH_PACK_DEFINITIONS: BranchPackDefinition[] = [
  {
    id: "civil-core-practice",
    branch: "Civil",
    title: "Civil Core Practice Pack",
    description: "High-value Civil placement prep across structures, surveying, and site-facing fundamentals.",
    keywords: ["structural", "surveying", "geotechnical", "transportation", "construction"],
  },
  {
    id: "civil-interview-revision",
    branch: "Civil",
    title: "Civil Interview Quick Revision",
    description: "Shortlisting-ready interview and revision material for Civil roles.",
    keywords: ["civil interview", "site engineer", "construction management", "quality", "foundation"],
  },
  {
    id: "mechanical-core-concepts",
    branch: "ME",
    title: "Mechanical Core Concepts Pack",
    description: "Focused Mechanical practice across thermals, manufacturing, design, and practical core concepts.",
    keywords: ["thermodynamics", "manufacturing", "strength of materials", "fluid mechanics", "cad"],
  },
  {
    id: "mechanical-interview-revision",
    branch: "ME",
    title: "Mechanical Interview Quick Revision",
    description: "Fast Mechanical revision and interview-oriented material for trainee and production roles.",
    keywords: ["mechanical interview", "production", "design", "machine", "manufacturing process"],
  },
  {
    id: "electrical-core-practice",
    branch: "EEE",
    title: "Electrical Core Practice Pack",
    description: "Core Electrical and EEE preparation across circuits, machines, and power systems.",
    keywords: ["circuit theory", "electrical machines", "power systems", "control systems", "power electronics"],
  },
  {
    id: "electronics-core-practice",
    branch: "ECE",
    title: "ECE Core Practice Pack",
    description: "Core ECE preparation across digital, analog, communication systems, and embedded fundamentals.",
    keywords: ["digital electronics", "analog electronics", "communication systems", "signals", "embedded"],
  },
  {
    id: "software-foundation-essentials",
    branch: "CSE",
    title: "Software Foundation Pack",
    description: "Core CS preparation across DSA, SQL, DBMS, OS, and networks.",
    keywords: ["dsa", "dbms", "sql", "operating systems", "computer networks"],
  },
  {
    id: "it-placement-essentials",
    branch: "IT",
    title: "IT Placement Essentials",
    description: "Applied software and analyst prep across SQL, web systems, aptitude, and communication.",
    keywords: ["sql", "javascript", "python", "analyst", "aptitude"],
  },
];

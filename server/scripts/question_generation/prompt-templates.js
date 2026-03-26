export const promptTemplates = {
  analytical_structured: (topic, difficulty, count) => `You are an expert question designer for Indian campus placement tests. Generate high-quality multiple-choice questions for engineering students preparing for companies like TCS, Infosys, and Wipro.

TASK: Generate ${count} questions on the topic: ${topic}

SPECIFICATIONS:
- Difficulty Level: ${difficulty}
- Time per question: 45-90 seconds

OUTPUT FORMAT (JSON only, no markdown):
{
  "questions": [
    {
      "questionText": "Full question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "A",
      "explanation": "Step-by-step solution showing why A is correct",
      "estimatedTime": 60,
      "subtopic": "Specific subtopic within main topic",
      "tags": ["tag1", "tag2"]
    }
  ]
}

QUALITY REQUIREMENTS:
1. Questions must be unambiguous with exactly ONE correct answer
2. All options should be plausible (no obviously wrong distractors)
3. Use Indian English conventions (lakhs/crores for large numbers)
4. Include complete explanations with step-by-step working
5. Vary problem patterns within the topic
6. Match actual campus placement difficulty
7. NO questions copied from existing sources (create original problems)

Generate exactly ${count} questions following these specifications. Output ONLY valid JSON, no additional text.`,

  scenario_creative: (topic, difficulty, count) => `You are creating placement test questions for Indian engineering students. Focus on creative, real-world scenarios.

TOPIC: ${topic}
DIFFICULTY: ${difficulty}
COUNT: ${count} questions

Create engaging, scenario-based questions that feel like real-world problems using Indian context.

OUTPUT FORMAT (JSON only):
{
  "questions": [
    {
      "questionText": "Scenario + question",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "Letter",
      "explanation": "Clear solution with steps",
      "estimatedTime": 60,
      "difficulty": "${difficulty}",
      "tags": ["tag1", "tag2"]
    }
  ]
}

GUIDELINES:
- Wrap concepts in realistic stories (business problems, daily life)
- Use Indian context (cities, companies, currencies in Rs)
- Use different protagonists (Rahul, Priya, Amit, Sneha, etc.)
- Mix traditional and modern scenarios
- Ensure all calculations are mathematically correct
- Make incorrect options arise from common mistakes

Generate exactly ${count} questions. Output ONLY valid JSON.`,

  comprehensive_detailed: (topic, difficulty, count) => `Generate ${count} comprehensive placement test questions for Indian engineering students.

TOPIC: ${topic}
DIFFICULTY: ${difficulty}

OUTPUT FORMAT (JSON only):
{
  "questions": [
    {
      "questionText": "...",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "Letter",
      "explanation": "Detailed solution",
      "alternativeMethods": "Other solving approaches if applicable",
      "commonMistakes": "Why wrong answers are tempting",
      "estimatedTime": 60,
      "subtopic": "Specific area",
      "tags": ["concept1", "concept2"]
    }
  ]
}

REQUIREMENTS:
- Comprehensive coverage of ${topic}
- Educational explanations that teach concepts
- Include formula derivations where helpful
- For numerical answers, include common calculation errors as distractors
- For conceptual answers, include common misconceptions
- Verify all mathematical calculations
- Ensure technical accuracy

Generate exactly ${count} questions. Output ONLY valid JSON.`,

  code_practical: (topic, difficulty, count) => `Create ${count} practical placement test questions for campus recruitment.

TOPIC: ${topic}
DIFFICULTY: ${difficulty}

OUTPUT FORMAT (JSON only):
{
  "questions": [
    {
      "questionText": "Clear, concise question",
      "codeSnippet": "// Code if question involves programming (optional)",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
      "correctAnswer": "A/B/C/D",
      "explanation": "Practical explanation with examples",
      "language": "C/Java/Python if code involved, otherwise null",
      "estimatedTime": 60,
      "tags": ["tag1", "tag2"]
    }
  ]
}

GUIDELINES FOR PROGRAMMING QUESTIONS:
- Use clean, readable code snippets (under 15 lines)
- Follow standard conventions
- For code output questions: show execution flow in explanation
- For non-programming topics: focus on practical application
- Include both theoretical and problem-solving questions
- Cover edge cases and common pitfalls

Generate exactly ${count} questions. Output ONLY valid JSON.`,

  pattern_efficient: (topic, difficulty, count) => `Generate ${count} high-quality multiple-choice questions for campus placement preparation.

TOPIC: ${topic}
DIFFICULTY: ${difficulty}

OUTPUT FORMAT (JSON only):
{
  "questions": [
    {
      "questionText": "Question text",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "Step-by-step solution",
      "estimatedTime": 60,
      "pattern": "problem_type",
      "tags": ["tag1", "tag2"]
    }
  ]
}

QUESTION PATTERNS:
- 40% Direct application (straightforward formula use)
- 30% Multi-step problems (combine 2-3 concepts)
- 20% Applied scenarios (word problems)
- 10% Analysis questions (compare approaches, identify errors)

OPTION DESIGN:
- Use graduated values (if answer is 50: options are [40, 45, 50, 55])
- Include results from common mistakes
- Include result if units not converted
- Avoid patterns in correct answers

EFFICIENCY:
- Questions solvable in 45-90 seconds
- Use round numbers when possible
- Concise wording
- All calculations verified

Generate exactly ${count} questions. Output ONLY valid JSON.`,
};

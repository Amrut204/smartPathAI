const fs = require('fs');
const path = require('path');
const https = require('https');

const MATERIAL_DIR = path.resolve('C:/vscode/smartPathAI-mern/material');
const OUTPUT_DIR = path.resolve('C:/vscode/smartPathAI-mern/analysis_output/study_documents');
const MANIFEST_FILE = path.join(OUTPUT_DIR, 'manifest.jsonl');

const EXCLUDED_DIRS = [
    'node_modules', 'dist', '.git', 'analysis_output',
    'placement_scraper_output', 'open_resource_scraper',
    'question_source_scraper', 'repo_resource_harvester'
];

function getFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = path.relative(MATERIAL_DIR, fullPath).replace(/\\/g, '/');

        let shouldExclude = false;
        for (const ex of EXCLUDED_DIRS) {
            if (relativePath.startsWith(ex + '/') || relativePath === ex || relativePath.includes('/' + ex + '/')) {
                shouldExclude = true;
                break;
            }
        }
        if (shouldExclude) continue;

        if (fs.statSync(fullPath).isDirectory()) {
            getFiles(fullPath, files);
        } else {
            const ext = path.extname(fullPath).toLowerCase();
            if (['.md', '.markdown', '.txt'].includes(ext)) {
                files.push(fullPath);
            }
        }
    }
    return files;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callAIGemini(promptText) {
    const key = process.env.GEMINI_API_KEY;
    const body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    });

    return new Promise((resolve, reject) => {
        const req = https.request(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Gemini API Error: ${res.statusCode} ${data}`));
                } else {
                    try {
                        const json = JSON.parse(data);
                        let text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (!text) throw new Error(`No text in Gemini response. Full response: ${data}`);
                        resolve(text);
                    } catch (e) {
                        reject(e);
                    }
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function callAIGroq(promptText) {
    const groqKey = process.env.GROQ_API_KEY;
    const body = JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: promptText }],
        temperature: 0.1,
        response_format: { type: "json_object" }
    });

    return new Promise((resolve, reject) => {
        const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Groq API Error: ${res.statusCode} ${data}`));
                } else {
                    try {
                        const json = JSON.parse(data);
                        if (!json.choices || !json.choices[0] || !json.choices[0].message) {
                            throw new Error(`Invalid Groq response: ${data}`);
                        }
                        resolve(json.choices[0].message.content);
                    } catch (e) {
                        reject(e);
                    }
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function processContent(content) {
    const limit = 6000;
    if (content.length > limit) content = content.substring(0, limit) + "... [truncated]";

    const sysPrompt = `You are a read-only content transformation assistant.
Your task is to transform local note-style resource files into a structured JSON "study document".
If the source file is empty, junk, navigation-only, badge-only, or not useful for learning, output exactly {"status": "rejected"}.
If it has very little educational value, output {"status": "low_quality"}.

Otherwise, infer the topic and extract the core explanation.
Remove noisy content (badges, banners, installation instructions unless educational, repo boilerplate, raw HTML, links).
Prefer educational clarity over source fidelity. Convert messy README content into student-friendly notes.

Output ONLY valid JSON matching exactly this schema:
{
  "status": "ok",
  "title": "clean inferred title",
  "topic": "best inferred topic",
  "subtopic": "best inferred subtopic",
  "branch_relevance": ["CSE","IT","ECE","EEE","ME","Civil"] or ["all"],
  "career_tracks": ["aptitude","verbal","HR interview","technical interview","core subjects","software placement crossover","analyst/data crossover"],
  "difficulty": "easy" | "medium" | "hard" | "unknown",
  "resource_type": "study_document",
  "what_this_covers": "short paragraph",
  "key_concepts": ["concept 1", "concept 2", "etc"],
  "important_definitions": ["def 1", "def 2", "etc"],
  "core_explanation": "clear learner-friendly explanation in Markdown, no raw HTML",
  "step_by_step_understanding": ["step 1", "step 2", "etc"],
  "interview_focus": ["point 1", "etc"],
  "common_mistakes": ["mistake 1", "etc"],
  "quick_revision_points": ["point 1", "etc"],
  "practice_prompts": ["prompt 1", "etc"],
  "recommended_for": ["audience 1", "etc"],
  "search_text": "dense retrieval-friendly paragraph including topic terms, interview terms, formulas, concepts, and likely search phrases",
  "source_quality_notes": "brief note about source cleanup quality"
}

Text to process:
----------------
${content}
`;

    return callAIGemini(sysPrompt).catch(err => {
        console.warn('Gemini failed, trying Groq...', err.message);
        return callAIGroq(sysPrompt);
    });
}

const PRIORITY_WORDS = ['dbms', 'sql', 'dsa', 'os', 'cn', 'oop', 'aptitude', 'interview', 'placement', 'reasoning', 'electronics', 'mechanical', 'civil', 'electrical'];

function getPriorityScore(filePath) {
    let lowerPath = filePath.toLowerCase();
    let score = 0;
    for (let word of PRIORITY_WORDS) {
        if (lowerPath.includes(word)) score += 1;
    }
    return score;
}

function writeManifest(entries) {
    fs.writeFileSync(MANIFEST_FILE, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    let manifestEntries = [];
    let processedPaths = new Set();

    if (fs.existsSync(MANIFEST_FILE)) {
        const lines = fs.readFileSync(MANIFEST_FILE, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                manifestEntries.push(entry);
                if (['ok', 'rejected', 'low_quality'].includes(entry.status)) {
                    processedPaths.add(entry.source_path);
                }
            } catch (e) {
                // ignore invalid lines
            }
        }
    }

    console.log("Scanning files to find failed/unprocessed ones...");
    const allFiles = getFiles(MATERIAL_DIR);

    let failedFiles = [];

    // Check manifest for explicit fails first
    for (const entry of manifestEntries) {
        if (entry.status === 'failed') {
            failedFiles.push(entry.source_path);
        }
    }

    // Since previous script might not have written failed/rejected to manifest, we do the fast heuristic inline to figure out what was implicit fail
    let newlyRejectedCount = 0;

    for (const file of allFiles) {
        let fPath = file.replace(/\\/g, '/');
        if (processedPaths.has(fPath) || failedFiles.includes(fPath)) continue;

        let content = '';
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch (e) { continue; }

        let textLower = content.toLowerCase();
        let plainText = content.replace(/!\[.*?\]\(.*?\)/g, '')
            .replace(/\[.*?\]\(.*?\)/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/```[\s\S]*?```/g, '')
            .trim();
        let words = plainText.split(/\s+/).filter(w => w.length > 1);

        if (
            words.length < 10 ||
            (textLower.includes('<!doctype html') && !textLower.includes('class')) ||
            (textLower.startsWith('{"') && textLower.endsWith('}')) ||
            textLower.includes('t.me/campusdrive') ||
            textLower.includes('@campusdrive') ||
            (plainText.length < 30)
        ) {
            // implicit rejected
            manifestEntries.push({
                source_path: fPath,
                relative_path: path.relative(MATERIAL_DIR, file).replace(/\\/g, '/'),
                file_name: path.basename(file),
                status: 'rejected',
                reason: 'heuristic_filter'
            });
            processedPaths.add(fPath);
            newlyRejectedCount++;
        } else {
            // implicit failed
            failedFiles.push(fPath);
        }
    }

    // Sort failed files by priority
    failedFiles.sort((a, b) => getPriorityScore(b) - getPriorityScore(a));

    // Keep max 20
    let toProcess = failedFiles.slice(0, 20);

    const summary = {
        failed_considered: failedFiles.length,
        retried_this_run: toProcess.length,
        newly_successful: 0,
        newly_rejected: newlyRejectedCount, // including heuristic
        still_failed: failedFiles.length - toProcess.length,
        rate_limited_count: 0,
        topics: {}
    };

    let rateLimited = false;

    for (let i = 0; i < toProcess.length; i++) {
        if (rateLimited) {
            summary.still_failed++;
            continue;
        }

        let file = toProcess[i];
        let relativePathStr = path.relative(MATERIAL_DIR, file).replace(/\\/g, '/');
        console.log(`[${i + 1}/${toProcess.length}] Retrying ${relativePathStr}`);

        let content = fs.readFileSync(file, 'utf8');
        let aiResultObj = null;
        let isApiFail = false;

        try {
            let aiResultText = await processContent(content);
            aiResultText = aiResultText.replace(/^\s*```(json)?\n?/, '').replace(/```\n?\s*$/, '').trim();
            aiResultObj = JSON.parse(aiResultText);
        } catch (err) {
            console.error(`Error processing ${relativePathStr}: ${err.message}`);
            isApiFail = true;
            if (err.message.includes('429') || err.message.toLowerCase().includes('quota') || err.message.includes('limits')) {
                rateLimited = true;
                summary.rate_limited_count++;
            }
        }

        let existingIdx = manifestEntries.findIndex(e => e.source_path === file);
        let baseEntry = {
            source_path: file.replace(/\\/g, '/'),
            relative_path: relativePathStr,
            file_name: path.basename(file)
        };

        if (isApiFail || !aiResultObj) {
            summary.still_failed++;
            baseEntry.status = 'failed';
            baseEntry.reason = rateLimited ? 'rate_limit' : 'parse_error';
            if (existingIdx !== -1) manifestEntries[existingIdx] = baseEntry;
            else manifestEntries.push(baseEntry);

            if (rateLimited) {
                console.log("Rate limit hit. Stopping batch early.");
                break;
            }
            continue;
        }

        if (['rejected', 'low_quality'].includes(aiResultObj.status)) {
            summary.newly_rejected++;
            baseEntry.status = aiResultObj.status;
            if (existingIdx !== -1) manifestEntries[existingIdx] = baseEntry;
            else manifestEntries.push(baseEntry);
            continue;
        }

        summary.newly_successful++;
        const topic = aiResultObj.topic || 'unknown';
        summary.topics[topic] = (summary.topics[topic] || 0) + 1;

        Object.assign(baseEntry, aiResultObj);
        baseEntry.resource_type = "study_document";

        const safeBaseName = relativePathStr.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 150);
        const jsonOutPath = path.join(OUTPUT_DIR, safeBaseName + '.json');
        const mdOutPath = path.join(OUTPUT_DIR, safeBaseName + '.md');

        fs.writeFileSync(jsonOutPath, JSON.stringify(baseEntry, null, 2), "utf8");

        const mdContent = `# ${baseEntry.title || 'Untitled'}

Source Path: ${baseEntry.source_path}
Relative Path: ${baseEntry.relative_path}

## What This Covers
${baseEntry.what_this_covers || 'N/A'}

## Key Concepts
${(baseEntry.key_concepts || []).map(x => '- ' + x).join('\n')}

## Important Definitions
${(baseEntry.important_definitions || []).map(x => '- ' + x).join('\n')}

## Core Explanation
${baseEntry.core_explanation || 'N/A'}

## Step-by-Step Understanding
${(baseEntry.step_by_step_understanding || []).map((x, j) => (j + 1) + '. ' + x).join('\n')}

## Interview Focus
${(baseEntry.interview_focus || []).map(x => '- ' + x).join('\n')}

## Common Mistakes
${(baseEntry.common_mistakes || []).map(x => '- ' + x).join('\n')}

## Quick Revision Points
${(baseEntry.quick_revision_points || []).map(x => '- ' + x).join('\n')}

## Practice Prompts
${(baseEntry.practice_prompts || []).map(x => '- ' + x).join('\n')}

## Recommended For
${(baseEntry.recommended_for || []).map(x => '- ' + x).join('\n')}

## Source Quality Notes
${baseEntry.source_quality_notes || 'N/A'}
`;
        fs.writeFileSync(mdOutPath, mdContent.trim(), "utf8");

        if (existingIdx !== -1) manifestEntries[existingIdx] = baseEntry;
        else manifestEntries.push(baseEntry);

        // Sleep to avoid rate limiting
        await sleep(3000);
    }

    writeManifest(manifestEntries);

    console.log("\n===============================");
    console.log("RETRY RUN SUMMARY");
    console.log(`- failed files considered: ${summary.failed_considered}`);
    console.log(`- files retried this run: ${summary.retried_this_run}`);
    console.log(`- newly transformed successfully: ${summary.newly_successful}`);
    console.log(`- newly rejected (including heuristics): ${summary.newly_rejected}`);
    console.log(`- still failed: ${summary.still_failed}`);
    console.log(`- rate-limited count: ${summary.rate_limited_count}`);

    // Top inferred topics
    const sortedTopics = Object.entries(summary.topics).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log("- top topics from newly successful files:");
    sortedTopics.forEach(([t, c]) => {
        console.log(`  * ${t} (${c} items)`);
    });
    console.log("===============================");
}

main().catch(console.error);

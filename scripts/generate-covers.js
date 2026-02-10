#!/usr/bin/env node

/**
 * Generate cover images for posts without images using Google Gemini
 *
 * Usage:
 *   GEMINI_API_KEY=your_key node scripts/generate-covers.js
 *
 * Or set GEMINI_API_KEY in .env file
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const POSTS_DIR = path.join(__dirname, '../_posts');
const IMAGES_DIR = path.join(__dirname, '../assets/images/posts');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is required');
  console.error('Usage: GEMINI_API_KEY=your_key node scripts/generate-covers.js');
  process.exit(1);
}

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// Parse front matter from markdown file
function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontMatter = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontMatter[key] = value;
    }
  }

  return { frontMatter, raw: match[0], content: content.slice(match[0].length) };
}

// Generate image using Gemini 3 Pro Image Preview (Nano Banana Pro)
async function generateImage(title, description) {
  const prompt = `Create a minimal, elegant cover image for a blog post titled "${title}".
Style: Modern editorial illustration, muted colors, clean composition.
Theme: ${description || title}.
No text or words in the image.`;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "2K"
        }
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          const parts = response.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.mimeType?.startsWith('image/')) {
              resolve(Buffer.from(part.inlineData.data, 'base64'));
              return;
            }
          }
          reject(new Error('No image in response: ' + JSON.stringify(response).slice(0, 500)));
        } catch (e) {
          reject(new Error('Failed to parse response: ' + body.slice(0, 500)));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Update front matter with image path
function updateFrontMatter(filePath, imagePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseFrontMatter(content);
  if (!parsed) return;

  // Add image field after existing front matter
  const lines = parsed.raw.split('\n');
  const newLines = [];
  let inserted = false;

  for (let i = 0; i < lines.length; i++) {
    newLines.push(lines[i]);
    // Insert after title or description line
    if (!inserted && (lines[i].startsWith('title:') || lines[i].startsWith('description:'))) {
      if (i + 1 < lines.length && !lines[i + 1].startsWith('image:')) {
        // Check if next line is not already image
        if (lines[i].startsWith('description:') ||
            (lines[i].startsWith('title:') && !lines.some(l => l.startsWith('description:')))) {
          newLines.push(`image: ${imagePath}`);
          inserted = true;
        }
      }
    }
  }

  if (!inserted) {
    // Insert before closing ---
    newLines.splice(newLines.length - 1, 0, `image: ${imagePath}`);
  }

  const newContent = newLines.join('\n') + parsed.content;
  fs.writeFileSync(filePath, newContent);
}

async function main() {
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));

  console.log(`Found ${files.length} posts`);

  for (const file of files) {
    const filePath = path.join(POSTS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFrontMatter(content);

    if (!parsed) {
      console.log(`Skipping ${file}: no front matter`);
      continue;
    }

    if (parsed.frontMatter.image) {
      console.log(`Skipping ${file}: already has image`);
      continue;
    }

    const title = parsed.frontMatter.title || file.replace('.md', '');
    const description = parsed.frontMatter.description || parsed.frontMatter.subtitle || '';

    console.log(`Generating image for: ${title}`);

    try {
      const imageBuffer = await generateImage(title, description);

      // Generate filename from post filename
      const imageName = file.replace('.md', '.png');
      const imagePath = path.join(IMAGES_DIR, imageName);
      const relativeImagePath = `/assets/images/posts/${imageName}`;

      fs.writeFileSync(imagePath, imageBuffer);
      console.log(`  Saved: ${imagePath}`);

      // Update post front matter
      updateFrontMatter(filePath, relativeImagePath);
      console.log(`  Updated front matter`);

    } catch (error) {
      console.error(`  Error generating image: ${error.message}`);
    }

    // Rate limiting - wait 2 seconds between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('Done!');
}

main().catch(console.error);

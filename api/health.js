import { env } from './_lib.js';

// Tells the page which services are configured and whether the password is right.
export default function handler(req, res) {
  const pw = process.env.APP_PASSWORD;
  res.status(200).json({
    password_required: !!pw,
    authorized: !pw || req.headers['x-app-password'] === pw,
    claude: !!env.claudeKey(),
    voice: !!(env.elevenKey() && env.elevenVoice()),
    transcribe: !!env.elevenKey(),
    character: env.characterName(),
  });
}

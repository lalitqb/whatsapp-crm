import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach((line) => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const encryptionKeyHex = env.ENCRYPTION_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase config in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GCM_IV_LENGTH = 12;
const CBC_IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');

  if (parts.length === 3) {
    // GCM — current format.
    const [ivHex, ctHex, tagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(encryptionKeyHex, 'hex'),
      iv,
    );
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ctHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  throw new Error(`Unexpected part count: ${parts.length}`);
}

async function run() {
  console.log('Fetching WhatsApp Config...');
  const { data: configs, error: configErr } = await supabase
    .from('whatsapp_config')
    .select('*');

  if (configErr) {
    console.error('Config fetch error:', configErr);
    return;
  }

  console.log(`Found ${configs?.length || 0} configs:`);
  for (const config of configs || []) {
    let token = 'FAILED_TO_DECRYPT';
    try {
      token = decrypt(config.access_token);
    } catch (e) {
      token = `Decryption failed: ${e.message}`;
    }
    console.log({
      id: config.id,
      user_id: config.user_id,
      phone_number_id: config.phone_number_id,
      waba_id: config.waba_id,
      status: config.status,
      token: token.substring(0, 15) + '...',
      fullTokenLength: token.length,
    });
  }
}

run();

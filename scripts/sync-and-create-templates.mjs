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

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length === 3) {
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

function categoryToMeta(category) {
  switch (category) {
    case 'Utility':
      return 'UTILITY';
    case 'Authentication':
      return 'AUTHENTICATION';
    default:
      return 'MARKETING';
  }
}

function buildMetaComponents({ body_text, footer_text, header_type, header_content }) {
  const components = [];

  if (header_type === 'text' && header_content?.trim()) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: header_content.trim(),
    });
  }

  components.push({
    type: 'BODY',
    text: body_text.trim(),
  });

  if (footer_text?.trim()) {
    components.push({
      type: 'FOOTER',
      text: footer_text.trim(),
    });
  }

  return components;
}

async function run() {
  // 1. Load active config
  const { data: configs } = await supabase
    .from('whatsapp_config')
    .select('*')
    .limit(1);

  if (!configs || configs.length === 0) {
    console.error('No WhatsApp config found in database.');
    return;
  }

  const config = configs[0];
  const wabaId = config.waba_id;
  const accessToken = decrypt(config.access_token);
  const userId = config.user_id;

  console.log(`Using WABA ID: ${wabaId}`);

  // 2. Fetch existing templates on Meta
  console.log('Fetching existing templates from Meta...');
  const metaUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=1000&fields=id,name,language,status`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    console.error('Failed to fetch templates from Meta:', errText);
    return;
  }

  const metaData = await metaRes.json();
  const metaTemplates = metaData.data || [];
  const metaMap = new Map(); // key: "name:lang" -> status
  for (const t of metaTemplates) {
    metaMap.set(`${t.name}:${t.language}`, t.status);
  }

  console.log(`Found ${metaTemplates.length} templates on Meta.`);

  // 3. Fetch templates from local Supabase DB
  console.log('Fetching local templates from database...');
  const { data: dbTemplates, error: templatesErr } = await supabase
    .from('message_templates')
    .select('*')
    .eq('user_id', userId);

  if (templatesErr) {
    console.error('Failed to fetch local templates:', templatesErr);
    return;
  }

  console.log(`Found ${dbTemplates.length} local templates.`);

  // 4. Create missing templates on Meta
  for (const t of dbTemplates) {
    // Skip default hello_world template
    if (t.name === 'hello_world') continue;

    const key = `${t.name}:${t.language}`;
    if (metaMap.has(key)) {
      const metaStatus = metaMap.get(key);
      console.log(`Template "${t.name}" (${t.language}) already exists on Meta with status: ${metaStatus}`);

      // If status mismatch, let's update it locally
      const normalizedStatus = metaStatus === 'APPROVED' ? 'Approved' : metaStatus === 'PENDING' ? 'Pending' : 'Rejected';
      if (t.status !== normalizedStatus) {
        console.log(`Updating local status of "${t.name}" from "${t.status}" to "${normalizedStatus}"...`);
        await supabase
          .from('message_templates')
          .update({ status: normalizedStatus, updated_at: new Date().toISOString() })
          .eq('id', t.id);
      }
      continue;
    }

    // Media headers (image, video, document) cannot be submitted through this API
    if (t.header_type && t.header_type !== 'text' && t.header_type !== 'none') {
      console.log(`Skipping template "${t.name}" because it has a media header (${t.header_type}) which must be created in Meta WhatsApp Manager.`);
      continue;
    }

    console.log(`Creating template "${t.name}" (${t.language}) on Meta...`);

    const components = buildMetaComponents({
      body_text: t.body_text,
      footer_text: t.footer_text,
      header_type: t.header_type,
      header_content: t.header_content,
    });

    const createUrl = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: t.name,
        language: t.language,
        category: categoryToMeta(t.category),
        components,
      }),
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      console.error(`Failed to create template "${t.name}":`, createData.error?.message || createData);
    } else {
      console.log(`Successfully created template "${t.name}"! Meta ID: ${createData.id}, Status: ${createData.status}`);
      const normalizedStatus = createData.status === 'APPROVED' ? 'Approved' : 'Pending';
      await supabase
        .from('message_templates')
        .update({ status: normalizedStatus, updated_at: new Date().toISOString() })
        .eq('id', t.id);
    }
  }

  console.log('\nFinished synchronization and creation of templates.');
}

run();

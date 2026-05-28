'use client';

import { TemplateManager } from '@/components/settings/template-manager';

export default function TemplateManagerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Template Manager</h1>
        <p className="mt-1 text-sm text-slate-400">
          Create, sync, and manage WhatsApp message templates.
        </p>
      </div>

      <TemplateManager />
    </div>
  );
}
